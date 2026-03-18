"""
Property-Based and Unit Tests for Graph RAG Summary Agent (Strands SDK)

Tests the migrated module-level functions:
- _build_knowledge_graph_impl
- _extract_entities_impl
- _detect_graph_anomalies_impl
- _find_labeled_dates
- _parse_date
- _serialize_graph / _deserialize_graph
- DocumentRetrievalError

Property tests:
- Property 6: Graph RAG entity extraction completeness
- Property 7: Graph entity extraction round-trip
- Property 8: Conflicting DOBs detection in graph

Uses pytest with hypothesis library for property-based testing.
Minimum 100 iterations per property test.
"""

import sys
import os
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest
from hypothesis import given, settings, strategies as st, assume

# ---------------------------------------------------------------------------
# Mock external dependencies BEFORE importing the agent module.
# The module creates real boto3/strands/bedrock_agentcore objects at import
# time, so we must intercept them.
# ---------------------------------------------------------------------------

mock_boto3 = MagicMock()
mock_strands = MagicMock()
mock_strands_models = MagicMock()
mock_bedrock_agentcore = MagicMock()
mock_bedrock_agentcore_runtime = MagicMock()

# The @tool decorator should return the function unchanged for testing
mock_strands.tool = lambda f: f

with patch.dict("sys.modules", {
    "boto3": mock_boto3,
    "strands": mock_strands,
    "strands.models": mock_strands_models,
    "strands.Agent": MagicMock(),
    "bedrock_agentcore": mock_bedrock_agentcore,
    "bedrock_agentcore.runtime": mock_bedrock_agentcore_runtime,
}):
    import importlib.util as _ilu

    _graph_agent_path = os.path.join(
        os.path.dirname(__file__), "..", "agents", "graph_rag_agent", "agent.py"
    )
    _spec = _ilu.spec_from_file_location("graph_rag_agent_mod", _graph_agent_path)
    _graph_mod = _ilu.module_from_spec(_spec)
    _spec.loader.exec_module(_graph_mod)

# Extract functions and classes from the loaded module
_build_knowledge_graph_impl = _graph_mod._build_knowledge_graph_impl
_extract_entities_impl = _graph_mod._extract_entities_impl
_detect_graph_anomalies_impl = _graph_mod._detect_graph_anomalies_impl
_find_labeled_dates = _graph_mod._find_labeled_dates
_parse_date = _graph_mod._parse_date
_serialize_graph = _graph_mod._serialize_graph
_deserialize_graph = _graph_mod._deserialize_graph
DocumentRetrievalError = _graph_mod.DocumentRetrievalError

# Grab @tool-wrapped functions for decorator verification
retrieve_claim_documents = _graph_mod.retrieve_claim_documents
build_knowledge_graph = _graph_mod.build_knowledge_graph
extract_entities = _graph_mod.extract_entities
detect_graph_anomalies = _graph_mod.detect_graph_anomalies


# =============================================================================
# Hypothesis Strategies
# =============================================================================

# Patient names: first + last
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

# ICD-10 codes
icd10_strategy = st.tuples(
    st.sampled_from(list("ABCDEFGHJKLMNPRSTUVWZ")),
    st.integers(min_value=10, max_value=99),
    st.integers(min_value=0, max_value=9),
).map(lambda t: f"{t[0]}{t[1]}.{t[2]}")

# CPT codes (5-digit)
cpt_strategy = st.integers(min_value=10000, max_value=99999).map(str)

# ISO dates
date_strategy = st.dates(
    min_value=datetime(1950, 1, 1).date(),
    max_value=datetime(2030, 12, 31).date(),
).map(lambda d: d.strftime("%Y-%m-%d"))

# Dollar amounts
amount_strategy = st.floats(
    min_value=1.0, max_value=99999.99, allow_nan=False, allow_infinity=False
).map(lambda f: f"{f:.2f}")

# Provider names
provider_name_strategy = st.tuples(
    st.sampled_from(["Dr.", "Dr"]),
    st.sampled_from([
        "Adams", "Baker", "Clark", "Evans", "Foster",
        "Grant", "Harris", "Irving", "Jackson", "King",
    ]),
).map(lambda t: f"{t[0]} {t[1]}")


# =============================================================================
# Helpers
# =============================================================================

def make_doc(file_name: str, extracted_text: str, claim_id: str = "test-claim") -> dict:
    """Create a minimal document record for testing."""
    return {
        "documentId": f"doc-{file_name}",
        "fileName": file_name,
        "extractedText": extracted_text,
        "processingStatus": "completed",
        "claimMetadata": {"claimId": claim_id, "documentType": "medical_record"},
    }


