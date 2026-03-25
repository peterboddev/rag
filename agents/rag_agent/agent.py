"""
RAG Summary Agent

AgentCore Runtime agent that summarizes insurance claims using AWS Bedrock
Knowledge Base for document retrieval. Supports full-document and semantic
chunking methods. Includes anomaly detection for data inconsistencies.

Uses Strands Agents SDK for tool orchestration and BedrockAgentCoreApp
for AgentCore Runtime deployment.

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

from opentelemetry import trace

import boto3
from strands import Agent, tool
from strands.models import BedrockModel
from bedrock_agentcore.runtime import BedrockAgentCoreApp

# Configure logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Environment configuration
KNOWLEDGE_BASE_ID = os.environ.get("KNOWLEDGE_BASE_ID", "rag-app-v2-kb-dev")
BEDROCK_REGION = os.environ.get("BEDROCK_REGION", "us-east-1")
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "amazon.nova-pro-v1:0")

# Initialize module-level Bedrock Agent Runtime client
bedrock_agent_client = boto3.client(
    "bedrock-agent-runtime", region_name=BEDROCK_REGION
)


class KnowledgeBaseRetrievalError(Exception):
    """Raised when Knowledge Base retrieval fails."""

    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.status_code = status_code


# ---------------------------------------------------------------------------
# Helper (impl) functions — business logic, directly testable
# ---------------------------------------------------------------------------


def _retrieve_chunks_impl(claim_id: str, chunking_method: str) -> list[dict]:
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

        response = bedrock_agent_client.retrieve(
            knowledgeBaseId=KNOWLEDGE_BASE_ID,
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
        idx = text_lower.find(label_lower)
        while idx != -1:
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


def _check_chronological_anomalies(
    source: str, text: str
) -> list[dict]:
    """Check for service dates before birth dates.

    Args:
        source: Source document name
        text: Document text to analyze

    Returns:
        List of anomaly dicts for chronological impossibilities
    """
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
                    "sourceDocument": source,
                    "dataValues": {
                        "serviceDate": sd_str,
                        "birthDate": bd_str,
                    },
                })

    return anomalies


def _check_payment_date_anomalies(
    source: str, text: str
) -> list[dict]:
    """Check for payment dates before service dates.

    Args:
        source: Source document name
        text: Document text to analyze

    Returns:
        List of anomaly dicts for payment-before-service issues
    """
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
                    "sourceDocument": source,
                    "dataValues": {
                        "paymentDate": pd_str,
                        "serviceDate": sd_str,
                    },
                })

    return anomalies


def _check_cross_chunk_anomalies(
    chunks: list[dict],
) -> list[dict]:
    """Check for conflicting patient names across chunks.

    Args:
        chunks: List of chunk dicts with text and source_document

    Returns:
        List of anomaly dicts for conflicting patient names
    """
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


def _detect_anomalies_impl(chunks: list[dict]) -> list[dict]:
    """
    Analyze retrieved chunks for data anomalies.

    Detects:
    - Chronological impossibilities (service date before birth date)
    - Payment dates before service dates
    - Conflicting patient names across chunks

    Args:
        chunks: List of chunk dicts with text and source_document

    Returns:
        List of anomaly dicts with description, severity,
        sourceDocument, and dataValues
    """
    anomalies = []

    for chunk in chunks:
        source = chunk.get("source_document", "Unknown")
        text = chunk.get("text", "")

        # Check for chronological impossibilities
        anomalies.extend(
            _check_chronological_anomalies(source, text)
        )

        # Check for payment date before service date
        anomalies.extend(
            _check_payment_date_anomalies(source, text)
        )

    # Check for conflicting patient names across chunks
    anomalies.extend(_check_cross_chunk_anomalies(chunks))

    return anomalies


# ---------------------------------------------------------------------------
# @tool decorated wrapper functions — Strands Agent interface
# ---------------------------------------------------------------------------


@tool
def retrieve_chunks(claim_id: str, chunking_method: str) -> str:
    """Retrieve document chunks from the Knowledge Base for an insurance claim.

    Queries the AWS Bedrock Knowledge Base for relevant document chunks
    matching the given claim ID. Supports full-document chunking (5 results)
    and semantic chunking (10 results).

    Args:
        claim_id: The unique identifier of the claim to retrieve chunks for.
        chunking_method: The chunking strategy to use, either "full-document"
            or "semantic".

    Returns:
        A JSON string containing a list of chunk dicts with 'text',
        'source_document', and 'score' fields.
    """
    chunks = _retrieve_chunks_impl(claim_id, chunking_method)
    return json.dumps(chunks, default=str)


@tool
def detect_anomalies(chunks: str) -> str:
    """Detect data anomalies in retrieved document chunks.

    Analyzes chunks for chronological impossibilities (service date before
    birth date), payment dates before service dates, and conflicting patient
    names across chunks.

    Args:
        chunks: A JSON string containing a list of chunk dicts, each with
            'text' and 'source_document' fields.

    Returns:
        A JSON string containing a list of anomaly dicts, each with keys
        'description', 'severity', 'sourceDocument', and 'dataValues'.
    """
    chunk_list = json.loads(chunks)
    result = _detect_anomalies_impl(chunk_list)
    return json.dumps(result, default=str)


# ---------------------------------------------------------------------------
# Agent configuration
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are an insurance claims analyst agent using RAG retrieval. For each claim, you MUST:
1. Call retrieve_chunks with the claim_id and chunking_method to get relevant document chunks from the Knowledge Base
2. Call detect_anomalies with the retrieved chunks to find data inconsistencies
3. Generate a comprehensive summary of the claim based on the retrieved chunks

Return your final response as JSON with these exact keys:
- "summary": your generated summary text
- "anomalies": the anomalies from detect_anomalies
- "documentCount": number of unique source documents from the chunks
- "strategy": "rag"
- "chunkingMethod": the chunking method used
"""

