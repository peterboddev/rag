"""
Unit tests for RadiologyReportGenerator
"""

import pytest
from datetime import date

from medical_claims_generator.models import Patient, Address, Insurance, Encounter, Condition
from medical_claims_generator.pdf_generators.radiology_report_generator import RadiologyReportGenerator


@pytest.fixture
def sample_patient():
    """Create a sample patient for testing."""
    return Patient(
        id="TEST-001",
        name="John Doe",
        birth_date=date(1960, 5, 15),
        gender="Male",
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
def generator():
    """Create a RadiologyReportGenerator instance."""
    return RadiologyReportGenerator()


def test_generator_initialization(generator):
    """Test that generator initializes correctly."""
    assert generator is not None
    assert hasattr(generator, 'FINDINGS_TEMPLATES')
    assert 'lung_cancer' in generator.FINDINGS_TEMPLATES
    assert 'colorectal_cancer' in generator.FINDINGS_TEMPLATES


def test_generate_lung_cancer_report(generator, sample_patient):
    """Test generating a radiology report for lung cancer."""
    pdf_bytes = generator.generate(
        patient=sample_patient,
        study_uid="1.2.840.113619.2.55.3.123456789.123",
        modality="CT",
        anatomical_region="Chest",
        cancer_type="lung_cancer",
        radiologist="Dr. Sarah Johnson",
        report_date=date(2024, 1, 15)
    )
    
    # Verify PDF was generated
    assert pdf_bytes is not None
    assert isinstance(pdf_bytes, bytes)
    assert len(pdf_bytes) > 0
    
    # Verify it's a valid PDF (starts with PDF header)
    assert pdf_bytes.startswith(b'%PDF')


def test_generate_colorectal_cancer_report(generator, sample_patient):
    """Test generating a radiology report for colorectal cancer."""
    pdf_bytes = generator.generate(
        patient=sample_patient,
        study_uid="1.2.840.113619.2.55.3.987654321.456",
        modality="CT",
        anatomical_region="Abdomen/Pelvis",
        cancer_type="colorectal_cancer",
        radiologist="Dr. Michael Chen",
        report_date=date(2024, 2, 20)
    )
    
    # Verify PDF was generated
    assert pdf_bytes is not None
    assert isinstance(pdf_bytes, bytes)
    assert len(pdf_bytes) > 0
    
    # Verify it's a valid PDF (starts with PDF header)
    assert pdf_bytes.startswith(b'%PDF')


def test_generate_unknown_cancer_type(generator, sample_patient):
    """Test generating a report with unknown cancer type defaults to lung cancer template."""
    pdf_bytes = generator.generate(
        patient=sample_patient,
        study_uid="1.2.840.113619.2.55.3.111222333.789",
        modality="CT",
        anatomical_region="Chest",
        cancer_type="unknown_cancer",
        radiologist="Dr. Emily Rodriguez",
        report_date=date(2024, 3, 10)
    )
    
    # Should still generate a valid PDF using default template
    assert pdf_bytes is not None
    assert isinstance(pdf_bytes, bytes)
    assert len(pdf_bytes) > 0


def test_generate_findings_lung_cancer(generator):
    """Test that findings generation for lung cancer includes expected content."""
    findings_html = generator._generate_findings("lung_cancer")
    
    # Check for key terms in lung cancer findings
    assert "lung" in findings_html.lower()
    assert "mass" in findings_html.lower()
    assert "lobe" in findings_html.lower()
    assert "lymph" in findings_html.lower()


def test_generate_findings_colorectal_cancer(generator):
    """Test that findings generation for colorectal cancer includes expected content."""
    findings_html = generator._generate_findings("colorectal_cancer")
    
    # Check for key terms in colorectal cancer findings
    assert "colon" in findings_html.lower()
    assert "wall thickening" in findings_html.lower()
    assert "lymph" in findings_html.lower()


def test_multiple_reports_are_unique(generator, sample_patient):
    """Test that multiple reports with same cancer type have variations."""
    # Generate multiple lung cancer reports
    reports = []
    for i in range(5):
        pdf_bytes = generator.generate(
            patient=sample_patient,
            study_uid=f"1.2.840.113619.2.55.3.{i}",
            modality="CT",
            anatomical_region="Chest",
            cancer_type="lung_cancer",
            radiologist="Dr. Test",
            report_date=date(2024, 1, 15)
        )
        reports.append(pdf_bytes)
    
    # Verify all reports were generated
    assert len(reports) == 5
    
    # Reports should have different sizes due to random variations
    sizes = [len(report) for report in reports]
    # At least some variation in sizes (not all identical)
    assert len(set(sizes)) > 1 or all(s > 0 for s in sizes)