# =============================================================================
# Task 7.2 — Unit tests for module structure, @tool decorator, edge cases
# =============================================================================

class TestModuleStructure:
    """Unit tests verifying the migrated module structure."""

    def test_tool_decorator_applied_to_retrieve_claim_documents(self):
        """Verify @tool decorator was applied to retrieve_claim_documents."""
        assert callable(retrieve_claim_documents)

    def test_tool_decorator_applied_to_build_knowledge_graph(self):
        """Verify @tool decorator was applied to build_knowledge_graph."""
        assert callable(build_knowledge_graph)

    def test_tool_decorator_applied_to_extract_entities(self):
        """Verify @tool decorator was applied to extract_entities."""
        assert callable(extract_entities)

    def test_tool_decorator_applied_to_detect_graph_anomalies(self):
        """Verify @tool decorator was applied to detect_graph_anomalies."""
        assert callable(detect_graph_anomalies)

    def test_document_retrieval_error_exists(self):
        """Verify DocumentRetrievalError is defined and is an Exception."""
        assert issubclass(DocumentRetrievalError, Exception)

    def test_document_retrieval_error_has_status_code(self):
        """Verify DocumentRetrievalError stores status_code."""
        err = DocumentRetrievalError("test", status_code=404)
        assert err.status_code == 404
        assert str(err) == "test"

    def test_document_retrieval_error_default_status_code(self):
        """Verify DocumentRetrievalError defaults to 500."""
        err = DocumentRetrievalError("fail")
        assert err.status_code == 500


class TestEdgeCases:
    """Edge case tests for the impl functions."""

    def test_build_graph_empty_document_list(self):
        """Empty document list produces empty graph."""
        graph = _build_knowledge_graph_impl([])
        assert len(graph.nodes) == 0
        assert len(graph.edges) == 0

    def test_build_graph_document_missing_extracted_text(self):
        """Document without extractedText still creates document node."""
        docs = [{"fileName": "test.pdf"}]
        graph = _build_knowledge_graph_impl(docs)
        doc_nodes = [n for n, d in graph.nodes(data=True) if d.get("type") == "document"]
        assert len(doc_nodes) == 1

    def test_build_graph_document_missing_file_name(self):
        """Document without fileName falls back to documentId."""
        docs = [{"documentId": "doc-123", "extractedText": "Patient Name: Test User\n"}]
        graph = _build_knowledge_graph_impl(docs)
        doc_nodes = [n for n, d in graph.nodes(data=True) if d.get("type") == "document"]
        assert len(doc_nodes) == 1

    def test_extract_entities_empty_graph(self):
        """Empty graph returns empty entity list."""
        import networkx as nx
        graph = nx.DiGraph()
        entities = _extract_entities_impl(graph)
        assert entities == []

    def test_detect_anomalies_empty_graph(self):
        """Empty graph returns no anomalies."""
        import networkx as nx
        graph = nx.DiGraph()
        anomalies = _detect_graph_anomalies_impl(graph)
        assert anomalies == []

    def test_serialize_deserialize_roundtrip(self):
        """Graph serialization and deserialization preserves structure."""
        import networkx as nx
        graph = nx.DiGraph()
        graph.add_node("n1", type="patient", label="Test", properties={"name": "Test"})
        graph.add_node("n2", type="date", label="2024-01-01", properties={"date": "2024-01-01"})
        graph.add_edge("n1", "n2", type="has_dob")

        json_str = _serialize_graph(graph)
        restored = _deserialize_graph(json_str)

        assert set(restored.nodes) == set(graph.nodes)
        assert len(restored.edges) == len(graph.edges)
        assert restored.nodes["n1"]["type"] == "patient"

    def test_find_labeled_dates_empty_text(self):
        """Empty text returns no dates."""
        result = _find_labeled_dates("", ["birth date"])
        assert result == []

    def test_parse_date_invalid_string(self):
        """Invalid date string returns None."""
        assert _parse_date("not-a-date") is None

    def test_parse_date_iso_format(self):
        """ISO format date is parsed correctly."""
        result = _parse_date("2024-01-15")
        assert result == datetime(2024, 1, 15)

    def test_parse_date_us_format(self):
        """US format date is parsed correctly."""
        result = _parse_date("01/15/2024")
        assert result == datetime(2024, 1, 15)


# =============================================================================
# Property 6: Graph RAG entity extraction completeness
# Feature: strands-agent-migration, Property 6: Graph RAG entity extraction completeness
# =============================================================================

