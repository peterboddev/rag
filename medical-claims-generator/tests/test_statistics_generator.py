"""
Unit tests for StatisticsGenerator
"""

import pytest
from datetime import datetime, date
from medical_claims_generator.statistics_generator import StatisticsGenerator
from medical_claims_generator.models import (
    Patient,
    Address,
    Insurance,
    Condition,
    Encounter,
    PatientMapping,
    DocumentSet,
    CMS1500Document,
    EOBDocument,
    RadiologyReport,
    ClinicalNote,
    ClaimStatus,
    PaymentInfo,
    ImagingStudy,
    Statistics
)


@pytest.fixture
def sample_patients():
    """Create sample patients with different cancer types."""
    patients = []
    
    # Create 3 lung cancer patients
    for i in range(1, 4):
        patient = Patient(
            id=f"patient-{i}",
            name=f"Patient {i}",
            birth_date=date(1970, 1, 1),
            gender="M",
            address=Address(
                line1="123 Main St",
                line2=None,
                city="Boston",
                state="MA",
                postal_code="02101"
            ),
            insurance=Insurance(
                payer_name="Blue Cross",
                policy_number=f"BC{i:06d}",
                group_number="GRP001"
            ),
            encounters=[
                Encounter(
                    id=f"enc-{i}",
                    date=date(2024, 1, 15),
                    type="outpatient",
                    provider="Dr. Smith",
                    reason=["Chest pain"]
                )
            ],
            conditions=[
                Condition(
                    code="C34.90",
                    display="Malignant neoplasm of unspecified part of bronchus or lung",
                    onset_date=date(2024, 1, 1),
                    category="lung_cancer"
                )
            ]
        )
        patients.append(patient)
    
    # Create 2 colorectal cancer patients
    for i in range(4, 6):
        patient = Patient(
            id=f"patient-{i}",
            name=f"Patient {i}",
            birth_date=date(1970, 1, 1),
            gender="F",
            address=Address(
                line1="456 Oak Ave",
                line2=None,
                city="Boston",
                state="MA",
                postal_code="02102"
            ),
            insurance=Insurance(
                payer_name="Aetna",
                policy_number=f"AE{i:06d}",
                group_number="GRP002"
            ),
            encounters=[
                Encounter(
                    id=f"enc-{i}",
                    date=date(2024, 1, 20),
                    type="outpatient",
                    provider="Dr. Jones",
                    reason=["Abdominal pain"]
                )
            ],
            conditions=[
                Condition(
                    code="C18.9",
                    display="Malignant neoplasm of colon, unspecified",
                    onset_date=date(2024, 1, 1),
                    category="colorectal_cancer"
                )
            ]
        )
        patients.append(patient)
    
    return patients


@pytest.fixture
def sample_mapping(sample_patients):
    """Create sample patient mapping."""
    patient_id_mapping = {
        patient.id: f"TCIA-{i:03d}"
        for i, patient in enumerate(sample_patients, 1)
    }
    
    encounter_study_mapping = {
        f"enc-{i}": [
            ImagingStudy(
                study_uid=f"1.2.3.{i}",
                tcia_patient_id=f"TCIA-{i:03d}",
                modality="CT",
                study_date=date(2024, 1, 15),
                series_description="Chest CT",
                anatomical_region="Chest"
            )
        ]
        for i in range(1, 6)
    }
    
    return PatientMapping(
        patient_id_mapping=patient_id_mapping,
        encounter_study_mapping=encounter_study_mapping
    )


