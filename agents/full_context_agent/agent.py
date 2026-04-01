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

from opentelemetry import trace

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


def _extract_financial_data_impl(documents: list[dict]) -> dict:
    """
    Extract financial information from documents.

    Extracts payment amounts, claim values, and calculates min/max ranges.

    Args:
        documents: List of document records

    Returns:
        Dict with minPayment, maxPayment, totalValue, and payments list
    """
    payments = []

    # Currency patterns to match various formats
    currency_patterns = [
        # Standard currency formats
        r'\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)',  # $1,234.56
        r'(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:USD|dollars?)',  # 1,234.56 USD

        # Labeled amounts
        r'(?:amount|total|payment|charge|cost|fee|copay|deductible|balance|claim):\s*\$?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)',
        r'(?:paid|billed|charged|owed|due|allowed):\s*\$?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)',

        # Insurance-specific terms
        r'(?:coinsurance|copayment|premium|benefit):\s*\$?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)',
        r'(?:reimbursement|adjustment|write[- ]?off):\s*\$?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)',

        # Medical billing terms
        r'(?:procedure|service|office visit|consultation)\s+(?:cost|fee|charge):\s*\$?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)',

        # Line item patterns
        r'(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:\$|dollars?|USD)\s*(?:each|per|total)',
    ]

    for doc in documents:
        file_name = doc.get("fileName", doc.get("documentId", "Unknown"))
        text = doc.get("extractedText", "")

        for pattern in currency_patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            for match in matches:
                try:
                    # Remove commas and convert to float
                    amount = float(match.replace(',', ''))
                    if amount > 0:  # Only positive amounts
                        payments.append({
                            "amount": amount,
                            "sourceDocument": file_name,
                            "rawText": match
                        })
                except ValueError:
                    continue

    if not payments:
        return {
            "minPayment": 0.0,
            "maxPayment": 0.0,
            "totalValue": 0.0,
            "payments": []
        }

    amounts = [p["amount"] for p in payments]
    return {
        "minPayment": min(amounts),
        "maxPayment": max(amounts),
        "totalValue": sum(amounts),
        "payments": payments
    }


def _extract_timeline_data_impl(documents: list[dict]) -> dict:
    """
    Extract timeline information from documents.

    Finds earliest and latest dates to determine care history duration.

    Args:
        documents: List of document records

    Returns:
        Dict with startYear, endYear, durationYears
    """
    all_dates = []

    date_labels = [
        # Patient dates
        "birth date", "dob", "date of birth", "born",

        # Service dates
        "service date", "date of service", "dos", "encounter date", "visit date",
        "appointment date", "consultation date", "examination date",

        # Medical procedure dates
        "procedure date", "treatment date", "surgery date", "operation date",
        "test date", "lab date", "imaging date", "x-ray date", "mri date",

        # Facility dates
        "admission date", "discharge date", "admission", "discharge",
        "check-in date", "check-out date",

        # Billing dates
        "payment date", "paid date", "date paid", "billing date", "invoice date",
        "claim date", "processed date", "adjudicated", "submitted",

        # Insurance dates
        "effective date", "coverage date", "policy date", "expiration date",
        "authorization date", "approval date"
    ]

    for doc in documents:
        text = doc.get("extractedText", "")
        dates = _find_dates(text, date_labels)

        for date_str in dates:
            parsed_date = _parse_date(date_str)
            if parsed_date:
                all_dates.append(parsed_date)

    if not all_dates:
        return {
            "startYear": None,
            "endYear": None,
            "durationYears": None
        }

    earliest = min(all_dates)
    latest = max(all_dates)
    duration = latest.year - earliest.year

    return {
        "startYear": earliest.year,
        "endYear": latest.year,
        "durationYears": duration
    }


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
def extract_financial_data(documents: str) -> str:
    """Extract financial information from insurance claim documents.

    Analyzes documents to find payment amounts, claim values, and calculate
    financial summaries including minimum and maximum payment amounts.

    Args:
        documents: A JSON string containing a list of document records,
            each with 'extractedText' and 'fileName' fields.

    Returns:
        A JSON string containing financial summary with keys
        'minPayment', 'maxPayment', 'totalValue', and 'payments'.
    """
    docs = json.loads(documents)
    result = _extract_financial_data_impl(docs)
    return json.dumps(result, default=str)


