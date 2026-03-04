"""
Integration tests for GenerationOrchestrator

Tests the complete end-to-end workflow with mocked external dependencies.
"""

import json
import pytest
from pathlib import Path
from datetime import date, datetime
from unittest.mock import Mock, patch, MagicMock
import pandas as pd

from medical_claims_generator.orchestrator import GenerationOrchestrator
from medical_claims_generator.models import (
    GenerationConfig,
    GenerationResult,
    Patient,
    Address,
    Insurance,
    Encounter,
    Condition,
    PatientMapping,
    ImagingStudy,
    DocumentSet,
    CMS1500Document,
    EOBDocument,
    RadiologyReport,
    ClinicalNote,
    ClaimStatus,
    ValidationResult,
    Statistics
)


# Sample test data fixtures
@pytest.fixture
def sample_patients():
    """Create sample patients for testing."""
    patients = []
    for i in range(1, 4):  # 3 patients for fast tests
        patient = Patient(
            id=f"patient-{i}",
            name=f"Test Patient {i}",
            birth_date=date(1960 + i, 1, 1),
            gender="male" if i % 2 == 0 else "female",
            address=Address(
                line1=f"{i}00 Main St",
                line2=None,
                city="Boston",
                state="MA",
                postal_code="02101"
            ),
            insurance=Insurance(
                payer_name="Blue Cross",
                policy_number=f"POL-{i:03d}",
                group_number=None
            ),
            encounters=[
                Encounter(
                    id=f"encounter-{i}-1",
                    date=date(2023, 6, i),
                    type="outpatient",
                    provider=f"Dr. Smith {i}",
                    reason=["Cancer screening"]
                )
            ],
            conditions=[
                Condition(
                    code="C34.90" if i % 2 == 0 else "C18.9",
                    display="Lung cancer" if i % 2 == 0 else "Colorectal cancer",
                    onset_date=date(2023, 5, i),
                    category="lung_cancer" if i % 2 == 0 else "colorectal_cancer"
                )
            ]
        )
        patients.append(patient)
    return patients


@pytest.fixture
def sample_tcia_metadata():
    """Create sample TCIA metadata DataFrame."""
    data = {
        'Patient ID': [f'TCIA-{i:03d}' for i in range(1, 6)],
        'Study UID': [f'1.2.3.{i}' for i in range(1, 6)],
        'Modality': ['CT'] * 5,
        'Study Date': ['2023-06-01', '2023-06-02', '2023-06-03', '2023-06-04', '2023-06-05'],
        'Series Description': ['Chest CT'] * 5,
        'Body Part Examined': ['CHEST'] * 5
    }
    return pd.DataFrame(data)


@pytest.fixture
def sample_mapping(sample_patients):
    """Create sample patient mapping."""
    patient_id_mapping = {
        patient.id: f"TCIA-{i:03d}"
        for i, patient in enumerate(sample_patients, 1)
    }
    
    encounter_study_mapping = {}
    for i, patient in enumerate(sample_patients, 1):
        for encounter in patient.encounters:
            encounter_study_mapping[encounter.id] = [
                ImagingStudy(
                    study_uid=f"1.2.3.{i}",
                    tcia_patient_id=f"TCIA-{i:03d}",
                    modality="CT",
                    study_date=date(2023, 6, i),
                    series_description="Chest CT",
                    anatomical_region="CHEST"
                )
            ]
    
    return PatientMapping(
        patient_id_mapping=patient_id_mapping,
        encounter_study_mapping=encounter_study_mapping
    )


@pytest.fixture
def sample_documents(sample_patients, sample_mapping):
    """Create sample document set."""
    cms1500_forms = []
    eob_documents = []
    radiology_reports = []
    clinical_notes = []
    
    for i, patient in enumerate(sample_patients, 1):
        tcia_id = sample_mapping.patient_id_mapping[patient.id]
        
        # CMS-1500 form
        cms1500 = CMS1500Document(
            claim_number=f"CLM-{i:06d}",
            patient_id=patient.id,
            tcia_patient_id=tcia_id,
            encounter_id=patient.encounters[0].id,
            study_uid=f"1.2.3.{i}",
            procedure_code="71250",
            diagnosis_codes=["C34.90"],
            pdf_bytes=b"fake pdf content",
            filename=f"cms1500_{i:03d}.pdf"
        )
        cms1500_forms.append(cms1500)
        
        # EOB document
        eob = EOBDocument(
            eob_number=f"EOB-{i:06d}",
            claim_number=cms1500.claim_number,
            patient_id=patient.id,
            tcia_patient_id=tcia_id,
            status=ClaimStatus.APPROVED,
            payment_info=None,
            denial_reason=None,
            pdf_bytes=b"fake pdf content",
            filename=f"eob_{i:03d}.pdf"
        )
        eob_documents.append(eob)
        
        # Radiology report
        report = RadiologyReport(
            report_id=f"RAD-{i:06d}",
            patient_id=patient.id,
            tcia_patient_id=tcia_id,
            study_uid=f"1.2.3.{i}",
            modality="CT",
            anatomical_region="CHEST",
            findings="Test findings",
            radiologist="Dr. Radiologist",
            report_date=date(2023, 6, i),
            pdf_bytes=b"fake pdf content",
            filename=f"radiology_report_{i:03d}.pdf"
        )
        radiology_reports.append(report)
        
        # Clinical note
        note = ClinicalNote(
            note_id=f"NOTE-{i:06d}",
            patient_id=patient.id,
            tcia_patient_id=tcia_id,
            encounter_id=patient.encounters[0].id,
            symptoms=["Cough"],
            imaging_orders=["CT Chest"],
            treatment_plan="Follow-up in 3 months",
            physician="Dr. Physician",
            note_date=date(2023, 6, i),
            pdf_bytes=b"fake pdf content",
            filename=f"note_{i:03d}.pdf"
        )
        clinical_notes.append(note)
    
    return DocumentSet(
        cms1500_forms=cms1500_forms,
        eob_documents=eob_documents,
        radiology_reports=radiology_reports,
        clinical_notes=clinical_notes
    )