@pytest.fixture
def sample_documents(sample_patients, sample_mapping):
    """Create sample document set with various claim statuses."""
    cms1500_forms = []
    eob_documents = []
    radiology_reports = []
    clinical_notes = []
    
    # Create documents for each patient
    # 3 approved, 1 denied, 1 pending (60%, 20%, 20%)
    statuses = [
        ClaimStatus.APPROVED,
        ClaimStatus.APPROVED,
        ClaimStatus.APPROVED,
        ClaimStatus.DENIED,
        ClaimStatus.PENDING
    ]
    
    for i, (patient, status) in enumerate(zip(sample_patients, statuses), 1):
        tcia_id = sample_mapping.patient_id_mapping[patient.id]
        
        # CMS-1500 form
        cms1500 = CMS1500Document(
            claim_number=f"CLM{i:06d}",
            patient_id=patient.id,
            tcia_patient_id=tcia_id,
            encounter_id=f"enc-{i}",
            study_uid=f"1.2.3.{i}",
            procedure_code="71250",
            diagnosis_codes=["C34.90"],
            pdf_bytes=b"fake pdf",
            filename=f"cms1500_{i:03d}.pdf"
        )
        cms1500_forms.append(cms1500)
        
        # EOB document
        payment_info = None
        denial_reason = None
        
        if status == ClaimStatus.APPROVED:
            payment_info = PaymentInfo(
                amount=1500.00,
                payment_date=date(2024, 2, 1)
            )
        elif status == ClaimStatus.DENIED:
            denial_reason = "Prior authorization required"
        
        eob = EOBDocument(
            eob_number=f"EOB{i:06d}",
            claim_number=f"CLM{i:06d}",
            patient_id=patient.id,
            tcia_patient_id=tcia_id,
            status=status,
            payment_info=payment_info,
            denial_reason=denial_reason,
            pdf_bytes=b"fake pdf",
            filename=f"eob_{i:03d}.pdf"
        )
        eob_documents.append(eob)
        
        # Radiology report
        report = RadiologyReport(
            report_id=f"RAD{i:06d}",
            patient_id=patient.id,
            tcia_patient_id=tcia_id,
            study_uid=f"1.2.3.{i}",
            modality="CT",
            anatomical_region="Chest",
            findings="Findings text",
            radiologist="Dr. Radiologist",
            report_date=date(2024, 1, 15),
            pdf_bytes=b"fake pdf",
            filename=f"radiology_report_{i:03d}.pdf"
        )
        radiology_reports.append(report)
        
        # Clinical note
        note = ClinicalNote(
            note_id=f"NOTE{i:06d}",
            patient_id=patient.id,
            tcia_patient_id=tcia_id,
            encounter_id=f"enc-{i}",
            symptoms=["Chest pain"],
            imaging_orders=["CT Chest"],
            treatment_plan="Follow-up in 3 months",
            physician="Dr. Smith",
            note_date=date(2024, 1, 15),
            pdf_bytes=b"fake pdf",
            filename=f"note_{i:03d}.pdf"
        )
        clinical_notes.append(note)
    
    return DocumentSet(
        cms1500_forms=cms1500_forms,
        eob_documents=eob_documents,
        radiology_reports=radiology_reports,
        clinical_notes=clinical_notes
    )


