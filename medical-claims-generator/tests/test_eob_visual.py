"""
Visual test for EOB Generator - creates sample PDFs for manual inspection.

This test is marked as manual and won't run in CI/CD.
Run with: pytest tests/test_eob_visual.py -v -m manual
"""

import pytest
from datetime import date, timedelta
from pathlib import Path

from medical_claims_generator.models import (
    Patient, Address, Insurance, ClaimStatus, PaymentInfo
)
from medical_claims_generator.pdf_generators.eob_generator import EOBGenerator


@pytest.fixture
def sample_patient():
    """Create a sample patient for testing."""
    return Patient(
        id="TEST-001",
        name="Jane Smith",
        birth_date=date(1975, 8, 22),
        gender="F",
        address=Address(
            line1="456 Oak Avenue",
            line2=None,
            city="Seattle",
            state="WA",
            postal_code="98101"
        ),
        insurance=Insurance(
            payer_name="Aetna Health Insurance",
            policy_number="AET987654",
            group_number="GRP456"
        ),
        encounters=[],
        conditions=[]
    )


@pytest.mark.manual
def test_create_sample_eob_pdfs(sample_patient, tmp_path):
    """Create sample EOB PDFs for all three statuses for visual inspection."""
    generator = EOBGenerator()
    
    # Create approved claim EOB
    payment_info = PaymentInfo(
        amount=1850.00,
        payment_date=date.today() - timedelta(days=3)
    )
    
    approved_pdf = generator.generate(
        eob_number="EOB-2024-APPROVED-001",
        claim_number="CLM-2024-001",
        patient=sample_patient,
        status=ClaimStatus.APPROVED,
        payment_info=payment_info,
        service_date=date(2024, 1, 15),
        billed_amount=2000.00
    )
    
    approved_path = tmp_path / "eob_approved_sample.pdf"
    approved_path.write_bytes(approved_pdf)
    print(f"\nApproved EOB saved to: {approved_path}")
    
    # Create denied claim EOB
    denied_pdf = generator.generate(
        eob_number="EOB-2024-DENIED-002",
        claim_number="CLM-2024-002",
        patient=sample_patient,
        status=ClaimStatus.DENIED,
        denial_reason="Service not covered under current policy. The procedure requires pre-authorization which was not obtained prior to service. Additionally, the service is considered experimental and is excluded from coverage under Section 5.2 of your policy agreement.",
        service_date=date(2024, 1, 20),
        billed_amount=3500.00
    )
    
    denied_path = tmp_path / "eob_denied_sample.pdf"
    denied_path.write_bytes(denied_pdf)
    print(f"Denied EOB saved to: {denied_path}")
    
    # Create pending claim EOB
    pending_pdf = generator.generate(
        eob_number="EOB-2024-PENDING-003",
        claim_number="CLM-2024-003",
        patient=sample_patient,
        status=ClaimStatus.PENDING,
        service_date=date(2024, 2, 1),
        billed_amount=1200.00
    )
    
    pending_path = tmp_path / "eob_pending_sample.pdf"
    pending_path.write_bytes(pending_pdf)
    print(f"Pending EOB saved to: {pending_path}")
    
    print(f"\nAll sample EOBs created successfully in: {tmp_path}")
    print("Open these files to visually inspect the EOB layouts.")
    
    # Verify all files were created
    assert approved_path.exists()
    assert denied_path.exists()
    assert pending_path.exists()
