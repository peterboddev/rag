"""
Unit tests for data models

Tests dataclass initialization, field validation, serialization methods,
and enum values for all data models in the medical claims generator.
"""

import pytest
from datetime import date, datetime
from pathlib import Path

from medical_claims_generator.models import (
    Address,
    Insurance,
    Condition,
    Encounter,
    Patient,
    ImagingStudy,
    ClaimStatus,
    PaymentInfo,
    CMS1500Document,
    EOBDocument,
    RadiologyReport,
    ClinicalNote,
    PatientMapping,
    DocumentSet,
    ValidationResult,
    Statistics,
    GenerationResult,
    GenerationConfig,
)


class TestAddress:
    """Tests for Address dataclass."""
    
    def test_address_initialization(self):
        """Test Address can be initialized with all fields."""
        address = Address(
            line1="123 Main St",
            line2="Apt 4B",
            city="Boston",
            state="MA",
            postal_code="02101"
        )
        
        assert address.line1 == "123 Main St"
        assert address.line2 == "Apt 4B"
        assert address.city == "Boston"
        assert address.state == "MA"
        assert address.postal_code == "02101"
    
    def test_address_optional_line2(self):
        """Test Address with optional line2 as None."""
        address = Address(
            line1="456 Oak Ave",
            line2=None,
            city="Cambridge",
            state="MA",
            postal_code="02139"
        )
        
        assert address.line2 is None


class TestInsurance:
    """Tests for Insurance dataclass."""
    
    def test_insurance_initialization(self):
        """Test Insurance can be initialized with all fields."""
        insurance = Insurance(
            payer_name="Blue Cross Blue Shield",
            policy_number="POL123456",
            group_number="GRP789"
        )
        
        assert insurance.payer_name == "Blue Cross Blue Shield"
        assert insurance.policy_number == "POL123456"
        assert insurance.group_number == "GRP789"
    
    def test_insurance_optional_group_number(self):
        """Test Insurance with optional group_number as None."""
        insurance = Insurance(
            payer_name="Aetna",
            policy_number="POL999888",
            group_number=None
        )
        
        assert insurance.group_number is None


class TestCondition:
    """Tests for Condition dataclass."""
    
    def test_condition_initialization(self):
        """Test Condition can be initialized with all fields."""
        condition = Condition(
            code="C34.90",
            display="Malignant neoplasm of unspecified part of bronchus or lung",
            onset_date=date(2023, 6, 15),
            category="lung_cancer"
        )
        
        assert condition.code == "C34.90"
        assert condition.display == "Malignant neoplasm of unspecified part of bronchus or lung"
        assert condition.onset_date == date(2023, 6, 15)
        assert condition.category == "lung_cancer"


class TestEncounter:
    """Tests for Encounter dataclass."""
    
    def test_encounter_initialization(self):
        """Test Encounter can be initialized with all fields."""
        encounter = Encounter(
            id="enc-001",
            date=date(2023, 7, 20),
            type="outpatient",
            provider="Dr. Smith",
            reason=["chest pain", "shortness of breath"]
        )
        
        assert encounter.id == "enc-001"
        assert encounter.date == date(2023, 7, 20)
        assert encounter.type == "outpatient"
        assert encounter.provider == "Dr. Smith"
        assert encounter.reason == ["chest pain", "shortness of breath"]


class TestPatient:
    """Tests for Patient dataclass."""
    
    def test_patient_initialization(self):
        """Test Patient can be initialized with all fields."""
        address = Address("123 Main St", None, "Boston", "MA", "02101")
        insurance = Insurance("BCBS", "POL123", "GRP456")
        condition = Condition("C34.90", "Lung cancer", date(2023, 6, 15), "lung_cancer")
        encounter = Encounter("enc-001", date(2023, 7, 20), "outpatient", "Dr. Smith", ["chest pain"])
        
        patient = Patient(
            id="patient-001",
            name="John Doe",
            birth_date=date(1960, 3, 15),
            gender="M",
            address=address,
            insurance=insurance,
            encounters=[encounter],
            conditions=[condition]
        )
        
        assert patient.id == "patient-001"
        assert patient.name == "John Doe"
        assert patient.birth_date == date(1960, 3, 15)
        assert patient.gender == "M"
        assert patient.address == address
        assert patient.insurance == insurance
        assert len(patient.encounters) == 1
        assert len(patient.conditions) == 1


