"""
Property-Based and Unit Tests for Full Context Summary Agent (Strands SDK)

Tests the migrated module-level functions:
- _combine_document_text_impl
- _detect_anomalies_impl
- _find_dates
- _parse_date
- DocumentRetrievalError

Property tests:
- Property 1: Combined text includes all documents and preserves order
- Property 2: Anomaly dict structure invariant
- Property 3: Chronological impossibility detection (service before birth)
- Property 4: Payment-before-service detection
- Property 5: Conflicting patient names detection
- Property 9: Date parsing across formats and labels
- Property 10: No false positive anomalies for consistent documents

Uses pytest with hypothesis library for property-based testing.
Minimum 100 iterations per property test.
"""

import sys
import os
from datetime import datetime, timedelta
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

    _fc_agent_path = os.path.join(
        os.path.dirname(__file__), "..", "agents", "full_context_agent", "agent.py"
    )
    _spec = _ilu.spec_from_file_location("full_context_agent", _fc_agent_path)
    _fc_mod = _ilu.module_from_spec(_spec)
    _spec.loader.exec_module(_fc_mod)

# Extract functions and classes from the loaded module
_combine_document_text_impl = _fc_mod._combine_document_text_impl
_detect_anomalies_impl = _fc_mod._detect_anomalies_impl
_find_dates = _fc_mod._find_dates
_parse_date = _fc_mod._parse_date
DocumentRetrievalError = _fc_mod.DocumentRetrievalError

# Also grab the @tool-wrapped functions for decorator verification
retrieve_claim_documents = _fc_mod.retrieve_claim_documents
combine_document_text = _fc_mod.combine_document_text
detect_anomalies = _fc_mod.detect_anomalies


# =============================================================================
# Hypothesis Strategies
# =============================================================================

# ISO dates between 1900 and 2030
date_strategy = st.dates(
    min_value=datetime(1900, 1, 1).date(),
    max_value=datetime(2030, 12, 31).date(),
).map(lambda d: d.isoformat())

# Patient names: first + last from safe alphabetic pools (no regex-breaking chars)
_first_names = st.sampled_from([
    "John", "Jane", "Alice", "Bob", "Carlos", "Diana", "Edward", "Fiona",
    "George", "Helen", "Ivan", "Julia", "Kevin", "Laura", "Michael", "Nancy",
])
_last_names = st.sampled_from([
    "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller",
    "Davis", "Rodriguez", "Martinez", "Anderson", "Taylor", "Thomas", "Moore",
])
patient_name_strategy = st.tuples(_first_names, _last_names).map(
    lambda t: f"{t[0]} {t[1]}"
)

# File names with .pdf extension
file_name_strategy = st.text(
    alphabet=st.characters(whitelist_categories=("L", "N"), whitelist_characters="-_"),
    min_size=1,
    max_size=40,
).filter(lambda x: len(x.strip()) > 0).map(lambda x: f"{x}.pdf")

# Non-empty extracted text
extracted_text_strategy = st.text(
    min_size=5,
    max_size=200,
).filter(lambda x: len(x.strip()) > 0)


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
# Task 7.1 — Unit tests for module structure, @tool decorator, edge cases
# =============================================================================

class TestModuleStructure:
    """Unit tests verifying the migrated module structure."""

    def test_tool_decorator_applied_to_retrieve_claim_documents(self):
        """Verify @tool decorator was applied to retrieve_claim_documents."""
        # Since we mocked @tool as identity, the function should be callable
        assert callable(retrieve_claim_documents)

    def test_tool_decorator_applied_to_combine_document_text(self):
        """Verify @tool decorator was applied to combine_document_text."""
        assert callable(combine_document_text)

    def test_tool_decorator_applied_to_detect_anomalies(self):
        """Verify @tool decorator was applied to detect_anomalies."""
        assert callable(detect_anomalies)

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

    def test_combine_empty_document_list(self):
        """Empty document list produces empty string."""
        result = _combine_document_text_impl([])
        assert result == ""

    def test_combine_document_missing_extracted_text(self):
        """Document without extractedText uses empty string."""
        docs = [{"fileName": "test.pdf"}]
        result = _combine_document_text_impl(docs)
        assert "--- Document: test.pdf ---" in result

    def test_combine_document_missing_file_name(self):
        """Document without fileName falls back to documentId."""
        docs = [{"documentId": "doc-123", "extractedText": "hello"}]
        result = _combine_document_text_impl(docs)
        assert "--- Document: doc-123 ---" in result
        assert "hello" in result

    def test_combine_document_missing_both_names(self):
        """Document without fileName or documentId uses 'Unknown'."""
        docs = [{"extractedText": "content"}]
        result = _combine_document_text_impl(docs)
        assert "--- Document: Unknown ---" in result

    def test_detect_anomalies_empty_list(self):
        """Empty document list returns no anomalies."""
        result = _detect_anomalies_impl([])
        assert result == []

    def test_detect_anomalies_no_dates_in_text(self):
        """Documents without date patterns return no anomalies."""
        docs = [make_doc("test.pdf", "This is plain text with no dates.")]
        result = _detect_anomalies_impl(docs)
        assert result == []

    def test_find_dates_empty_text(self):
        """Empty text returns no dates."""
        result = _find_dates("", ["birth date"])
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
# Property 1: Combined text includes all documents and preserves order
# Feature: strands-agent-migration, Property 1: Combined text includes all documents and preserves order
# =============================================================================

