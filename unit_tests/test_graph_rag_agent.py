"""
Property-Based Tests for Graph RAG Summary Agent

Tests for:
- Property 6: Graph RAG Entity Extraction

Uses pytest with hypothesis library for property-based testing.
Minimum 100 iterations per property test.
"""

import sys
import os
from datetime import datetime
from unittest.mock import MagicMock

import pytest
from hypothesis import given, settings, strategies as st, assume

# Import GraphRAGSummaryAgent from the specific agent module path
import importlib.util as _ilu

_graph_agent_path = os.path.join(
    os.path.dirname(__file__), "..", "agents", "graph_rag_agent", "agent.py"
)
_spec = _ilu.spec_from_file_location("graph_rag_agent", _graph_agent_path)
_graph_mod = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_graph_mod)
GraphRAGSummaryAgent = _graph_mod.GraphRAGSummaryAgent


# =============================================================================
# Test Fixtures and Helpers
# =============================================================================


def create_document(
    doc_id: str,
    file_name: str,
    extracted_text: str,
    claim_id: str = "test-claim-001",
) -> dict:
    """Create a document record for testing."""
    return {
        "documentId": doc_id,
        "fileName": file_name,
        "extractedText": extracted_text,
        "processingStatus": "completed",
        "claimMetadata": {
            "claimId": claim_id,
            "documentType": "medical_record",
        },
        "tenantId": "test-tenant",
        "createdAt": datetime.now().isoformat(),
    }


def make_agent() -> GraphRAGSummaryAgent:
    """Create a GraphRAGSummaryAgent with mocked clients."""
    return GraphRAGSummaryAgent(
        dynamodb_client=MagicMock(),
        bedrock_client=MagicMock(),
    )


# =============================================================================
# Hypothesis Strategies
# =============================================================================

# Strategy for generating patient names (first + last)
patient_name_strategy = st.tuples(
    st.sampled_from([
        "John", "Jane", "Alice", "Bob", "Carlos", "Diana",
        "Edward", "Fiona", "George", "Helen",
    ]),
    st.sampled_from([
        "Smith", "Doe", "Johnson", "Williams", "Brown",
        "Jones", "Garcia", "Miller", "Davis", "Wilson",
    ]),
).map(lambda t: f"{t[0]} {t[1]}")

# Strategy for generating ICD-10 codes
icd10_strategy = st.tuples(
    st.sampled_from(list("ABCDEFGHJKLMNPRSTUVWZ")),
    st.integers(min_value=10, max_value=99),
    st.integers(min_value=0, max_value=9),
).map(lambda t: f"{t[0]}{t[1]}.{t[2]}")

# Strategy for generating CPT codes
cpt_strategy = st.integers(min_value=10000, max_value=99999).map(str)

# Strategy for generating dates in ISO format
date_strategy = st.dates(
    min_value=datetime(1950, 1, 1).date(),
    max_value=datetime(2030, 12, 31).date(),
).map(lambda d: d.strftime("%Y-%m-%d"))

# Strategy for generating dollar amounts
amount_strategy = st.floats(
    min_value=1.0, max_value=99999.99, allow_nan=False, allow_infinity=False
).map(lambda f: f"{f:.2f}")

# Strategy for generating provider names
provider_name_strategy = st.tuples(
    st.sampled_from(["Dr.", "Dr"]),
    st.sampled_from([
        "Adams", "Baker", "Clark", "Evans", "Foster",
        "Grant", "Harris", "Irving", "Jackson", "King",
    ]),
).map(lambda t: f"{t[0]} {t[1]}")


# =============================================================================
# Property 6: Graph RAG Entity Extraction
# =============================================================================