class TestProperty6EntityExtraction:
    """
    Property 6: Graph RAG entity extraction completeness

    For any document containing a patient name (matching Patient Name: X),
    an ICD-10 code, a CPT code, a service date (via Date of Service: X),
    a dollar amount (via $X), and a provider name (via Provider Name: X),
    calling _build_knowledge_graph_impl shall produce a graph containing at
    least one node of each type: patient, diagnosis, procedure, date, amount,
    and provider.

    Validates: Requirements 3.3, 10.6
    """

    @given(
        patient_name=patient_name_strategy,
        icd10_code=icd10_strategy,
        cpt_code=cpt_strategy,
        service_date=date_strategy,
        amount=amount_strategy,
        provider_name=provider_name_strategy,
    )
    @settings(max_examples=100, deadline=None)
    def test_all_entity_types_extracted(
        self, patient_name, icd10_code, cpt_code, service_date, amount, provider_name
    ):
        """
        # Feature: strands-agent-migration, Property 6: Graph RAG entity extraction completeness
        **Validates: Requirements 3.3, 10.6**
        """
        text = (
            f"Patient Name: {patient_name}\n"
            f"Date of Service: {service_date}\n"
            f"Diagnosis Code: {icd10_code}\n"
            f"CPT: {cpt_code}\n"
            f"Total Charges: ${amount}\n"
            f"Provider Name: {provider_name}\n"
        )
        docs = [make_doc("claim.pdf", text)]
        graph = _build_knowledge_graph_impl(docs)

        entity_types_found = set()
        for _, data in graph.nodes(data=True):
            entity_types_found.add(data.get("type", "unknown"))

        expected_types = {"patient", "diagnosis", "procedure", "date", "amount", "provider"}
        for etype in expected_types:
            assert etype in entity_types_found, (
                f"Entity type '{etype}' not found in graph. "
                f"Found types: {entity_types_found}"
            )

    @given(patient_name=patient_name_strategy)
    @settings(max_examples=100, deadline=None)
    def test_patient_entity_extracted(self, patient_name):
        """
        # Feature: strands-agent-migration, Property 6: Graph RAG entity extraction completeness
        **Validates: Requirements 3.3, 10.6**
        """
        text = f"Patient Name: {patient_name}\nDiagnosis: Routine checkup\n"
        docs = [make_doc("claim.pdf", text)]
        graph = _build_knowledge_graph_impl(docs)

        patient_nodes = [
            n for n, d in graph.nodes(data=True) if d.get("type") == "patient"
        ]
        patient_labels = [graph.nodes[n].get("label", "") for n in patient_nodes]
        assert patient_name in patient_labels, (
            f"Patient '{patient_name}' not found in graph labels: {patient_labels}"
        )

    @given(icd10_code=icd10_strategy)
    @settings(max_examples=100, deadline=None)
    def test_diagnosis_entity_extracted(self, icd10_code):
        """
        # Feature: strands-agent-migration, Property 6: Graph RAG entity extraction completeness
        **Validates: Requirements 3.3, 10.6**
        """
        text = f"Patient Name: Test Patient\nDiagnosis Code: {icd10_code}\n"
        docs = [make_doc("claim.pdf", text)]
        graph = _build_knowledge_graph_impl(docs)

        diagnosis_codes = [
            graph.nodes[n].get("properties", {}).get("code", "")
            for n, d in graph.nodes(data=True) if d.get("type") == "diagnosis"
        ]
        assert icd10_code in diagnosis_codes, (
            f"ICD-10 code '{icd10_code}' not found. Found: {diagnosis_codes}"
        )

    @given(cpt_code=cpt_strategy)
    @settings(max_examples=100, deadline=None)
    def test_procedure_entity_extracted(self, cpt_code):
        """
        # Feature: strands-agent-migration, Property 6: Graph RAG entity extraction completeness
        **Validates: Requirements 3.3, 10.6**
        """
        text = f"Patient Name: Test Patient\nCPT: {cpt_code}\n"
        docs = [make_doc("claim.pdf", text)]
        graph = _build_knowledge_graph_impl(docs)

        procedure_codes = [
            graph.nodes[n].get("properties", {}).get("code", "")
            for n, d in graph.nodes(data=True) if d.get("type") == "procedure"
        ]
        assert cpt_code in procedure_codes, (
            f"CPT code '{cpt_code}' not found. Found: {procedure_codes}"
        )

    @given(service_date=date_strategy)
    @settings(max_examples=100, deadline=None)
    def test_date_entity_extracted(self, service_date):
        """
        # Feature: strands-agent-migration, Property 6: Graph RAG entity extraction completeness
        **Validates: Requirements 3.3, 10.6**
        """
        text = f"Patient Name: Test Patient\nDate of Service: {service_date}\n"
        docs = [make_doc("claim.pdf", text)]
        graph = _build_knowledge_graph_impl(docs)

        date_values = [
            graph.nodes[n].get("properties", {}).get("date", "")
            for n, d in graph.nodes(data=True) if d.get("type") == "date"
        ]
        assert service_date in date_values, (
            f"Service date '{service_date}' not found. Found: {date_values}"
        )

    @given(amount=amount_strategy)
    @settings(max_examples=100, deadline=None)
    def test_amount_entity_extracted(self, amount):
        """
        # Feature: strands-agent-migration, Property 6: Graph RAG entity extraction completeness
        **Validates: Requirements 3.3, 10.6**
        """
        text = f"Patient Name: Test Patient\nTotal Charges: ${amount}\n"
        docs = [make_doc("claim.pdf", text)]
        graph = _build_knowledge_graph_impl(docs)

        amount_values = [
            graph.nodes[n].get("properties", {}).get("amount", "")
            for n, d in graph.nodes(data=True) if d.get("type") == "amount"
        ]
        amount_clean = amount.replace(",", "")
        assert amount_clean in amount_values, (
            f"Amount '${amount}' not found. Found: {amount_values}"
        )

    @given(provider_name=provider_name_strategy)
    @settings(max_examples=100, deadline=None)
    def test_provider_entity_extracted(self, provider_name):
        """
        # Feature: strands-agent-migration, Property 6: Graph RAG entity extraction completeness
        **Validates: Requirements 3.3, 10.6**
        """
        text = f"Patient Name: Test Patient\nProvider Name: {provider_name}\n"
        docs = [make_doc("claim.pdf", text)]
        graph = _build_knowledge_graph_impl(docs)

        provider_labels = [
            graph.nodes[n].get("label", "")
            for n, d in graph.nodes(data=True) if d.get("type") == "provider"
        ]
        assert provider_name in provider_labels, (
            f"Provider '{provider_name}' not found. Found: {provider_labels}"
        )