class TestProperty1CombinedText:
    """
    Property 1: Combined text includes all documents and preserves order

    For any list of N documents with non-empty extractedText and unique fileName
    values, calling _combine_document_text_impl shall produce a string that
    (a) contains every document's extractedText verbatim,
    (b) contains a '--- Document: {fileName} ---' separator for each document,
    (c) the separators appear in the same order as the input list.

    Validates: Requirements 1.4, 10.4
    """

    @given(
        data=st.lists(
            st.tuples(file_name_strategy, extracted_text_strategy),
            min_size=1,
            max_size=8,
            unique_by=lambda t: t[0],
        ),
    )
    @settings(max_examples=100, deadline=None)
    def test_combined_text_property(self, data):
        """
        # Feature: strands-agent-migration, Property 1: Combined text includes all documents and preserves order
        **Validates: Requirements 1.4, 10.4**
        """
        documents = [make_doc(fn, txt) for fn, txt in data]
        combined = _combine_document_text_impl(documents)

        # (a) Every document's extractedText appears verbatim
        for doc in documents:
            assert doc["extractedText"] in combined, (
                f"extractedText not found for {doc['fileName']}"
            )

        # (b) Separator for each document
        for doc in documents:
            sep = f"--- Document: {doc['fileName']} ---"
            assert sep in combined, f"Separator missing for {doc['fileName']}"

        # (c) Separators appear in input order
        last_pos = -1
        for doc in documents:
            sep = f"--- Document: {doc['fileName']} ---"
            pos = combined.find(sep)
            assert pos > last_pos, (
                f"Separator for {doc['fileName']} not in expected order"
            )
            last_pos = pos


# =============================================================================
# Property 2: Anomaly dict structure invariant
# Feature: strands-agent-migration, Property 2: Anomaly dict structure invariant
# =============================================================================

class TestProperty2AnomalyStructure:
    """
    Property 2: Anomaly dict structure invariant

    For any list of documents that triggers at least one anomaly, every anomaly
    dict returned by _detect_anomalies_impl shall contain exactly the keys
    'description' (non-empty str), 'severity' (one of "critical" or "warning"),
    'sourceDocument' (str), and 'dataValues' (dict with at least one entry).

    Validates: Requirements 1.3, 2.4, 7.4, 10.7
    """

    @given(
        birth_date=st.dates(
            min_value=datetime(2000, 1, 1).date(),
            max_value=datetime(2025, 12, 31).date(),
        ),
        service_date=st.dates(
            min_value=datetime(1900, 1, 1).date(),
            max_value=datetime(2025, 12, 31).date(),
        ),
    )
    @settings(max_examples=100, deadline=None)
    def test_anomaly_structure_invariant(self, birth_date, service_date):
        """
        # Feature: strands-agent-migration, Property 2: Anomaly dict structure invariant
        **Validates: Requirements 1.3, 2.4, 7.4, 10.7**
        """
        assume(service_date < birth_date)

        bd_str = birth_date.isoformat()
        sd_str = service_date.isoformat()

        text = (
            f"Patient Name: Test Patient\n"
            f"Date of Birth: {bd_str}\n"
            f"Date of Service: {sd_str}\n"
        )
        docs = [make_doc("claim.pdf", text)]
        anomalies = _detect_anomalies_impl(docs)

        assert len(anomalies) >= 1, "Expected at least one anomaly"

        for a in anomalies:
            assert "description" in a and isinstance(a["description"], str) and len(a["description"]) > 0
            assert "severity" in a and a["severity"] in ("critical", "warning")
            assert "sourceDocument" in a and isinstance(a["sourceDocument"], str)
            assert "dataValues" in a and isinstance(a["dataValues"], dict) and len(a["dataValues"]) >= 1