@tool
def extract_timeline_data(documents: str) -> str:
    """Extract timeline information from insurance claim documents.

    Analyzes documents to find earliest and latest dates to determine
    the duration of the patient's care history.

    Args:
        documents: A JSON string containing a list of document records,
            each with 'extractedText' and 'fileName' fields.

    Returns:
        A JSON string containing timeline data with keys
        'startYear', 'endYear', and 'durationYears'.
    """
    docs = json.loads(documents)
    result = _extract_timeline_data_impl(docs)
    return json.dumps(result, default=str)


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
3. Call extract_financial_data with the retrieved documents to get payment information
4. Call extract_timeline_data with the retrieved documents to get care history timeline
5. Call detect_anomalies with the retrieved documents to find data inconsistencies

Then generate a comprehensive summary that includes:

## PATIENT & TIMELINE OVERVIEW
- Patient demographics (name, age, gender, date of birth)
- Care history timeline from earliest to most recent engagement
- Duration of care relationship and key milestones

## FINANCIAL SUMMARY
- Payment amounts found across all documents (minimum to maximum range)
- Total claim values and payment patterns
- Key financial dates and transaction details

## CLINICAL SUMMARY
- Primary and secondary diagnoses with ICD codes
- Procedures performed with CPT codes and dates
- Treatment progression and outcomes
- Provider information and healthcare facilities

## DATA QUALITY & ANOMALIES
- Any inconsistencies found in dates, amounts, or patient information
- Cross-document contradictions or unusual patterns
- Data completeness assessment

Include specific dollar amounts, dates, and medical codes where available. Base your analysis on the actual tool results from extract_financial_data and extract_timeline_data calls.
- Any gaps in care or unusual patterns

## ANALYSIS INSTRUCTIONS

**FINANCIAL EXTRACTION**: Use the extract_financial_data results to highlight:
- Payment amount ranges (min/max)
- Unusual or outlier amounts
- Payment patterns over time

**TIMELINE ANALYSIS**: Use the extract_timeline_data results to identify:
- Care history duration
- Frequency of services
- Gaps or intensive treatment periods

**ANOMALY DETECTION**: Combine detect_anomalies results with your own analysis to identify:
- Financial inconsistencies (duplicate charges, unusual amounts)
- Clinical implausibilities for patient age/condition
- Timeline conflicts or impossible sequences
- Cross-document contradictions

**CLINICAL EXPERTISE**: Apply medical and insurance domain knowledge to flag:
- Treatments inappropriate for diagnosis
- Procedures inconsistent with patient age
- Billing patterns that warrant investigation

