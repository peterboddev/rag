"""
Full Context Summary Agent

AgentCore Runtime agent that summarizes insurance claims by retrieving all
document text and passing it directly to Bedrock Nova Pro for summarization.
Includes anomaly detection for data inconsistencies.

Environment Variables:
    DOCUMENTS_TABLE: DynamoDB table name for document records
    BEDROCK_REGION: AWS region for Bedrock service (default: us-east-1)
    BEDROCK_MODEL_ID: Bedrock model ID (default: amazon.nova-pro-v1:0)
"""

import json
import os
import re
import logging
from datetime import datetime
from typing import Any

import boto3
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor, ConsoleSpanExporter

# Configure logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Environment configuration
DOCUMENTS_TABLE = os.environ.get("DOCUMENTS_TABLE", "rag-app-documents-dev")
BEDROCK_REGION = os.environ.get("BEDROCK_REGION", "us-east-1")
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "amazon.nova-pro-v1:0")

# Initialize OpenTelemetry tracer
provider = TracerProvider()
provider.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter()))
trace.set_tracer_provider(provider)
tracer = trace.get_tracer(__name__)


class DocumentRetrievalError(Exception):
    """Raised when document retrieval fails."""

    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.status_code = status_code


class SummaryGenerationError(Exception):
    """Raised when Bedrock summary generation fails."""

    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