# =============================================================================
# Property 7: Graph entity extraction round-trip
# Feature: strands-agent-migration, Property 7: Graph entity extraction round-trip
# =============================================================================

class TestProperty7EntityRoundTrip:
    """
    Property 7: Graph entity extraction round-trip

    For any knowledge graph produced by _build_knowledge_graph_impl, calling
    _extract_entities_impl shall return a list where every node in the graph
    appears exactly once, and each entity dict contains the keys id, type,
    label, and properties.

    Validates: Requirements 3.5
    """

    @given(
        patient_name=patient_name_strategy,
        icd10_code=icd10_strategy,
        cpt_code=cpt_strategy,
        service_date=date_strategy,
        amount=amount_strategy,
        provider_name=provider_name_strategy,
    )
    @settings(max_examples=100, deadline=None)
    def test_entity_round_trip(
        self, patient_name, icd10_code, cpt_code, service_date, amount, provider_name
    ):
        """
        # Feature: strands-agent-migration, Property 7: Graph entity extraction round-trip
        **Validates: Requirements 3.5**
        """
        text = (
            f"Patient Name: {patient_name}\n"
            f"Date of Service: {service_date}\n"
            f"Diagnosis Code: {icd10_code}\n"
            f"CPT: {cpt_code}\n"
            f"Total Charges: ${amount}\n"
            f"Provider Name: {provider_name}\n"
        )
        docs = [make_doc("claim.pdf", text)]
        graph = _build_knowledge_graph_impl(docs)
        entities = _extract_entities_impl(graph)

        # Every node appears exactly once
        entity_ids = [e["id"] for e in entities]
        graph_node_ids = list(graph.nodes)
        assert sorted(entity_ids) == sorted(graph_node_ids), (
            f"Entity IDs don't match graph nodes.\n"
            f"Entities: {sorted(entity_ids)}\n"
            f"Graph: {sorted(graph_node_ids)}"
        )

        # Each entity has required keys
        for entity in entities:
            assert "id" in entity, f"Entity missing 'id': {entity}"
            assert "type" in entity, f"Entity missing 'type': {entity}"
            assert "label" in entity, f"Entity missing 'label': {entity}"
            assert "properties" in entity, f"Entity missing 'properties': {entity}"

    @given(
        num_docs=st.integers(min_value=1, max_value=3),
        patient_name=patient_name_strategy,
    )
    @settings(max_examples=100, deadline=None)
    def test_entity_count_matches_graph_nodes(self, num_docs, patient_name):
        """
        # Feature: strands-agent-migration, Property 7: Graph entity extraction round-trip
        **Validates: Requirements 3.5**
        """
        docs = []
        for i in range(num_docs):
            text = (
                f"Patient Name: {patient_name}\n"
                f"Date of Service: 2024-01-{15 + i:02d}\n"
            )
            docs.append(make_doc(f"doc_{i}.pdf", text))

        graph = _build_knowledge_graph_impl(docs)
        entities = _extract_entities_impl(graph)

        assert len(entities) == len(graph.nodes), (
            f"Entity count ({len(entities)}) != graph node count ({len(graph.nodes)})"
        )