class TestImagingStudy:
    """Tests for ImagingStudy dataclass."""
    
    def test_imaging_study_initialization(self):
        """Test ImagingStudy can be initialized with all fields."""
        study = ImagingStudy(
            study_uid="1.2.840.113654.2.55.123456789",
            tcia_patient_id="TCIA-001",
            modality="CT",
            study_date=date(2023, 7, 21),
            series_description="Chest CT with contrast",
            anatomical_region="Chest"
        )
        
        assert study.study_uid == "1.2.840.113654.2.55.123456789"
        assert study.tcia_patient_id == "TCIA-001"
        assert study.modality == "CT"
        assert study.study_date == date(2023, 7, 21)
        assert study.series_description == "Chest CT with contrast"
        assert study.anatomical_region == "Chest"


class TestClaimStatus:
    """Tests for ClaimStatus enum."""
    
    def test_claim_status_values(self):
        """Test ClaimStatus enum has correct values."""
        assert ClaimStatus.APPROVED.value == "approved"
        assert ClaimStatus.DENIED.value == "denied"
        assert ClaimStatus.PENDING.value == "pending"
    
    def test_claim_status_members(self):
        """Test ClaimStatus enum has exactly three members."""
        assert len(ClaimStatus) == 3
        assert ClaimStatus.APPROVED in ClaimStatus
        assert ClaimStatus.DENIED in ClaimStatus
        assert ClaimStatus.PENDING in ClaimStatus


class TestPaymentInfo:
    """Tests for PaymentInfo dataclass."""
    
    def test_payment_info_initialization(self):
        """Test PaymentInfo can be initialized with all fields."""
        payment = PaymentInfo(
            amount=1250.50,
            payment_date=date(2023, 8, 15)
        )
        
        assert payment.amount == 1250.50
        assert payment.payment_date == date(2023, 8, 15)


class TestCMS1500Document:
    """Tests for CMS1500Document dataclass."""
    
    def test_cms1500_initialization(self):
        """Test CMS1500Document can be initialized with all fields."""
        doc = CMS1500Document(
            claim_number="CLM-001",
            patient_id="patient-001",
            tcia_patient_id="TCIA-001",
            encounter_id="enc-001",
            study_uid="1.2.840.113654.2.55.123456789",
            procedure_code="71250",
            diagnosis_codes=["C34.90", "Z87.891"],
            pdf_bytes=b"fake pdf content",
            filename="cms1500_001.pdf"
        )
        
        assert doc.claim_number == "CLM-001"
        assert doc.patient_id == "patient-001"
        assert doc.tcia_patient_id == "TCIA-001"
        assert doc.encounter_id == "enc-001"
        assert doc.study_uid == "1.2.840.113654.2.55.123456789"
        assert doc.procedure_code == "71250"
        assert doc.diagnosis_codes == ["C34.90", "Z87.891"]
        assert doc.pdf_bytes == b"fake pdf content"
        assert doc.filename == "cms1500_001.pdf"