class TestGenerationOrchestratorInitialization:
    """Tests for GenerationOrchestrator initialization."""
    
    def test_initialization(self, tmp_path):
        """Test orchestrator initializes correctly."""
        config = GenerationConfig(
            output_dir=tmp_path / "output",
            tcia_metadata_path=tmp_path / "tcia.csv",
            patient_count=25,
            seed=42,
            synthea_path=tmp_path / "synthea"
        )
        
        orchestrator = GenerationOrchestrator(config)
        
        assert orchestrator.config == config
        assert orchestrator.actual_seed is None
        assert isinstance(orchestrator.generation_start_time, datetime)


class TestCompleteWorkflow:
    """Integration tests for complete generation workflow."""
    
    @patch('medical_claims_generator.orchestrator.PatientGenerator')
    @patch('medical_claims_generator.orchestrator.PatientMapper')
    @patch('medical_claims_generator.orchestrator.DocumentGenerator')
    @patch('medical_claims_generator.orchestrator.OutputOrganizer')
    @patch('medical_claims_generator.orchestrator.DataValidator')
    @patch('medical_claims_generator.orchestrator.StatisticsGenerator')
    def test_complete_workflow_success(
        self,
        mock_stats_gen_class,
        mock_validator_class,
        mock_organizer_class,
        mock_doc_gen_class,
        mock_mapper_class,
        mock_patient_gen_class,
        tmp_path,
        sample_patients,
        sample_tcia_metadata,
        sample_mapping,
        sample_documents
    ):
        """Test complete workflow with all components mocked."""
        # Setup config
        tcia_csv = tmp_path / "tcia.csv"
        sample_tcia_metadata.to_csv(tcia_csv, index=False)
        
        config = GenerationConfig(
            output_dir=tmp_path / "output",
            tcia_metadata_path=tcia_csv,
            patient_count=20,
            seed=42,
            synthea_path=tmp_path / "synthea"
        )
        
        # Mock PatientGenerator
        mock_patient_gen = MagicMock()
        mock_patient_gen.generate_patients.return_value = sample_patients
        mock_patient_gen_class.return_value = mock_patient_gen
        
        # Mock PatientMapper
        mock_mapper = MagicMock()
        mock_mapper.map_patients.return_value = sample_mapping
        mock_mapper_class.return_value = mock_mapper
        
        # Mock DocumentGenerator
        mock_doc_gen = MagicMock()
        mock_doc_gen.generate_all_documents.return_value = sample_documents
        mock_doc_gen_class.return_value = mock_doc_gen
        
        # Mock OutputOrganizer
        mock_organizer = MagicMock()
        mock_organizer_class.return_value = mock_organizer
        
        # Mock DataValidator
        mock_validator = MagicMock()
        mock_validation_result = ValidationResult(
            success=True,
            errors=[],
            warnings=[]
        )
        mock_validator.validate.return_value = mock_validation_result
        mock_validator_class.return_value = mock_validator
        
        # Mock StatisticsGenerator
        mock_stats_gen = MagicMock()
        mock_statistics = Statistics(
            total_patients=20,
            patients_by_cancer_type={"lung_cancer": 1, "colorectal_cancer": 2},
            total_claims=20,
            claims_by_status={"approved": 20},
            documents_by_type={"cms1500": 20, "eob": 20, "radiology": 20, "clinical_note": 20},
            tcia_patient_ids=["TCIA-001", "TCIA-002", "TCIA-003"],
            random_seed=42,
            generation_timestamp=datetime.now().isoformat()
        )
        mock_stats_gen.generate.return_value = mock_statistics
        mock_stats_gen_class.return_value = mock_stats_gen
        
        # Execute
        orchestrator = GenerationOrchestrator(config)
        result = orchestrator.generate()
        
        # Verify result
        assert isinstance(result, GenerationResult)
        assert result.success is True
        assert result.statistics.total_patients == 20
        assert result.validation_result.success is True
        assert result.output_directory == config.output_dir
        
        # Verify all components were called
        mock_patient_gen.generate_patients.assert_called_once()
        mock_mapper.map_patients.assert_called_once()
        mock_doc_gen.generate_all_documents.assert_called_once()
        mock_organizer.organize.assert_called_once()
        mock_validator.validate.assert_called_once()
        mock_stats_gen.generate.assert_called_once()
        
        # Verify statistics.json was written
        stats_file = config.output_dir / "statistics.json"
        assert stats_file.exists()
        with open(stats_file) as f:
            stats_data = json.load(f)
            assert stats_data["total_patients"] == 20


    @patch('medical_claims_generator.orchestrator.PatientGenerator')
    def test_workflow_synthea_failure(
        self,
        mock_patient_gen_class,
        tmp_path
    ):
        """Test error handling when Synthea execution fails."""
        # Setup config
        tcia_csv = tmp_path / "tcia.csv"
        tcia_csv.write_text("Patient ID,Study UID,Modality\nTCIA-001,1.2.3,CT\n")
        
        config = GenerationConfig(
            output_dir=tmp_path / "output",
            tcia_metadata_path=tcia_csv,
            patient_count=20,
            seed=42,
            synthea_path=tmp_path / "synthea"
        )
        
        # Mock PatientGenerator to raise error
        mock_patient_gen = MagicMock()
        mock_patient_gen.generate_patients.side_effect = RuntimeError("Synthea execution failed")
        mock_patient_gen_class.return_value = mock_patient_gen
        
        # Execute
        orchestrator = GenerationOrchestrator(config)
        result = orchestrator.generate()
        
        # Verify failure result
        assert result.success is False
        assert len(result.validation_result.errors) > 0
        assert "Synthea execution failed" in result.validation_result.errors[0]
        assert result.statistics.total_patients == 0


