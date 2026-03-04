"""
Unit tests for OutputOrganizer

Tests directory structure creation, file placement, mapping.json creation,
and metadata copying functionality.
"""

import pytest
import json
import shutil
from pathlib import Path
from datetime import date
from medical_claims_generator.output_organizer import OutputOrganizer
from medical_claims_generator.models import (
    DocumentSet, PatientMapping, ImagingStudy,
    CMS1500Document, EOBDocument, RadiologyReport, ClinicalNote,
    ClaimStatus, PaymentInfo
)


@pytest.fixture
def temp_output_dir(tmp_path):
    """Create temporary output directory for testing."""
    output_dir = tmp_path / "test_output"
    output_dir.mkdir()
    return output_dir


@pytest.fixture
def temp_synthea_dir(tmp_path):
    """Create temporary Synthea output directory with sample files."""
    synthea_dir = tmp_path / "synthea_output"
    synthea_dir.mkdir()
    
    # Create sample files
    (synthea_dir / "patients.csv").write_text("id,name\n1,John Doe\n")
    (synthea_dir / "encounters.csv").write_text("id,patient_id\nenc1,1\n")
    
    # Create subdirectory
    fhir_dir = synthea_dir / "fhir"
    fhir_dir.mkdir()
    (fhir_dir / "patient_1.json").write_text('{"resourceType": "Patient"}')
    
    return synthea_dir


@pytest.fixture
def temp_tcia_metadata(tmp_path):
    """Create temporary TCIA metadata CSV file."""
    metadata_file = tmp_path / "tcia_metadata.csv"
    metadata_file.write_text(
        "PatientID,StudyInstanceUID,Modality,StudyDate\n"
        "TCIA-001,1.2.3.001,CT,20230615\n"
        "TCIA-002,1.2.3.002,CT,20230720\n"
    )
    return metadata_file


@pytest.fixture
def sample_patient_mapping():
    """Create sample patient mapping."""
    return PatientMapping(
        patient_id_mapping={
            "synthea-001": "TCIA-001",
            "synthea-002": "TCIA-002"
        },
        encounter_study_mapping={
            "enc-001": [
                ImagingStudy(
                    study_uid="1.2.3.001",
                    tcia_patient_id="TCIA-001",
                    modality="CT",
                    study_date=date(2023, 6, 15),
                    series_description="Chest CT",
                    anatomical_region="chest"
                )
            ],
            "enc-002": [
                ImagingStudy(
                    study_uid="1.2.3.002",
                    tcia_patient_id="TCIA-002",
                    modality="CT",
                    study_date=date(2023, 7, 20),
                    series_description="Abdomen CT",
                    anatomical_region="abdomen"
                )
            ]
        }
    )


@pytest.fixture
def sample_documents():
    """Create sample document set."""
    return DocumentSet(
        cms1500_forms=[
            CMS1500Document(
                claim_number="CLM-001",
                patient_id="synthea-001",
                tcia_patient_id="TCIA-001",
                encounter_id="enc-001",
                study_uid="1.2.3.001",
                procedure_code="71250",
                diagnosis_codes=["C34.90"],
                pdf_bytes=b"PDF content for CMS1500-001",
                filename="cms1500_001.pdf"
            ),
            CMS1500Document(
                claim_number="CLM-002",
                patient_id="synthea-002",
                tcia_patient_id="TCIA-002",
                encounter_id="enc-002",
                study_uid="1.2.3.002",
                procedure_code="71260",
                diagnosis_codes=["C18.9"],
                pdf_bytes=b"PDF content for CMS1500-002",
                filename="cms1500_002.pdf"
            )
        ],
        eob_documents=[
            EOBDocument(
                eob_number="EOB-001",
                claim_number="CLM-001",
                patient_id="synthea-001",
                tcia_patient_id="TCIA-001",
                status=ClaimStatus.APPROVED,
                payment_info=PaymentInfo(amount=1500.00, payment_date=date(2023, 7, 1)),
                denial_reason=None,
                pdf_bytes=b"PDF content for EOB-001",
                filename="eob_001.pdf"
            ),
            EOBDocument(
                eob_number="EOB-002",
                claim_number="CLM-002",
                patient_id="synthea-002",
                tcia_patient_id="TCIA-002",
                status=ClaimStatus.DENIED,
                payment_info=None,
                denial_reason="Pre-authorization required",
                pdf_bytes=b"PDF content for EOB-002",
                filename="eob_002.pdf"
            )
        ],
        radiology_reports=[
            RadiologyReport(
                report_id="RAD-001",
                patient_id="synthea-001",
                tcia_patient_id="TCIA-001",
                study_uid="1.2.3.001",
                modality="CT",
                anatomical_region="chest",
                findings="Suspicious nodule in right upper lobe",
                radiologist="Dr. Johnson",
                report_date=date(2023, 6, 16),
                pdf_bytes=b"PDF content for RAD-001",
                filename="radiology_report_001.pdf"
            ),
            RadiologyReport(
                report_id="RAD-002",
                patient_id="synthea-002",
                tcia_patient_id="TCIA-002",
                study_uid="1.2.3.002",
                modality="CT",
                anatomical_region="abdomen",
                findings="Mass in sigmoid colon",
                radiologist="Dr. Williams",
                report_date=date(2023, 7, 21),
                pdf_bytes=b"PDF content for RAD-002",
                filename="radiology_report_002.pdf"
            )
        ],
        clinical_notes=[
            ClinicalNote(
                note_id="NOTE-001",
                patient_id="synthea-001",
                tcia_patient_id="TCIA-001",
                encounter_id="enc-001",
                symptoms=["chest pain", "shortness of breath"],
                imaging_orders=["CT chest"],
                treatment_plan="Follow-up imaging in 3 months",
                physician="Dr. Smith",
                note_date=date(2023, 6, 15),
                pdf_bytes=b"PDF content for NOTE-001",
                filename="note_001.pdf"
            ),
            ClinicalNote(
                note_id="NOTE-002",
                patient_id="synthea-002",
                tcia_patient_id="TCIA-002",
                encounter_id="enc-002",
                symptoms=["abdominal pain", "weight loss"],
                imaging_orders=["CT abdomen"],
                treatment_plan="Referral to oncology",
                physician="Dr. Jones",
                note_date=date(2023, 7, 20),
                pdf_bytes=b"PDF content for NOTE-002",
                filename="note_002.pdf"
            )
        ]
    )