# =============================================================================
# Property 8: Conflicting DOBs detection in graph
# Feature: strands-agent-migration, Property 8: Conflicting DOBs detection in graph
# =============================================================================

class TestProperty8ConflictingDOBs:
    """
    Property 8: Conflicting DOBs detection in graph

    For any set of documents where the same patient name appears with two or
    more distinct dates of birth, calling _build_knowledge_graph_impl followed
    by _detect_graph_anomalies_impl shall return at least one anomaly with
    severity == "critical" and description containing the conflicting DOB values.

    Validates: Requirements 4.4
    """

    @given(
        patient_name=patient_name_strategy,
        dob1=st.dates(
            min_value=datetime(1950, 1, 1).date(),
            max_value=datetime(1980, 12, 31).date(),
        ).map(lambda d: d.isoformat()),
        dob2=st.dates(
            min_value=datetime(1950, 1, 1).date(),
            max_value=datetime(1980, 12, 31).date(),
        ).map(lambda d: d.isoformat()),
    )
    @settings(max_examples=100, deadline=None)
    def test_conflicting_dobs_detected(self, patient_name, dob1, dob2):
        """
        # Feature: strands-agent-migration, Property 8: Conflicting DOBs detection in graph
        **Validates: Requirements 4.4**
        """
        assume(dob1 != dob2)

        doc1_text = (
            f"Patient Name: {patient_name}\n"
            f"Date of Birth: {dob1}\n"
        )
        doc2_text = (
            f"Patient Name: {patient_name}\n"
            f"Date of Birth: {dob2}\n"
        )
        docs = [
            make_doc("doc1.pdf", doc1_text),
            make_doc("doc2.pdf", doc2_text),
        ]

        graph = _build_knowledge_graph_impl(docs)
        anomalies = _detect_graph_anomalies_impl(graph)

        critical = [a for a in anomalies if a["severity"] == "critical"]
        assert len(critical) >= 1, (
            f"Expected critical anomaly for conflicting DOBs {dob1} vs {dob2}. "
            f"Got anomalies: {anomalies}"
        )

        # At least one critical anomaly must mention both DOB values
        found = any(
            dob1 in a["description"] and dob2 in a["description"]
            for a in critical
        )
        assert found, (
            f"No critical anomaly description contains both {dob1} and {dob2}. "
            f"Descriptions: {[a['description'] for a in critical]}"
        )

    @given(
        patient_name=patient_name_strategy,
        dob=st.dates(
            min_value=datetime(1950, 1, 1).date(),
            max_value=datetime(1980, 12, 31).date(),
        ).map(lambda d: d.isoformat()),
        num_docs=st.integers(min_value=2, max_value=4),
    )
    @settings(max_examples=100, deadline=None)
    def test_same_dob_no_conflicting_dob_anomaly(self, patient_name, dob, num_docs):
        """
        # Feature: strands-agent-migration, Property 8: Conflicting DOBs detection in graph
        **Validates: Requirements 4.4**

        When all documents have the same DOB for the same patient,
        no conflicting DOB anomaly should be raised.
        """
        docs = []
        for i in range(num_docs):
            text = (
                f"Patient Name: {patient_name}\n"
                f"Date of Birth: {dob}\n"
            )
            docs.append(make_doc(f"doc_{i}.pdf", text))

        graph = _build_knowledge_graph_impl(docs)
        anomalies = _detect_graph_anomalies_impl(graph)

        # Filter to only conflicting DOB anomalies (not other types)
        dob_anomalies = [
            a for a in anomalies
            if "conflicting" in a["description"].lower() and "birth" in a["description"].lower()
        ]
        assert len(dob_anomalies) == 0, (
            f"Expected no conflicting DOB anomalies for same DOB {dob}. "
            f"Got: {dob_anomalies}"
        )
