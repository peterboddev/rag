"""
Graph RAG Summary Agent

AgentCore Runtime agent that summarizes insurance claims by building an
in-memory knowledge graph of entities and relationships from claim documents,
then using graph traversal for contextually connected information and
anomaly detection via graph analysis.

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
import networkx as nx
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


# Entity extraction regex patterns
PATIENT_NAME_PATTERN = r"[Pp]atient\s*[Nn]ame\s*[:]\s*([A-Za-z\s]+?)(?:\n|$|,)"
ICD10_CODE_PATTERN = r"([A-Z]\d{2}(?:\.\d{1,4})?)"
CPT_CODE_PATTERN = r"(?:CPT|cpt)\s*[:]*\s*(\d{5})"
DATE_PATTERN = r"(\d{4}-\d{2}-\d{2})"
AMOUNT_PATTERN = r"\$\s*([\d,]+\.?\d*)"
PROVIDER_NAME_PATTERN = r"[Pp]rovider\s*[Nn]ame\s*[:]\s*([A-Za-z\s\.]+?)(?:\n|$|,)"
NPI_PATTERN = r"(?:NPI|npi)\s*[:]*\s*(\d{10})"
DOB_LABELS = ["birth date", "dob", "date of birth"]
SERVICE_DATE_LABELS = ["service date", "date of service", "dos"]
PAYMENT_DATE_LABELS = ["payment date", "paid date", "date paid"]


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

        # Handle pagination
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


def _find_labeled_dates(text: str, labels: list[str]) -> list[str]:
    """
    Find dates associated with given labels in text.

    Looks for patterns like:
    - "Birth Date: 2024-01-15"
    - "DOB: 01/15/2024"
    - "Date of Service: 2024-01-15"

    Args:
        text: The document text to search
        labels: List of label strings to look for

    Returns:
        List of date strings found near the labels
    """
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


def _extract_patient_entities(
    graph: nx.DiGraph, text: str, doc_node_id: str
) -> None:
    """Extract patient entities and add to graph."""
    # Extract patient names
    names = re.findall(PATIENT_NAME_PATTERN, text)
    for name in names:
        name_clean = name.strip()
        if not name_clean:
            continue
        node_id = f"patient:{name_clean}"
        graph.add_node(
            node_id,
            type="patient",
            label=name_clean,
            properties={"name": name_clean},
        )
        graph.add_edge(doc_node_id, node_id, type="contains")

    # Extract DOB and link to patient
    dob_dates = _find_labeled_dates(text, DOB_LABELS)
    for dob in dob_dates:
        dob_node_id = f"date:dob:{dob}"
        graph.add_node(
            dob_node_id,
            type="date",
            label=f"DOB: {dob}",
            properties={"date": dob, "dateType": "birth"},
        )
        # Link DOB to patient nodes in this document
        for name in names:
            name_clean = name.strip()
            if name_clean:
                patient_node = f"patient:{name_clean}"
                if graph.has_node(patient_node):
                    graph.add_edge(
                        patient_node, dob_node_id, type="has_dob"
                    )


def _extract_provider_entities(
    graph: nx.DiGraph, text: str, doc_node_id: str
) -> None:
    """Extract provider entities and add to graph."""
    providers = re.findall(PROVIDER_NAME_PATTERN, text)
    for provider in providers:
        provider_clean = provider.strip()
        if not provider_clean:
            continue
        node_id = f"provider:{provider_clean}"
        graph.add_node(
            node_id,
            type="provider",
            label=provider_clean,
            properties={"name": provider_clean},
        )
        graph.add_edge(doc_node_id, node_id, type="contains")

    # Extract NPI numbers
    npis = re.findall(NPI_PATTERN, text)
    for npi in npis:
        npi_node_id = f"provider:npi:{npi}"
        graph.add_node(
            npi_node_id,
            type="provider",
            label=f"NPI: {npi}",
            properties={"npi": npi},
        )
        graph.add_edge(doc_node_id, npi_node_id, type="contains")
        # Link NPI to named providers in this document
        for provider in providers:
            provider_clean = provider.strip()
            if provider_clean:
                graph.add_edge(
                    f"provider:{provider_clean}",
                    npi_node_id,
                    type="has_npi",
                )


def _extract_diagnosis_entities(
    graph: nx.DiGraph, text: str, doc_node_id: str
) -> None:
    """Extract diagnosis (ICD-10) entities and add to graph."""
    codes = re.findall(ICD10_CODE_PATTERN, text)
    for code in codes:
        node_id = f"diagnosis:{code}"
        graph.add_node(
            node_id,
            type="diagnosis",
            label=f"ICD-10: {code}",
            properties={"code": code},
        )
        graph.add_edge(doc_node_id, node_id, type="contains")

        # Link diagnosis to patients in this document
        patient_nodes = [
            n for n in graph.successors(doc_node_id)
            if graph.nodes[n].get("type") == "patient"
        ]
        for patient_node in patient_nodes:
            graph.add_edge(
                patient_node, node_id, type="has_diagnosis"
            )


def _extract_procedure_entities(
    graph: nx.DiGraph, text: str, doc_node_id: str
) -> None:
    """Extract procedure (CPT) entities and add to graph."""
    codes = re.findall(CPT_CODE_PATTERN, text)
    for code in codes:
        node_id = f"procedure:{code}"
        graph.add_node(
            node_id,
            type="procedure",
            label=f"CPT: {code}",
            properties={"code": code},
        )
        graph.add_edge(doc_node_id, node_id, type="contains")

        # Link procedure to patients
        patient_nodes = [
            n for n in graph.successors(doc_node_id)
            if graph.nodes[n].get("type") == "patient"
        ]
        for patient_node in patient_nodes:
            graph.add_edge(
                patient_node, node_id, type="received_procedure"
            )

        # Link procedure to providers
        provider_nodes = [
            n for n in graph.successors(doc_node_id)
            if graph.nodes[n].get("type") == "provider"
        ]
        for provider_node in provider_nodes:
            graph.add_edge(
                provider_node, node_id, type="performed"
            )


def _extract_date_entities(
    graph: nx.DiGraph, text: str, doc_node_id: str
) -> None:
    """Extract date entities (service dates, payment dates) and add to graph."""
    # Service dates
    service_dates = _find_labeled_dates(text, SERVICE_DATE_LABELS)
    for date_str in service_dates:
        node_id = f"date:service:{date_str}"
        graph.add_node(
            node_id,
            type="date",
            label=f"Service: {date_str}",
            properties={"date": date_str, "dateType": "service"},
        )
        graph.add_edge(doc_node_id, node_id, type="contains")

        # Link service dates to procedures in this document
        procedure_nodes = [
            n for n in graph.successors(doc_node_id)
            if graph.nodes[n].get("type") == "procedure"
        ]
        for proc_node in procedure_nodes:
            graph.add_edge(proc_node, node_id, type="on_date")

    # Payment dates
    payment_dates = _find_labeled_dates(text, PAYMENT_DATE_LABELS)
    for date_str in payment_dates:
        node_id = f"date:payment:{date_str}"
        graph.add_node(
            node_id,
            type="date",
            label=f"Payment: {date_str}",
            properties={"date": date_str, "dateType": "payment"},
        )
        graph.add_edge(doc_node_id, node_id, type="contains")


def _extract_amount_entities(
    graph: nx.DiGraph, text: str, doc_node_id: str
) -> None:
    """Extract monetary amount entities and add to graph."""
    amounts = re.findall(AMOUNT_PATTERN, text)
    for amount_str in amounts:
        # Normalize: remove commas
        amount_clean = amount_str.replace(",", "")
        node_id = f"amount:{amount_clean}"
        graph.add_node(
            node_id,
            type="amount",
            label=f"${amount_clean}",
            properties={"amount": amount_clean},
        )
        graph.add_edge(doc_node_id, node_id, type="contains")

        # Link amounts to procedures in this document
        procedure_nodes = [
            n for n in graph.successors(doc_node_id)
            if graph.nodes[n].get("type") == "procedure"
        ]
        for proc_node in procedure_nodes:
            graph.add_edge(proc_node, node_id, type="costs")


def _build_knowledge_graph_impl(documents: list[dict]) -> nx.DiGraph:
    """
    Build an in-memory knowledge graph from claim documents.

    Extracts entities (patients, providers, diagnoses, procedures, dates,
    amounts) and creates relationships between them.

    Args:
        documents: List of document records with extractedText

    Returns:
        A networkx DiGraph with entity nodes and relationship edges
    """
    graph = nx.DiGraph()

    for doc in documents:
        file_name = doc.get("fileName", doc.get("documentId", "Unknown"))
        text = doc.get("extractedText", "")

        # Add document node
        doc_node_id = f"doc:{file_name}"
        graph.add_node(
            doc_node_id,
            type="document",
            label=file_name,
            properties={"fileName": file_name},
        )

        # Extract and add entities from this document
        _extract_patient_entities(graph, text, doc_node_id)
        _extract_provider_entities(graph, text, doc_node_id)
        _extract_diagnosis_entities(graph, text, doc_node_id)
        _extract_procedure_entities(graph, text, doc_node_id)
        _extract_date_entities(graph, text, doc_node_id)
        _extract_amount_entities(graph, text, doc_node_id)

    return graph


def _extract_entities_impl(graph: nx.DiGraph) -> list[dict]:
    """
    Extract all entity nodes from the knowledge graph.

    Args:
        graph: The knowledge graph

    Returns:
        List of entity dicts with id, type, label, and properties
    """
    entities = []
    for node_id, data in graph.nodes(data=True):
        entities.append({
            "id": node_id,
            "type": data.get("type", "unknown"),
            "label": data.get("label", ""),
            "properties": data.get("properties", {}),
        })
    return entities


def _detect_conflicting_dobs(graph: nx.DiGraph) -> list[dict]:
    """Detect patients with multiple different DOBs."""
    anomalies = []

    patient_nodes = [
        n for n, d in graph.nodes(data=True)
        if d.get("type") == "patient"
    ]

    for patient_node in patient_nodes:
        dob_nodes = [
            n for n in graph.successors(patient_node)
            if graph.nodes[n].get("type") == "date"
            and graph.nodes[n].get("properties", {}).get("dateType") == "birth"
        ]

        if len(dob_nodes) > 1:
            dob_values = [
                graph.nodes[n]["properties"]["date"] for n in dob_nodes
            ]
            unique_dobs = set(dob_values)
            if len(unique_dobs) > 1:
                # Find source documents
                source_docs = set()
                for dob_node in dob_nodes:
                    for pred in graph.predecessors(dob_node):
                        if graph.nodes[pred].get("type") == "document":
                            source_docs.add(
                                graph.nodes[pred].get("label", "Unknown")
                            )

                patient_label = graph.nodes[patient_node].get("label", "Unknown")
                anomalies.append({
                    "description": (
                        f"Patient {patient_label} has conflicting dates "
                        f"of birth: {', '.join(sorted(unique_dobs))}"
                    ),
                    "severity": "critical",
                    "sourceDocument": ", ".join(sorted(source_docs)) or "Unknown",
                    "dataValues": {
                        f"dob_{i + 1}": dob
                        for i, dob in enumerate(sorted(unique_dobs))
                    },
                })

    return anomalies


def _detect_chronological_impossibilities(graph: nx.DiGraph) -> list[dict]:
    """Detect service dates before birth dates via graph traversal."""
    anomalies = []

    # Find all DOB date nodes
    dob_nodes = [
        (n, d) for n, d in graph.nodes(data=True)
        if d.get("type") == "date"
        and d.get("properties", {}).get("dateType") == "birth"
    ]

    # Find all service date nodes
    service_nodes = [
        (n, d) for n, d in graph.nodes(data=True)
        if d.get("type") == "date"
        and d.get("properties", {}).get("dateType") == "service"
    ]

    for dob_id, dob_data in dob_nodes:
        dob_str = dob_data.get("properties", {}).get("date", "")
        dob_dt = _parse_date(dob_str)
        if not dob_dt:
            continue

        for svc_id, svc_data in service_nodes:
            svc_str = svc_data.get("properties", {}).get("date", "")
            svc_dt = _parse_date(svc_str)
            if not svc_dt:
                continue

            if svc_dt < dob_dt:
                # Find source documents for the service date
                source_docs = set()
                for pred in graph.predecessors(svc_id):
                    if graph.nodes[pred].get("type") == "document":
                        source_docs.add(
                            graph.nodes[pred].get("label", "Unknown")
                        )
                for pred in graph.predecessors(dob_id):
                    if graph.nodes[pred].get("type") == "document":
                        source_docs.add(
                            graph.nodes[pred].get("label", "Unknown")
                        )

                anomalies.append({
                    "description": (
                        f"Service date ({svc_str}) precedes patient "
                        f"birth date ({dob_str})"
                    ),
                    "severity": "critical",
                    "sourceDocument": ", ".join(sorted(source_docs)) or "Unknown",
                    "dataValues": {
                        "serviceDate": svc_str,
                        "birthDate": dob_str,
                    },
                })

    return anomalies


def _detect_payment_before_service(graph: nx.DiGraph) -> list[dict]:
    """Detect payment dates before service dates via graph traversal."""
    anomalies = []

    service_nodes = [
        (n, d) for n, d in graph.nodes(data=True)
        if d.get("type") == "date"
        and d.get("properties", {}).get("dateType") == "service"
    ]

    payment_nodes = [
        (n, d) for n, d in graph.nodes(data=True)
        if d.get("type") == "date"
        and d.get("properties", {}).get("dateType") == "payment"
    ]

    for pay_id, pay_data in payment_nodes:
        pay_str = pay_data.get("properties", {}).get("date", "")
        pay_dt = _parse_date(pay_str)
        if not pay_dt:
            continue

        for svc_id, svc_data in service_nodes:
            svc_str = svc_data.get("properties", {}).get("date", "")
            svc_dt = _parse_date(svc_str)
            if not svc_dt:
                continue

            if pay_dt < svc_dt:
                source_docs = set()
                for pred in graph.predecessors(pay_id):
                    if graph.nodes[pred].get("type") == "document":
                        source_docs.add(
                            graph.nodes[pred].get("label", "Unknown")
                        )
                for pred in graph.predecessors(svc_id):
                    if graph.nodes[pred].get("type") == "document":
                        source_docs.add(
                            graph.nodes[pred].get("label", "Unknown")
                        )

                anomalies.append({
                    "description": (
                        f"Payment date ({pay_str}) precedes service "
                        f"date ({svc_str})"
                    ),
                    "severity": "critical",
                    "sourceDocument": ", ".join(sorted(source_docs)) or "Unknown",
                    "dataValues": {
                        "paymentDate": pay_str,
                        "serviceDate": svc_str,
                    },
                })

    return anomalies


def _detect_conflicting_patient_names(graph: nx.DiGraph) -> list[dict]:
    """Detect conflicting patient names across documents."""
    anomalies = []

    patient_nodes = [
        (n, d) for n, d in graph.nodes(data=True)
        if d.get("type") == "patient"
    ]

    if len(patient_nodes) > 1:
        names = [d.get("label", "") for _, d in patient_nodes]
        unique_names = set(names)
        if len(unique_names) > 1:
            source_docs = set()
            for node_id, _ in patient_nodes:
                for pred in graph.predecessors(node_id):
                    if graph.nodes[pred].get("type") == "document":
                        source_docs.add(
                            graph.nodes[pred].get("label", "Unknown")
                        )

            anomalies.append({
                "description": (
                    f"Conflicting patient names found across documents: "
                    f"{', '.join(sorted(unique_names))}"
                ),
                "severity": "warning",
                "sourceDocument": ", ".join(sorted(source_docs)) or "Unknown",
                "dataValues": {
                    f"name_{i + 1}": name
                    for i, name in enumerate(sorted(unique_names))
                },
            })

    return anomalies


def _detect_graph_anomalies_impl(graph: nx.DiGraph) -> list[dict]:
    """
    Detect anomalies via graph analysis.

    Detects:
    - Conflicting relationships (patient has multiple different DOBs)
    - Impossible connections (service date before birth date via graph traversal)
    - Payment dates before service dates
    - Conflicting patient names across documents

    Args:
        graph: The knowledge graph

    Returns:
        List of anomaly dicts with description, severity,
        sourceDocument, and dataValues
    """
    anomalies = []

    anomalies.extend(_detect_conflicting_dobs(graph))
    anomalies.extend(_detect_chronological_impossibilities(graph))
    anomalies.extend(_detect_payment_before_service(graph))
    anomalies.extend(_detect_conflicting_patient_names(graph))

    return anomalies


def _build_graph_context(graph: nx.DiGraph) -> str:
    """
    Traverse graph for connected context to include in the prompt.

    Args:
        graph: The knowledge graph

    Returns:
        A text representation of the graph entities and relationships
    """
    lines = []

    # Group entities by type
    entity_types = {}
    for node_id, data in graph.nodes(data=True):
        etype = data.get("type", "unknown")
        if etype not in entity_types:
            entity_types[etype] = []
        entity_types[etype].append((node_id, data))

    # Format entities by type
    type_labels = {
        "patient": "Patients",
        "provider": "Providers",
        "diagnosis": "Diagnoses",
        "procedure": "Procedures",
        "date": "Dates",
        "amount": "Amounts",
        "document": "Documents",
    }

    for etype, label in type_labels.items():
        entities = entity_types.get(etype, [])
        if not entities:
            continue
        lines.append(f"\n{label}:")
        for node_id, data in entities:
            entity_label = data.get("label", node_id)
            lines.append(f"  - {entity_label}")

    # Format key relationships
    lines.append("\nRelationships:")
    relationship_types = {
        "has_diagnosis": "diagnosed with",
        "received_procedure": "received",
        "performed": "performed",
        "on_date": "on date",
        "costs": "costs",
        "has_dob": "born on",
    }

    for u, v, edge_data in graph.edges(data=True):
        edge_type = edge_data.get("type", "")
        if edge_type in relationship_types:
            u_label = graph.nodes[u].get("label", u)
            v_label = graph.nodes[v].get("label", v)
            rel_label = relationship_types[edge_type]
            lines.append(f"  - {u_label} {rel_label} {v_label}")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Graph serialization helpers for @tool JSON interface
# ---------------------------------------------------------------------------


def _serialize_graph(graph: nx.DiGraph) -> str:
    """Serialize a networkx DiGraph to a JSON string.

    Converts nodes (with id, type, label, properties) and edges
    (with source, target, type) into a JSON-serializable format.

    Args:
        graph: The networkx DiGraph to serialize

    Returns:
        JSON string with 'nodes' and 'edges' arrays
    """
    nodes = []
    for node_id, data in graph.nodes(data=True):
        nodes.append({
            "id": node_id,
            "type": data.get("type", "unknown"),
            "label": data.get("label", ""),
            "properties": data.get("properties", {}),
        })

    edges = []
    for u, v, data in graph.edges(data=True):
        edges.append({
            "source": u,
            "target": v,
            "type": data.get("type", ""),
        })

    return json.dumps({"nodes": nodes, "edges": edges})


def _deserialize_graph(graph_json: str) -> nx.DiGraph:
    """Deserialize a JSON string back into a networkx DiGraph.

    Args:
        graph_json: JSON string with 'nodes' and 'edges' arrays

    Returns:
        Reconstructed networkx DiGraph
    """
    data = json.loads(graph_json)
    graph = nx.DiGraph()

    for node in data.get("nodes", []):
        graph.add_node(
            node["id"],
            type=node.get("type", "unknown"),
            label=node.get("label", ""),
            properties=node.get("properties", {}),
        )

    for edge in data.get("edges", []):
        graph.add_edge(
            edge["source"],
            edge["target"],
            type=edge.get("type", ""),
        )

    return graph


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
def build_knowledge_graph(documents: str) -> str:
    """Build an in-memory knowledge graph from insurance claim documents.

    Extracts entities (patients, providers, diagnoses, procedures, dates,
    amounts) and creates relationship edges between them. Returns a JSON
    representation of the graph with nodes and edges.

    Args:
        documents: A JSON string containing a list of document records,
            each with 'fileName' and 'extractedText' fields.

    Returns:
        A JSON string with 'nodes' (id, type, label, properties) and
        'edges' (source, target, type) arrays representing the knowledge graph.
    """
    docs = json.loads(documents)
    graph = _build_knowledge_graph_impl(docs)
    return _serialize_graph(graph)


@tool
def extract_entities(graph_json: str) -> str:
    """Extract all entities from a knowledge graph.

    Returns a list of entity dicts with id, type, label, and properties
    for every node in the graph.

    Args:
        graph_json: A JSON string representing the knowledge graph with
            'nodes' and 'edges' arrays.

    Returns:
        A JSON string containing a list of entity dicts, each with keys
        'id', 'type', 'label', and 'properties'.
    """
    graph = _deserialize_graph(graph_json)
    entities = _extract_entities_impl(graph)
    return json.dumps(entities)


@tool
def detect_graph_anomalies(graph_json: str) -> str:
    """Detect data anomalies in a knowledge graph via graph analysis.

    Analyzes the graph for conflicting dates of birth, chronological
    impossibilities (service date before birth date), payment dates before
    service dates, and conflicting patient names across documents.

    Args:
        graph_json: A JSON string representing the knowledge graph with
            'nodes' and 'edges' arrays.

    Returns:
        A JSON string containing a list of anomaly dicts, each with keys
        'description', 'severity', 'sourceDocument', and 'dataValues'.
    """
    graph = _deserialize_graph(graph_json)
    anomalies = _detect_graph_anomalies_impl(graph)
    return json.dumps(anomalies)


# ---------------------------------------------------------------------------
# Agent configuration
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are an insurance claims analyst agent using graph-based RAG. For each claim, you MUST:
1. Call retrieve_claim_documents with the claim_id to get all documents
2. Call build_knowledge_graph with the retrieved documents to construct the knowledge graph
3. Call extract_entities with the graph JSON to get all entities
4. Call detect_graph_anomalies with the graph JSON to find data inconsistencies
5. Generate a comprehensive summary of the claim based on the graph entities and anomalies

Return your final response as JSON with these exact keys:
- "summary": your generated summary text
- "anomalies": the anomalies from detect_graph_anomalies
- "documentCount": number of documents retrieved
- "strategy": "graph-rag"
- "entityCount": number of entities extracted
"""

