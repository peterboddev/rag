"""
Enriched Summary Agent

Combines Full Context (DynamoDB), RAG (Bedrock Knowledge Base), and
Graph RAG (Neptune Analytics GraphRAG KB) source material into a single
deduplicated context for Bedrock Nova Pro summarization.

Graceful degradation: Full Context is required; RAG and Graph RAG failures
are logged as warnings and the agent continues with available sources.

Environment Variables:
    DOCUMENTS_TABLE: DynamoDB table name for document records
    KNOWLEDGE_BASE_ID: Bedrock Knowledge Base ID for RAG retrieval
    GRAPH_RAG_KNOWLEDGE_BASE_ID: Bedrock Knowledge Base ID for Graph RAG retrieval
    BEDROCK_REGION: AWS region for Bedrock service (default: us-east-1)
    BEDROCK_MODEL_ID: Bedrock model ID (default: amazon.nova-pro-v1:0)
"""

import json
import os
import re
import logging
from datetime import datetime

import boto3

# Configure logging
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

# Environment configuration
DOCUMENTS_TABLE = os.environ.get("DOCUMENTS_TABLE", "rag-app-documents-dev")
KNOWLEDGE_BASE_ID = os.environ.get("KNOWLEDGE_BASE_ID", "rag-app-v2-kb-dev")
GRAPH_RAG_KNOWLEDGE_BASE_ID = os.environ.get("GRAPH_RAG_KNOWLEDGE_BASE_ID", "")
BEDROCK_REGION = os.environ.get("BEDROCK_REGION", "us-east-1")
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "amazon.nova-pro-v1:0")

# Initialize AWS clients
dynamodb = boto3.resource("dynamodb", region_name=BEDROCK_REGION)
documents_table = dynamodb.Table(DOCUMENTS_TABLE)
bedrock_agent_client = boto3.client(
    "bedrock-agent-runtime", region_name=BEDROCK_REGION
)
bedrock_runtime_client = boto3.client(
    "bedrock-runtime", region_name=BEDROCK_REGION
)


class DocumentRetrievalError(Exception):
    """Raised when document retrieval fails."""

    def __init__(self, message: str, status_code: int = 500):
        super().__init__(message)
        self.status_code = status_code


# ---------------------------------------------------------------------------
# Source Material Gathering (Task 2.2)
# ---------------------------------------------------------------------------


def _retrieve_full_context(claim_id: str, tenant_id: str = None) -> list[dict]:
    """
    Retrieve all documents for a claim from DynamoDB Documents table.

    Uses tenant-documents-index GSI with filter on claimMetadata.claimId,
    matching the orchestrator's queryClaimDocuments pattern.

    Args:
        claim_id: The claim identifier to query
        tenant_id: Tenant ID for GSI partition key

    Returns:
        List of document records with extractedText

    Raises:
        DocumentRetrievalError: If no documents found or none have extractedText
    """
    try:
        if not tenant_id:
            raise DocumentRetrievalError(
                "tenant_id is required for document retrieval",
                status_code=400,
            )

        response = documents_table.query(
            IndexName="tenant-documents-index",
            KeyConditionExpression="tenantId = :tenantId",
            FilterExpression="claimMetadata.claimId = :claimId",
            ExpressionAttributeValues={
                ":tenantId": tenant_id,
                ":claimId": claim_id,
            },
        )

        documents = response.get("Items", [])

        # Handle pagination
        while "LastEvaluatedKey" in response:
            response = documents_table.query(
                IndexName="tenant-documents-index",
                KeyConditionExpression="tenantId = :tenantId",
                FilterExpression="claimMetadata.claimId = :claimId",
                ExpressionAttributeValues={
                    ":tenantId": tenant_id,
                    ":claimId": claim_id,
                },
                ExclusiveStartKey=response["LastEvaluatedKey"],
            )
            documents.extend(response.get("Items", []))

        if not documents:
            raise DocumentRetrievalError(
                f"No documents found for claim {claim_id}",
                status_code=404,
            )

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