class TestProperty6EntityExtraction:
    """
    Property 6: Graph RAG Entity Extraction

    For any set of claim documents, when the graph-rag strategy is used,
    the in-memory knowledge graph shall contain nodes representing entities
    (patients, providers, diagnoses, procedures, dates, amounts) that appear
    in the document text.

    Validates: Requirements 3.8
    """

    @given(patient_name=patient_name_strategy)
    @settings(max_examples=100, deadline=None)
    def test_patient_entities_extracted(self, patient_name: str):
        """
        **Validates: Requirements 3.8**

        Generate documents with patient names, assert graph contains
        patient nodes for those names.
        """
        text = f"Patient Name: {patient_name}\nDiagnosis: Routine checkup\n"
        documents = [
            create_document("doc-1", "claim.pdf", text),
        ]

        agent = make_agent()
        graph = agent.build_knowledge_graph(documents)

        patient_nodes = [
            n for n, d in graph.nodes(data=True)
            if d.get("type") == "patient"
        ]
        patient_labels = [
            graph.nodes[n].get("label", "") for n in patient_nodes
        ]

        assert len(patient_nodes) >= 1, (
            f"Expected patient node for '{patient_name}', found none"
        )
        assert patient_name in patient_labels, (
            f"Patient '{patient_name}' not found in graph labels: {patient_labels}"
        )

    @given(icd10_code=icd10_strategy)
    @settings(max_examples=100, deadline=None)
    def test_diagnosis_entities_extracted(self, icd10_code: str):
        """
        **Validates: Requirements 3.8**

        Generate documents with ICD-10 codes, assert graph contains
        diagnosis nodes for those codes.
        """
        text = (
            f"Patient Name: Test Patient\n"
            f"Diagnosis Code: {icd10_code}\n"
            f"Description: Test diagnosis\n"
        )
        documents = [
            create_document("doc-1", "claim.pdf", text),
        ]

        agent = make_agent()
        graph = agent.build_knowledge_graph(documents)

        diagnosis_nodes = [
            n for n, d in graph.nodes(data=True)
            if d.get("type") == "diagnosis"
        ]
        diagnosis_codes = [
            graph.nodes[n].get("properties", {}).get("code", "")
            for n in diagnosis_nodes
        ]

        assert icd10_code in diagnosis_codes, (
            f"ICD-10 code '{icd10_code}' not found in graph. "
            f"Found codes: {diagnosis_codes}"
        )

    @given(cpt_code=cpt_strategy)
    @settings(max_examples=100, deadline=None)
    def test_procedure_entities_extracted(self, cpt_code: str):
        """
        **Validates: Requirements 3.8**

        Generate documents with CPT codes, assert graph contains
        procedure nodes for those codes.
        """
        text = (
            f"Patient Name: Test Patient\n"
            f"CPT: {cpt_code}\n"
            f"Procedure: Test procedure\n"
        )
        documents = [
            create_document("doc-1", "claim.pdf", text),
        ]

        agent = make_agent()
        graph = agent.build_knowledge_graph(documents)

        procedure_nodes = [
            n for n, d in graph.nodes(data=True)
            if d.get("type") == "procedure"
        ]
        procedure_codes = [
            graph.nodes[n].get("properties", {}).get("code", "")
            for n in procedure_nodes
        ]

        assert cpt_code in procedure_codes, (
            f"CPT code '{cpt_code}' not found in graph. "
            f"Found codes: {procedure_codes}"
        )

    @given(service_date=date_strategy)
    @settings(max_examples=100, deadline=None)
    def test_date_entities_extracted(self, service_date: str):
        """
        **Validates: Requirements 3.8**

        Generate documents with service dates, assert graph contains
        date nodes for those dates.
        """
        text = (
            f"Patient Name: Test Patient\n"
            f"Date of Service: {service_date}\n"
        )
        documents = [
            create_document("doc-1", "claim.pdf", text),
        ]

        agent = make_agent()
        graph = agent.build_knowledge_graph(documents)

        date_nodes = [
            n for n, d in graph.nodes(data=True)
            if d.get("type") == "date"
        ]
        date_values = [
            graph.nodes[n].get("properties", {}).get("date", "")
            for n in date_nodes
        ]

        assert service_date in date_values, (
            f"Service date '{service_date}' not found in graph. "
            f"Found dates: {date_values}"
        )

    @given(amount=amount_strategy)
    @settings(max_examples=100, deadline=None)
    def test_amount_entities_extracted(self, amount: str):
        """
        **Validates: Requirements 3.8**

        Generate documents with dollar amounts, assert graph contains
        amount nodes for those values.
        """
        text = (
            f"Patient Name: Test Patient\n"
            f"Total Charges: ${amount}\n"
        )
        documents = [
            create_document("doc-1", "claim.pdf", text),
        ]

        agent = make_agent()
        graph = agent.build_knowledge_graph(documents)

        amount_nodes = [
            n for n, d in graph.nodes(data=True)
            if d.get("type") == "amount"
        ]
        amount_values = [
            graph.nodes[n].get("properties", {}).get("amount", "")
            for n in amount_nodes
        ]

        # Normalize: remove commas for comparison
        amount_clean = amount.replace(",", "")
        assert amount_clean in amount_values, (
            f"Amount '${amount}' not found in graph. "
            f"Found amounts: {amount_values}"
        )

    @given(provider_name=provider_name_strategy)
    @settings(max_examples=100, deadline=None)
    def test_provider_entities_extracted(self, provider_name: str):
        """
        **Validates: Requirements 3.8**

        Generate documents with provider names, assert graph contains
        provider nodes for those names.
        """
        text = (
            f"Patient Name: Test Patient\n"
            f"Provider Name: {provider_name}\n"
        )
        documents = [
            create_document("doc-1", "claim.pdf", text),
        ]

        agent = make_agent()
        graph = agent.build_knowledge_graph(documents)

        provider_nodes = [
            n for n, d in graph.nodes(data=True)
            if d.get("type") == "provider"
        ]
        provider_labels = [
            graph.nodes[n].get("label", "") for n in provider_nodes
        ]

        assert provider_name in provider_labels, (
            f"Provider '{provider_name}' not found in graph. "
            f"Found providers: {provider_labels}"
        )

    @given(
        patient_name=patient_name_strategy,
        icd10_code=icd10_strategy,
        cpt_code=cpt_strategy,
        service_date=date_strategy,
        amount=amount_strategy,
    )
    @settings(max_examples=100, deadline=None)
    def test_all_entity_types_extracted_from_single_document(
        self,
        patient_name: str,
        icd10_code: str,
        cpt_code: str,
        service_date: str,
        amount: str,
    ):
        """
        **Validates: Requirements 3.8**

        Generate a document with all entity types, assert graph contains
        nodes for each entity type.
        """
        text = (
            f"Patient Name: {patient_name}\n"
            f"Date of Birth: 1985-03-15\n"
            f"Date of Service: {service_date}\n"
            f"Diagnosis: {icd10_code}\n"
            f"CPT: {cpt_code}\n"
            f"Total Charges: ${amount}\n"
            f"Provider Name: Dr. Smith\n"
        )
        documents = [
            create_document("doc-1", "claim.pdf", text),
        ]

        agent = make_agent()
        graph = agent.build_knowledge_graph(documents)

        # Check each entity type is present
        entity_types_found = set()
        for _, data in graph.nodes(data=True):
            entity_types_found.add(data.get("type", "unknown"))

        expected_types = {"document", "patient", "diagnosis", "procedure", "date", "amount", "provider"}
        for etype in expected_types:
            assert etype in entity_types_found, (
                f"Entity type '{etype}' not found in graph. "
                f"Found types: {entity_types_found}"
            )

    @given(
        num_docs=st.integers(min_value=1, max_value=5),
        patient_name=patient_name_strategy,
    )
    @settings(max_examples=100, deadline=None)
    def test_entities_linked_to_documents(
        self, num_docs: int, patient_name: str
    ):
        """
        **Validates: Requirements 3.8**

        Verify that extracted entities are connected to their source
        document nodes via edges.
        """
        documents = []
        for i in range(num_docs):
            text = (
                f"Patient Name: {patient_name}\n"
                f"Date of Service: 2024-01-{15 + i:02d}\n"
            )
            documents.append(
                create_document(f"doc-{i}", f"claim_{i}.pdf", text)
            )

        agent = make_agent()
        graph = agent.build_knowledge_graph(documents)

        # Each document node should have outgoing edges
        doc_nodes = [
            n for n, d in graph.nodes(data=True)
            if d.get("type") == "document"
        ]
        assert len(doc_nodes) == num_docs, (
            f"Expected {num_docs} document nodes, found {len(doc_nodes)}"
        )

        for doc_node in doc_nodes:
            successors = list(graph.successors(doc_node))
            assert len(successors) >= 1, (
                f"Document node '{doc_node}' has no connected entities"
            )
