"""
Unit tests for CMS1500Generator
"""

import pytest
from datetime import date

from medical_claims_generator.models import Patient, Address, Insurance, Encounter, Condition
from medical_claims_generator.pdf_generators.cms1500_generator import CMS1500Generator


@pytest.fixture
def sample_patient():
    """Create a sample patient for testing."""
    return Patient(
        id="patient-001",
        name="John Doe",
        birth_date=date(1960, 5, 15),
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
            policy_number="BCBS123456789",
            group_number="GRP001"
        ),
        encounters=[],
        conditions=[]
    )


@pytest.fixture
def sample_provider_address():
    """Create a sample provider address."""
    return Address(
        line1="456 Medical Plaza",
        line2=None,
        city="Boston",
        state="MA",
        postal_code="02115"
    )


def test_cms1500_generator_initialization():
    """Test that CMS1500Generator can be initialized."""
    generator = CMS1500Generator()
    assert generator is not None


def test_generate_returns_bytes(sample_patient, sample_provider_address):
    """Test that generate() returns bytes."""
    generator = CMS1500Generator()
    
    pdf_bytes = generator.generate(
        patient=sample_patient,
        provider_name="Dr. Jane Smith",
        provider_npi="1234567890",
        provider_address=sample_provider_address,
        diagnosis_codes=["C34.90", "Z87.891"],
        procedure_code="71250",
        procedure_charge=1500.00,
        service_date=date(2024, 1, 15),
        study_uid="1.2.840.113619.2.55.3.12345678",
        claim_number="CLM-2024-001"
    )
    
    assert isinstance(pdf_bytes, bytes)
    assert len(pdf_bytes) > 0


def test_generate_creates_valid_pdf(sample_patient, sample_provider_address):
    """Test that generate() creates a valid PDF document."""
    generator = CMS1500Generator()
    
    pdf_bytes = generator.generate(
        patient=sample_patient,
        provider_name="Dr. Jane Smith",
        provider_npi="1234567890",
        provider_address=sample_provider_address,
        diagnosis_codes=["C34.90"],
        procedure_code="71250",
        procedure_charge=1500.00,
        service_date=date(2024, 1, 15),
        study_uid="1.2.840.113619.2.55.3.12345678",
        claim_number="CLM-2024-001"
    )
    
    # Verify it starts with PDF header
    assert pdf_bytes.startswith(b'%PDF')


def test_generate_with_multiple_diagnosis_codes(sample_patient, sample_provider_address):
    """Test that generate() handles multiple diagnosis codes."""
    generator = CMS1500Generator()
    diagnosis_codes = ["C34.90", "Z87.891", "J44.0", "I10"]
    
    pdf_bytes = generator.generate(
        patient=sample_patient,
        provider_name="Dr. Jane Smith",
        provider_npi="1234567890",
        provider_address=sample_provider_address,
        diagnosis_codes=diagnosis_codes,
        procedure_code="71250",
        procedure_charge=1500.00,
        service_date=date(2024, 1, 15),
        study_uid="1.2.840.113619.2.55.3.12345678",
        claim_number="CLM-2024-001"
    )
    
    assert isinstance(pdf_bytes, bytes)
    assert len(pdf_bytes) > 0


def test_generate_with_different_procedure_codes(sample_patient, sample_provider_address):
    """Test that generate() handles different CPT codes."""
    generator = CMS1500Generator()
    
    for procedure_code in ["71250", "71260", "71270", "71275"]:
        pdf_bytes = generator.generate(
            patient=sample_patient,
            provider_name="Dr. Jane Smith",
            provider_npi="1234567890",
            provider_address=sample_provider_address,
            diagnosis_codes=["C34.90"],
            procedure_code=procedure_code,
            procedure_charge=1500.00,
            service_date=date(2024, 1, 15),
            study_uid="1.2.840.113619.2.55.3.12345678",
            claim_number="CLM-2024-001"
        )
        
        assert isinstance(pdf_bytes, bytes)
        assert len(pdf_bytes) > 0


def test_generate_with_patient_without_address_line2(sample_provider_address):
    """Test that generate() handles patients without address line 2."""
    patient = Patient(
        id="patient-002",
        name="Jane Smith",
        birth_date=date(1975, 8, 20),
        gender="F",
        address=Address(
            line1="789 Oak Ave",
            line2=None,
            city="Cambridge",
            state="MA",
            postal_code="02139"
        ),
        insurance=Insurance(
            payer_name="Aetna",
            policy_number="AETNA987654321",
            group_number=None
        ),
        encounters=[],
        conditions=[]
    )
    
    generator = CMS1500Generator()
    pdf_bytes = generator.generate(
        patient=patient,
        provider_name="Dr. John Brown",
        provider_npi="9876543210",
        provider_address=sample_provider_address,
        diagnosis_codes=["C18.9"],
        procedure_code="71260",
        procedure_charge=2000.00,
        service_date=date(2024, 2, 1),
        study_uid="1.2.840.113619.2.55.3.87654321",
        claim_number="CLM-2024-002"
    )
    
    assert isinstance(pdf_bytes, bytes)
    assert len(pdf_bytes) > 0
