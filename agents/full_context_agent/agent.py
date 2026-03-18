"""
Full Context Summary Agent

AgentCore Runtime agent that summarizes insurance claims by retrieving all
document text and passing it directly to Bedrock Nova Pro for summarization.
Includes anomaly detection for data inconsistencies.

Uses Strands Agents SDK for tool orchestration and BedrockAgentCoreApp
for AgentCore Runtime deployment.

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

import boto3
from strands import Agent, tool
from strands.models import BedrockModel
from bedrock_agentcore.runtime import BedrockAgentCoreApp

# Configure logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Environment configuration
DOCUMENTS_TABLE = os.environ.get("DOCUMENTS_TABLE", "rag-app-documents-dev")
BEDROCK_REGION = os.environ.get("BEDROCK_REGION", "us-east-1")
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "amazon.nova-pro-v1:0")

# Initialize module-level DynamoDB resource and table
dynamodb = boto3.resource("dynamodb", region_name=BEDROCK_REGION)
documents_table = dynamodb.Table(DOCUMENTS_TABLE)


class DocumentRetrievalError(Exception):
    """Raised when document retrieval fails."""

    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.status_code = status_code


# ---------------------------------------------------------------------------
# Helper (impl) functions — business logic, directly testable
# ---------------------------------------------------------------------------


def _retrieve_claim_documents_impl(claim_id: str) -> list[dict]:
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
        response = documents_table.scan(
            FilterExpression="claimMetadata.claimId = :claimId",
            ExpressionAttributeValues={":claimId": claim_id},
        )

        documents = response.get("Items", [])

        # Handle pagination if needed
        while "LastEvaluatedKey" in response:
            response = documents_table.scan(
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
            doc for doc in documents if doc.get("extractedText")
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


def _combine_document_text_impl(documents: list[dict]) -> str:
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


def _find_dates(text: str, labels: list[str]) -> list[str]:
    """
    Find dates associated with given labels in text.

    Looks for patterns like:
    - "Birth Date: 2024-01-15"
    - "DOB: 01/15/2024"
    - "Date of Service: January 15, 2024"

    Args:
        text: The document text to search
        labels: List of label strings to look for (e.g. ["birth date", "dob"])

    Returns:
        List of date strings found near the labels
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
            # Look for a date within 80 chars after the label
            context = text[idx:idx + 80]

            for pattern in [iso_pattern, us_pattern]:
                matches = re.findall(pattern, context)
                dates.extend(matches)

            idx = text_lower.find(label_lower, idx + 1)

    return dates


def _parse_date(date_str: str) -> datetime | None:
    """Parse a date string into a datetime object.

    Args:
        date_str: Date string in ISO or US format

    Returns:
        datetime object or None if parsing fails
    """
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


def _detect_anomalies_impl(documents: list[dict]) -> list[dict]:
    """
    Analyze documents for data anomalies.

    Detects:
    - Chronological impossibilities (service date before birth date)
    - Payment dates before service dates
    - Conflicting patient names across documents

    Args:
        documents: List of document records

    Returns:
        List of anomaly dicts with description, severity,
        sourceDocument, and dataValues
    """
    anomalies = []

    for doc in documents:
        file_name = doc.get("fileName", doc.get("documentId", "Unknown"))
        text = doc.get("extractedText", "")
        metadata = doc.get("claimMetadata", {})

        # Check for chronological impossibilities
        anomalies.extend(
            _check_chronological_anomalies(file_name, text, metadata)
        )

        # Check for payment date before service date
        anomalies.extend(
            _check_payment_date_anomalies(file_name, text)
        )

    # Check for duplicate/conflicting info across documents
    anomalies.extend(
        _check_cross_document_anomalies(documents)
    )

    return anomalies


def _check_chronological_anomalies(
    file_name: str, text: str, metadata: dict
) -> list[dict]:
    """Check for service dates before birth dates."""
    anomalies = []

    birth_dates = _find_dates(text, ["birth date", "dob", "date of birth"])
    service_dates = _find_dates(text, ["service date", "date of service", "dos"])

    for bd_str in birth_dates:
        bd = _parse_date(bd_str)
        if not bd:
            continue
        for sd_str in service_dates:
            sd = _parse_date(sd_str)
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
    file_name: str, text: str
) -> list[dict]:
    """Check for payment dates before service dates."""
    anomalies = []

    service_dates = _find_dates(text, ["service date", "date of service", "dos"])
    payment_dates = _find_dates(text, ["payment date", "paid date", "date paid"])

    for pd_str in payment_dates:
        pd = _parse_date(pd_str)
        if not pd:
            continue
        for sd_str in service_dates:
            sd = _parse_date(sd_str)
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
    documents: list[dict],
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


