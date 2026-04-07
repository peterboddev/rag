"""
Financial Timeline Agent

AgentCore Runtime agent that extracts and infers financial and timeline data
from insurance claim documents using LLM reasoning. Unlike the deterministic
regex-based extraction, this agent can interpret prose amounts, implicit date
ranges, and cross-document financial patterns.

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

from opentelemetry import trace

import boto3
from strands import Agent
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
        DocumentRetrievalError: If DynamoDB query fails
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

        return documents

    except Exception as e:
        logger.error(f"Error retrieving documents for claim {claim_id}: {e}")
        raise DocumentRetrievalError(
            f"Failed to retrieve documents: {str(e)}",
            status_code=500,
        )


def _combine_document_text(documents: list[dict]) -> str:
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
        if extracted_text:
            text_parts.append(f"--- Document: {file_name} ---\n{extracted_text}")

    return "\n\n".join(text_parts)


# ---------------------------------------------------------------------------
# System prompt — focused exclusively on financial/timeline extraction
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are a specialized financial and timeline extraction agent for insurance claims.
Your ONLY task is to analyze claim documents and extract:
1. All monetary amounts (explicit like $1,234.56 AND implicit like "two hundred fifty dollars")
2. All dates and time periods (explicit like 01/15/2024 AND implicit like "over a three-year period")
3. Financial patterns (recurring payments, escalating costs, etc.)

CRITICAL: You MUST respond with ONLY a valid JSON object. No markdown, no code fences, no explanation text outside the JSON.

The JSON object MUST have this exact structure:
{"financialSummary": {"minPayment": 0, "maxPayment": 0, "totalValue": 0, "payments": [{"amount": 0, "sourceDocument": "", "description": ""}]}, "timeline": {"startYear": null, "endYear": null, "durationYears": null}, "confidence": 0.0, "reasoning": ""}

Rules:
- Include EVERY monetary amount you find, whether explicit or described in words
- For prose amounts, convert to numeric (e.g., "two hundred fifty" = 250)
- For implicit date ranges, infer start/end years from context
- confidence should reflect how certain you are (0.0 to 1.0)
- Do NOT summarize the claim — only extract financial and timeline data
- Do NOT wrap the JSON in markdown code fences
- Do NOT include any text before or after the JSON object
"""


# ---------------------------------------------------------------------------
# Agent configuration
# ---------------------------------------------------------------------------

model = BedrockModel(
    model_id=BEDROCK_MODEL_ID,
    region_name=BEDROCK_REGION,
    temperature=0.3,
    max_tokens=4000,
)

agent = Agent(
    model=model,
    system_prompt=SYSTEM_PROMPT,
)


# ---------------------------------------------------------------------------
# Response parsing helper
# ---------------------------------------------------------------------------


def parse_agent_response(result) -> dict:
    """Parse and validate LLM output into the expected schema.

    Extracts JSON from the agent result, validates structure, clamps
    confidence to [0, 1], enforces minPayment <= maxPayment, recomputes
    totalValue from payments, and computes durationYears.

    Args:
        result: The Strands Agent result object, a dict, or a JSON string.

    Returns:
        A validated dict with financialSummary, timeline, confidence,
        and reasoning.
    """
    default_response = {
        "financialSummary": {
            "minPayment": 0.0,
            "maxPayment": 0.0,
            "totalValue": 0.0,
            "payments": [],
        },
        "timeline": {
            "startYear": None,
            "endYear": None,
            "durationYears": None,
        },
        "confidence": 0.0,
        "reasoning": "",
    }

    try:
        # Extract raw data from various input types
        if isinstance(result, dict):
            parsed = result
        elif isinstance(result, str):
            # Try to extract JSON from the string
            parsed = _extract_json(result)
        elif hasattr(result, "message"):
            parsed = _extract_json(
                result.message if isinstance(result.message, str) else str(result.message)
            )
        else:
            parsed = _extract_json(str(result))

        if parsed is None:
            default_response["reasoning"] = "Failed to parse LLM response as JSON"
            return default_response

        # --- Validate and normalize financialSummary ---
        fs = parsed.get("financialSummary", {})
        if not isinstance(fs, dict):
            fs = {}

        payments_raw = fs.get("payments", [])
        if not isinstance(payments_raw, list):
            payments_raw = []

        payments = []
        for p in payments_raw:
            if not isinstance(p, dict):
                continue
            try:
                amount = float(p.get("amount", 0))
            except (TypeError, ValueError):
                continue
            if amount < 0:
                amount = 0.0
            payments.append({
                "amount": amount,
                "sourceDocument": str(p.get("sourceDocument", "")),
                "description": str(p.get("description", "")),
            })

        amounts = [p["amount"] for p in payments]
        if amounts:
            min_payment = min(amounts)
            max_payment = max(amounts)
            total_value = sum(amounts)
        else:
            min_payment = 0.0
            max_payment = 0.0
            total_value = 0.0

        # Enforce minPayment <= maxPayment
        if min_payment > max_payment:
            min_payment, max_payment = max_payment, min_payment

        # --- Validate and normalize timeline ---
        tl = parsed.get("timeline", {})
        if not isinstance(tl, dict):
            tl = {}

        start_year = _to_int_or_none(tl.get("startYear"))
        end_year = _to_int_or_none(tl.get("endYear"))

        if start_year is not None and end_year is not None:
            duration_years = end_year - start_year
        else:
            duration_years = None

        # --- Validate confidence ---
        try:
            confidence = float(parsed.get("confidence", 0.0))
        except (TypeError, ValueError):
            confidence = 0.0
        confidence = max(0.0, min(1.0, confidence))

        # --- Reasoning ---
        reasoning = str(parsed.get("reasoning", ""))

        return {
            "financialSummary": {
                "minPayment": min_payment,
                "maxPayment": max_payment,
                "totalValue": total_value,
                "payments": payments,
            },
            "timeline": {
                "startYear": start_year,
                "endYear": end_year,
                "durationYears": duration_years,
            },
            "confidence": confidence,
            "reasoning": reasoning,
        }

    except Exception as e:
        logger.error(f"Error parsing agent response: {e}")
        default_response["reasoning"] = f"Parse error: {str(e)}"
        return default_response


