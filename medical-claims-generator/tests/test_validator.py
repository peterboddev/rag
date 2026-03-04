"""
Unit tests for DataValidator
"""

import json
import pytest
from pathlib import Path
from medical_claims_generator.validator import DataValidator
from medical_claims_generator.models import ValidationResult


@pytest.fixture
def temp_data_dir(tmp_path):
    """Create a temporary data directory structure."""
    return tmp_path / "medical_data"


@pytest.fixture
def valid_data_structure(temp_data_dir):
    """Create a valid data structure with 25 patients."""
    # Create root directory
    temp_data_dir.mkdir()
    
    # Create patients directory with 25 patients
    patients_dir = temp_data_dir / "patients"
    patients_dir.mkdir()
    
    tcia_ids = []
    for i in range(1, 26):
        tcia_id = f"TCIA-{i:03d}"
        tcia_ids.append(tcia_id)
        
        patient_dir = patients_dir / tcia_id
        patient_dir.mkdir()
        
        # Create claims directory with required documents
        claims_dir = patient_dir / "claims"
        claims_dir.mkdir()
        
        # Create required PDFs
        (claims_dir / f"cms1500_{i:03d}.pdf").write_bytes(b"fake pdf content")
        (claims_dir / f"eob_{i:03d}.pdf").write_bytes(b"fake pdf content")
        (claims_dir / f"radiology_report_{i:03d}.pdf").write_bytes(b"fake pdf content")
        
        # Create clinical-notes directory
        notes_dir = patient_dir / "clinical-notes"
        notes_dir.mkdir()
        (notes_dir / f"note_{i:03d}.pdf").write_bytes(b"fake pdf content")
    
    # Create mapping.json
    mapping_data = {
        "patient_mappings": [
            {"synthea_id": f"synthea-{i}", "tcia_id": tcia_id}
            for i, tcia_id in enumerate(tcia_ids, 1)
        ],
        "encounter_study_mappings": {}
    }
    
    mapping_file = temp_data_dir / "mapping.json"
    with open(mapping_file, 'w') as f:
        json.dump(mapping_data, f)
    
    return temp_data_dir