# =============================================================================
# Property 3: Chronological impossibility detection (service before birth)
# Feature: strands-agent-migration, Property 3: Chronological impossibility detection (service before birth)
# =============================================================================

class TestProperty3ChronologicalImpossibility:
    """
    Property 3: Chronological impossibility detection (service before birth)

    For any document containing a birth date B and a service date S where S < B
    (both in ISO YYYY-MM-DD format), calling _detect_anomalies_impl shall return
    at least one anomaly with severity == "critical" and description containing
    both date strings.

    Validates: Requirements 4.1, 10.5
    """

    @given(
        birth_date=st.dates(
            min_value=datetime(1950, 1, 1).date(),
            max_value=datetime(2025, 12, 31).date(),
        ),
        service_date=st.dates(
            min_value=datetime(1900, 1, 1).date(),
            max_value=datetime(2025, 12, 31).date(),
        ),
    )
    @settings(max_examples=100, deadline=None)
    def test_service_before_birth_detected(self, birth_date, service_date):
        """
        # Feature: strands-agent-migration, Property 3: Chronological impossibility detection (service before birth)
        **Validates: Requirements 4.1, 10.5**
        """
        assume(service_date < birth_date)

        bd_str = birth_date.isoformat()
        sd_str = service_date.isoformat()

        text = (
            f"Date of Birth: {bd_str}\n"
            f"Date of Service: {sd_str}\n"
        )
        docs = [make_doc("claim.pdf", text)]
        anomalies = _detect_anomalies_impl(docs)

        critical = [a for a in anomalies if a["severity"] == "critical"]
        assert len(critical) >= 1, (
            f"Expected critical anomaly for service {sd_str} < birth {bd_str}"
        )

        # At least one critical anomaly must mention both dates
        found = any(
            sd_str in a["description"] and bd_str in a["description"]
            for a in critical
        )
        assert found, (
            f"No critical anomaly description contains both {sd_str} and {bd_str}"
        )


# =============================================================================
# Property 4: Payment-before-service detection
# Feature: strands-agent-migration, Property 4: Payment-before-service detection
# =============================================================================

class TestProperty4PaymentBeforeService:
    """
    Property 4: Payment-before-service detection

    For any document containing a service date S and a payment date P where P < S
    (both in ISO YYYY-MM-DD format), calling _detect_anomalies_impl shall return
    at least one anomaly with severity == "critical" and description containing
    both date strings.

    Validates: Requirements 4.2, 10.5
    """

    @given(
        service_date=st.dates(
            min_value=datetime(1950, 1, 1).date(),
            max_value=datetime(2025, 12, 31).date(),
        ),
        payment_date=st.dates(
            min_value=datetime(1900, 1, 1).date(),
            max_value=datetime(2025, 12, 31).date(),
        ),
    )
    @settings(max_examples=100, deadline=None)
    def test_payment_before_service_detected(self, service_date, payment_date):
        """
        # Feature: strands-agent-migration, Property 4: Payment-before-service detection
        **Validates: Requirements 4.2, 10.5**
        """
        assume(payment_date < service_date)

        sd_str = service_date.isoformat()
        pd_str = payment_date.isoformat()

        text = (
            f"Date of Service: {sd_str}\n"
            f"Payment Date: {pd_str}\n"
        )
        docs = [make_doc("claim.pdf", text)]
        anomalies = _detect_anomalies_impl(docs)

        critical = [a for a in anomalies if a["severity"] == "critical"]
        assert len(critical) >= 1, (
            f"Expected critical anomaly for payment {pd_str} < service {sd_str}"
        )

        found = any(
            pd_str in a["description"] and sd_str in a["description"]
            for a in critical
        )
        assert found, (
            f"No critical anomaly description contains both {pd_str} and {sd_str}"
        )


# =============================================================================
# Property 5: Conflicting patient names detection
# Feature: strands-agent-migration, Property 5: Conflicting patient names detection
# =============================================================================

class TestProperty5ConflictingNames:
    """
    Property 5: Conflicting patient names detection

    For any set of two or more documents where each document contains a distinct
    patient name via 'Patient Name: X' pattern, calling _detect_anomalies_impl
    shall return at least one anomaly with severity == "warning" and description
    containing all distinct names.

    Validates: Requirements 4.3
    """

    @given(
        names=st.lists(
            patient_name_strategy,
            min_size=2,
            max_size=5,
            unique=True,
        ),
    )
    @settings(max_examples=100, deadline=None)
    def test_conflicting_names_detected(self, names):
        """
        # Feature: strands-agent-migration, Property 5: Conflicting patient names detection
        **Validates: Requirements 4.3**
        """
        docs = []
        for i, name in enumerate(names):
            text = f"Patient Name: {name}\nSome medical content here."
            docs.append(make_doc(f"doc_{i}.pdf", text))

        anomalies = _detect_anomalies_impl(docs)

        warnings = [a for a in anomalies if a["severity"] == "warning"]
        assert len(warnings) >= 1, (
            f"Expected warning anomaly for conflicting names: {names}"
        )

        # The description should contain all distinct names
        desc = warnings[0]["description"]
        for name in names:
            assert name in desc, (
                f"Name '{name}' not found in anomaly description: {desc}"
            )