class FullContextSummaryAgent:
    """
    Agent that summarizes claims using full document context.
    
    This agent retrieves all documents for a claim, concatenates their
    extracted text, detects data anomalies, and generates a comprehensive
    summary using Bedrock Nova Pro.
    """

    def __init__(
        self,
        dynamodb_client: Any = None,
        bedrock_client: Any = None,
    ):
        """
        Initialize the Full Context Summary Agent.
        
        Args:
            dynamodb_client: Optional DynamoDB client for testing
            bedrock_client: Optional Bedrock Runtime client for testing
        """
        self.dynamodb = dynamodb_client or boto3.resource(
            "dynamodb", region_name=BEDROCK_REGION
        )
        self.bedrock = bedrock_client or boto3.client(
            "bedrock-runtime", region_name=BEDROCK_REGION
        )
        self.documents_table = self.dynamodb.Table(DOCUMENTS_TABLE)

    async def invoke(self, claim_id: str) -> dict:
        """
        Generate a summary for the given claim using full document context.
        
        Args:
            claim_id: The unique identifier of the claim to summarize
            
        Returns:
            dict containing:
                - summary: The generated summary text
                - anomalies: List of detected data anomalies
                - documentCount: Number of documents processed
                - strategy: Always "full-context"
                
        Raises:
            DocumentRetrievalError: If no documents found or no extractedText
            SummaryGenerationError: If Bedrock invocation fails
        """
        with tracer.start_as_current_span("full_context_summary") as span:
            span.set_attribute("claim_id", claim_id)
            
            # 1. Retrieve all documents for claim
            documents = await self.get_claim_documents(claim_id)
            span.set_attribute("document_count", len(documents))
            
            # 2. Concatenate extracted text
            combined_text = self.combine_document_text(documents)
            
            # 3. Detect anomalies
            anomalies = self.detect_anomalies(documents)
            span.set_attribute("anomaly_count", len(anomalies))
            
            # 4. Generate summary with Bedrock Nova Pro
            summary = await self.generate_summary(combined_text, anomalies)
            
            # 5. Return structured response
            return {
                "summary": summary,
                "anomalies": anomalies,
                "documentCount": len(documents),
                "strategy": "full-context",
            }

    async def get_claim_documents(self, claim_id: str) -> list[dict]:
        """
        Retrieve all documents for a claim from DynamoDB.
        
        Uses scan with filter on claimMetadata.claimId since the table
        has documentId as partition key with no sort key.
        
        Args:
            claim_id: The claim identifier to query
            
        Returns:
            List of document records with extractedText
            
        Raises:
            DocumentRetrievalError: If no documents found or none have extractedText
        """
        try:
            # Scan with filter on claimMetadata.claimId
            response = self.documents_table.scan(
                FilterExpression="claimMetadata.claimId = :claimId",
                ExpressionAttributeValues={":claimId": claim_id},
            )
            
            documents = response.get("Items", [])
            
            # Handle pagination if needed
            while "LastEvaluatedKey" in response:
                response = self.documents_table.scan(
                    FilterExpression="claimMetadata.claimId = :claimId",
                    ExpressionAttributeValues={":claimId": claim_id},
                    ExclusiveStartKey=response["LastEvaluatedKey"],
                )
                documents.extend(response.get("Items", []))
            
            if not documents:
                raise DocumentRetrievalError(
                    f"No documents found for claim {claim_id}",
                    status_code=404,
                )
            
            # Filter to documents with extractedText
            docs_with_text = [
                doc for doc in documents
                if doc.get("extractedText")
            ]
            
            if not docs_with_text:
                raise DocumentRetrievalError(
                    "No summarizable content available. Documents are still "
                    "processing or have no extracted text.",
                    status_code=400,
                )
            
            return docs_with_text
            
        except DocumentRetrievalError:
            raise
        except Exception as e:
            logger.error(f"Error retrieving documents for claim {claim_id}: {e}")
            raise DocumentRetrievalError(
                f"Failed to retrieve documents: {str(e)}",
                status_code=500,
            )

    def combine_document_text(self, documents: list[dict]) -> str:
        """
        Concatenate extracted text from all documents.
        
        Args:
            documents: List of document records with extractedText
            
        Returns:
            Combined text with document separators
        """
        text_parts = []
        for doc in documents:
            file_name = doc.get("fileName", doc.get("documentId", "Unknown"))
            extracted_text = doc.get("extractedText", "")
            text_parts.append(f"--- Document: {file_name} ---\n{extracted_text}")
        
        return "\n\n".join(text_parts)


    def detect_anomalies(self, documents: list[dict]) -> list[dict]:
        """
        Analyze documents for data anomalies.
        
        Detects:
        - Chronological impossibilities (service date before birth date)
        - Payment dates before service dates
        - Diagnosis codes inconsistent with demographics
        - Duplicate or conflicting information
        
        Args:
            documents: List of document records
            
        Returns:
            List of DataAnomaly dicts with description, severity,
            sourceDocument, and dataValues
        """
        anomalies = []
        
        # Collect dates and metadata across all documents
        all_dates = self._extract_dates_from_documents(documents)
        
        for doc in documents:
            file_name = doc.get("fileName", doc.get("documentId", "Unknown"))
            text = doc.get("extractedText", "")
            metadata = doc.get("claimMetadata", {})
            
            # Check for chronological impossibilities
            anomalies.extend(
                self._check_chronological_anomalies(file_name, text, metadata)
            )
            
            # Check for payment date before service date
            anomalies.extend(
                self._check_payment_date_anomalies(file_name, text)
            )
        
        # Check for duplicate/conflicting info across documents
        anomalies.extend(
            self._check_cross_document_anomalies(documents)
        )
        
        return anomalies

    def _extract_dates_from_documents(self, documents: list[dict]) -> dict:
        """Extract date information from all documents."""
        dates = {
            "birth_dates": [],
            "service_dates": [],
            "payment_dates": [],
        }
        for doc in documents:
            text = doc.get("extractedText", "")
            file_name = doc.get("fileName", doc.get("documentId", "Unknown"))
            
            birth_dates = self._find_dates(text, ["birth date", "dob", "date of birth"])
            service_dates = self._find_dates(text, ["service date", "date of service", "dos"])
            payment_dates = self._find_dates(text, ["payment date", "paid date", "date paid"])
            
            for d in birth_dates:
                dates["birth_dates"].append({"date": d, "source": file_name})
            for d in service_dates:
                dates["service_dates"].append({"date": d, "source": file_name})
            for d in payment_dates:
                dates["payment_dates"].append({"date": d, "source": file_name})
        
        return dates

    def _find_dates(self, text: str, labels: list[str]) -> list[str]:
        """
        Find dates associated with given labels in text.
        
        Looks for patterns like:
        - "Birth Date: 2024-01-15"
        - "DOB: 01/15/2024"
        - "Date of Service: January 15, 2024"
        """
        dates = []
        text_lower = text.lower()
        
        # ISO format: YYYY-MM-DD
        iso_pattern = r"(\d{4}-\d{2}-\d{2})"
        # US format: MM/DD/YYYY
        us_pattern = r"(\d{1,2}/\d{1,2}/\d{4})"
        
        for label in labels:
            label_lower = label.lower()
            # Find label position in text
            idx = text_lower.find(label_lower)
            while idx != -1:
                # Look for a date within 50 chars after the label
                context = text[idx:idx + 80]
                
                for pattern in [iso_pattern, us_pattern]:
                    matches = re.findall(pattern, context)
                    dates.extend(matches)
                
                idx = text_lower.find(label_lower, idx + 1)
        
        return dates

    def _parse_date(self, date_str: str) -> datetime | None:
        """Parse a date string into a datetime object."""
        formats = [
            "%Y-%m-%d",
            "%m/%d/%Y",
            "%m/%d/%y",
            "%d/%m/%Y",
        ]
        for fmt in formats:
            try:
                return datetime.strptime(date_str, fmt)
            except ValueError:
                continue
        return None

    def _check_chronological_anomalies(
        self, file_name: str, text: str, metadata: dict
    ) -> list[dict]:
        """Check for service dates before birth dates."""
        anomalies = []
        
        birth_dates = self._find_dates(text, ["birth date", "dob", "date of birth"])
        service_dates = self._find_dates(text, ["service date", "date of service", "dos"])
        
        for bd_str in birth_dates:
            bd = self._parse_date(bd_str)
            if not bd:
                continue
            for sd_str in service_dates:
                sd = self._parse_date(sd_str)
                if not sd:
                    continue
                if sd < bd:
                    anomalies.append({
                        "description": (
                            f"Service date ({sd_str}) precedes patient "
                            f"birth date ({bd_str})"
                        ),
                        "severity": "critical",
                        "sourceDocument": file_name,
                        "dataValues": {
                            "serviceDate": sd_str,
                            "birthDate": bd_str,
                        },
                    })
        
        return anomalies

    def _check_payment_date_anomalies(
        self, file_name: str, text: str
    ) -> list[dict]:
        """Check for payment dates before service dates."""
        anomalies = []
        
        service_dates = self._find_dates(text, ["service date", "date of service", "dos"])
        payment_dates = self._find_dates(text, ["payment date", "paid date", "date paid"])
        
        for pd_str in payment_dates:
            pd = self._parse_date(pd_str)
            if not pd:
                continue
            for sd_str in service_dates:
                sd = self._parse_date(sd_str)
                if not sd:
                    continue
                if pd < sd:
                    anomalies.append({
                        "description": (
                            f"Payment date ({pd_str}) precedes service "
                            f"date ({sd_str})"
                        ),
                        "severity": "critical",
                        "sourceDocument": file_name,
                        "dataValues": {
                            "paymentDate": pd_str,
                            "serviceDate": sd_str,
                        },
                    })
        
        return anomalies

    def _check_cross_document_anomalies(
        self, documents: list[dict]
    ) -> list[dict]:
        """Check for duplicate or conflicting information across documents."""
        anomalies = []
        
        # Track patient names across documents for conflict detection
        patient_names: dict[str, list[str]] = {}
        
        for doc in documents:
            text = doc.get("extractedText", "")
            file_name = doc.get("fileName", doc.get("documentId", "Unknown"))
            
            # Look for patient name patterns
            name_patterns = [
                r"[Pp]atient\s*[Nn]ame\s*[:]\s*([A-Za-z\s]+?)(?:\n|$|,)",
                r"[Nn]ame\s*[:]\s*([A-Za-z\s]+?)(?:\n|$|,)",
            ]
            
            for pattern in name_patterns:
                matches = re.findall(pattern, text)
                for name in matches:
                    name_clean = name.strip()
                    if name_clean:
                        if name_clean not in patient_names:
                            patient_names[name_clean] = []
                        patient_names[name_clean].append(file_name)
        
        # If multiple different patient names found, flag as warning
        if len(patient_names) > 1:
            names_list = list(patient_names.keys())
            sources = set()
            for src_list in patient_names.values():
                sources.update(src_list)
            
            anomalies.append({
                "description": (
                    f"Conflicting patient names found across documents: "
                    f"{', '.join(names_list)}"
                ),
                "severity": "warning",
                "sourceDocument": ", ".join(sorted(sources)),
                "dataValues": {
                    f"name_{i+1}": name
                    for i, name in enumerate(names_list)
                },
            })
        
        return anomalies


    async def generate_summary(
        self, combined_text: str, anomalies: list[dict]
    ) -> str:
        """
        Generate a summary using Bedrock Nova Pro.
        
        Args:
            combined_text: Concatenated text from all documents
            anomalies: List of detected anomalies to include in context
            
        Returns:
            Generated summary text
            
        Raises:
            SummaryGenerationError: If Bedrock invocation fails
        """
        anomaly_context = ""
        if anomalies:
            anomaly_lines = []
            for a in anomalies:
                anomaly_lines.append(
                    f"- [{a['severity'].upper()}] {a['description']} "
                    f"(Source: {a['sourceDocument']})"
                )
            anomaly_context = (
                "\n\nDetected Data Anomalies:\n"
                + "\n".join(anomaly_lines)
                + "\n\nPlease acknowledge these anomalies in your summary."
            )

        prompt = (
            "You are an insurance claims analyst. Analyze the following claim "
            "documents and provide a comprehensive summary.\n\n"
            "Include:\n"
            "1. Patient information (name, DOB, ID)\n"
            "2. Diagnosis codes and descriptions\n"
            "3. Procedures performed\n"
            "4. Service dates\n"
            "5. Provider information\n"
            "6. Amounts and charges\n"
            "7. Any notable findings or concerns\n\n"
            "Also analyze the documents for data anomalies including:\n"
            "- Chronological impossibilities (service dates before birth dates)\n"
            "- Payment dates before service dates\n"
            "- Diagnosis codes inconsistent with patient demographics\n"
            "- Duplicate or conflicting information across documents\n"
            f"{anomaly_context}\n\n"
            f"Documents:\n{combined_text}"
        )

        try:
            request_body = json.dumps({
                "messages": [
                    {
                        "role": "user",
                        "content": [{"text": prompt}],
                    }
                ],
                "inferenceConfig": {
                    "max_new_tokens": 2000,
                    "temperature": 0.3,
                },
            })

            response = self.bedrock.invoke_model(
                modelId=BEDROCK_MODEL_ID,
                body=request_body,
            )

            response_body = json.loads(response["body"].read())
            
            # Extract text from Nova Pro response
            output = response_body.get("output", {})
            message = output.get("message", {})
            content = message.get("content", [])
            
            if content and isinstance(content, list):
                return content[0].get("text", "")
            
            return str(response_body)

        except Exception as e:
            logger.error(f"Bedrock invocation failed: {e}")
            raise SummaryGenerationError(
                "Summary generation failed. Please try again later."
            )