Return your final response as JSON with these exact keys:
- "summary": your structured summary text (use markdown headers as shown above)
- "anomalies": the anomalies from detect_anomalies plus your additional findings
- "documentCount": number of documents retrieved
- "strategy": "full-context"
- "financialSummary": the complete result from extract_financial_data
- "timeline": the complete result from extract_timeline_data
"""

model = BedrockModel(
    model_id=f"us.{BEDROCK_MODEL_ID}",
    region_name=BEDROCK_REGION,
    temperature=0.3,
    max_tokens=2000,
)

agent = Agent(
    model=model,
    tools=[
        retrieve_claim_documents,
        combine_document_text,
        extract_financial_data,
        extract_timeline_data,
        detect_anomalies
    ],
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
        A dict with keys summary, anomalies, documentCount, strategy,
        financialSummary, and timeline.
    """
    # Default response structure
    default_response = {
        "summary": "",
        "anomalies": [],
        "documentCount": default_count,
        "strategy": strategy,
        "promptInfo": {
            "promptTemplate": SYSTEM_PROMPT,
            "strategyLabel": "Enhanced Full Context Agent",
        },
        "financialSummary": {
            "minPayment": 0.0,
            "maxPayment": 0.0,
            "totalValue": 0.0,
            "payments": []
        },
        "timeline": {
            "startYear": None,
            "endYear": None,
            "durationYears": None
        }
    }

    try:
        response_text = result.message if hasattr(result, 'message') else str(result)

        # First try to parse as JSON (backward compatibility)
        try:
            parsed = json.loads(response_text)
            default_response.update({
                "summary": parsed.get("summary", response_text),
                "anomalies": parsed.get("anomalies", []),
                "documentCount": parsed.get("documentCount", default_count),
                "financialSummary": parsed.get("financialSummary", default_response["financialSummary"]),
                "timeline": parsed.get("timeline", default_response["timeline"])
            })
            return default_response
        except json.JSONDecodeError:
            # Handle markdown format - use the full response as summary
            default_response["summary"] = response_text

        # Try to extract financial and timeline data from tool results if available
        if hasattr(result, 'tool_results') and result.tool_results:
            for tool_result in result.tool_results:
                if hasattr(tool_result, 'name'):
                    if tool_result.name == 'extract_financial_data' and hasattr(tool_result, 'result'):
                        try:
                            financial_data = tool_result.result
                            if isinstance(financial_data, dict):
                                default_response["financialSummary"] = financial_data
                        except Exception:
                            pass
                    elif tool_result.name == 'extract_timeline_data' and hasattr(tool_result, 'result'):
                        try:
                            timeline_data = tool_result.result
                            if isinstance(timeline_data, dict):
                                default_response["timeline"] = timeline_data
                        except Exception:
                            pass

        return default_response

    except Exception as e:
        logger.error(f"Error parsing agent response: {e}")
        default_response["summary"] = str(result)
        return default_response


# ---------------------------------------------------------------------------
# Lambda Handler entry point
# ---------------------------------------------------------------------------

def handler(event, context):
    """
    Lambda handler for the Enhanced Full Context Summary Agent.

    Receives payload with claim_id and uses tools to extract financial and
    timeline data, then generates a comprehensive summary.

    Args:
        event: Dict containing 'claim_id' and optionally 'tenant_id', 'model_id'
        context: Lambda context (unused)

    Returns:
        Dict with summary, anomalies, documentCount, strategy, financialSummary, and timeline
    """
    try:
        claim_id = event.get("claim_id")
        if not claim_id:
            return {"error": "claim_id is required", "statusCode": 400}

        # Set OpenTelemetry attributes if span is available
        try:
            span = trace.get_current_span()
            span.set_attribute("claim.id", claim_id or "")
            span.set_attribute("claim.strategy", "full-context")
            span.set_attribute("claim.chunking_method", "none")
        except:
            pass  # OpenTelemetry may not be available in all environments

        # Invoke the Strands Agent with enhanced tools
        result = agent(
            f"Process claim {claim_id} and provide a comprehensive analysis with financial and timeline data in the structured format specified"
        )

        return parse_agent_response(result)
    except Exception as e:
        logger.error(f"Full Context agent invocation failed: {e}")
        return {"error": str(e), "statusCode": 500}


# ---------------------------------------------------------------------------
# BedrockAgentCoreApp entry point (for compatibility)
# ---------------------------------------------------------------------------

app = BedrockAgentCoreApp()


@app.entrypoint
def invoke(payload):
    """AgentCore Runtime entry point for the Full Context Summary Agent.

    Compatibility wrapper that calls the main handler logic.

    Args:
        payload: Dict containing at least 'claim_id'.

    Returns:
        A dict with summary, anomalies, documentCount, strategy,
        financialSummary, and timeline.
    """
    return handler(payload, None)


if __name__ == "__main__":
    app.run()