model = BedrockModel(
    model_id=f"us.{BEDROCK_MODEL_ID}",
    region_name=BEDROCK_REGION,
    temperature=0.3,
    max_tokens=2000,
)

agent = Agent(
    model=model,
    tools=[retrieve_chunks, detect_anomalies],
    system_prompt=SYSTEM_PROMPT,
)


# ---------------------------------------------------------------------------
# Response parsing helper
# ---------------------------------------------------------------------------


def parse_agent_response(result, strategy="rag", default_count=0):
    """Parse the agent's response into a structured dict.

    Attempts to extract JSON from the agent result. Falls back to returning
    the raw text as the summary with empty anomalies if JSON parsing fails.

    Args:
        result: The Strands Agent result object.
        strategy: The strategy name to include in the response.
        default_count: Default document count if not found in response.

    Returns:
        A dict with keys summary, anomalies, documentCount, strategy,
        and chunkingMethod.
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
    """AgentCore Runtime entry point for the RAG Summary Agent.

    Extracts the claim_id and optional chunking_method from the payload
    and invokes the Strands Agent to process the claim.

    Args:
        payload: Dict containing 'claim_id' and optionally 'chunking_method'.

    Returns:
        A dict with summary, anomalies, documentCount, strategy,
        and chunkingMethod.
    """
    try:
        claim_id = payload.get("claim_id")
        if not claim_id:
            return {"error": "claim_id is required", "statusCode": 400}
        chunking_method = payload.get("chunking_method", "semantic")
        span = trace.get_current_span()
        span.set_attribute("claim.id", claim_id or "")
        span.set_attribute("claim.strategy", "rag")
        span.set_attribute("claim.chunking_method", chunking_method or "semantic")
        result = agent(
            f"Process claim {claim_id} using {chunking_method} chunking "
            f"and return the structured JSON response"
        )
        return parse_agent_response(result)
    except Exception as e:
        logger.error(f"Agent invocation failed: {e}")
        return {"error": str(e), "statusCode": 500}


if __name__ == "__main__":
    app.run()