class TestErrorHandling:
    """Tests for error handling in various scenarios."""
    
    def test_missing_tcia_metadata_file(self, tmp_path):
        """Test error handling when TCIA metadata file doesn't exist."""
        # Create synthea directory so that error is about TCIA file
        synthea_path = tmp_path / "synthea"
        synthea_path.mkdir()
        
        config = GenerationConfig(
            output_dir=tmp_path / "output",
            tcia_metadata_path=tmp_path / "nonexistent.csv",
            patient_count=20,
            seed=42,
            synthea_path=synthea_path
        )
        
        orchestrator = GenerationOrchestrator(config)
        result = orchestrator.generate()
        
        # Verify failure
        assert result.success is False
        # Error could be about TCIA file not found or Synthea path
        assert len(result.validation_result.errors) > 0
    
    @patch('medical_claims_generator.orchestrator.PatientGenerator')
    def test_invalid_tcia_metadata_csv(
        self,
        mock_patient_gen_class,
        tmp_path,
        sample_patients
    ):
        """Test error handling when TCIA metadata CSV is invalid."""
        # Create invalid CSV
        tcia_csv = tmp_path / "tcia.csv"
        tcia_csv.write_text("invalid,csv,format\n")
        
        config = GenerationConfig(
            output_dir=tmp_path / "output",
            tcia_metadata_path=tcia_csv,
            patient_count=20,
            seed=42,
            synthea_path=tmp_path / "synthea"
        )
        
        # Mock PatientGenerator
        mock_patient_gen = MagicMock()
        mock_patient_gen.generate_patients.return_value = sample_patients
        mock_patient_gen_class.return_value = mock_patient_gen
        
        # Execute
        orchestrator = GenerationOrchestrator(config)
        result = orchestrator.generate()
        
        # Verify failure (will fail during mapping due to missing required columns)
        assert result.success is False
    
    @patch('medical_claims_generator.orchestrator.PatientGenerator')
    def test_empty_tcia_metadata(
        self,
        mock_patient_gen_class,
        tmp_path,
        sample_patients
    ):
        """Test error handling when TCIA metadata is empty."""
        # Create empty CSV with headers only
        tcia_csv = tmp_path / "tcia.csv"
        tcia_csv.write_text("Patient ID,Study UID,Modality\n")
        
        config = GenerationConfig(
            output_dir=tmp_path / "output",
            tcia_metadata_path=tcia_csv,
            patient_count=20,
            seed=42,
            synthea_path=tmp_path / "synthea"
        )
        
        # Mock PatientGenerator
        mock_patient_gen = MagicMock()
        mock_patient_gen.generate_patients.return_value = sample_patients
        mock_patient_gen_class.return_value = mock_patient_gen
        
        # Execute
        orchestrator = GenerationOrchestrator(config)
        result = orchestrator.generate()
        
        # Verify failure
        assert result.success is False
        assert any("empty" in error.lower() for error in result.validation_result.errors)