def _retrieve_rag_chunks(claim_id: str, patient_id: str = None) -> list[dict]:
    """
    Query Bedrock Knowledge Base for vector-retrieved chunks.

    Args:
        claim_id: The claim identifier to query
        patient_id: Optional patient ID for metadata filtering

    Returns:
        List of chunk dicts with text, source_document, and score.
        Returns empty list on failure (graceful degradation).
    """
    try:
        # Use claimId filter to avoid mixed-patient data from KB
        retrieval_config = {
            "vectorSearchConfiguration": {
                "numberOfResults": 20,
                "filter": {
                    "equals": {"key": "claimId", "value": claim_id},
                },
            }
        }

        response = bedrock_agent_client.retrieve(
            knowledgeBaseId=KNOWLEDGE_BASE_ID,
            retrievalQuery={
                "text": (
                    f"Summarize insurance claim {claim_id} including patient "
                    f"information, diagnoses, procedures, service dates, "
                    f"provider details, and amounts."
                )
            },
            retrievalConfiguration=retrieval_config,
        )

        retrieval_results = response.get("retrievalResults", [])

        chunks = []
        for result in retrieval_results:
            content = result.get("content", {})
            text = content.get("text", "")
            if not text:
                continue

            location = result.get("location", {})
            s3_location = location.get("s3Location", {})
            source_uri = s3_location.get("uri", "")
            source_document = (
                source_uri.split("/")[-1] if source_uri else "Unknown"
            )

            score = result.get("score", 0.0)
            chunks.append({
                "text": text,
                "source_document": source_document,
                "score": score,
            })

        return chunks

    except Exception as e:
        logger.warning(f"RAG retrieval failed for claim {claim_id}: {e}")
        return []


def _retrieve_graph_rag_chunks(claim_id: str, patient_id: str = None) -> list[dict]:
    """
    Query Neptune Analytics GraphRAG Knowledge Base for graph-based chunks.

    Args:
        claim_id: The claim identifier to query
        patient_id: Optional patient ID for metadata filtering

    Returns:
        List of chunk dicts with text, source_document, and score.
        Returns empty list on failure (graceful degradation).
    """
    try:
        if not GRAPH_RAG_KNOWLEDGE_BASE_ID:
            logger.warning("GRAPH_RAG_KNOWLEDGE_BASE_ID not configured, skipping Graph RAG retrieval")
            return []

        # Use claimId filter to avoid mixed-patient data from KB
        retrieval_config = {
            "vectorSearchConfiguration": {
                "numberOfResults": 20,
                "filter": {
                    "equals": {"key": "claimId", "value": claim_id},
                },
            }
        }

        response = bedrock_agent_client.retrieve(
            knowledgeBaseId=GRAPH_RAG_KNOWLEDGE_BASE_ID,
            retrievalQuery={
                "text": (
                    f"Summarize insurance claim {claim_id} including patient "
                    f"information, diagnoses, procedures, service dates, "
                    f"provider details, and amounts."
                )
            },
            retrievalConfiguration=retrieval_config,
        )

        retrieval_results = response.get("retrievalResults", [])

        chunks = []
        for result in retrieval_results:
            content = result.get("content", {})
            text = content.get("text", "")
            if not text:
                continue

            location = result.get("location", {})
            s3_location = location.get("s3Location", {})
            source_uri = s3_location.get("uri", "")
            source_document = (
                source_uri.split("/")[-1] if source_uri else "Unknown"
            )

            score = result.get("score", 0.0)
            chunks.append({
                "text": text,
                "source_document": source_document,
                "score": score,
            })

        return chunks

    except Exception as e:
        logger.warning(f"Graph RAG retrieval failed for claim {claim_id}: {e}")
        return []


# ---------------------------------------------------------------------------
# Content Deduplication (Task 2.4)
# ---------------------------------------------------------------------------


def _normalize_sentence(sentence: str) -> str:
    """Normalize a sentence for comparison: lowercase, strip, collapse whitespace."""
    return re.sub(r"\s+", " ", sentence.strip().lower())


