"""
Property-Based Tests for Full Context Summary Agent

Tests for:
- Property 5: Full Context Strategy Document Retrieval
- Property 8: Anomaly Detection for Chronological Impossibilities

Uses pytest with hypothesis library for property-based testing.
Minimum 100 iterations per property test.
"""

import sys
import os
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch
import asyncio

import pytest
from hypothesis import given, settings, strategies as st, assume

# Import FullContextSummaryAgent from the specific agent module path
import importlib.util as _ilu

_fc_agent_path = os.path.join(
    os.path.dirname(__file__), "..", "agents", "full_context_agent", "agent.py"
)
_spec = _ilu.spec_from_file_location("full_context_agent", _fc_agent_path)
_fc_mod = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_fc_mod)
FullContextSummaryAgent = _fc_mod.FullContextSummaryAgent
DocumentRetrievalError = _fc_mod.DocumentRetrievalError


# =============================================================================
# Test Fixtures and Helpers
# =============================================================================

@pytest.fixture
def mock_dynamodb():
    """Create a mock DynamoDB resource."""
    mock = MagicMock()
    mock_table = MagicMock()
    mock.Table.return_value = mock_table
    return mock, mock_table


@pytest.fixture
def mock_bedrock():
    """Create a mock Bedrock client."""
    mock = MagicMock()
    return mock


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


# =============================================================================
# Hypothesis Strategies
# =============================================================================

# Strategy for generating valid document IDs
doc_id_strategy = st.text(
    alphabet=st.characters(whitelist_categories=("L", "N"), whitelist_characters="-_"),
    min_size=1,
    max_size=50,
).filter(lambda x: len(x.strip()) > 0)

# Strategy for generating file names
file_name_strategy = st.text(
    alphabet=st.characters(whitelist_categories=("L", "N"), whitelist_characters="-_."),
    min_size=1,
    max_size=100,
).filter(lambda x: len(x.strip()) > 0).map(lambda x: f"{x}.pdf")

# Strategy for generating extracted text content
extracted_text_strategy = st.text(
    min_size=10,
    max_size=1000,
).filter(lambda x: len(x.strip()) > 0)

# Strategy for generating dates in ISO format
date_strategy = st.dates(
    min_value=datetime(1900, 1, 1).date(),
    max_value=datetime(2030, 12, 31).date(),
).map(lambda d: d.strftime("%Y-%m-%d"))


# =============================================================================
# Property 5: Full Context Strategy Document Retrieval
# =============================================================================

class TestProperty5DocumentRetrieval:
    """
    Property 5: Full Context Strategy Document Retrieval
    
    For any claim with N documents containing extracted text, when the 
    full-context strategy is used, the combined text passed to Bedrock 
    Nova Pro shall contain the extracted text from all N documents.
    
    Validates: Requirements 3.4
    """

    @given(
        num_docs=st.integers(min_value=1, max_value=10),
        texts=st.lists(
            extracted_text_strategy,
            min_size=1,
            max_size=10,
        ),
    )
    @settings(max_examples=100, deadline=None)
    def test_combined_text_contains_all_documents(
        self, num_docs: int, texts: list[str]
    ):
        """
        **Validates: Requirements 3.4**
        
        Generate N documents with extractedText, assert combined text 
        contains all N documents' text.
        """
        # Ensure we have the right number of texts
        texts = texts[:num_docs] if len(texts) > num_docs else texts
        assume(len(texts) >= 1)
        
        # Create documents with unique extracted text
        documents = []
        for i, text in enumerate(texts):
            doc = create_document(
                doc_id=f"doc-{i}",
                file_name=f"document_{i}.pdf",
                extracted_text=text,
            )
            documents.append(doc)
        
        # Create agent and combine text
        agent = FullContextSummaryAgent(
            dynamodb_client=MagicMock(),
            bedrock_client=MagicMock(),
        )
        
        combined = agent.combine_document_text(documents)
        
        # Assert all document texts are present in combined output
        for doc in documents:
            assert doc["extractedText"] in combined, (
                f"Document text '{doc['extractedText'][:50]}...' not found in combined text"
            )
        
        # Assert document separators are present
        for doc in documents:
            assert doc["fileName"] in combined, (
                f"Document name '{doc['fileName']}' not found in combined text"
            )

    @given(
        num_docs=st.integers(min_value=2, max_value=5),
    )
    @settings(max_examples=100, deadline=None)
    def test_combined_text_preserves_order(self, num_docs: int):
        """
        **Validates: Requirements 3.4**
        
        Verify that document separators appear in the order documents are provided.
        Uses unique file names to avoid ambiguity with duplicate text content.
        """
        documents = [
            create_document(
                doc_id=f"doc-{i}",
                file_name=f"document_{i}.pdf",
                extracted_text=f"Unique content for document number {i}",
            )
            for i in range(num_docs)
        ]
        
        agent = FullContextSummaryAgent(
            dynamodb_client=MagicMock(),
            bedrock_client=MagicMock(),
        )
        
        combined = agent.combine_document_text(documents)
        
        # Verify document separators appear in order using unique file names
        last_pos = -1
        for doc in documents:
            pos = combined.find(f"--- Document: {doc['fileName']} ---")
            assert pos > last_pos, (
                f"Document separator for '{doc['fileName']}' not in expected order"
            )
            last_pos = pos

    @given(
        num_docs=st.integers(min_value=1, max_value=5),
    )
    @settings(max_examples=100, deadline=None)
    def test_document_count_matches_input(self, num_docs: int):
        """
        **Validates: Requirements 3.4**
        
        Verify that the number of document separators matches the number 
        of input documents.
        """
        documents = [
            create_document(
                doc_id=f"doc-{i}",
                file_name=f"document_{i}.pdf",
                extracted_text=f"Content for document {i}",
            )
            for i in range(num_docs)
        ]
        
        agent = FullContextSummaryAgent(
            dynamodb_client=MagicMock(),
            bedrock_client=MagicMock(),
        )
        
        combined = agent.combine_document_text(documents)
        
        # Count document separators
        separator_count = combined.count("--- Document:")
        assert separator_count == num_docs, (
            f"Expected {num_docs} document separators, found {separator_count}"
        )