# ---------------------------------------------------------------------------
# @tool decorated wrapper functions — Strands Agent interface
# ---------------------------------------------------------------------------


@tool
def retrieve_claim_documents(claim_id: str) -> str:
    """Retrieve all documents for an insurance claim from DynamoDB.

    Scans the documents table for records matching the given claim ID,
    filters to documents with extracted text, and returns them as JSON.

    Args:
        claim_id: The unique identifier of the claim to retrieve documents for.

    Returns:
        A JSON string containing a list of document records with extractedText.
    """
    documents = _retrieve_claim_documents_impl(claim_id)
    return json.dumps(documents, default=str)


@tool
def combine_document_text(documents: str) -> str:
    """Combine extracted text from multiple claim documents into a single string.

    Concatenates the extracted text from each document, separated by
    document name headers in the format '--- Document: {fileName} ---'.

    Args:
        documents: A JSON string containing a list of document records,
            each with 'fileName' and 'extractedText' fields.

    Returns:
        A single string with all document texts combined with separators.
    """
    docs = json.loads(documents)
    return _combine_document_text_impl(docs)


@tool
def detect_anomalies(documents: str) -> str:
    """Detect data anomalies in insurance claim documents.

    Analyzes documents for chronological impossibilities (service date before
    birth date), payment dates before service dates, and conflicting patient
    names across documents.

    Args:
        documents: A JSON string containing a list of document records,
            each with 'extractedText' and 'fileName' fields.

    Returns:
        A JSON string containing a list of anomaly dicts, each with keys
        'description', 'severity', 'sourceDocument', and 'dataValues'.
    """
    docs = json.loads(documents)
    result = _detect_anomalies_impl(docs)
    return json.dumps(result, default=str)


# ---------------------------------------------------------------------------
# Agent configuration
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are an insurance claims analyst agent. For each claim, you MUST:
1. Call retrieve_claim_documents with the claim_id to get all documents
2. Call combine_document_text with the retrieved documents to get the full text
3. Call detect_anomalies with the retrieved documents to find data inconsistencies
4. Generate a comprehensive summary of the claim

Return your final response as JSON with these exact keys:
- "summary": your generated summary text
- "anomalies": the anomalies from detect_anomalies
- "documentCount": number of documents retrieved
- "strategy": "full-context"
"""

model = BedrockModel(
    model_id=f"us.{BEDROCK_MODEL_ID}",
    region_name=BEDROCK_REGION,
    temperature=0.3,
    max_tokens=2000,
)

agent = Agent(
    model=model,
    tools=[retrieve_claim_documents, combine_document_text, detect_anomalies],
    system_prompt=SYSTEM_PROMPT,
)


# ---------------------------------------------------------------------------
# Response parsing helper
# ---------------------------------------------------------------------------


def parse_agent_response(result, strategy="full-context", default_count=0):
    """Parse the agent's response into a structured dict.

    Attempts to extract JSON from the agent result. Falls back to returning
    the raw text as the summary with empty anomalies if JSON parsing fails.

    Args:
        result: The Strands Agent result object.
        strategy: The strategy name to include in the response.
        default_count: Default document count if not found in response.

    Returns:
        A dict with keys summary, anomalies, documentCount, and strategy.
    """
    try:
        response_text = result.message
        parsed = json.loads(response_text)
        return parsed
    except (json.JSONDecodeError, AttributeError):
        return {
            "summary": str(result),
            "anomalies": [],
            "documentCount": default_count,
            "strategy": strategy,
        }


# ---------------------------------------------------------------------------
# BedrockAgentCoreApp entry point
# ---------------------------------------------------------------------------

app = BedrockAgentCoreApp()


@app.entrypoint
def invoke(payload):
    """AgentCore Runtime entry point for the Full Context Summary Agent.

    Extracts the claim_id from the payload and invokes the Strands Agent
    to process the claim.

    Args:
        payload: Dict containing at least 'claim_id'.

    Returns:
        A dict with summary, anomalies, documentCount, and strategy.
    """
    try:
        claim_id = payload.get("claim_id")
        if not claim_id:
            return {"error": "claim_id is required", "statusCode": 400}
        result = agent(
            f"Process claim {claim_id} and return the structured JSON response"
        )
        return parse_agent_response(result)
    except Exception as e:
        logger.error(f"Agent invocation failed: {e}")
        return {"error": str(e), "statusCode": 500}


if __name__ == "__main__":
    app.run()