model = BedrockModel(
    model_id=f"us.{BEDROCK_MODEL_ID}",
    region_name=BEDROCK_REGION,
    temperature=0.3,
    max_tokens=2000,
)

agent = Agent(
    model=model,
    tools=[retrieve_claim_documents, build_knowledge_graph, extract_entities, detect_graph_anomalies],
    system_prompt=SYSTEM_PROMPT,
)


# ---------------------------------------------------------------------------
# Response parsing helper
# ---------------------------------------------------------------------------


def parse_agent_response(result, strategy="graph-rag", default_count=0):
    """Parse the agent's response into a structured dict.

    Attempts to extract JSON from the agent result. Falls back to returning
    the raw text as the summary with empty anomalies if JSON parsing fails.

    Args:
        result: The Strands Agent result object.
        strategy: The strategy name to include in the response.
        default_count: Default document count if not found in response.

    Returns:
        A dict with keys summary, anomalies, documentCount, strategy,
        and entityCount.
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
    """AgentCore Runtime entry point for the Graph RAG Summary Agent.

    Extracts the claim_id from the payload and invokes the Strands Agent
    to process the claim using knowledge graph analysis.

    Args:
        payload: Dict containing at least 'claim_id'.

    Returns:
        A dict with summary, anomalies, documentCount, strategy,
        and entityCount.
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