class TestEOBDocument:
    """Tests for EOBDocument dataclass."""
    
    def test_eob_approved_initialization(self):
        """Test EOBDocument for approved claim with payment info."""
        payment = PaymentInfo(1250.50, date(2023, 8, 15))
        doc = EOBDocument(
            eob_number="EOB-001",
            claim_number="CLM-001",
            patient_id="patient-001",
            tcia_patient_id="TCIA-001",
            status=ClaimStatus.APPROVED,
            payment_info=payment,
            denial_reason=None,
            pdf_bytes=b"fake eob pdf",
            filename="eob_001.pdf"
        )
        
        assert doc.eob_number == "EOB-001"
        assert doc.status == ClaimStatus.APPROVED
        assert doc.payment_info == payment
        assert doc.denial_reason is None
    
    def test_eob_denied_initialization(self):
        """Test EOBDocument for denied claim with denial reason."""
        doc = EOBDocument(
            eob_number="EOB-002",
            claim_number="CLM-002",
            patient_id="patient-002",
            tcia_patient_id="TCIA-002",
            status=ClaimStatus.DENIED,
            payment_info=None,
            denial_reason="Prior authorization required",
            pdf_bytes=b"fake eob pdf",
            filename="eob_002.pdf"
        )
        
        assert doc.status == ClaimStatus.DENIED
        assert doc.payment_info is None
        assert doc.denial_reason == "Prior authorization required"
    
    def test_eob_pending_initialization(self):
        """Test EOBDocument for pending claim."""
        doc = EOBDocument(
            eob_number="EOB-003",
            claim_number="CLM-003",
            patient_id="patient-003",
            tcia_patient_id="TCIA-003",
            status=ClaimStatus.PENDING,
            payment_info=None,
            denial_reason=None,
            pdf_bytes=b"fake eob pdf",
            filename="eob_003.pdf"
        )
        
        assert doc.status == ClaimStatus.PENDING
        assert doc.payment_info is None
        assert doc.denial_reason is None


class TestRadiologyReport:
    """Tests for RadiologyReport dataclass."""
    
    def test_radiology_report_initialization(self):
        """Test RadiologyReport can be initialized with all fields."""
        report = RadiologyReport(
            report_id="RAD-001",
            patient_id="patient-001",
            tcia_patient_id="TCIA-001",
            study_uid="1.2.840.113654.2.55.123456789",
            modality="CT",
            anatomical_region="Chest",
            findings="Mass in right upper lobe measuring 3.2 cm",
            radiologist="Dr. Johnson",
            report_date=date(2023, 7, 22),
            pdf_bytes=b"fake radiology report pdf",
            filename="radiology_report_001.pdf"
        )
        
        assert report.report_id == "RAD-001"
        assert report.patient_id == "patient-001"
        assert report.tcia_patient_id == "TCIA-001"
        assert report.study_uid == "1.2.840.113654.2.55.123456789"
        assert report.modality == "CT"
        assert report.anatomical_region == "Chest"
        assert report.findings == "Mass in right upper lobe measuring 3.2 cm"
        assert report.radiologist == "Dr. Johnson"
        assert report.report_date == date(2023, 7, 22)


class TestClinicalNote:
    """Tests for ClinicalNote dataclass."""
    
    def test_clinical_note_initialization(self):
        """Test ClinicalNote can be initialized with all fields."""
        note = ClinicalNote(
            note_id="NOTE-001",
            patient_id="patient-001",
            tcia_patient_id="TCIA-001",
            encounter_id="enc-001",
            symptoms=["chest pain", "shortness of breath", "cough"],
            imaging_orders=["Chest CT with contrast"],
            treatment_plan="Refer to oncology for further evaluation",
            physician="Dr. Smith",
            note_date=date(2023, 7, 20),
            pdf_bytes=b"fake clinical note pdf",
            filename="note_001.pdf"
        )
        
        assert note.note_id == "NOTE-001"
        assert note.patient_id == "patient-001"
        assert note.tcia_patient_id == "TCIA-001"
        assert note.encounter_id == "enc-001"
        assert note.symptoms == ["chest pain", "shortness of breath", "cough"]
        assert note.imaging_orders == ["Chest CT with contrast"]
        assert note.treatment_plan == "Refer to oncology for further evaluation"
        assert note.physician == "Dr. Smith"
        assert note.note_date == date(2023, 7, 20)