# =============================================================================
# Property 8: Anomaly Detection for Chronological Impossibilities
# =============================================================================

class TestProperty8AnomalyDetection:
    """
    Property 8: Anomaly Detection for Chronological Impossibilities
    
    For any claim document set where a service date precedes the patient's 
    birth date, the anomaly detection service shall identify and return an 
    anomaly with severity "critical" describing the chronological impossibility.
    
    Validates: Requirements 4.2
    """

    @given(
        birth_year=st.integers(min_value=2000, max_value=2025),
        birth_month=st.integers(min_value=1, max_value=12),
        birth_day=st.integers(min_value=1, max_value=28),
        years_before=st.integers(min_value=1, max_value=50),
    )
    @settings(max_examples=100, deadline=None)
    def test_detects_service_date_before_birth_date(
        self,
        birth_year: int,
        birth_month: int,
        birth_day: int,
        years_before: int,
    ):
        """
        **Validates: Requirements 4.2**
        
        Generate documents with service date before birth date,
        assert anomaly with severity "critical" is returned.
        """
        birth_date = f"{birth_year:04d}-{birth_month:02d}-{birth_day:02d}"
        
        # Service date is before birth date
        service_year = birth_year - years_before
        assume(service_year >= 1900)
        service_date = f"{service_year:04d}-{birth_month:02d}-{birth_day:02d}"
        
        text = (
            f"Patient Name: Test Patient\n"
            f"Date of Birth: {birth_date}\n"
            f"Date of Service: {service_date}\n"
            f"Diagnosis: Test diagnosis\n"
        )
        
        documents = [
            create_document(
                doc_id="doc-1",
                file_name="test_claim.pdf",
                extracted_text=text,
            )
        ]
        
        agent = FullContextSummaryAgent(
            dynamodb_client=MagicMock(),
            bedrock_client=MagicMock(),
        )
        
        anomalies = agent.detect_anomalies(documents)
        
        # Must detect at least one critical anomaly
        critical_anomalies = [
            a for a in anomalies if a["severity"] == "critical"
        ]
        assert len(critical_anomalies) >= 1, (
            f"Expected at least one critical anomaly for service date "
            f"{service_date} before birth date {birth_date}, "
            f"got {len(critical_anomalies)}"
        )
        
        # Verify anomaly structure
        for anomaly in critical_anomalies:
            assert "description" in anomaly
            assert anomaly["severity"] == "critical"
            assert "sourceDocument" in anomaly
            assert "dataValues" in anomaly
            assert isinstance(anomaly["dataValues"], dict)
            assert len(anomaly["dataValues"]) >= 1

    @given(
        service_year=st.integers(min_value=2020, max_value=2025),
        service_month=st.integers(min_value=1, max_value=12),
        service_day=st.integers(min_value=1, max_value=28),
        years_before_birth=st.integers(min_value=20, max_value=60),
    )
    @settings(max_examples=100, deadline=None)
    def test_no_false_positive_when_dates_valid(
        self,
        service_year: int,
        service_month: int,
        service_day: int,
        years_before_birth: int,
    ):
        """
        **Validates: Requirements 4.2**
        
        When service date is after birth date, no chronological
        anomaly should be detected.
        """
        service_date = f"{service_year:04d}-{service_month:02d}-{service_day:02d}"
        
        # Birth date is before service date
        birth_year = service_year - years_before_birth
        assume(birth_year >= 1900)
        birth_date = f"{birth_year:04d}-{service_month:02d}-{service_day:02d}"
        
        text = (
            f"Patient Name: Test Patient\n"
            f"Date of Birth: {birth_date}\n"
            f"Date of Service: {service_date}\n"
        )
        
        documents = [
            create_document(
                doc_id="doc-1",
                file_name="test_claim.pdf",
                extracted_text=text,
            )
        ]
        
        agent = FullContextSummaryAgent(
            dynamodb_client=MagicMock(),
            bedrock_client=MagicMock(),
        )
        
        anomalies = agent.detect_anomalies(documents)
        
        # Filter to only chronological anomalies (not cross-document ones)
        chrono_anomalies = [
            a for a in anomalies
            if "precedes" in a.get("description", "").lower()
            and "birth" in a.get("description", "").lower()
        ]
        
        assert len(chrono_anomalies) == 0, (
            f"False positive: detected chronological anomaly when service date "
            f"{service_date} is after birth date {birth_date}"
        )

    @given(
        payment_year=st.integers(min_value=2000, max_value=2020),
        payment_month=st.integers(min_value=1, max_value=12),
        payment_day=st.integers(min_value=1, max_value=28),
        years_after_service=st.integers(min_value=1, max_value=10),
    )
    @settings(max_examples=100, deadline=None)
    def test_detects_payment_before_service_date(
        self,
        payment_year: int,
        payment_month: int,
        payment_day: int,
        years_after_service: int,
    ):
        """
        **Validates: Requirements 4.2**
        
        Generate documents with payment date before service date,
        assert anomaly with severity "critical" is returned.
        """
        payment_date = f"{payment_year:04d}-{payment_month:02d}-{payment_day:02d}"
        
        # Service date is after payment date
        service_year = payment_year + years_after_service
        assume(service_year <= 2030)
        service_date = f"{service_year:04d}-{payment_month:02d}-{payment_day:02d}"
        
        text = (
            f"Patient Name: Test Patient\n"
            f"Date of Service: {service_date}\n"
            f"Payment Date: {payment_date}\n"
        )
        
        documents = [
            create_document(
                doc_id="doc-1",
                file_name="test_claim.pdf",
                extracted_text=text,
            )
        ]
        
        agent = FullContextSummaryAgent(
            dynamodb_client=MagicMock(),
            bedrock_client=MagicMock(),
        )
        
        anomalies = agent.detect_anomalies(documents)
        
        # Must detect at least one critical anomaly for payment before service
        payment_anomalies = [
            a for a in anomalies
            if a["severity"] == "critical"
            and "payment" in a.get("description", "").lower()
        ]
        assert len(payment_anomalies) >= 1, (
            f"Expected at least one critical anomaly for payment date "
            f"{payment_date} before service date {service_date}, "
            f"got {len(payment_anomalies)}"
        )

    @given(
        num_docs=st.integers(min_value=1, max_value=5),
    )
    @settings(max_examples=100, deadline=None)
    def test_anomaly_structure_is_valid(self, num_docs: int):
        """
        **Validates: Requirements 4.2**
        
        For any detected anomaly, verify the structure contains all
        required fields.
        """
        # Create documents with known anomaly (service before birth)
        documents = []
        for i in range(num_docs):
            text = (
                f"Patient Name: Test Patient\n"
                f"Date of Birth: 2024-06-01\n"
                f"Date of Service: 2020-01-15\n"
            )
            documents.append(
                create_document(
                    doc_id=f"doc-{i}",
                    file_name=f"claim_{i}.pdf",
                    extracted_text=text,
                )
            )
        
        agent = FullContextSummaryAgent(
            dynamodb_client=MagicMock(),
            bedrock_client=MagicMock(),
        )
        
        anomalies = agent.detect_anomalies(documents)
        
        assert len(anomalies) >= 1, "Expected at least one anomaly"
        
        for anomaly in anomalies:
            # Verify required fields
            assert "description" in anomaly, "Missing 'description' field"
            assert isinstance(anomaly["description"], str), "description must be string"
            assert len(anomaly["description"]) > 0, "description must be non-empty"
            
            assert "severity" in anomaly, "Missing 'severity' field"
            assert anomaly["severity"] in ("critical", "warning", "info"), (
                f"Invalid severity: {anomaly['severity']}"
            )
            
            assert "sourceDocument" in anomaly, "Missing 'sourceDocument' field"
            assert isinstance(anomaly["sourceDocument"], str), "sourceDocument must be string"
            
            assert "dataValues" in anomaly, "Missing 'dataValues' field"
            assert isinstance(anomaly["dataValues"], dict), "dataValues must be dict"
            assert len(anomaly["dataValues"]) >= 1, "dataValues must have at least one entry"