class TestReproducibility:
    """Tests for reproducibility with same seed."""
    
    @patch('medical_claims_generator.orchestrator.PatientGenerator')
    @patch('medical_claims_generator.orchestrator.PatientMapper')
    @patch('medical_claims_generator.orchestrator.DocumentGenerator')
    @patch('medical_claims_generator.orchestrator.OutputOrganizer')
    @patch('medical_claims_generator.orchestrator.DataValidator')
    @patch('medical_claims_generator.orchestrator.StatisticsGenerator')
    def test_same_seed_produces_same_results(
        self,
        mock_stats_gen_class,
        mock_validator_class,
        mock_organizer_class,
        mock_doc_gen_class,
        mock_mapper_class,
        mock_patient_gen_class,
        tmp_path,
        sample_patients,
        sample_tcia_metadata,
        sample_mapping,
        sample_documents
    ):
        """Test that using the same seed produces reproducible results."""
        # Setup config with seed
        tcia_csv = tmp_path / "tcia.csv"
        sample_tcia_metadata.to_csv(tcia_csv, index=False)
        
        seed = 12345
        
        # Setup mocks
        def setup_mocks():
            mock_patient_gen = MagicMock()
            mock_patient_gen.generate_patients.return_value = sample_patients
            mock_patient_gen_class.return_value = mock_patient_gen
            
            mock_mapper = MagicMock()
            mock_mapper.map_patients.return_value = sample_mapping
            mock_mapper_class.return_value = mock_mapper
            
            mock_doc_gen = MagicMock()
            mock_doc_gen.generate_all_documents.return_value = sample_documents
            mock_doc_gen_class.return_value = mock_doc_gen
            
            mock_organizer = MagicMock()
            mock_organizer_class.return_value = mock_organizer
            
            mock_validator = MagicMock()
            mock_validator.validate.return_value = ValidationResult(True, [], [])
            mock_validator_class.return_value = mock_validator
            
            mock_stats_gen = MagicMock()
            mock_stats_gen.generate.return_value = Statistics(
                total_patients=20,
                patients_by_cancer_type={},
                total_claims=20,
                claims_by_status={},
                documents_by_type={},
                tcia_patient_ids=["TCIA-001", "TCIA-002", "TCIA-003"],
                random_seed=seed,
                generation_timestamp=datetime.now().isoformat()
            )
            mock_stats_gen_class.return_value = mock_stats_gen
        
        # First run
        setup_mocks()
        config1 = GenerationConfig(
            output_dir=tmp_path / "output1",
            tcia_metadata_path=tcia_csv,
            patient_count=20,
            seed=seed,
            synthea_path=tmp_path / "synthea"
        )
        orchestrator1 = GenerationOrchestrator(config1)
        result1 = orchestrator1.generate()
        
        # Second run with same seed
        setup_mocks()
        config2 = GenerationConfig(
            output_dir=tmp_path / "output2",
            tcia_metadata_path=tcia_csv,
            patient_count=20,
            seed=seed,
            synthea_path=tmp_path / "synthea"
        )
        orchestrator2 = GenerationOrchestrator(config2)
        result2 = orchestrator2.generate()
        
        # Verify both runs succeeded
        assert result1.success is True
        assert result2.success is True
        
        # Verify same seed was used
        assert result1.statistics.random_seed == seed
        assert result2.statistics.random_seed == seed
        
        # Verify PatientGenerator was initialized with same seed both times
        calls = mock_patient_gen_class.call_args_list
        assert len(calls) == 2
        assert calls[0][1]['seed'] == seed
        assert calls[1][1]['seed'] == seed
    
    @patch('medical_claims_generator.orchestrator.PatientGenerator')
    @patch('medical_claims_generator.orchestrator.PatientMapper')
    @patch('medical_claims_generator.orchestrator.DocumentGenerator')
    @patch('medical_claims_generator.orchestrator.OutputOrganizer')
    @patch('medical_claims_generator.orchestrator.DataValidator')
    @patch('medical_claims_generator.orchestrator.StatisticsGenerator')
    def test_no_seed_generates_random_seed(
        self,
        mock_stats_gen_class,
        mock_validator_class,
        mock_organizer_class,
        mock_doc_gen_class,
        mock_mapper_class,
        mock_patient_gen_class,
        tmp_path,
        sample_patients,
        sample_tcia_metadata,
        sample_mapping,
        sample_documents
    ):
        """Test that not providing a seed generates a random seed."""
        # Setup config without seed
        tcia_csv = tmp_path / "tcia.csv"
        sample_tcia_metadata.to_csv(tcia_csv, index=False)
        
        config = GenerationConfig(
            output_dir=tmp_path / "output",
            tcia_metadata_path=tcia_csv,
            patient_count=20,
            seed=None,  # No seed provided
            synthea_path=tmp_path / "synthea"
        )
        
        # Setup mocks
        mock_patient_gen = MagicMock()
        mock_patient_gen.generate_patients.return_value = sample_patients
        mock_patient_gen_class.return_value = mock_patient_gen
        
        mock_mapper = MagicMock()
        mock_mapper.map_patients.return_value = sample_mapping
        mock_mapper_class.return_value = mock_mapper
        
        mock_doc_gen = MagicMock()
        mock_doc_gen.generate_all_documents.return_value = sample_documents
        mock_doc_gen_class.return_value = mock_doc_gen
        
        mock_organizer = MagicMock()
        mock_organizer_class.return_value = mock_organizer
        
        mock_validator = MagicMock()
        mock_validator.validate.return_value = ValidationResult(True, [], [])
        mock_validator_class.return_value = mock_validator
        
        mock_stats_gen = MagicMock()
        mock_stats_gen.generate.return_value = Statistics(
            total_patients=20,
            patients_by_cancer_type={},
            total_claims=20,
            claims_by_status={},
            documents_by_type={},
            tcia_patient_ids=["TCIA-001", "TCIA-002", "TCIA-003"],
            random_seed=0,  # Will be overwritten
            generation_timestamp=datetime.now().isoformat()
        )
        mock_stats_gen_class.return_value = mock_stats_gen
        
        # Execute
        orchestrator = GenerationOrchestrator(config)
        result = orchestrator.generate()
        
        # Verify a seed was generated
        assert result.success is True
        assert orchestrator.actual_seed is not None
        assert isinstance(orchestrator.actual_seed, int)
        assert orchestrator.actual_seed > 0


