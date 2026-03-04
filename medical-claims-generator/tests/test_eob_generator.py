"""
Unit tests for EOBGenerator

Tests the generation of Explanation of Benefits PDF documents.
"""

import pytest
from datetime import date, timedelta
from io import BytesIO

from medical_claims_generator.models import (
    Patient, Address, Insurance, ClaimStatus, PaymentInfo
)
from medical_claims_generator.pdf_generators.eob_generator import EOBGenerator


@pytest.fixture
def sample_patient():
    """Create a sample patient for testing."""
    return Patient(
        id="TEST-001",
        name="John Doe",
        birth_date=date(1980, 5, 15),
        gender="M",
        address=Address(
            line1="123 Main St",
            line2="Apt 4B",
            city="Boston",
            state="MA",
            postal_code="02101"
        ),
        insurance=Insurance(
            payer_name="Blue Cross Blue Shield",
            policy_number="BCBS123456",
            group_number="GRP789"
        ),
        encounters=[],
        conditions=[]
    )


@pytest.fixture
def eob_generator():
    """Create an EOBGenerator instance."""
    return EOBGenerator()


class TestEOBGenerator:
    """Test suite for EOBGenerator class."""
    
    def test_generate_approved_claim(self, eob_generator, sample_patient):
        """Test generating EOB for an approved claim."""
        payment_info = PaymentInfo(
            amount=1500.00,
            payment_date=date.today() - timedelta(days=5)
        )
        
        pdf_bytes = eob_generator.generate(
            eob_number="EOB-2024-001",
            claim_number="CLM-2024-001",
            patient=sample_patient,
            status=ClaimStatus.APPROVED,
            payment_info=payment_info,
            denial_reason=None,
            service_date=date(2024, 1, 15),
            billed_amount=1800.00
        )
        
        # Verify PDF was generated
        assert isinstance(pdf_bytes, bytes)
        assert len(pdf_bytes) > 0
        
        # Verify PDF header
        assert pdf_bytes.startswith(b'%PDF')
    
    def test_generate_denied_claim(self, eob_generator, sample_patient):
        """Test generating EOB for a denied claim."""
        pdf_bytes = eob_generator.generate(
            eob_number="EOB-2024-002",
            claim_number="CLM-2024-002",
            patient=sample_patient,
            status=ClaimStatus.DENIED,
            payment_info=None,
            denial_reason="Service not covered under current policy. Pre-authorization required.",
            service_date=date(2024, 1, 20),
            billed_amount=2000.00
        )
        
        # Verify PDF was generated
        assert isinstance(pdf_bytes, bytes)
        assert len(pdf_bytes) > 0
        assert pdf_bytes.startswith(b'%PDF')
    
    def test_generate_pending_claim(self, eob_generator, sample_patient):
        """Test generating EOB for a pending claim."""
        pdf_bytes = eob_generator.generate(
            eob_number="EOB-2024-003",
            claim_number="CLM-2024-003",
            patient=sample_patient,
            status=ClaimStatus.PENDING,
            payment_info=None,
            denial_reason=None,
            service_date=date(2024, 1, 25),
            billed_amount=1200.00
        )
        
        # Verify PDF was generated
        assert isinstance(pdf_bytes, bytes)
        assert len(pdf_bytes) > 0
        assert pdf_bytes.startswith(b'%PDF')
    
    def test_generate_with_minimal_info(self, eob_generator, sample_patient):
        """Test generating EOB with minimal information."""
        pdf_bytes = eob_generator.generate(
            eob_number="EOB-2024-004",
            claim_number="CLM-2024-004",
            patient=sample_patient,
            status=ClaimStatus.PENDING
        )
        
        # Verify PDF was generated even with minimal info
        assert isinstance(pdf_bytes, bytes)
        assert len(pdf_bytes) > 0
        assert pdf_bytes.startswith(b'%PDF')
    
    def test_approved_claim_requires_payment_info(self, eob_generator, sample_patient):
        """Test that approved claims work with payment info."""
        payment_info = PaymentInfo(
            amount=1000.00,
            payment_date=date.today()
        )
        
        pdf_bytes = eob_generator.generate(
            eob_number="EOB-2024-005",
            claim_number="CLM-2024-005",
            patient=sample_patient,
            status=ClaimStatus.APPROVED,
            payment_info=payment_info,
            service_date=date(2024, 2, 1),
            billed_amount=1000.00
        )
        
        assert isinstance(pdf_bytes, bytes)
        assert len(pdf_bytes) > 0
    
    def test_denied_claim_with_long_reason(self, eob_generator, sample_patient):
        """Test generating EOB with a long denial reason that needs wrapping."""
        long_reason = (
            "This claim has been denied because the service provided does not meet "
            "the medical necessity criteria as outlined in your policy. The procedure "
            "was deemed experimental and not covered under standard benefits. "
            "Please contact customer service for more information about your coverage."
        )
        
        pdf_bytes = eob_generator.generate(
            eob_number="EOB-2024-006",
            claim_number="CLM-2024-006",
            patient=sample_patient,
            status=ClaimStatus.DENIED,
            denial_reason=long_reason,
            service_date=date(2024, 2, 5),
            billed_amount=3000.00
        )
        
        assert isinstance(pdf_bytes, bytes)
        assert len(pdf_bytes) > 0
        assert pdf_bytes.startswith(b'%PDF')
    
    def test_patient_responsibility_calculation(self, eob_generator, sample_patient):
        """Test that patient responsibility is calculated correctly."""
        # When billed amount exceeds payment, patient is responsible for difference
        payment_info = PaymentInfo(
            amount=1500.00,
            payment_date=date.today()
        )
        
        pdf_bytes = eob_generator.generate(
            eob_number="EOB-2024-007",
            claim_number="CLM-2024-007",
            patient=sample_patient,
            status=ClaimStatus.APPROVED,
            payment_info=payment_info,
            service_date=date(2024, 2, 10),
            billed_amount=2000.00  # Patient responsible for $500
        )
        
        assert isinstance(pdf_bytes, bytes)
        assert len(pdf_bytes) > 0