class TestStatisticsGenerator:
    """Test suite for StatisticsGenerator class."""
    
    def test_generate_returns_statistics_object(
        self,
        sample_patients,
        sample_mapping,
        sample_documents
    ):
        """Test that generate() returns a Statistics object."""
        generator = StatisticsGenerator()
        seed = 12345
        generation_time = datetime(2024, 1, 15, 10, 30, 0)
        
        result = generator.generate(
            patients=sample_patients,
            mapping=sample_mapping,
            documents=sample_documents,
            seed=seed,
            generation_time=generation_time
        )
        
        assert isinstance(result, Statistics)
    
    def test_total_patients_count(
        self,
        sample_patients,
        sample_mapping,
        sample_documents
    ):
        """Test that total patient count is correct."""
        generator = StatisticsGenerator()
        seed = 12345
        generation_time = datetime(2024, 1, 15, 10, 30, 0)
        
        result = generator.generate(
            patients=sample_patients,
            mapping=sample_mapping,
            documents=sample_documents,
            seed=seed,
            generation_time=generation_time
        )
        
        assert result.total_patients == 5
    
    def test_patients_by_cancer_type(
        self,
        sample_patients,
        sample_mapping,
        sample_documents
    ):
        """Test that patients are correctly counted by cancer type."""
        generator = StatisticsGenerator()
        seed = 12345
        generation_time = datetime(2024, 1, 15, 10, 30, 0)
        
        result = generator.generate(
            patients=sample_patients,
            mapping=sample_mapping,
            documents=sample_documents,
            seed=seed,
            generation_time=generation_time
        )
        
        assert result.patients_by_cancer_type["lung_cancer"] == 3
        assert result.patients_by_cancer_type["colorectal_cancer"] == 2
    
    def test_total_claims_count(
        self,
        sample_patients,
        sample_mapping,
        sample_documents
    ):
        """Test that total claim count is correct."""
        generator = StatisticsGenerator()
        seed = 12345
        generation_time = datetime(2024, 1, 15, 10, 30, 0)
        
        result = generator.generate(
            patients=sample_patients,
            mapping=sample_mapping,
            documents=sample_documents,
            seed=seed,
            generation_time=generation_time
        )
        
        assert result.total_claims == 5
    
    def test_claims_by_status(
        self,
        sample_patients,
        sample_mapping,
        sample_documents
    ):
        """Test that claims are correctly counted by status."""
        generator = StatisticsGenerator()
        seed = 12345
        generation_time = datetime(2024, 1, 15, 10, 30, 0)
        
        result = generator.generate(
            patients=sample_patients,
            mapping=sample_mapping,
            documents=sample_documents,
            seed=seed,
            generation_time=generation_time
        )
        
        assert result.claims_by_status["approved"] == 3
        assert result.claims_by_status["denied"] == 1
        assert result.claims_by_status["pending"] == 1
    
    def test_documents_by_type(
        self,
        sample_patients,
        sample_mapping,
        sample_documents
    ):
        """Test that documents are correctly counted by type."""
        generator = StatisticsGenerator()
        seed = 12345
        generation_time = datetime(2024, 1, 15, 10, 30, 0)
        
        result = generator.generate(
            patients=sample_patients,
            mapping=sample_mapping,
            documents=sample_documents,
            seed=seed,
            generation_time=generation_time
        )
        
        assert result.documents_by_type["cms1500_forms"] == 5
        assert result.documents_by_type["eob_documents"] == 5
        assert result.documents_by_type["radiology_reports"] == 5
        assert result.documents_by_type["clinical_notes"] == 5
    
    def test_tcia_patient_ids(
        self,
        sample_patients,
        sample_mapping,
        sample_documents
    ):
        """Test that TCIA patient IDs are correctly extracted."""
        generator = StatisticsGenerator()
        seed = 12345
        generation_time = datetime(2024, 1, 15, 10, 30, 0)
        
        result = generator.generate(
            patients=sample_patients,
            mapping=sample_mapping,
            documents=sample_documents,
            seed=seed,
            generation_time=generation_time
        )
        
        expected_ids = ["TCIA-001", "TCIA-002", "TCIA-003", "TCIA-004", "TCIA-005"]
        assert result.tcia_patient_ids == expected_ids
    
    def test_random_seed(
        self,
        sample_patients,
        sample_mapping,
        sample_documents
    ):
        """Test that random seed is correctly recorded."""
        generator = StatisticsGenerator()
        seed = 12345
        generation_time = datetime(2024, 1, 15, 10, 30, 0)
        
        result = generator.generate(
            patients=sample_patients,
            mapping=sample_mapping,
            documents=sample_documents,
            seed=seed,
            generation_time=generation_time
        )
        
        assert result.random_seed == 12345
    
    def test_generation_timestamp(
        self,
        sample_patients,
        sample_mapping,
        sample_documents
    ):
        """Test that generation timestamp is correctly formatted."""
        generator = StatisticsGenerator()
        seed = 12345
        generation_time = datetime(2024, 1, 15, 10, 30, 0)
        
        result = generator.generate(
            patients=sample_patients,
            mapping=sample_mapping,
            documents=sample_documents,
            seed=seed,
            generation_time=generation_time
        )
        
        assert result.generation_timestamp == "2024-01-15T10:30:00"
    
    def test_to_json_serialization(
        self,
        sample_patients,
        sample_mapping,
        sample_documents
    ):
        """Test that Statistics can be serialized to JSON."""
        generator = StatisticsGenerator()
        seed = 12345
        generation_time = datetime(2024, 1, 15, 10, 30, 0)
        
        result = generator.generate(
            patients=sample_patients,
            mapping=sample_mapping,
            documents=sample_documents,
            seed=seed,
            generation_time=generation_time
        )
        
        json_data = result.to_json()
        
        assert isinstance(json_data, dict)
        assert "total_patients" in json_data
        assert "patients_by_cancer_type" in json_data
        assert "total_claims" in json_data
        assert "claims_by_status" in json_data
        assert "documents_by_type" in json_data
        assert "tcia_patient_ids" in json_data
        assert "random_seed" in json_data
        assert "generation_timestamp" in json_data
    
    def test_to_json_values(
        self,
        sample_patients,
        sample_mapping,
        sample_documents
    ):
        """Test that JSON serialization contains correct values."""
        generator = StatisticsGenerator()
        seed = 12345
        generation_time = datetime(2024, 1, 15, 10, 30, 0)
        
        result = generator.generate(
            patients=sample_patients,
            mapping=sample_mapping,
            documents=sample_documents,
            seed=seed,
            generation_time=generation_time
        )
        
        json_data = result.to_json()
        
        assert json_data["total_patients"] == 5
        assert json_data["patients_by_cancer_type"]["lung_cancer"] == 3
        assert json_data["patients_by_cancer_type"]["colorectal_cancer"] == 2
        assert json_data["total_claims"] == 5
        assert json_data["claims_by_status"]["approved"] == 3
        assert json_data["claims_by_status"]["denied"] == 1
        assert json_data["claims_by_status"]["pending"] == 1
        assert json_data["documents_by_type"]["cms1500_forms"] == 5
        assert json_data["random_seed"] == 12345
        assert json_data["generation_timestamp"] == "2024-01-15T10:30:00"
    
    def test_empty_patients(self, sample_mapping):
        """Test statistics generation with no patients."""
        generator = StatisticsGenerator()
        seed = 12345
        generation_time = datetime(2024, 1, 15, 10, 30, 0)
        
        empty_documents = DocumentSet(
            cms1500_forms=[],
            eob_documents=[],
            radiology_reports=[],
            clinical_notes=[]
        )
        
        empty_mapping = PatientMapping(
            patient_id_mapping={},
            encounter_study_mapping={}
        )
        
        result = generator.generate(
            patients=[],
            mapping=empty_mapping,
            documents=empty_documents,
            seed=seed,
            generation_time=generation_time
        )
        
        assert result.total_patients == 0
        assert result.total_claims == 0
        assert len(result.tcia_patient_ids) == 0
    
    def test_multiple_conditions_per_patient(self, sample_mapping):
        """Test patient with multiple cancer conditions."""
        # Create patient with both lung and colorectal cancer
        patient = Patient(
            id="patient-1",
            name="Patient 1",
            birth_date=date(1970, 1, 1),
            gender="M",
            address=Address(
                line1="123 Main St",
                line2=None,
                city="Boston",
                state="MA",
                postal_code="02101"
            ),
            insurance=Insurance(
                payer_name="Blue Cross",
                policy_number="BC000001",
                group_number="GRP001"
            ),
            encounters=[],
            conditions=[
                Condition(
                    code="C34.90",
                    display="Lung cancer",
                    onset_date=date(2024, 1, 1),
                    category="lung_cancer"
                ),
                Condition(
                    code="C18.9",
                    display="Colorectal cancer",
                    onset_date=date(2024, 1, 1),
                    category="colorectal_cancer"
                )
            ]
        )
        
        generator = StatisticsGenerator()
        seed = 12345
        generation_time = datetime(2024, 1, 15, 10, 30, 0)
        
        empty_documents = DocumentSet(
            cms1500_forms=[],
            eob_documents=[],
            radiology_reports=[],
            clinical_notes=[]
        )
        
        mapping = PatientMapping(
            patient_id_mapping={"patient-1": "TCIA-001"},
            encounter_study_mapping={}
        )
        
        result = generator.generate(
            patients=[patient],
            mapping=mapping,
            documents=empty_documents,
            seed=seed,
            generation_time=generation_time
        )
        
        # Patient should be counted for both cancer types
        assert result.patients_by_cancer_type["lung_cancer"] == 1
        assert result.patients_by_cancer_type["colorectal_cancer"] == 1