def _extract_json(text: str) -> dict | None:
    """Extract a JSON object from a string that may contain surrounding text or markdown."""
    # Try direct parse first
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        pass

    # Strip markdown code fences: ```json ... ``` or ``` ... ```
    stripped = re.sub(r"^```(?:json)?\s*\n?", "", text.strip(), flags=re.MULTILINE)
    stripped = re.sub(r"\n?```\s*$", "", stripped.strip(), flags=re.MULTILINE)
    try:
        return json.loads(stripped)
    except (json.JSONDecodeError, TypeError):
        pass

    # Try to find JSON object in the text
    match = re.search(r"\{[\s\S]*\}", text)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass

    return None


def _to_int_or_none(value) -> int | None:
    """Convert a value to int or return None."""
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Lambda Handler entry point
# ---------------------------------------------------------------------------


def handler(event, context):
    """
    Lambda handler for the Financial Timeline Agent.

    Retrieves documents for a claim, combines their text, invokes the
    Strands Agent for LLM-based financial/timeline extraction, and
    returns a validated structured response.

    Args:
        event: Dict containing 'claim_id' and optionally 'tenant_id', 'model_id'
        context: Lambda context (unused)

    Returns:
        Dict with financialSummary, timeline, confidence, and reasoning
    """
    claim_id = event.get("claim_id")
    if not claim_id:
        return {"error": "claim_id is required", "statusCode": 400}

    # Set OpenTelemetry attributes if span is available
    try:
        span = trace.get_current_span()
        span.set_attribute("claim.id", claim_id)
        span.set_attribute("claim.strategy", "financial-timeline")
    except Exception:
        pass  # OpenTelemetry may not be available in all environments

    # 1. Retrieve documents
    try:
        documents = _retrieve_claim_documents_impl(claim_id)
    except DocumentRetrievalError as e:
        logger.error(f"Document retrieval failed for claim {claim_id}: {e}")
        return {"error": str(e), "statusCode": e.status_code}
    except Exception as e:
        logger.error(f"Document retrieval failed for claim {claim_id}: {e}")
        return {"error": str(e), "statusCode": 500}

    # 2. Combine document text
    combined_text = _combine_document_text(documents)

    # 3. If no documents have extractable text, return defaults
    if not combined_text.strip():
        logger.info(f"No extractable text for claim {claim_id}, returning defaults")
        return {
            "financialSummary": {
                "minPayment": 0.0,
                "maxPayment": 0.0,
                "totalValue": 0.0,
                "payments": [],
            },
            "timeline": {
                "startYear": None,
                "endYear": None,
                "durationYears": None,
            },
            "confidence": 0.0,
            "reasoning": "No extractable text found in documents",
        }

    # Truncate to fit within model context window (Nova Pro ~300K tokens, but
    # Strands Agent overhead + system prompt consume significant tokens)
    max_text_chars = 15000
    if len(combined_text) > max_text_chars:
        combined_text = combined_text[:max_text_chars] + "\n\n[... truncated ...]"
        print(f"[FINANCIAL_AGENT] Truncated text from {len(combined_text)} to {max_text_chars} chars")

    # 4. Invoke the Strands Agent
    try:
        print(f"[FINANCIAL_AGENT] Invoking Strands Agent for claim {claim_id} with {len(combined_text)} chars of text")
        result = agent(
            f"Analyze the following insurance claim documents and extract all "
            f"financial amounts and timeline data. Return ONLY a JSON object, "
            f"no markdown, no explanation outside the JSON:\n\n{combined_text}"
        )
        # Log the raw result for debugging
        raw_message = result.message if hasattr(result, 'message') else str(result)
        print(f"[FINANCIAL_AGENT] Raw response type: {type(result)}, message length: {len(raw_message)}")
        print(f"[FINANCIAL_AGENT] Raw response (first 1000 chars): {raw_message[:1000]}")
        response = parse_agent_response(result)
        print(f"[FINANCIAL_AGENT] Parsed response: payments={len(response.get('financialSummary', {}).get('payments', []))}, confidence={response.get('confidence')}")
    except Exception as e:
        logger.error(f"Agent invocation failed for claim {claim_id}: {e}")
        return {
            "financialSummary": {
                "minPayment": 0.0,
                "maxPayment": 0.0,
                "totalValue": 0.0,
                "payments": [],
            },
            "timeline": {
                "startYear": None,
                "endYear": None,
                "durationYears": None,
            },
            "confidence": 0.0,
            "reasoning": f"Agent invocation failed: {str(e)}",
        }

    return response


# ---------------------------------------------------------------------------
# BedrockAgentCoreApp entry point
# ---------------------------------------------------------------------------

app = BedrockAgentCoreApp()


@app.entrypoint
def invoke(payload):
    """AgentCore Runtime entry point for the Financial Timeline Agent.

    Args:
        payload: Dict containing at least 'claim_id'.

    Returns:
        A dict with financialSummary, timeline, confidence, and reasoning.
    """
    return handler(payload, None)


if __name__ == "__main__":
    app.run()