class TestOutputValidation:
    """Tests for output validation and file creation."""
    
    @patch('medical_claims_generator.orchestrator.PatientGenerator')
    @patch('medical_claims_generator.orchestrator.PatientMapper')
    @patch('medical_claims_generator.orchestrator.DocumentGenerator')
    @patch('medical_claims_generator.orchestrator.OutputOrganizer')
    @patch('medical_claims_generator.orchestrator.DataValidator')
    @patch('medical_claims_generator.orchestrator.StatisticsGenerator')
    def test_statistics_file_created(
        self,
        mock_stats_gen_class,
        mock_validator_class,
        mock_organizer_class,
        mock_doc_gen_class,
        mock_mapper_class,
        mock_patient_gen_class,
        tmp_path,
        sample_patients,
        sample_tcia_metadata,
        sample_mapping,
        sample_documents
    ):
        """Test that statistics.json is created in output directory."""
        # Setup
        tcia_csv = tmp_path / "tcia.csv"
        sample_tcia_metadata.to_csv(tcia_csv, index=False)
        
        config = GenerationConfig(
            output_dir=tmp_path / "output",
            tcia_metadata_path=tcia_csv,
            patient_count=20,
            seed=42,
            synthea_path=tmp_path / "synthea"
        )
        
        # Setup mocks
        mock_patient_gen = MagicMock()
        mock_patient_gen.generate_patients.return_value = sample_patients
        mock_patient_gen_class.return_value = mock_patient_gen
        
        mock_mapper = MagicMock()
        mock_mapper.map_patients.return_value = sample_mapping
        mock_mapper_class.return_value = mock_mapper
        
        mock_doc_gen = MagicMock()
        mock_doc_gen.generate_all_documents.return_value = sample_documents
        mock_doc_gen_class.return_value = mock_doc_gen
        
        mock_organizer = MagicMock()
        mock_organizer_class.return_value = mock_organizer
        
        mock_validator = MagicMock()
        mock_validator.validate.return_value = ValidationResult(True, [], [])
        mock_validator_class.return_value = mock_validator
        
        mock_stats_gen = MagicMock()
        mock_statistics = Statistics(
            total_patients=20,
            patients_by_cancer_type={"lung_cancer": 1, "colorectal_cancer": 2},
            total_claims=20,
            claims_by_status={"approved": 2, "denied": 1},
            documents_by_type={"cms1500": 3, "eob": 3, "radiology": 3, "clinical_note": 3},
            tcia_patient_ids=["TCIA-001", "TCIA-002", "TCIA-003"],
            random_seed=42,
            generation_timestamp="2024-01-01T00:00:00"
        )
        mock_stats_gen.generate.return_value = mock_statistics
        mock_stats_gen_class.return_value = mock_stats_gen
        
        # Execute
        orchestrator = GenerationOrchestrator(config)
        result = orchestrator.generate()
        
        # Verify statistics file exists
        stats_file = config.output_dir / "statistics.json"
        assert stats_file.exists()
        
        # Verify statistics content
        with open(stats_file) as f:
            stats_data = json.load(f)
            assert stats_data["total_patients"] == 20
            assert stats_data["random_seed"] == 42
            assert "lung_cancer" in stats_data["patients_by_cancer_type"]
            assert "approved" in stats_data["claims_by_status"]
    
    @patch('medical_claims_generator.orchestrator.PatientGenerator')
    @patch('medical_claims_generator.orchestrator.PatientMapper')
    @patch('medical_claims_generator.orchestrator.DocumentGenerator')
    @patch('medical_claims_generator.orchestrator.OutputOrganizer')
    @patch('medical_claims_generator.orchestrator.DataValidator')
    @patch('medical_claims_generator.orchestrator.StatisticsGenerator')
    def test_validation_failure_returns_failure_result(
        self,
        mock_stats_gen_class,
        mock_validator_class,
        mock_organizer_class,
        mock_doc_gen_class,
        mock_mapper_class,
        mock_patient_gen_class,
        tmp_path,
        sample_patients,
        sample_tcia_metadata,
        sample_mapping,
        sample_documents
    ):
        """Test that validation failure is reflected in result."""
        # Setup
        tcia_csv = tmp_path / "tcia.csv"
        sample_tcia_metadata.to_csv(tcia_csv, index=False)
        
        config = GenerationConfig(
            output_dir=tmp_path / "output",
            tcia_metadata_path=tcia_csv,
            patient_count=20,
            seed=42,
            synthea_path=tmp_path / "synthea"
        )
        
        # Setup mocks
        mock_patient_gen = MagicMock()
        mock_patient_gen.generate_patients.return_value = sample_patients
        mock_patient_gen_class.return_value = mock_patient_gen
        
        mock_mapper = MagicMock()
        mock_mapper.map_patients.return_value = sample_mapping
        mock_mapper_class.return_value = mock_mapper
        
        mock_doc_gen = MagicMock()
        mock_doc_gen.generate_all_documents.return_value = sample_documents
        mock_doc_gen_class.return_value = mock_doc_gen
        
        mock_organizer = MagicMock()
        mock_organizer_class.return_value = mock_organizer
        
        # Mock validator to return failure
        mock_validator = MagicMock()
        mock_validation_result = ValidationResult(
            success=False,
            errors=["Missing required documents", "Patient count mismatch"],
            warnings=["Some warnings"]
        )
        mock_validator.validate.return_value = mock_validation_result
        mock_validator_class.return_value = mock_validator
        
        mock_stats_gen = MagicMock()
        mock_stats_gen.generate.return_value = Statistics(
            total_patients=20,
            patients_by_cancer_type={},
            total_claims=20,
            claims_by_status={},
            documents_by_type={},
            tcia_patient_ids=["TCIA-001", "TCIA-002", "TCIA-003"],
            random_seed=42,
            generation_timestamp=datetime.now().isoformat()
        )
        mock_stats_gen_class.return_value = mock_stats_gen
        
        # Execute
        orchestrator = GenerationOrchestrator(config)
        result = orchestrator.generate()
        
        # Verify failure result
        assert result.success is False
        assert result.validation_result.success is False
        assert len(result.validation_result.errors) == 2
        assert "Missing required documents" in result.validation_result.errors


