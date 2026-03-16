"""
RAG Summary Agent

AgentCore Runtime agent that summarizes insurance claims using AWS Bedrock
Knowledge Base for document retrieval. Supports full-document and semantic
chunking methods. Includes anomaly detection for data inconsistencies.

Environment Variables:
    KNOWLEDGE_BASE_ID: Bedrock Knowledge Base ID (default: rag-app-v2-kb-dev)
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
KNOWLEDGE_BASE_ID = os.environ.get("KNOWLEDGE_BASE_ID", "rag-app-v2-kb-dev")
BEDROCK_REGION = os.environ.get("BEDROCK_REGION", "us-east-1")
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "amazon.nova-pro-v1:0")

# Initialize OpenTelemetry tracer
provider = TracerProvider()
provider.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter()))
trace.set_tracer_provider(provider)
tracer = trace.get_tracer(__name__)


class KnowledgeBaseRetrievalError(Exception):
    """Raised when Knowledge Base retrieval fails."""

    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.status_code = status_code


class SummaryGenerationError(Exception):
    """Raised when Bedrock summary generation fails."""

    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


class RAGSummaryAgent:
    """
    Agent that summarizes claims using RAG retrieval from Knowledge Base.

    This agent queries the AWS Bedrock Knowledge Base for relevant document
    chunks, detects data anomalies in the retrieved content, and generates
    a summary using Bedrock Nova Pro.
    """

    def __init__(
        self,
        bedrock_agent_client: Any = None,
        bedrock_client: Any = None,
    ):
        """
        Initialize the RAG Summary Agent.

        Args:
            bedrock_agent_client: Optional Bedrock Agent Runtime client for testing
            bedrock_client: Optional Bedrock Runtime client for testing
        """
        self.bedrock_agent = bedrock_agent_client or boto3.client(
            "bedrock-agent-runtime", region_name=BEDROCK_REGION
        )
        self.bedrock = bedrock_client or boto3.client(
            "bedrock-runtime", region_name=BEDROCK_REGION
        )
        self.knowledge_base_id = KNOWLEDGE_BASE_ID

    async def invoke(
        self, claim_id: str, chunking_method: str = "semantic"
    ) -> dict:
        """
        Generate a summary for the given claim using RAG retrieval.

        Args:
            claim_id: The unique identifier of the claim to summarize
            chunking_method: "full-document" or "semantic" (default: "semantic")

        Returns:
            dict containing:
                - summary: The generated summary text
                - anomalies: List of detected data anomalies
                - documentCount: Number of unique source documents
                - strategy: Always "rag"
                - chunkingMethod: The chunking method used

        Raises:
            KnowledgeBaseRetrievalError: If Knowledge Base query fails
            SummaryGenerationError: If Bedrock invocation fails
        """
        with tracer.start_as_current_span("rag_summary") as span:
            span.set_attribute("claim_id", claim_id)
            span.set_attribute("chunking_method", chunking_method)

            # 1. Query Knowledge Base for relevant chunks
            chunks = await self.retrieve_chunks(claim_id, chunking_method)
            span.set_attribute("chunk_count", len(chunks))

            # 2. Count unique source documents
            unique_sources = set()
            for chunk in chunks:
                source = chunk.get("source_document", "")
                if source:
                    unique_sources.add(source)
            document_count = max(len(unique_sources), 1)
            span.set_attribute("document_count", document_count)

            # 3. Detect anomalies in retrieved chunks
            anomalies = self.detect_anomalies(chunks)
            span.set_attribute("anomaly_count", len(anomalies))

            # 4. Generate summary from chunks
            combined_text = self._combine_chunk_text(chunks)
            summary = await self.generate_summary(
                combined_text, anomalies, claim_id
            )

            # 5. Set trace output attributes
            span.set_attribute("summary_length", len(summary))
            span.set_attribute(
                "retrieved_chunks",
                json.dumps([c.get("text", "")[:200] for c in chunks]),
            )
            span.set_attribute(
                "detected_anomalies", json.dumps(anomalies)
            )

            return {
                "summary": summary,
                "anomalies": anomalies,
                "documentCount": document_count,
                "strategy": "rag",
                "chunkingMethod": chunking_method,
            }

    async def retrieve_chunks(
        self, claim_id: str, chunking_method: str
    ) -> list[dict]:
        """
        Query the Knowledge Base for relevant document chunks.

        Args:
            claim_id: The claim identifier to query
            chunking_method: "full-document" or "semantic"

        Returns:
            List of chunk dicts with text, source_document, and score

        Raises:
            KnowledgeBaseRetrievalError: If retrieval fails or returns no results
        """
        try:
            # Build retrieval query based on chunking method
            if chunking_method == "full-document":
                query_text = (
                    f"Complete insurance claim {claim_id} documents, "
                    f"patient information, diagnosis, procedures, and billing"
                )
                num_results = 5
            else:
                # semantic chunking — more granular retrieval
                query_text = (
                    f"Insurance claim {claim_id} details including patient "
                    f"demographics, diagnosis codes, procedures performed, "
                    f"service dates, provider information, and charges"
                )
                num_results = 10

            retrieval_config = {
                "vectorSearchConfiguration": {
                    "numberOfResults": num_results,
                }
            }

            response = self.bedrock_agent.retrieve(
                knowledgeBaseId=self.knowledge_base_id,
                retrievalQuery={"text": query_text},
                retrievalConfiguration=retrieval_config,
            )

            retrieval_results = response.get("retrievalResults", [])

            if not retrieval_results:
                raise KnowledgeBaseRetrievalError(
                    f"No documents found for claim {claim_id}",
                    status_code=404,
                )

            # Normalize chunks into a consistent format
            chunks = []
            for result in retrieval_results:
                content = result.get("content", {})
                text = content.get("text", "")

                if not text:
                    continue

                location = result.get("location", {})
                s3_location = location.get("s3Location", {})
                source_uri = s3_location.get("uri", "")
                # Extract filename from S3 URI
                source_document = (
                    source_uri.split("/")[-1] if source_uri else "Unknown"
                )

                score = result.get("score", 0.0)

                chunks.append({
                    "text": text,
                    "source_document": source_document,
                    "score": score,
                })

            if not chunks:
                raise KnowledgeBaseRetrievalError(
                    "No summarizable content available. Documents are still "
                    "processing or have no extracted text.",
                    status_code=400,
                )

            return chunks

        except KnowledgeBaseRetrievalError:
            raise
        except Exception as e:
            logger.error(
                f"Knowledge Base retrieval failed for claim {claim_id}: {e}"
            )
            raise KnowledgeBaseRetrievalError(
                f"Failed to retrieve documents: {str(e)}",
                status_code=500,
            )

    def _combine_chunk_text(self, chunks: list[dict]) -> str:
        """
        Combine retrieved chunk texts with source attribution.

        Args:
            chunks: List of chunk dicts with text and source_document

        Returns:
            Combined text with chunk separators
        """
        text_parts = []
        for i, chunk in enumerate(chunks, 1):
            source = chunk.get("source_document", "Unknown")
            text = chunk.get("text", "")
            score = chunk.get("score", 0.0)
            text_parts.append(
                f"--- Chunk {i} (Source: {source}, Relevance: {score:.2f}) ---\n{text}"
            )
        return "\n\n".join(text_parts)

    def detect_anomalies(self, chunks: list[dict]) -> list[dict]:
        """
        Analyze retrieved chunks for data anomalies.

        Detects:
        - Chronological impossibilities (service date before birth date)
        - Payment dates before service dates
        - Conflicting patient names across chunks

        Args:
            chunks: List of chunk dicts with text and source_document

        Returns:
            List of DataAnomaly dicts with description, severity,
            sourceDocument, and dataValues
        """
        anomalies = []

        for chunk in chunks:
            source = chunk.get("source_document", "Unknown")
            text = chunk.get("text", "")

            # Check for chronological impossibilities
            anomalies.extend(
                self._check_chronological_anomalies(source, text)
            )

            # Check for payment date before service date
            anomalies.extend(
                self._check_payment_date_anomalies(source, text)
            )

        # Check for conflicting patient names across chunks
        anomalies.extend(self._check_cross_chunk_anomalies(chunks))

        return anomalies

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
            idx = text_lower.find(label_lower)
            while idx != -1:
                context = text[idx : idx + 80]
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
        self, source: str, text: str
    ) -> list[dict]:
        """Check for service dates before birth dates."""
        anomalies = []

        birth_dates = self._find_dates(
            text, ["birth date", "dob", "date of birth"]
        )
        service_dates = self._find_dates(
            text, ["service date", "date of service", "dos"]
        )

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
                        "sourceDocument": source,
                        "dataValues": {
                            "serviceDate": sd_str,
                            "birthDate": bd_str,
                        },
                    })

        return anomalies

    def _check_payment_date_anomalies(
        self, source: str, text: str
    ) -> list[dict]:
        """Check for payment dates before service dates."""
        anomalies = []

        service_dates = self._find_dates(
            text, ["service date", "date of service", "dos"]
        )
        payment_dates = self._find_dates(
            text, ["payment date", "paid date", "date paid"]
        )

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
                        "sourceDocument": source,
                        "dataValues": {
                            "paymentDate": pd_str,
                            "serviceDate": sd_str,
                        },
                    })

        return anomalies

    def _check_cross_chunk_anomalies(
        self, chunks: list[dict]
    ) -> list[dict]:
        """Check for conflicting patient names across chunks."""
        anomalies = []

        patient_names: dict[str, list[str]] = {}

        for chunk in chunks:
            text = chunk.get("text", "")
            source = chunk.get("source_document", "Unknown")

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
                        patient_names[name_clean].append(source)

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
                    f"name_{i + 1}": name
                    for i, name in enumerate(names_list)
                },
            })

        return anomalies

    async def generate_summary(
        self, combined_text: str, anomalies: list[dict], claim_id: str
    ) -> str:
        """
        Generate a summary using Bedrock Nova Pro with retrieved chunks.

        Args:
            combined_text: Combined text from retrieved chunks
            anomalies: List of detected anomalies to include in context
            claim_id: The claim identifier for context

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
            "You are an insurance claims analyst. Analyze the following "
            "retrieved document chunks for claim "
            f"{claim_id} and provide a comprehensive summary.\n\n"
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
            f"Retrieved Document Chunks:\n{combined_text}"
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