class TestPatientMapping:
    """Tests for PatientMapping dataclass."""
    
    def test_patient_mapping_initialization(self):
        """Test PatientMapping can be initialized with all fields."""
        study1 = ImagingStudy(
            "1.2.840.113654.2.55.123456789",
            "TCIA-001",
            "CT",
            date(2023, 7, 21),
            "Chest CT",
            "Chest"
        )
        study2 = ImagingStudy(
            "1.2.840.113654.2.55.987654321",
            "TCIA-002",
            "CT",
            date(2023, 7, 22),
            "Abdomen CT",
            "Abdomen"
        )
        
        mapping = PatientMapping(
            patient_id_mapping={"patient-001": "TCIA-001", "patient-002": "TCIA-002"},
            encounter_study_mapping={"enc-001": [study1], "enc-002": [study2]}
        )
        
        assert len(mapping.patient_id_mapping) == 2
        assert mapping.patient_id_mapping["patient-001"] == "TCIA-001"
        assert len(mapping.encounter_study_mapping) == 2
        assert len(mapping.encounter_study_mapping["enc-001"]) == 1
    
    def test_patient_mapping_to_json(self):
        """Test PatientMapping.to_json() serialization."""
        study = ImagingStudy(
            "1.2.840.113654.2.55.123456789",
            "TCIA-001",
            "CT",
            date(2023, 7, 21),
            "Chest CT",
            "Chest"
        )
        
        mapping = PatientMapping(
            patient_id_mapping={"patient-001": "TCIA-001"},
            encounter_study_mapping={"enc-001": [study]}
        )
        
        json_data = mapping.to_json()
        
        assert "patient_mappings" in json_data
        assert "encounter_study_mappings" in json_data
        assert len(json_data["patient_mappings"]) == 1
        assert json_data["patient_mappings"][0]["synthea_id"] == "patient-001"
        assert json_data["patient_mappings"][0]["tcia_id"] == "TCIA-001"
        assert "enc-001" in json_data["encounter_study_mappings"]
        assert len(json_data["encounter_study_mappings"]["enc-001"]) == 1
        assert json_data["encounter_study_mappings"]["enc-001"][0]["study_uid"] == "1.2.840.113654.2.55.123456789"
        assert json_data["encounter_study_mappings"]["enc-001"][0]["modality"] == "CT"
        assert json_data["encounter_study_mappings"]["enc-001"][0]["study_date"] == "2023-07-21"


class TestDocumentSet:
    """Tests for DocumentSet dataclass."""
    
    def test_document_set_initialization(self):
        """Test DocumentSet can be initialized with all document types."""
        cms1500 = CMS1500Document(
            "CLM-001", "patient-001", "TCIA-001", "enc-001",
            "1.2.840.113654.2.55.123456789", "71250", ["C34.90"],
            b"pdf", "cms1500_001.pdf"
        )
        eob = EOBDocument(
            "EOB-001", "CLM-001", "patient-001", "TCIA-001",
            ClaimStatus.APPROVED, PaymentInfo(1250.50, date(2023, 8, 15)),
            None, b"pdf", "eob_001.pdf"
        )
        rad_report = RadiologyReport(
            "RAD-001", "patient-001", "TCIA-001", "1.2.840.113654.2.55.123456789",
            "CT", "Chest", "findings", "Dr. Johnson", date(2023, 7, 22),
            b"pdf", "radiology_report_001.pdf"
        )
        clinical_note = ClinicalNote(
            "NOTE-001", "patient-001", "TCIA-001", "enc-001",
            ["chest pain"], ["Chest CT"], "treatment plan", "Dr. Smith",
            date(2023, 7, 20), b"pdf", "note_001.pdf"
        )
        
        doc_set = DocumentSet(
            cms1500_forms=[cms1500],
            eob_documents=[eob],
            radiology_reports=[rad_report],
            clinical_notes=[clinical_note]
        )
        
        assert len(doc_set.cms1500_forms) == 1
        assert len(doc_set.eob_documents) == 1
        assert len(doc_set.radiology_reports) == 1
        assert len(doc_set.clinical_notes) == 1