class TestRandomSeedSetup:
    """Tests for random seed setup and usage."""
    
    def test_setup_random_seed_with_provided_seed(self, tmp_path):
        """Test that provided seed is used."""
        config = GenerationConfig(
            output_dir=tmp_path / "output",
            tcia_metadata_path=tmp_path / "tcia.csv",
            patient_count=25,
            seed=99999,
            synthea_path=tmp_path / "synthea"
        )
        
        orchestrator = GenerationOrchestrator(config)
        seed = orchestrator._setup_random_seed()
        
        assert seed == 99999
        # Note: actual_seed is set during generate(), not during _setup_random_seed()
    
    def test_setup_random_seed_without_provided_seed(self, tmp_path):
        """Test that random seed is generated when not provided."""
        config = GenerationConfig(
            output_dir=tmp_path / "output",
            tcia_metadata_path=tmp_path / "tcia.csv",
            patient_count=25,
            seed=None,
            synthea_path=tmp_path / "synthea"
        )
        
        orchestrator = GenerationOrchestrator(config)
        seed = orchestrator._setup_random_seed()
        
        assert seed is not None
        assert isinstance(seed, int)
        assert seed > 0
        assert seed < 2**31  # Within valid range


class TestComponentIntegration:
    """Tests for integration between orchestrator and components."""
    
    @patch('medical_claims_generator.orchestrator.PatientGenerator')
    def test_patient_generator_receives_correct_parameters(
        self,
        mock_patient_gen_class,
        tmp_path,
        sample_patients
    ):
        """Test that PatientGenerator is initialized with correct parameters."""
        tcia_csv = tmp_path / "tcia.csv"
        tcia_csv.write_text("Patient ID,Study UID,Modality\nTCIA-001,1.2.3,CT\n")
        
        synthea_path = tmp_path / "synthea"
        output_dir = tmp_path / "output"
        seed = 12345
        
        config = GenerationConfig(
            output_dir=output_dir,
            tcia_metadata_path=tcia_csv,
            patient_count=20,
            seed=seed,
            synthea_path=synthea_path
        )
        
        # Mock PatientGenerator
        mock_patient_gen = MagicMock()
        mock_patient_gen.generate_patients.side_effect = RuntimeError("Stop here")
        mock_patient_gen_class.return_value = mock_patient_gen
        
        # Execute (will fail but we just want to check initialization)
        orchestrator = GenerationOrchestrator(config)
        try:
            orchestrator.generate()
        except:
            pass
        
        # Verify PatientGenerator was initialized correctly
        mock_patient_gen_class.assert_called_once()
        call_kwargs = mock_patient_gen_class.call_args[1]
        assert call_kwargs['synthea_path'] == synthea_path
        assert call_kwargs['seed'] == seed
        # output_dir will be synthea_temp subdirectory
        assert 'synthea_temp' in str(call_kwargs['output_dir'])
    
    @patch('medical_claims_generator.orchestrator.PatientGenerator')
    @patch('medical_claims_generator.orchestrator.PatientMapper')
    def test_patient_mapper_receives_correct_parameters(
        self,
        mock_mapper_class,
        mock_patient_gen_class,
        tmp_path,
        sample_patients,
        sample_tcia_metadata
    ):
        """Test that PatientMapper is initialized with correct seed."""
        tcia_csv = tmp_path / "tcia.csv"
        sample_tcia_metadata.to_csv(tcia_csv, index=False)
        
        seed = 54321
        
        config = GenerationConfig(
            output_dir=tmp_path / "output",
            tcia_metadata_path=tcia_csv,
            patient_count=20,
            seed=seed,
            synthea_path=tmp_path / "synthea"
        )
        
        # Mock PatientGenerator
        mock_patient_gen = MagicMock()
        mock_patient_gen.generate_patients.return_value = sample_patients
        mock_patient_gen_class.return_value = mock_patient_gen
        
        # Mock PatientMapper
        mock_mapper = MagicMock()
        mock_mapper.map_patients.side_effect = RuntimeError("Stop here")
        mock_mapper_class.return_value = mock_mapper
        
        # Execute (will fail but we just want to check initialization)
        orchestrator = GenerationOrchestrator(config)
        try:
            orchestrator.generate()
        except:
            pass
        
        # Verify PatientMapper was initialized with correct seed
        mock_mapper_class.assert_called_once_with(seed=seed)
    
    @patch('medical_claims_generator.orchestrator.PatientGenerator')
    @patch('medical_claims_generator.orchestrator.PatientMapper')
    @patch('medical_claims_generator.orchestrator.DocumentGenerator')
    def test_document_generator_receives_correct_parameters(
        self,
        mock_doc_gen_class,
        mock_mapper_class,
        mock_patient_gen_class,
        tmp_path,
        sample_patients,
        sample_tcia_metadata,
        sample_mapping
    ):
        """Test that DocumentGenerator is initialized with correct seed."""
        tcia_csv = tmp_path / "tcia.csv"
        sample_tcia_metadata.to_csv(tcia_csv, index=False)
        
        seed = 11111
        
        config = GenerationConfig(
            output_dir=tmp_path / "output",
            tcia_metadata_path=tcia_csv,
            patient_count=20,
            seed=seed,
            synthea_path=tmp_path / "synthea"
        )
        
        # Mock PatientGenerator
        mock_patient_gen = MagicMock()
        mock_patient_gen.generate_patients.return_value = sample_patients
        mock_patient_gen_class.return_value = mock_patient_gen
        
        # Mock PatientMapper
        mock_mapper = MagicMock()
        mock_mapper.map_patients.return_value = sample_mapping
        mock_mapper_class.return_value = mock_mapper
        
        # Mock DocumentGenerator
        mock_doc_gen = MagicMock()
        mock_doc_gen.generate_all_documents.side_effect = RuntimeError("Stop here")
        mock_doc_gen_class.return_value = mock_doc_gen
        
        # Execute (will fail but we just want to check initialization)
        orchestrator = GenerationOrchestrator(config)
        try:
            orchestrator.generate()
        except:
            pass
        
        # Verify DocumentGenerator was initialized with correct seed
        mock_doc_gen_class.assert_called_once_with(seed=seed)