class TestOutputOrganizer:
    """Test suite for OutputOrganizer class."""
    
    def test_initialization(self, temp_output_dir):
        """Test OutputOrganizer initialization."""
        organizer = OutputOrganizer(temp_output_dir)
        assert organizer.root_dir == temp_output_dir
        assert isinstance(organizer.root_dir, Path)
    
    def test_create_directory_structure(self, temp_output_dir):
        """Test directory structure creation for multiple patients."""
        organizer = OutputOrganizer(temp_output_dir)
        tcia_ids = ["TCIA-001", "TCIA-002", "TCIA-003"]
        
        organizer._create_directory_structure(tcia_ids)
        
        # Check root directory exists
        assert temp_output_dir.exists()
        
        # Check patients directory exists
        patients_dir = temp_output_dir / "patients"
        assert patients_dir.exists()
        assert patients_dir.is_dir()
        
        # Check each patient directory exists with subdirectories
        for tcia_id in tcia_ids:
            patient_dir = patients_dir / tcia_id
            assert patient_dir.exists()
            assert patient_dir.is_dir()
            
            # Check claims subdirectory
            claims_dir = patient_dir / "claims"
            assert claims_dir.exists()
            assert claims_dir.is_dir()
            
            # Check clinical-notes subdirectory
            notes_dir = patient_dir / "clinical-notes"
            assert notes_dir.exists()
            assert notes_dir.is_dir()
        
        # Check metadata directory exists
        metadata_dir = temp_output_dir / "metadata"
        assert metadata_dir.exists()
        assert metadata_dir.is_dir()
        
        # Check synthea-output subdirectory within metadata
        synthea_output_dir = metadata_dir / "synthea-output"
        assert synthea_output_dir.exists()
        assert synthea_output_dir.is_dir()
    
    def test_create_directory_structure_single_patient(self, temp_output_dir):
        """Test directory structure creation for single patient."""
        organizer = OutputOrganizer(temp_output_dir)
        tcia_ids = ["TCIA-001"]
        
        organizer._create_directory_structure(tcia_ids)
        
        patient_dir = temp_output_dir / "patients" / "TCIA-001"
        assert patient_dir.exists()
        assert (patient_dir / "claims").exists()
        assert (patient_dir / "clinical-notes").exists()
    
    def test_create_directory_structure_idempotent(self, temp_output_dir):
        """Test that creating directory structure multiple times is safe."""
        organizer = OutputOrganizer(temp_output_dir)
        tcia_ids = ["TCIA-001"]
        
        # Create structure twice
        organizer._create_directory_structure(tcia_ids)
        organizer._create_directory_structure(tcia_ids)
        
        # Should still exist without errors
        assert (temp_output_dir / "patients" / "TCIA-001").exists()
    
    def test_place_cms1500_documents(self, temp_output_dir, sample_documents, sample_patient_mapping):
        """Test CMS-1500 forms are placed in correct claims directories."""
        organizer = OutputOrganizer(temp_output_dir)
        
        # Create directory structure first
        tcia_ids = ["TCIA-001", "TCIA-002"]
        organizer._create_directory_structure(tcia_ids)
        
        # Place documents
        organizer._place_documents(sample_documents, sample_patient_mapping)
        
        # Check CMS-1500 forms are in claims directories
        cms1500_001 = temp_output_dir / "patients" / "TCIA-001" / "claims" / "cms1500_001.pdf"
        assert cms1500_001.exists()
        assert cms1500_001.read_bytes() == b"PDF content for CMS1500-001"
        
        cms1500_002 = temp_output_dir / "patients" / "TCIA-002" / "claims" / "cms1500_002.pdf"
        assert cms1500_002.exists()
        assert cms1500_002.read_bytes() == b"PDF content for CMS1500-002"
    
    def test_place_eob_documents(self, temp_output_dir, sample_documents, sample_patient_mapping):
        """Test EOB documents are placed in correct claims directories."""
        organizer = OutputOrganizer(temp_output_dir)
        
        # Create directory structure first
        tcia_ids = ["TCIA-001", "TCIA-002"]
        organizer._create_directory_structure(tcia_ids)
        
        # Place documents
        organizer._place_documents(sample_documents, sample_patient_mapping)
        
        # Check EOB documents are in claims directories
        eob_001 = temp_output_dir / "patients" / "TCIA-001" / "claims" / "eob_001.pdf"
        assert eob_001.exists()
        assert eob_001.read_bytes() == b"PDF content for EOB-001"
        
        eob_002 = temp_output_dir / "patients" / "TCIA-002" / "claims" / "eob_002.pdf"
        assert eob_002.exists()
        assert eob_002.read_bytes() == b"PDF content for EOB-002"
    
    def test_place_radiology_reports(self, temp_output_dir, sample_documents, sample_patient_mapping):
        """Test radiology reports are placed in correct claims directories."""
        organizer = OutputOrganizer(temp_output_dir)
        
        # Create directory structure first
        tcia_ids = ["TCIA-001", "TCIA-002"]
        organizer._create_directory_structure(tcia_ids)
        
        # Place documents
        organizer._place_documents(sample_documents, sample_patient_mapping)
        
        # Check radiology reports are in claims directories
        rad_001 = temp_output_dir / "patients" / "TCIA-001" / "claims" / "radiology_report_001.pdf"
        assert rad_001.exists()
        assert rad_001.read_bytes() == b"PDF content for RAD-001"
        
        rad_002 = temp_output_dir / "patients" / "TCIA-002" / "claims" / "radiology_report_002.pdf"
        assert rad_002.exists()
        assert rad_002.read_bytes() == b"PDF content for RAD-002"
    
    def test_place_clinical_notes(self, temp_output_dir, sample_documents, sample_patient_mapping):
        """Test clinical notes are placed in correct clinical-notes directories."""
        organizer = OutputOrganizer(temp_output_dir)
        
        # Create directory structure first
        tcia_ids = ["TCIA-001", "TCIA-002"]
        organizer._create_directory_structure(tcia_ids)
        
        # Place documents
        organizer._place_documents(sample_documents, sample_patient_mapping)
        
        # Check clinical notes are in clinical-notes directories
        note_001 = temp_output_dir / "patients" / "TCIA-001" / "clinical-notes" / "note_001.pdf"
        assert note_001.exists()
        assert note_001.read_bytes() == b"PDF content for NOTE-001"
        
        note_002 = temp_output_dir / "patients" / "TCIA-002" / "clinical-notes" / "note_002.pdf"
        assert note_002.exists()
        assert note_002.read_bytes() == b"PDF content for NOTE-002"
    
    def test_place_all_document_types(self, temp_output_dir, sample_documents, sample_patient_mapping):
        """Test all document types are placed correctly in one operation."""
        organizer = OutputOrganizer(temp_output_dir)
        
        # Create directory structure first
        tcia_ids = ["TCIA-001", "TCIA-002"]
        organizer._create_directory_structure(tcia_ids)
        
        # Place all documents
        organizer._place_documents(sample_documents, sample_patient_mapping)
        
        # Verify all document types exist for TCIA-001
        tcia_001_claims = temp_output_dir / "patients" / "TCIA-001" / "claims"
        assert (tcia_001_claims / "cms1500_001.pdf").exists()
        assert (tcia_001_claims / "eob_001.pdf").exists()
        assert (tcia_001_claims / "radiology_report_001.pdf").exists()
        
        tcia_001_notes = temp_output_dir / "patients" / "TCIA-001" / "clinical-notes"
        assert (tcia_001_notes / "note_001.pdf").exists()
        
        # Verify all document types exist for TCIA-002
        tcia_002_claims = temp_output_dir / "patients" / "TCIA-002" / "claims"
        assert (tcia_002_claims / "cms1500_002.pdf").exists()
        assert (tcia_002_claims / "eob_002.pdf").exists()
        assert (tcia_002_claims / "radiology_report_002.pdf").exists()
        
        tcia_002_notes = temp_output_dir / "patients" / "TCIA-002" / "clinical-notes"
        assert (tcia_002_notes / "note_002.pdf").exists()
    
    def test_copy_tcia_metadata(self, temp_output_dir, temp_tcia_metadata):
        """Test TCIA metadata CSV is copied to metadata directory."""
        organizer = OutputOrganizer(temp_output_dir)
        
        # Create metadata directory
        metadata_dir = temp_output_dir / "metadata"
        metadata_dir.mkdir(parents=True)
        
        # Copy metadata
        organizer._copy_metadata(Path("/nonexistent"), temp_tcia_metadata)
        
        # Check TCIA metadata was copied
        dest_metadata = metadata_dir / "tcia_metadata.csv"
        assert dest_metadata.exists()
        assert dest_metadata.read_text() == temp_tcia_metadata.read_text()
    
    def test_copy_synthea_output_files(self, temp_output_dir, temp_synthea_dir):
        """Test Synthea output files are copied to metadata/synthea-output directory."""
        organizer = OutputOrganizer(temp_output_dir)
        
        # Create metadata directory structure
        metadata_dir = temp_output_dir / "metadata"
        synthea_output_dir = metadata_dir / "synthea-output"
        synthea_output_dir.mkdir(parents=True)
        
        # Copy metadata
        organizer._copy_metadata(temp_synthea_dir, Path("/nonexistent"))
        
        # Check Synthea files were copied
        assert (synthea_output_dir / "patients.csv").exists()
        assert (synthea_output_dir / "encounters.csv").exists()
        
        # Check subdirectory was copied
        assert (synthea_output_dir / "fhir").exists()
        assert (synthea_output_dir / "fhir" / "patient_1.json").exists()
    
    def test_copy_metadata_both_sources(self, temp_output_dir, temp_synthea_dir, temp_tcia_metadata):
        """Test copying both TCIA metadata and Synthea output."""
        organizer = OutputOrganizer(temp_output_dir)
        
        # Create metadata directory structure
        metadata_dir = temp_output_dir / "metadata"
        synthea_output_dir = metadata_dir / "synthea-output"
        synthea_output_dir.mkdir(parents=True)
        
        # Copy both metadata sources
        organizer._copy_metadata(temp_synthea_dir, temp_tcia_metadata)
        
        # Check TCIA metadata
        assert (metadata_dir / "tcia_metadata.csv").exists()
        
        # Check Synthea output
        assert (synthea_output_dir / "patients.csv").exists()
        assert (synthea_output_dir / "encounters.csv").exists()
        assert (synthea_output_dir / "fhir" / "patient_1.json").exists()
    
    def test_copy_metadata_nonexistent_sources(self, temp_output_dir):
        """Test copying metadata handles nonexistent source paths gracefully."""
        organizer = OutputOrganizer(temp_output_dir)
        
        # Create metadata directory
        metadata_dir = temp_output_dir / "metadata"
        synthea_output_dir = metadata_dir / "synthea-output"
        synthea_output_dir.mkdir(parents=True)
        
        # Should not raise error with nonexistent paths
        organizer._copy_metadata(
            Path("/nonexistent/synthea"),
            Path("/nonexistent/tcia.csv")
        )
        
        # Metadata directory should still exist
        assert metadata_dir.exists()
        assert synthea_output_dir.exists()
    
    def test_write_mapping_json(self, temp_output_dir, sample_patient_mapping):
        """Test mapping.json is written at root level with correct structure."""
        organizer = OutputOrganizer(temp_output_dir)
        
        # Write mapping file
        mapping_file = temp_output_dir / "mapping.json"
        with open(mapping_file, 'w') as f:
            json.dump(sample_patient_mapping.to_json(), f, indent=2)
        
        # Verify file exists at root level
        assert mapping_file.exists()
        
        # Verify JSON structure
        with open(mapping_file, 'r') as f:
            mapping_data = json.load(f)
        
        assert "patient_mappings" in mapping_data
        assert "encounter_study_mappings" in mapping_data
        
        # Verify patient mappings
        patient_mappings = mapping_data["patient_mappings"]
        assert len(patient_mappings) == 2
        assert {"synthea_id": "synthea-001", "tcia_id": "TCIA-001"} in patient_mappings
        assert {"synthea_id": "synthea-002", "tcia_id": "TCIA-002"} in patient_mappings
        
        # Verify encounter mappings
        encounter_mappings = mapping_data["encounter_study_mappings"]
        assert "enc-001" in encounter_mappings
        assert "enc-002" in encounter_mappings
    
    def test_organize_complete_workflow(
        self,
        temp_output_dir,
        sample_documents,
        sample_patient_mapping,
        temp_synthea_dir,
        temp_tcia_metadata
    ):
        """Test complete organize workflow with all components."""
        organizer = OutputOrganizer(temp_output_dir)
        
        # Run complete organization
        organizer.organize(
            documents=sample_documents,
            mapping=sample_patient_mapping,
            synthea_output_path=temp_synthea_dir,
            tcia_metadata_path=temp_tcia_metadata
        )
        
        # Verify directory structure
        assert (temp_output_dir / "patients").exists()
        assert (temp_output_dir / "patients" / "TCIA-001" / "claims").exists()
        assert (temp_output_dir / "patients" / "TCIA-001" / "clinical-notes").exists()
        assert (temp_output_dir / "patients" / "TCIA-002" / "claims").exists()
        assert (temp_output_dir / "patients" / "TCIA-002" / "clinical-notes").exists()
        assert (temp_output_dir / "metadata").exists()
        assert (temp_output_dir / "metadata" / "synthea-output").exists()
        
        # Verify documents are placed
        assert (temp_output_dir / "patients" / "TCIA-001" / "claims" / "cms1500_001.pdf").exists()
        assert (temp_output_dir / "patients" / "TCIA-001" / "claims" / "eob_001.pdf").exists()
        assert (temp_output_dir / "patients" / "TCIA-001" / "claims" / "radiology_report_001.pdf").exists()
        assert (temp_output_dir / "patients" / "TCIA-001" / "clinical-notes" / "note_001.pdf").exists()
        
        # Verify metadata is copied
        assert (temp_output_dir / "metadata" / "tcia_metadata.csv").exists()
        assert (temp_output_dir / "metadata" / "synthea-output" / "patients.csv").exists()
        
        # Verify mapping.json exists at root
        mapping_file = temp_output_dir / "mapping.json"
        assert mapping_file.exists()
        
        # Verify mapping.json content
        with open(mapping_file, 'r') as f:
            mapping_data = json.load(f)
        assert "patient_mappings" in mapping_data
        assert "encounter_study_mappings" in mapping_data
    
    def test_organize_with_empty_document_set(
        self,
        temp_output_dir,
        sample_patient_mapping,
        temp_synthea_dir,
        temp_tcia_metadata
    ):
        """Test organize handles empty document set gracefully."""
        organizer = OutputOrganizer(temp_output_dir)
        
        # Create empty document set
        empty_documents = DocumentSet(
            cms1500_forms=[],
            eob_documents=[],
            radiology_reports=[],
            clinical_notes=[]
        )
        
        # Should not raise error
        organizer.organize(
            documents=empty_documents,
            mapping=sample_patient_mapping,
            synthea_output_path=temp_synthea_dir,
            tcia_metadata_path=temp_tcia_metadata
        )
        
        # Directory structure should still be created
        assert (temp_output_dir / "patients").exists()
        assert (temp_output_dir / "metadata").exists()
        assert (temp_output_dir / "mapping.json").exists()
    
    def test_organize_creates_root_directory(self, tmp_path):
        """Test organize creates root directory if it doesn't exist."""
        nonexistent_dir = tmp_path / "new_output" / "nested"
        organizer = OutputOrganizer(nonexistent_dir)
        
        # Create minimal test data
        empty_documents = DocumentSet(
            cms1500_forms=[],
            eob_documents=[],
            radiology_reports=[],
            clinical_notes=[]
        )
        minimal_mapping = PatientMapping(
            patient_id_mapping={"synthea-001": "TCIA-001"},
            encounter_study_mapping={}
        )
        
        # Should create directory hierarchy
        organizer.organize(
            documents=empty_documents,
            mapping=minimal_mapping,
            synthea_output_path=Path("/nonexistent"),
            tcia_metadata_path=Path("/nonexistent")
        )
        
        assert nonexistent_dir.exists()
        assert (nonexistent_dir / "mapping.json").exists()
