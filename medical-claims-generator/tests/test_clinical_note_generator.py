"""
Tests for ClinicalNoteGenerator

Tests the generation of clinical notes as PDF documents.
"""

import pytest
from datetime import date
from pathlib import Path

from medical_claims_generator.models import Patient, Address, Insurance, Encounter
from medical_claims_generator.pdf_generators.clinical_note_generator import ClinicalNoteGenerator


@pytest.fixture
def sample_patient():
    """Create a sample patient for testing."""
    return Patient(
        id="PAT-001",
        name="John Doe",
        birth_date=date(1965, 5, 15),
        gender="M",
        address=Address(
            line1="123 Main St",
            line2=None,
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
def sample_encounter():
    """Create a sample encounter for testing."""
    return Encounter(
        id="ENC-001",
        date=date(2024, 1, 15),
        type="outpatient",
        provider="Dr. Smith",
        reason=["Routine cancer screening"]
    )


@pytest.fixture
def generator():
    """Create a ClinicalNoteGenerator instance."""
    return ClinicalNoteGenerator()


def test_generator_initialization(generator):
    """Test that generator initializes correctly."""
    assert generator is not None
    assert hasattr(generator, 'generate')


def test_generate_clinical_note_lung_cancer(generator, sample_patient, sample_encounter):
    """Test generating a clinical note for lung cancer screening."""
    pdf_bytes = generator.generate(
        patient=sample_patient,
        encounter=sample_encounter,
        imaging_orders=["CT Chest with contrast"],
        cancer_type="lung_cancer",
        physician="Dr. Jane Smith"
    )
    
    assert pdf_bytes is not None
    assert isinstance(pdf_bytes, bytes)
    assert len(pdf_bytes) > 0
    assert pdf_bytes.startswith(b'%PDF')  # PDF magic number


def test_generate_clinical_note_colorectal_cancer(generator, sample_patient, sample_encounter):
    """Test generating a clinical note for colorectal cancer."""
    encounter = Encounter(
        id="ENC-002",
        date=date(2024, 1, 20),
        type="outpatient",
        provider="Dr. Johnson",
        reason=["Follow-up for abdominal symptoms"]
    )
    
    pdf_bytes = generator.generate(
        patient=sample_patient,
        encounter=encounter,
        imaging_orders=["CT Abdomen and Pelvis with contrast"],
        cancer_type="colorectal_cancer",
        physician="Dr. Robert Johnson"
    )
    
    assert pdf_bytes is not None
    assert isinstance(pdf_bytes, bytes)
    assert len(pdf_bytes) > 0
    assert pdf_bytes.startswith(b'%PDF')


def test_generate_clinical_note_no_imaging_orders(generator, sample_patient, sample_encounter):
    """Test generating a clinical note with no imaging orders."""
    pdf_bytes = generator.generate(
        patient=sample_patient,
        encounter=sample_encounter,
        imaging_orders=[],
        cancer_type="lung_cancer",
        physician="Dr. Jane Smith"
    )
    
    assert pdf_bytes is not None
    assert isinstance(pdf_bytes, bytes)
    assert len(pdf_bytes) > 0


def test_generate_symptoms_screening(generator):
    """Test symptom generation for screening encounter."""
    symptoms = generator._generate_symptoms("lung_cancer", ["Routine cancer screening"])
    
    assert symptoms is not None
    assert isinstance(symptoms, list)
    assert len(symptoms) > 0
    assert any("screening" in s.lower() for s in symptoms)


def test_generate_symptoms_follow_up(generator):
    """Test symptom generation for follow-up encounter."""
    symptoms = generator._generate_symptoms("lung_cancer", ["Follow-up visit"])
    
    assert symptoms is not None
    assert isinstance(symptoms, list)
    assert len(symptoms) > 0


def test_generate_symptoms_diagnostic(generator):
    """Test symptom generation for diagnostic encounter."""
    symptoms = generator._generate_symptoms("colorectal_cancer", ["Diagnostic evaluation"])
    
    assert symptoms is not None
    assert isinstance(symptoms, list)
    assert len(symptoms) > 0


def test_generate_treatment_plan_lung_cancer(generator):
    """Test treatment plan generation for lung cancer."""
    plan = generator._generate_treatment_plan("lung_cancer", ["CT Chest with contrast"])
    
    assert plan is not None
    assert isinstance(plan, str)
    assert len(plan) > 0
    assert "CT" in plan or "imaging" in plan.lower()


def test_generate_treatment_plan_colorectal_cancer(generator):
    """Test treatment plan generation for colorectal cancer."""
    plan = generator._generate_treatment_plan("colorectal_cancer", ["CT Abdomen and Pelvis"])
    
    assert plan is not None
    assert isinstance(plan, str)
    assert len(plan) > 0


def test_pdf_output_is_valid(generator, sample_patient, sample_encounter):
    """Test that generated PDF is valid and can be written to file."""
    pdf_bytes = generator.generate(
        patient=sample_patient,
        encounter=sample_encounter,
        imaging_orders=["CT Chest with contrast"],
        cancer_type="lung_cancer",
        physician="Dr. Jane Smith"
    )
    
    # Verify PDF structure
    assert pdf_bytes.startswith(b'%PDF')
    assert b'%%EOF' in pdf_bytes
    
    # Verify minimum size (should be at least a few KB)
    assert len(pdf_bytes) > 1000


def test_multiple_imaging_orders(generator, sample_patient, sample_encounter):
    """Test clinical note with multiple imaging orders."""
    pdf_bytes = generator.generate(
        patient=sample_patient,
        encounter=sample_encounter,
        imaging_orders=[
            "CT Chest with contrast",
            "PET scan",
            "Chest X-ray"
        ],
        cancer_type="lung_cancer",
        physician="Dr. Jane Smith"
    )
    
    assert pdf_bytes is not None
    assert len(pdf_bytes) > 0


def test_different_physicians(generator, sample_patient, sample_encounter):
    """Test clinical notes with different physician names."""
    physicians = ["Dr. Jane Smith", "Dr. Robert Johnson", "Dr. Emily Chen"]
    
    for physician in physicians:
        pdf_bytes = generator.generate(
            patient=sample_patient,
            encounter=sample_encounter,
            imaging_orders=["CT Scan"],
            cancer_type="lung_cancer",
            physician=physician
        )
        
        assert pdf_bytes is not None
        assert len(pdf_bytes) > 0