class TestS3Integration:
    """Tests for S3 upload integration."""
    
    @patch('medical_claims_generator.orchestrator.S3Uploader')
    @patch('medical_claims_generator.orchestrator.PatientGenerator')
    @patch('medical_claims_generator.orchestrator.PatientMapper')
    @patch('medical_claims_generator.orchestrator.DocumentGenerator')
    @patch('medical_claims_generator.orchestrator.OutputOrganizer')
    @patch('medical_claims_generator.orchestrator.DataValidator')
    @patch('medical_claims_generator.orchestrator.StatisticsGenerator')
    def test_s3_upload_success(
        self,
        mock_stats_gen_class,
        mock_validator_class,
        mock_organizer_class,
        mock_doc_gen_class,
        mock_mapper_class,
        mock_patient_gen_class,
        mock_s3_uploader_class,
        tmp_path,
        sample_patients,
        sample_tcia_metadata,
        sample_mapping,
        sample_documents
    ):
        """Test successful S3 upload after generation."""
        # Setup config with S3 bucket
        tcia_csv = tmp_path / "tcia.csv"
        sample_tcia_metadata.to_csv(tcia_csv, index=False)
        
        config = GenerationConfig(
            output_dir=tmp_path / "output",
            tcia_metadata_path=tcia_csv,
            patient_count=20,
            seed=42,
            synthea_path=tmp_path / "synthea",
            s3_bucket="test-bucket"
        )
        
        # Setup mocks for generation workflow
        mock_patient_gen = MagicMock()
        mock_patient_gen.generate_patients.return_value = sample_patients
        mock_patient_gen_class.return_value = mock_patient_gen
        
        mock_mapper = MagicMock()
        mock_mapper.map_patients.return_value = sample_mapping
        mock_mapper_class.return_value = mock_mapper
        
        mock_doc_gen = MagicMock()
        mock_doc_gen.generate_all_documents.return_value = sample_documents
        mock_doc_gen_class.return_value = mock_doc_gen
        
        mock_organizer = MagicMock()
        mock_organizer_class.return_value = mock_organizer
        
        mock_validator = MagicMock()
        mock_validator.validate.return_value = ValidationResult(True, [], [])
        mock_validator_class.return_value = mock_validator
        
        mock_stats_gen = MagicMock()
        mock_stats_gen.generate.return_value = Statistics(
            total_patients=20,
            patients_by_cancer_type={},
            total_claims=20,
            claims_by_status={},
            documents_by_type={},
            tcia_patient_ids=["TCIA-001"],
            random_seed=42,
            generation_timestamp=datetime.now().isoformat()
        )
        mock_stats_gen_class.return_value = mock_stats_gen
        
        # Setup S3 uploader mock
        mock_uploader = MagicMock()
        mock_uploader.upload_directory.return_value = {
            'success': True,
            'file_count': 50,
            'total_bytes': 1024000,
            'failed_files': [],
            'error_message': None
        }
        mock_s3_uploader_class.return_value = mock_uploader
        
        # Execute
        orchestrator = GenerationOrchestrator(config)
        result = orchestrator.generate()
        
        # Verify S3 uploader was created with correct bucket
        mock_s3_uploader_class.assert_called_once_with(bucket_name="test-bucket")
        
        # Verify upload was called with output directory
        mock_uploader.upload_directory.assert_called_once_with(config.output_dir)
        
        # Verify upload summary in result
        assert result.upload_summary is not None
        assert result.upload_summary['success'] is True
        assert result.upload_summary['file_count'] == 50
        assert result.upload_summary['total_bytes'] == 1024000
    
    @patch('medical_claims_generator.orchestrator.S3Uploader')
    @patch('medical_claims_generator.orchestrator.PatientGenerator')
    @patch('medical_claims_generator.orchestrator.PatientMapper')
    @patch('medical_claims_generator.orchestrator.DocumentGenerator')
    @patch('medical_claims_generator.orchestrator.OutputOrganizer')
    @patch('medical_claims_generator.orchestrator.DataValidator')
    @patch('medical_claims_generator.orchestrator.StatisticsGenerator')
    def test_s3_upload_failure_does_not_fail_generation(
        self,
        mock_stats_gen_class,
        mock_validator_class,
        mock_organizer_class,
        mock_doc_gen_class,
        mock_mapper_class,
        mock_patient_gen_class,
        mock_s3_uploader_class,
        tmp_path,
        sample_patients,
        sample_tcia_metadata,
        sample_mapping,
        sample_documents
    ):
        """Test that S3 upload failure doesn't fail the generation."""
        # Setup config with S3 bucket
        tcia_csv = tmp_path / "tcia.csv"
        sample_tcia_metadata.to_csv(tcia_csv, index=False)
        
        config = GenerationConfig(
            output_dir=tmp_path / "output",
            tcia_metadata_path=tcia_csv,
            patient_count=20,
            seed=42,
            synthea_path=tmp_path / "synthea",
            s3_bucket="test-bucket"
        )
        
        # Setup mocks for generation workflow
        mock_patient_gen = MagicMock()
        mock_patient_gen.generate_patients.return_value = sample_patients
        mock_patient_gen_class.return_value = mock_patient_gen
        
        mock_mapper = MagicMock()
        mock_mapper.map_patients.return_value = sample_mapping
        mock_mapper_class.return_value = mock_mapper
        
        mock_doc_gen = MagicMock()
        mock_doc_gen.generate_all_documents.return_value = sample_documents
        mock_doc_gen_class.return_value = mock_doc_gen
        
        mock_organizer = MagicMock()
        mock_organizer_class.return_value = mock_organizer
        
        mock_validator = MagicMock()
        mock_validator.validate.return_value = ValidationResult(True, [], [])
        mock_validator_class.return_value = mock_validator
        
        mock_stats_gen = MagicMock()
        mock_stats_gen.generate.return_value = Statistics(
            total_patients=20,
            patients_by_cancer_type={},
            total_claims=20,
            claims_by_status={},
            documents_by_type={},
            tcia_patient_ids=["TCIA-001"],
            random_seed=42,
            generation_timestamp=datetime.now().isoformat()
        )
        mock_stats_gen_class.return_value = mock_stats_gen
        
        # Setup S3 uploader mock to raise error
        from medical_claims_generator.s3_uploader import S3UploadError
        mock_uploader = MagicMock()
        mock_uploader.upload_directory.side_effect = S3UploadError("Bucket not found")
        mock_s3_uploader_class.return_value = mock_uploader
        
        # Execute
        orchestrator = GenerationOrchestrator(config)
        result = orchestrator.generate()
        
        # Verify generation still succeeded
        assert result.success is True
        
        # Verify upload summary shows failure
        assert result.upload_summary is not None
        assert result.upload_summary['success'] is False
        assert 'Bucket not found' in result.upload_summary['error_message']
    
    @patch('medical_claims_generator.orchestrator.PatientGenerator')
    @patch('medical_claims_generator.orchestrator.PatientMapper')
    @patch('medical_claims_generator.orchestrator.DocumentGenerator')
    @patch('medical_claims_generator.orchestrator.OutputOrganizer')
    @patch('medical_claims_generator.orchestrator.DataValidator')
    @patch('medical_claims_generator.orchestrator.StatisticsGenerator')
    def test_no_s3_upload_when_bucket_not_configured(
        self,
        mock_stats_gen_class,
        mock_validator_class,
        mock_organizer_class,
        mock_doc_gen_class,
        mock_mapper_class,
        mock_patient_gen_class,
        tmp_path,
        sample_patients,
        sample_tcia_metadata,
        sample_mapping,
        sample_documents
    ):
        """Test that S3 upload is skipped when bucket is not configured."""
        # Setup config without S3 bucket
        tcia_csv = tmp_path / "tcia.csv"
        sample_tcia_metadata.to_csv(tcia_csv, index=False)
        
        config = GenerationConfig(
            output_dir=tmp_path / "output",
            tcia_metadata_path=tcia_csv,
            patient_count=20,
            seed=42,
            synthea_path=tmp_path / "synthea",
            s3_bucket=None  # No S3 bucket
        )
        
        # Setup mocks for generation workflow
        mock_patient_gen = MagicMock()
        mock_patient_gen.generate_patients.return_value = sample_patients
        mock_patient_gen_class.return_value = mock_patient_gen
        
        mock_mapper = MagicMock()
        mock_mapper.map_patients.return_value = sample_mapping
        mock_mapper_class.return_value = mock_mapper
        
        mock_doc_gen = MagicMock()
        mock_doc_gen.generate_all_documents.return_value = sample_documents
        mock_doc_gen_class.return_value = mock_doc_gen
        
        mock_organizer = MagicMock()
        mock_organizer_class.return_value = mock_organizer
        
        mock_validator = MagicMock()
        mock_validator.validate.return_value = ValidationResult(True, [], [])
        mock_validator_class.return_value = mock_validator
        
        mock_stats_gen = MagicMock()
        mock_stats_gen.generate.return_value = Statistics(
            total_patients=20,
            patients_by_cancer_type={},
            total_claims=20,
            claims_by_status={},
            documents_by_type={},
            tcia_patient_ids=["TCIA-001"],
            random_seed=42,
            generation_timestamp=datetime.now().isoformat()
        )
        mock_stats_gen_class.return_value = mock_stats_gen
        
        # Execute
        orchestrator = GenerationOrchestrator(config)
        result = orchestrator.generate()
        
        # Verify generation succeeded
        assert result.success is True
        
        # Verify no upload summary
        assert result.upload_summary is None