class TestValidationResult:
    """Tests for ValidationResult dataclass."""
    
    def test_validation_result_success(self):
        """Test ValidationResult for successful validation."""
        result = ValidationResult(success=True, errors=[], warnings=[])
        
        assert result.success is True
        assert len(result.errors) == 0
        assert len(result.warnings) == 0
    
    def test_validation_result_with_errors(self):
        """Test ValidationResult with errors."""
        result = ValidationResult(
            success=False,
            errors=["Missing CMS-1500 form", "Invalid patient count"],
            warnings=["Missing optional field"]
        )
        
        assert result.success is False
        assert len(result.errors) == 2
        assert len(result.warnings) == 1
    
    def test_validation_result_to_report_success(self):
        """Test ValidationResult.to_report() for successful validation."""
        result = ValidationResult(success=True, errors=[], warnings=[])
        report = result.to_report()
        
        assert "✓ Validation PASSED" in report
        assert "Errors:" not in report
        assert "Warnings:" not in report
    
    def test_validation_result_to_report_with_errors(self):
        """Test ValidationResult.to_report() with errors and warnings."""
        result = ValidationResult(
            success=False,
            errors=["Missing CMS-1500 form", "Invalid patient count"],
            warnings=["Missing optional field"]
        )
        report = result.to_report()
        
        assert "✗ Validation FAILED" in report
        assert "Errors:" in report
        assert "Missing CMS-1500 form" in report
        assert "Invalid patient count" in report
        assert "Warnings:" in report
        assert "Missing optional field" in report


class TestStatistics:
    """Tests for Statistics dataclass."""
    
    def test_statistics_initialization(self):
        """Test Statistics can be initialized with all fields."""
        stats = Statistics(
            total_patients=25,
            patients_by_cancer_type={"lung_cancer": 15, "colorectal_cancer": 10},
            total_claims=30,
            claims_by_status={"approved": 18, "denied": 6, "pending": 6},
            documents_by_type={"cms1500": 30, "eob": 30, "radiology": 30, "clinical": 25},
            tcia_patient_ids=["TCIA-001", "TCIA-002", "TCIA-003"],
            random_seed=42,
            generation_timestamp="2023-08-01T10:30:00"
        )
        
        assert stats.total_patients == 25
        assert stats.patients_by_cancer_type["lung_cancer"] == 15
        assert stats.total_claims == 30
        assert stats.claims_by_status["approved"] == 18
        assert stats.random_seed == 42
        assert len(stats.tcia_patient_ids) == 3
    
    def test_statistics_to_json(self):
        """Test Statistics.to_json() serialization."""
        stats = Statistics(
            total_patients=25,
            patients_by_cancer_type={"lung_cancer": 15, "colorectal_cancer": 10},
            total_claims=30,
            claims_by_status={"approved": 18, "denied": 6, "pending": 6},
            documents_by_type={"cms1500": 30, "eob": 30, "radiology": 30, "clinical": 25},
            tcia_patient_ids=["TCIA-001", "TCIA-002"],
            random_seed=42,
            generation_timestamp="2023-08-01T10:30:00"
        )
        
        json_data = stats.to_json()
        
        assert json_data["total_patients"] == 25
        assert json_data["patients_by_cancer_type"]["lung_cancer"] == 15
        assert json_data["total_claims"] == 30
        assert json_data["claims_by_status"]["approved"] == 18
        assert json_data["random_seed"] == 42
        assert json_data["generation_timestamp"] == "2023-08-01T10:30:00"
        assert len(json_data["tcia_patient_ids"]) == 2


class TestGenerationResult:
    """Tests for GenerationResult dataclass."""
    
    def test_generation_result_initialization(self):
        """Test GenerationResult can be initialized with all fields."""
        stats = Statistics(
            25, {"lung_cancer": 15}, 30, {"approved": 18}, {"cms1500": 30},
            ["TCIA-001"], 42, "2023-08-01T10:30:00"
        )
        validation = ValidationResult(success=True, errors=[], warnings=[])
        
        result = GenerationResult(
            success=True,
            statistics=stats,
            validation_result=validation,
            output_directory=Path("/output/medical_data")
        )
        
        assert result.success is True
        assert result.statistics == stats
        assert result.validation_result == validation
        assert result.output_directory == Path("/output/medical_data")