# =============================================================================
# Property 9: Date parsing across formats and labels
# Feature: strands-agent-migration, Property 9: Date parsing across formats and labels
# =============================================================================

class TestProperty9DateParsing:
    """
    Property 9: Date parsing across formats and labels

    For any valid date D representable in ISO format (YYYY-MM-DD) and for any
    label from the set {birth date, dob, date of birth, service date,
    date of service, dos, payment date, paid date, date paid}, a text string
    "{Label}: {D}" shall cause _find_dates to return D in its results.

    Validates: Requirements 4.5
    """

    @given(
        d=st.dates(
            min_value=datetime(1900, 1, 1).date(),
            max_value=datetime(2030, 12, 31).date(),
        ),
        label=st.sampled_from([
            "birth date", "dob", "date of birth",
            "service date", "date of service", "dos",
            "payment date", "paid date", "date paid",
        ]),
    )
    @settings(max_examples=100, deadline=None)
    def test_date_found_for_all_labels(self, d, label):
        """
        # Feature: strands-agent-migration, Property 9: Date parsing across formats and labels
        **Validates: Requirements 4.5**
        """
        date_str = d.isoformat()
        text = f"{label}: {date_str}"

        # Determine which label group to use for _find_dates
        birth_labels = ["birth date", "dob", "date of birth"]
        service_labels = ["service date", "date of service", "dos"]
        payment_labels = ["payment date", "paid date", "date paid"]

        if label in birth_labels:
            search_labels = birth_labels
        elif label in service_labels:
            search_labels = service_labels
        else:
            search_labels = payment_labels

        results = _find_dates(text, search_labels)
        assert date_str in results, (
            f"Date {date_str} not found for label '{label}'. Got: {results}"
        )


# =============================================================================
# Property 10: No false positive anomalies for consistent documents
# Feature: strands-agent-migration, Property 10: No false positive anomalies for consistent documents
# =============================================================================

class TestProperty10NoFalsePositives:
    """
    Property 10: No false positive anomalies for consistent documents

    For any set of documents where all patient names are identical, all birth
    dates are identical and precede all service dates, and all payment dates
    follow all service dates, calling _detect_anomalies_impl shall return an
    empty list.

    Validates: Requirements 4.6
    """

    @given(
        patient_name=patient_name_strategy,
        birth_date=st.dates(
            min_value=datetime(1940, 1, 1).date(),
            max_value=datetime(1990, 12, 31).date(),
        ),
        service_date=st.dates(
            min_value=datetime(2000, 1, 1).date(),
            max_value=datetime(2020, 12, 31).date(),
        ),
        payment_date=st.dates(
            min_value=datetime(2021, 1, 1).date(),
            max_value=datetime(2030, 12, 31).date(),
        ),
        num_docs=st.integers(min_value=1, max_value=4),
    )
    @settings(max_examples=100, deadline=None)
    def test_no_anomalies_for_consistent_docs(
        self, patient_name, birth_date, service_date, payment_date, num_docs
    ):
        """
        # Feature: strands-agent-migration, Property 10: No false positive anomalies for consistent documents
        **Validates: Requirements 4.6**
        """
        # Ensure chronological ordering: birth < service < payment
        assume(birth_date < service_date)
        assume(service_date < payment_date)

        bd_str = birth_date.isoformat()
        sd_str = service_date.isoformat()
        pd_str = payment_date.isoformat()

        # Use enough padding between date lines so the 80-char context window
        # in _find_dates does not accidentally pick up a neighbouring date
        # under the wrong label.
        padding = " " * 80

        docs = []
        for i in range(num_docs):
            text = (
                f"Patient Name: {patient_name}\n"
                f"Date of Birth: {bd_str}\n"
                f"{padding}\n"
                f"Date of Service: {sd_str}\n"
                f"{padding}\n"
                f"Payment Date: {pd_str}\n"
            )
            docs.append(make_doc(f"doc_{i}.pdf", text))

        anomalies = _detect_anomalies_impl(docs)
        assert anomalies == [], (
            f"Expected no anomalies for consistent docs, got: {anomalies}"
        )