def _split_into_sentences(text: str) -> list[str]:
    """
    Split text into sentences on sentence-ending punctuation followed by whitespace.

    Args:
        text: Raw text to split

    Returns:
        List of sentence strings (stripped, non-empty)
    """
    # Split on . ! ? followed by whitespace or end-of-string
    parts = re.split(r"(?<=[.!?])\s+", text)
    return [s.strip() for s in parts if s.strip()]


def _deduplicate_sources(
    full_ctx: list[dict],
    rag_chunks: list[dict],
    graph_chunks: list[dict],
) -> list[dict]:
    """
    Remove overlapping content across the three sources using sentence-level
    overlap detection. Priority order: Full Context > RAG > Graph RAG.

    When a sentence is already seen, the longer (more complete) version is kept.

    Args:
        full_ctx: Documents from DynamoDB (each has 'extractedText', 'fileName')
        rag_chunks: Chunks from Bedrock KB (each has 'text', 'source_document')
        graph_chunks: Chunks from Graph RAG KB (each has 'text', 'source_document')

    Returns:
        List of dicts with keys 'text' and 'source_label'
    """
    # Map: normalized sentence -> { "text": original sentence, "source_label": str }
    seen: dict[str, dict] = {}

    # Process Full Context first (highest priority)
    for doc in full_ctx:
        text = doc.get("extractedText", "")
        sentences = _split_into_sentences(text)
        for sentence in sentences:
            norm = _normalize_sentence(sentence)
            if not norm:
                continue
            if norm not in seen or len(sentence) > len(seen[norm]["text"]):
                seen[norm] = {"text": sentence, "source_label": "Full Context"}

    # Process RAG chunks second
    for chunk in rag_chunks:
        text = chunk.get("text", "")
        sentences = _split_into_sentences(text)
        for sentence in sentences:
            norm = _normalize_sentence(sentence)
            if not norm:
                continue
            if norm not in seen:
                seen[norm] = {"text": sentence, "source_label": "RAG"}
            elif len(sentence) > len(seen[norm]["text"]):
                seen[norm]["text"] = sentence

    # Process Graph RAG chunks last (lowest priority)
    for chunk in graph_chunks:
        text = chunk.get("text", "")
        sentences = _split_into_sentences(text)
        for sentence in sentences:
            norm = _normalize_sentence(sentence)
            if not norm:
                continue
            if norm not in seen:
                seen[norm] = {"text": sentence, "source_label": "Graph RAG"}
            elif len(sentence) > len(seen[norm]["text"]):
                seen[norm]["text"] = sentence

    return list(seen.values())


def _build_enriched_context(deduplicated_segments: list[dict]) -> str:
    """
    Format deduplicated segments with source attribution labels into
    a single context string for the LLM prompt.

    Args:
        deduplicated_segments: List of dicts with 'text' and 'source_label'

    Returns:
        Formatted context string with source headers
    """
    # Group segments by source label
    groups: dict[str, list[str]] = {}
    for seg in deduplicated_segments:
        label = seg.get("source_label", "Unknown")
        if label not in groups:
            groups[label] = []
        groups[label].append(seg["text"])

    # Build context with source headers in priority order
    parts = []
    for label in ["Full Context", "RAG", "Graph RAG"]:
        sentences = groups.get(label, [])
        if sentences:
            text_block = " ".join(sentences)
            parts.append(f"--- Source: {label} ---\n{text_block}")

    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# Anomaly Detection (reuses patterns from existing agents)
# ---------------------------------------------------------------------------


def _find_dates(text: str, labels: list[str]) -> list[str]:
    """Find dates associated with given labels in text."""
    dates = []
    text_lower = text.lower()

    iso_pattern = r"(\d{4}-\d{2}-\d{2})"
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


