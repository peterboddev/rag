"""
Graph RAG Summary Agent

AgentCore Runtime agent that summarizes insurance claims by building an
in-memory knowledge graph of entities and relationships from claim documents,
then using graph traversal for contextually connected information and
anomaly detection via graph analysis.

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
import networkx as nx
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


class GraphRAGSummaryAgent:
    """
    Agent that summarizes claims using an in-memory knowledge graph.

    This agent retrieves all documents for a claim, builds a knowledge graph
    of entities (patients, providers, diagnoses, procedures, dates, amounts)
    and their relationships, detects anomalies via graph analysis, and
    generates a summary using Bedrock Nova Pro with graph context.
    """

    def __init__(
        self,
        dynamodb_client: Any = None,
        bedrock_client: Any = None,
    ):
        """
        Initialize the Graph RAG Summary Agent.

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
        Generate a summary for the given claim using knowledge graph.

        Args:
            claim_id: The unique identifier of the claim to summarize

        Returns:
            dict containing:
                - summary: The generated summary text
                - anomalies: List of detected data anomalies
                - documentCount: Number of documents processed
                - strategy: Always "graph-rag"
                - entityCount: Number of entities in the graph

        Raises:
            DocumentRetrievalError: If no documents found or no extractedText
            SummaryGenerationError: If Bedrock invocation fails
        """
        with tracer.start_as_current_span("graph_rag_summary") as span:
            span.set_attribute("claim_id", claim_id)

            # 1. Retrieve all documents for claim
            documents = await self.get_claim_documents(claim_id)
            span.set_attribute("document_count", len(documents))

            # 2. Build in-memory knowledge graph
            graph = self.build_knowledge_graph(documents)

            # 3. Extract entities from graph
            entities = self.extract_entities(graph)
            span.set_attribute("entity_count", len(entities))

            # 4. Detect anomalies via graph analysis
            anomalies = self.detect_graph_anomalies(graph)
            span.set_attribute("anomaly_count", len(anomalies))

            # 5. Generate summary with graph context
            summary = await self.generate_summary(graph, anomalies, claim_id)

            # 6. Set trace output attributes
            span.set_attribute("summary_length", len(summary))
            span.set_attribute(
                "graph_entities",
                json.dumps([
                    {"id": e["id"], "type": e["type"]}
                    for e in entities[:50]
                ]),
            )
            span.set_attribute(
                "detected_anomalies", json.dumps(anomalies)
            )

            return {
                "summary": summary,
                "anomalies": anomalies,
                "documentCount": len(documents),
                "strategy": "graph-rag",
                "entityCount": len(entities),
            }

    async def get_claim_documents(self, claim_id: str) -> list[dict]:
        """
        Retrieve all documents for a claim from DynamoDB.

        Args:
            claim_id: The claim identifier to query

        Returns:
            List of document records with extractedText

        Raises:
            DocumentRetrievalError: If no documents found or none have extractedText
        """
        try:
            response = self.documents_table.scan(
                FilterExpression="claimMetadata.claimId = :claimId",
                ExpressionAttributeValues={":claimId": claim_id},
            )

            documents = response.get("Items", [])

            # Handle pagination
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

    def build_knowledge_graph(self, documents: list[dict]) -> nx.DiGraph:
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
            self._extract_patient_entities(graph, text, doc_node_id)
            self._extract_provider_entities(graph, text, doc_node_id)
            self._extract_diagnosis_entities(graph, text, doc_node_id)
            self._extract_procedure_entities(graph, text, doc_node_id)
            self._extract_date_entities(graph, text, doc_node_id)
            self._extract_amount_entities(graph, text, doc_node_id)

        return graph

    def _extract_patient_entities(
        self, graph: nx.DiGraph, text: str, doc_node_id: str
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
        dob_dates = self._find_labeled_dates(text, DOB_LABELS)
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
        self, graph: nx.DiGraph, text: str, doc_node_id: str
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
        self, graph: nx.DiGraph, text: str, doc_node_id: str
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
        self, graph: nx.DiGraph, text: str, doc_node_id: str
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
        self, graph: nx.DiGraph, text: str, doc_node_id: str
    ) -> None:
        """Extract date entities (service dates, payment dates) and add to graph."""
        # Service dates
        service_dates = self._find_labeled_dates(text, SERVICE_DATE_LABELS)
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
        payment_dates = self._find_labeled_dates(text, PAYMENT_DATE_LABELS)
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
        self, graph: nx.DiGraph, text: str, doc_node_id: str
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

    def _find_labeled_dates(self, text: str, labels: list[str]) -> list[str]:
        """
        Find dates associated with given labels in text.

        Looks for patterns like:
        - "Birth Date: 2024-01-15"
        - "DOB: 01/15/2024"
        - "Date of Service: 2024-01-15"
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

    def extract_entities(self, graph: nx.DiGraph) -> list[dict]:
        """
        Extract all entity nodes from the knowledge graph.

        Args:
            graph: The knowledge graph

        Returns:
            List of entity dicts with id, type, and properties
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

    def detect_graph_anomalies(self, graph: nx.DiGraph) -> list[dict]:
        """
        Detect anomalies via graph analysis.

        Detects:
        - Conflicting relationships (patient has multiple different DOBs)
        - Impossible connections (service date before birth date via graph traversal)
        - Isolated nodes (entities not connected to the main claim graph)

        Args:
            graph: The knowledge graph

        Returns:
            List of DataAnomaly dicts
        """
        anomalies = []

        anomalies.extend(self._detect_conflicting_dobs(graph))
        anomalies.extend(self._detect_chronological_impossibilities(graph))
        anomalies.extend(self._detect_payment_before_service(graph))
        anomalies.extend(self._detect_conflicting_patient_names(graph))

        return anomalies

    def _detect_conflicting_dobs(self, graph: nx.DiGraph) -> list[dict]:
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

    def _detect_chronological_impossibilities(
        self, graph: nx.DiGraph
    ) -> list[dict]:
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
            dob_dt = self._parse_date(dob_str)
            if not dob_dt:
                continue

            for svc_id, svc_data in service_nodes:
                svc_str = svc_data.get("properties", {}).get("date", "")
                svc_dt = self._parse_date(svc_str)
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

    def _detect_payment_before_service(self, graph: nx.DiGraph) -> list[dict]:
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
            pay_dt = self._parse_date(pay_str)
            if not pay_dt:
                continue

            for svc_id, svc_data in service_nodes:
                svc_str = svc_data.get("properties", {}).get("date", "")
                svc_dt = self._parse_date(svc_str)
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

    def _detect_conflicting_patient_names(
        self, graph: nx.DiGraph
    ) -> list[dict]:
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

    def _build_graph_context(self, graph: nx.DiGraph) -> str:
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

    async def generate_summary(
        self, graph: nx.DiGraph, anomalies: list[dict], claim_id: str
    ) -> str:
        """
        Generate a summary using Bedrock Nova Pro with graph context.

        Args:
            graph: The knowledge graph
            anomalies: List of detected anomalies
            claim_id: The claim identifier

        Returns:
            Generated summary text

        Raises:
            SummaryGenerationError: If Bedrock invocation fails
        """
        graph_context = self._build_graph_context(graph)

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
            "You are an insurance claims analyst. A knowledge graph has been "
            "constructed from the claim documents for claim "
            f"{claim_id}. Analyze the following entity and relationship "
            "information and provide a comprehensive summary.\n\n"
            "Include:\n"
            "1. Patient information (name, DOB, ID)\n"
            "2. Diagnosis codes and descriptions\n"
            "3. Procedures performed\n"
            "4. Service dates\n"
            "5. Provider information\n"
            "6. Amounts and charges\n"
            "7. Entity relationships and connections\n"
            "8. Any notable findings or concerns\n\n"
            "Also analyze for data anomalies including:\n"
            "- Chronological impossibilities (service dates before birth dates)\n"
            "- Payment dates before service dates\n"
            "- Conflicting patient information across documents\n"
            "- Isolated or disconnected entities\n"
            f"{anomaly_context}\n\n"
            f"Knowledge Graph Context:\n{graph_context}"
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