class TestGenerationConfig:
    """Tests for GenerationConfig dataclass."""
    
    def test_generation_config_valid(self):
        """Test GenerationConfig with valid parameters."""
        config = GenerationConfig(
            output_dir=Path("/output"),
            tcia_metadata_path=Path("/data/tcia.csv"),
            patient_count=25,
            seed=42,
            synthea_path=Path("/synthea")
        )
        
        assert config.output_dir == Path("/output")
        assert config.tcia_metadata_path == Path("/data/tcia.csv")
        assert config.patient_count == 25
        assert config.seed == 42
        assert config.synthea_path == Path("/synthea")
        assert config.cpt_code_min == 71250
        assert config.cpt_code_max == 71275
        assert config.approved_percentage == 0.6
        assert config.denied_percentage == 0.2
        assert config.pending_percentage == 0.2
        assert config.cancer_types == ["lung_cancer", "colorectal_cancer"]
    
    def test_generation_config_patient_count_min_boundary(self):
        """Test GenerationConfig with minimum patient count (20)."""
        config = GenerationConfig(
            output_dir=Path("/output"),
            tcia_metadata_path=Path("/data/tcia.csv"),
            patient_count=20
        )
        
        assert config.patient_count == 20
    
    def test_generation_config_patient_count_max_boundary(self):
        """Test GenerationConfig with maximum patient count (30)."""
        config = GenerationConfig(
            output_dir=Path("/output"),
            tcia_metadata_path=Path("/data/tcia.csv"),
            patient_count=30
        )
        
        assert config.patient_count == 30
    
    def test_generation_config_patient_count_too_low(self):
        """Test GenerationConfig raises error when patient count is below 20."""
        with pytest.raises(ValueError, match="patient_count must be between 20 and 30"):
            GenerationConfig(
                output_dir=Path("/output"),
                tcia_metadata_path=Path("/data/tcia.csv"),
                patient_count=19
            )
    
    def test_generation_config_patient_count_too_high(self):
        """Test GenerationConfig raises error when patient count is above 30."""
        with pytest.raises(ValueError, match="patient_count must be between 20 and 30"):
            GenerationConfig(
                output_dir=Path("/output"),
                tcia_metadata_path=Path("/data/tcia.csv"),
                patient_count=31
            )
    
    def test_generation_config_status_percentages_valid(self):
        """Test GenerationConfig with valid status percentages that sum to 1.0."""
        config = GenerationConfig(
            output_dir=Path("/output"),
            tcia_metadata_path=Path("/data/tcia.csv"),
            patient_count=25,
            approved_percentage=0.5,
            denied_percentage=0.3,
            pending_percentage=0.2
        )
        
        assert config.approved_percentage == 0.5
        assert config.denied_percentage == 0.3
        assert config.pending_percentage == 0.2
    
    def test_generation_config_status_percentages_invalid_sum(self):
        """Test GenerationConfig raises error when status percentages don't sum to 1.0."""
        with pytest.raises(ValueError, match="Status percentages must sum to 1.0"):
            GenerationConfig(
                output_dir=Path("/output"),
                tcia_metadata_path=Path("/data/tcia.csv"),
                patient_count=25,
                approved_percentage=0.5,
                denied_percentage=0.3,
                pending_percentage=0.3  # Sum = 1.1
            )
    
    def test_generation_config_default_cancer_types(self):
        """Test GenerationConfig uses default cancer types when not specified."""
        config = GenerationConfig(
            output_dir=Path("/output"),
            tcia_metadata_path=Path("/data/tcia.csv"),
            patient_count=25
        )
        
        assert config.cancer_types == ["lung_cancer", "colorectal_cancer"]
    
    def test_generation_config_custom_cancer_types(self):
        """Test GenerationConfig with custom cancer types."""
        config = GenerationConfig(
            output_dir=Path("/output"),
            tcia_metadata_path=Path("/data/tcia.csv"),
            patient_count=25,
            cancer_types=["breast_cancer", "prostate_cancer"]
        )
        
        assert config.cancer_types == ["breast_cancer", "prostate_cancer"]
    
    def test_generation_config_optional_seed(self):
        """Test GenerationConfig with optional seed as None."""
        config = GenerationConfig(
            output_dir=Path("/output"),
            tcia_metadata_path=Path("/data/tcia.csv"),
            patient_count=25,
            seed=None
        )
        
        assert config.seed is None