def _parse_date(date_str: str) -> datetime | None:
    """Parse a date string into a datetime object."""
    formats = ["%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%d/%m/%Y"]
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
        documents: List of document records with extractedText

    Returns:
        List of anomaly dicts
    """
    anomalies = []

    for doc in documents:
        file_name = doc.get("fileName", doc.get("documentId", "Unknown"))
        text = doc.get("extractedText", "")

        # Chronological impossibilities
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

        # Payment date before service date
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

    # Cross-document patient name conflicts
    patient_names: dict[str, list[str]] = {}
    for doc in documents:
        text = doc.get("extractedText", "")
        file_name = doc.get("fileName", doc.get("documentId", "Unknown"))
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


# ---------------------------------------------------------------------------
# Summarization Prompt and Agent Entry Point (Task 2.6)
# ---------------------------------------------------------------------------

STRATEGY_LABEL = "Enriched (Full Context + RAG + Graph RAG)"


def _build_summary_prompt(enriched_context: str) -> str:
    """
    Build the summarization prompt for Bedrock Nova Pro.

    Args:
        enriched_context: The combined, deduplicated context text

    Returns:
        The full prompt string
    """
    return f"""You are an insurance claims analyst. Analyze the following claim documents and provide:

1. A comprehensive summary of the claim including patient information, diagnoses, procedures, service dates, provider information, and amounts.

2. Data anomaly detection - identify any inconsistencies including:
   - Chronological impossibilities (service dates before birth dates, payment dates before service dates)
   - Contradictory information across documents
   - Diagnosis codes inconsistent with patient demographics
   - Duplicate or conflicting information
   - Unrealistic data patterns

CRITICAL DATE COMPARISON RULES:
- All dates in these documents use MM/DD/YYYY format (month/day/year).
- To compare two dates, first extract the YEAR (the last 4 digits). A higher year number means a later date.
- A service date is AFTER a birth date if the service year > birth year. This is NOT an anomaly.
- Only flag "service date before birth date" if the service year is LESS than the birth year.
- When reporting dates in dataValues, convert to YYYY-MM-DD format.
- Do NOT flag a date as anomalous unless you are certain the service year is strictly less than the birth year.

Format your response as JSON with this exact structure:
{{
  "summary": "Your comprehensive summary text here",
  "anomalies": [
    {{
      "description": "Description of the anomaly",
      "severity": "critical|warning|info",
      "sourceDocument": "document name",
      "dataValues": {{"key": "value"}}
    }}
  ]
}}

Strategy used: {STRATEGY_LABEL}