class TestDataValidator:
    """Test suite for DataValidator class."""
    
    def test_init(self, temp_data_dir):
        """Test DataValidator initialization."""
        validator = DataValidator(temp_data_dir)
        assert validator.root_dir == temp_data_dir
    
    def test_validate_success(self, valid_data_structure):
        """Test validation passes with valid data structure."""
        validator = DataValidator(valid_data_structure)
        result = validator.validate()
        
        assert isinstance(result, ValidationResult)
        assert result.success is True
        assert len(result.errors) == 0
    
    def test_validate_patient_count_too_few(self, temp_data_dir):
        """Test validation fails when patient count is below 20."""
        # Create structure with only 15 patients
        temp_data_dir.mkdir()
        patients_dir = temp_data_dir / "patients"
        patients_dir.mkdir()
        
        for i in range(1, 16):
            patient_dir = patients_dir / f"TCIA-{i:03d}"
            patient_dir.mkdir()
            
            claims_dir = patient_dir / "claims"
            claims_dir.mkdir()
            (claims_dir / f"cms1500_{i}.pdf").write_bytes(b"fake")
            (claims_dir / f"eob_{i}.pdf").write_bytes(b"fake")
            (claims_dir / f"radiology_report_{i}.pdf").write_bytes(b"fake")
            
            notes_dir = patient_dir / "clinical-notes"
            notes_dir.mkdir()
        
        # Create mapping.json
        mapping_data = {
            "patient_mappings": [
                {"synthea_id": f"s-{i}", "tcia_id": f"TCIA-{i:03d}"}
                for i in range(1, 16)
            ],
            "encounter_study_mappings": {}
        }
        (temp_data_dir / "mapping.json").write_text(json.dumps(mapping_data))
        
        validator = DataValidator(temp_data_dir)
        result = validator.validate()
        
        assert result.success is False
        assert any("less than minimum" in error for error in result.errors)
    
    def test_validate_patient_count_too_many(self, temp_data_dir):
        """Test validation fails when patient count exceeds 30."""
        # Create structure with 35 patients
        temp_data_dir.mkdir()
        patients_dir = temp_data_dir / "patients"
        patients_dir.mkdir()
        
        for i in range(1, 36):
            patient_dir = patients_dir / f"TCIA-{i:03d}"
            patient_dir.mkdir()
            
            claims_dir = patient_dir / "claims"
            claims_dir.mkdir()
            (claims_dir / f"cms1500_{i}.pdf").write_bytes(b"fake")
            (claims_dir / f"eob_{i}.pdf").write_bytes(b"fake")
            (claims_dir / f"radiology_report_{i}.pdf").write_bytes(b"fake")
            
            notes_dir = patient_dir / "clinical-notes"
            notes_dir.mkdir()
        
        # Create mapping.json
        mapping_data = {
            "patient_mappings": [
                {"synthea_id": f"s-{i}", "tcia_id": f"TCIA-{i:03d}"}
                for i in range(1, 36)
            ],
            "encounter_study_mappings": {}
        }
        (temp_data_dir / "mapping.json").write_text(json.dumps(mapping_data))
        
        validator = DataValidator(temp_data_dir)
        result = validator.validate()
        
        assert result.success is False
        assert any("exceeds maximum" in error for error in result.errors)
    
    def test_validate_missing_patients_directory(self, temp_data_dir):
        """Test validation fails when patients directory is missing."""
        temp_data_dir.mkdir()
        
        validator = DataValidator(temp_data_dir)
        result = validator.validate()
        
        assert result.success is False
        assert any("patients/ directory does not exist" in error for error in result.errors)
    
    def test_validate_missing_cms1500(self, temp_data_dir):
        """Test validation fails when CMS-1500 forms are missing."""
        temp_data_dir.mkdir()
        patients_dir = temp_data_dir / "patients"
        patients_dir.mkdir()
        
        # Create 25 patients but missing CMS-1500 forms
        for i in range(1, 26):
            patient_dir = patients_dir / f"TCIA-{i:03d}"
            patient_dir.mkdir()
            
            claims_dir = patient_dir / "claims"
            claims_dir.mkdir()
            # Missing: cms1500 PDF
            (claims_dir / f"eob_{i}.pdf").write_bytes(b"fake")
            (claims_dir / f"radiology_report_{i}.pdf").write_bytes(b"fake")
            
            notes_dir = patient_dir / "clinical-notes"
            notes_dir.mkdir()
        
        # Create mapping.json
        mapping_data = {
            "patient_mappings": [
                {"synthea_id": f"s-{i}", "tcia_id": f"TCIA-{i:03d}"}
                for i in range(1, 26)
            ],
            "encounter_study_mappings": {}
        }
        (temp_data_dir / "mapping.json").write_text(json.dumps(mapping_data))
        
        validator = DataValidator(temp_data_dir)
        result = validator.validate()
        
        assert result.success is False
        assert any("no CMS-1500 forms found" in error for error in result.errors)
    
    def test_validate_missing_eob(self, temp_data_dir):
        """Test validation fails when EOB documents are missing."""
        temp_data_dir.mkdir()
        patients_dir = temp_data_dir / "patients"
        patients_dir.mkdir()
        
        # Create 25 patients but missing EOB documents
        for i in range(1, 26):
            patient_dir = patients_dir / f"TCIA-{i:03d}"
            patient_dir.mkdir()
            
            claims_dir = patient_dir / "claims"
            claims_dir.mkdir()
            (claims_dir / f"cms1500_{i}.pdf").write_bytes(b"fake")
            # Missing: EOB PDF
            (claims_dir / f"radiology_report_{i}.pdf").write_bytes(b"fake")
            
            notes_dir = patient_dir / "clinical-notes"
            notes_dir.mkdir()
        
        # Create mapping.json
        mapping_data = {
            "patient_mappings": [
                {"synthea_id": f"s-{i}", "tcia_id": f"TCIA-{i:03d}"}
                for i in range(1, 26)
            ],
            "encounter_study_mappings": {}
        }
        (temp_data_dir / "mapping.json").write_text(json.dumps(mapping_data))
        
        validator = DataValidator(temp_data_dir)
        result = validator.validate()
        
        assert result.success is False
        assert any("no EOB documents found" in error for error in result.errors)
    
    def test_validate_missing_radiology_report(self, temp_data_dir):
        """Test validation fails when radiology reports are missing."""
        temp_data_dir.mkdir()
        patients_dir = temp_data_dir / "patients"
        patients_dir.mkdir()
        
        # Create 25 patients but missing radiology reports
        for i in range(1, 26):
            patient_dir = patients_dir / f"TCIA-{i:03d}"
            patient_dir.mkdir()
            
            claims_dir = patient_dir / "claims"
            claims_dir.mkdir()
            (claims_dir / f"cms1500_{i}.pdf").write_bytes(b"fake")
            (claims_dir / f"eob_{i}.pdf").write_bytes(b"fake")
            # Missing: radiology report PDF
            
            notes_dir = patient_dir / "clinical-notes"
            notes_dir.mkdir()
        
        # Create mapping.json
        mapping_data = {
            "patient_mappings": [
                {"synthea_id": f"s-{i}", "tcia_id": f"TCIA-{i:03d}"}
                for i in range(1, 26)
            ],
            "encounter_study_mappings": {}
        }
        (temp_data_dir / "mapping.json").write_text(json.dumps(mapping_data))
        
        validator = DataValidator(temp_data_dir)
        result = validator.validate()
        
        assert result.success is False
        assert any("no radiology reports found" in error for error in result.errors)
    
    def test_validate_missing_claims_directory(self, temp_data_dir):
        """Test validation fails when claims directory is missing."""
        temp_data_dir.mkdir()
        patients_dir = temp_data_dir / "patients"
        patients_dir.mkdir()
        
        # Create patient without claims directory
        patient_dir = patients_dir / "TCIA-001"
        patient_dir.mkdir()
        
        notes_dir = patient_dir / "clinical-notes"
        notes_dir.mkdir()
        
        # Create mapping.json
        mapping_data = {
            "patient_mappings": [
                {"synthea_id": "s-1", "tcia_id": "TCIA-001"}
            ],
            "encounter_study_mappings": {}
        }
        (temp_data_dir / "mapping.json").write_text(json.dumps(mapping_data))
        
        validator = DataValidator(temp_data_dir)
        result = validator.validate()
        
        assert result.success is False
        assert any("claims/ directory missing" in error for error in result.errors)
    
    def test_validate_missing_clinical_notes_directory(self, temp_data_dir):
        """Test validation fails when clinical-notes directory is missing."""
        temp_data_dir.mkdir()
        patients_dir = temp_data_dir / "patients"
        patients_dir.mkdir()
        
        # Create patient without clinical-notes directory
        patient_dir = patients_dir / "TCIA-001"
        patient_dir.mkdir()
        
        claims_dir = patient_dir / "claims"
        claims_dir.mkdir()
        (claims_dir / "cms1500_1.pdf").write_bytes(b"fake")
        (claims_dir / "eob_1.pdf").write_bytes(b"fake")
        (claims_dir / "radiology_report_1.pdf").write_bytes(b"fake")
        
        # Create mapping.json
        mapping_data = {
            "patient_mappings": [
                {"synthea_id": "s-1", "tcia_id": "TCIA-001"}
            ],
            "encounter_study_mappings": {}
        }
        (temp_data_dir / "mapping.json").write_text(json.dumps(mapping_data))
        
        validator = DataValidator(temp_data_dir)
        result = validator.validate()
        
        assert result.success is False
        assert any("clinical-notes/ directory missing" in error for error in result.errors)
    
    def test_validate_missing_mapping_file(self, temp_data_dir):
        """Test validation fails when mapping.json is missing."""
        temp_data_dir.mkdir()
        patients_dir = temp_data_dir / "patients"
        patients_dir.mkdir()
        
        # Create valid patient structure but no mapping.json
        for i in range(1, 26):
            patient_dir = patients_dir / f"TCIA-{i:03d}"
            patient_dir.mkdir()
            
            claims_dir = patient_dir / "claims"
            claims_dir.mkdir()
            (claims_dir / f"cms1500_{i}.pdf").write_bytes(b"fake")
            (claims_dir / f"eob_{i}.pdf").write_bytes(b"fake")
            (claims_dir / f"radiology_report_{i}.pdf").write_bytes(b"fake")
            
            notes_dir = patient_dir / "clinical-notes"
            notes_dir.mkdir()
        
        validator = DataValidator(temp_data_dir)
        result = validator.validate()
        
        assert result.success is False
        assert any("mapping.json file does not exist" in error for error in result.errors)
    
    def test_validate_invalid_json_mapping(self, temp_data_dir):
        """Test validation fails when mapping.json is invalid JSON."""
        temp_data_dir.mkdir()
        patients_dir = temp_data_dir / "patients"
        patients_dir.mkdir()
        
        # Create valid patient structure
        for i in range(1, 26):
            patient_dir = patients_dir / f"TCIA-{i:03d}"
            patient_dir.mkdir()
            
            claims_dir = patient_dir / "claims"
            claims_dir.mkdir()
            (claims_dir / f"cms1500_{i}.pdf").write_bytes(b"fake")
            (claims_dir / f"eob_{i}.pdf").write_bytes(b"fake")
            (claims_dir / f"radiology_report_{i}.pdf").write_bytes(b"fake")
            
            notes_dir = patient_dir / "clinical-notes"
            notes_dir.mkdir()
        
        # Create invalid JSON
        (temp_data_dir / "mapping.json").write_text("{ invalid json }")
        
        validator = DataValidator(temp_data_dir)
        result = validator.validate()
        
        assert result.success is False
        assert any("not valid JSON" in error for error in result.errors)
    
    def test_validate_mapping_missing_patient_mappings_key(self, temp_data_dir):
        """Test validation fails when mapping.json missing patient_mappings key."""
        temp_data_dir.mkdir()
        patients_dir = temp_data_dir / "patients"
        patients_dir.mkdir()
        
        # Create valid patient structure
        for i in range(1, 26):
            patient_dir = patients_dir / f"TCIA-{i:03d}"
            patient_dir.mkdir()
            
            claims_dir = patient_dir / "claims"
            claims_dir.mkdir()
            (claims_dir / f"cms1500_{i}.pdf").write_bytes(b"fake")
            (claims_dir / f"eob_{i}.pdf").write_bytes(b"fake")
            (claims_dir / f"radiology_report_{i}.pdf").write_bytes(b"fake")
            
            notes_dir = patient_dir / "clinical-notes"
            notes_dir.mkdir()
        
        # Create mapping without patient_mappings key
        mapping_data = {
            "encounter_study_mappings": {}
        }
        (temp_data_dir / "mapping.json").write_text(json.dumps(mapping_data))
        
        validator = DataValidator(temp_data_dir)
        result = validator.validate()
        
        assert result.success is False
        assert any("missing 'patient_mappings' key" in error for error in result.errors)
    
    def test_validate_mapping_missing_encounter_mappings_key(self, temp_data_dir):
        """Test validation fails when mapping.json missing encounter_study_mappings key."""
        temp_data_dir.mkdir()
        patients_dir = temp_data_dir / "patients"
        patients_dir.mkdir()
        
        # Create valid patient structure
        for i in range(1, 26):
            patient_dir = patients_dir / f"TCIA-{i:03d}"
            patient_dir.mkdir()
            
            claims_dir = patient_dir / "claims"
            claims_dir.mkdir()
            (claims_dir / f"cms1500_{i}.pdf").write_bytes(b"fake")
            (claims_dir / f"eob_{i}.pdf").write_bytes(b"fake")
            (claims_dir / f"radiology_report_{i}.pdf").write_bytes(b"fake")
            
            notes_dir = patient_dir / "clinical-notes"
            notes_dir.mkdir()
        
        # Create mapping without encounter_study_mappings key
        mapping_data = {
            "patient_mappings": [
                {"synthea_id": f"s-{i}", "tcia_id": f"TCIA-{i:03d}"}
                for i in range(1, 26)
            ]
        }
        (temp_data_dir / "mapping.json").write_text(json.dumps(mapping_data))
        
        validator = DataValidator(temp_data_dir)
        result = validator.validate()
        
        assert result.success is False
        assert any("missing 'encounter_study_mappings' key" in error for error in result.errors)
    
    def test_validate_mapping_directory_mismatch(self, temp_data_dir):
        """Test validation fails when mapping and directories don't match."""
        temp_data_dir.mkdir()
        patients_dir = temp_data_dir / "patients"
        patients_dir.mkdir()
        
        # Create 25 patient directories
        for i in range(1, 26):
            patient_dir = patients_dir / f"TCIA-{i:03d}"
            patient_dir.mkdir()
            
            claims_dir = patient_dir / "claims"
            claims_dir.mkdir()
            (claims_dir / f"cms1500_{i}.pdf").write_bytes(b"fake")
            (claims_dir / f"eob_{i}.pdf").write_bytes(b"fake")
            (claims_dir / f"radiology_report_{i}.pdf").write_bytes(b"fake")
            
            notes_dir = patient_dir / "clinical-notes"
            notes_dir.mkdir()
        
        # Create mapping with only 20 patients
        mapping_data = {
            "patient_mappings": [
                {"synthea_id": f"s-{i}", "tcia_id": f"TCIA-{i:03d}"}
                for i in range(1, 21)
            ],
            "encounter_study_mappings": {}
        }
        (temp_data_dir / "mapping.json").write_text(json.dumps(mapping_data))
        
        validator = DataValidator(temp_data_dir)
        result = validator.validate()
        
        assert result.success is False
        assert any("without mapping entries" in error for error in result.errors)
    
    def test_validation_report_format(self, valid_data_structure):
        """Test validation report generation."""
        validator = DataValidator(valid_data_structure)
        result = validator.validate()
        
        report = result.to_report()
        assert "✓ Validation PASSED" in report
    
    def test_validation_report_with_errors(self, temp_data_dir):
        """Test validation report with errors."""
        temp_data_dir.mkdir()
        
        validator = DataValidator(temp_data_dir)
        result = validator.validate()
        
        report = result.to_report()
        assert "✗ Validation FAILED" in report
        assert "Errors:" in report