Documents:
{enriched_context}"""


def _build_prompt_info() -> dict:
    """
    Build prompt metadata with [DOCUMENTS] placeholder for transparency.

    Returns:
        Dict with promptTemplate and strategyLabel
    """
    return {
        "promptTemplate": _build_summary_prompt("[DOCUMENTS]"),
        "strategyLabel": STRATEGY_LABEL,
    }


def _invoke_bedrock(prompt: str, model_id: str = None) -> str:
    """
    Invoke Bedrock Nova Pro for summary generation.

    Args:
        prompt: The full prompt string

    Returns:
        The generated text response

    Raises:
        Exception: If Bedrock invocation fails
    """
    response = bedrock_runtime_client.invoke_model(
        modelId=model_id or BEDROCK_MODEL_ID,
        body=json.dumps({
            "messages": [
                {
                    "role": "user",
                    "content": [{"text": prompt}],
                }
            ],
            "inferenceConfig": {
                "max_new_tokens": 4000,
                "temperature": 0.3,
            },
        }),
    )

    response_body = json.loads(response["body"].read())
    output_text = (
        response_body.get("output", {})
        .get("message", {})
        .get("content", [{}])[0]
        .get("text", "")
    ) or response_body.get("completion", "")

    return output_text


def _parse_summary_response(response_text: str) -> dict:
    """
    Parse the Bedrock response into summary and anomalies.

    Args:
        response_text: Raw text from Bedrock

    Returns:
        Dict with 'summary' and 'anomalies' keys
    """
    try:
        json_match = re.search(r"\{[\s\S]*\}", response_text)
        if json_match:
            parsed = json.loads(json_match.group(0))
            anomalies = []
            for a in (parsed.get("anomalies") or []):
                anomalies.append({
                    "description": a.get("description", ""),
                    "severity": a.get("severity", "info")
                    if a.get("severity") in ("critical", "warning", "info")
                    else "info",
                    "sourceDocument": a.get("sourceDocument", "Unknown"),
                    "dataValues": a.get("dataValues", {}),
                })
            return {
                "summary": parsed.get("summary", response_text),
                "anomalies": anomalies,
            }
    except (json.JSONDecodeError, AttributeError):
        pass

    return {"summary": response_text, "anomalies": []}


def parse_agent_response(result, strategy="enriched", default_count=0):
    """Parse the agent's response into a structured dict.

    Attempts to extract JSON from the agent result. Falls back to returning
    the raw text as the summary with empty anomalies if JSON parsing fails.

    Args:
        result: The agent result (dict or object with message attribute).
        strategy: The strategy name to include in the response.
        default_count: Default document count if not found in response.

    Returns:
        A dict with keys summary, anomalies, documentCount, and strategy.
    """
    try:
        if isinstance(result, dict):
            return result
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
# Entry points
# ---------------------------------------------------------------------------


def invoke(payload):
    """
    Agent entry point accepting { claim_id, tenant_id, patient_id }.

    This is the primary interface for the enriched agent, matching the
    pattern used by the existing agents. Can be called directly or via
    the Lambda handler.

    Args:
        payload: Dict containing 'claim_id', 'tenant_id', and optionally 'patient_id'

    Returns:
        Dict with summary, anomalies, documentCount, strategy, and promptInfo
    """
    return handler(payload, None)


def handler(event, context):
    """
    Lambda handler for the Enriched Summary Agent.

    Receives payload with claim_id, tenant_id, patient_id.
    Gathers from all 3 sources (with graceful degradation),
    deduplicates, invokes Bedrock Nova Pro, and returns the result.

    Args:
        event: Dict containing 'claim_id', 'tenant_id', and optionally 'patient_id'
        context: Lambda context (unused)

    Returns:
        Dict with summary, anomalies, documentCount, strategy, and promptInfo
    """
    try:
        claim_id = event.get("claim_id")
        if not claim_id:
            return {"error": "claim_id is required", "statusCode": 400}

        tenant_id = event.get("tenant_id", "")
        patient_id = event.get("patient_id")
        model_id = event.get("model_id", BEDROCK_MODEL_ID)

        logger.info(f"Processing enriched strategy for claim {claim_id}")

        # 1. Gather source material from all three sources
        # Full Context is required — failure raises an error
        full_context_docs = _retrieve_full_context(claim_id, tenant_id)
        document_count = len(full_context_docs)

        # RAG and Graph RAG are optional — failures log warnings and return []
        rag_chunks = _retrieve_rag_chunks(claim_id, patient_id)
        graph_rag_chunks = _retrieve_graph_rag_chunks(claim_id, patient_id)

        if rag_chunks:
            logger.info(f"Retrieved {len(rag_chunks)} RAG chunks")
        else:
            logger.warning("No RAG chunks retrieved, continuing with other sources")

        if graph_rag_chunks:
            logger.info(f"Retrieved {len(graph_rag_chunks)} Graph RAG chunks")
        else:
            logger.warning("No Graph RAG chunks retrieved, continuing with other sources")

        # 2. Deduplicate across sources
        deduplicated = _deduplicate_sources(
            full_context_docs, rag_chunks, graph_rag_chunks
        )

        # 3. Build enriched context
        enriched_context = _build_enriched_context(deduplicated)

        # 4. Detect anomalies from full context documents
        anomalies = _detect_anomalies_impl(full_context_docs)

        # 5. Invoke Bedrock Nova Pro for summarization
        prompt = _build_summary_prompt(enriched_context)
        response_text = _invoke_bedrock(prompt, model_id)
        parsed = _parse_summary_response(response_text)

        # Merge LLM-detected anomalies with programmatic anomalies
        all_anomalies = anomalies + parsed.get("anomalies", [])

        # 6. Build and return response
        return {
            "summary": parsed.get("summary", ""),
            "anomalies": all_anomalies,
            "documentCount": document_count,
            "strategy": "enriched",
            "promptInfo": _build_prompt_info(),
        }

    except DocumentRetrievalError as e:
        logger.error(f"Document retrieval failed: {e}")
        return {"error": str(e), "statusCode": e.status_code}
    except Exception as e:
        logger.error(f"Enriched agent invocation failed: {e}")
        return {"error": str(e), "statusCode": 500}
