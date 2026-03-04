"""
Unit tests for PatientMapper

Tests the mapping functionality between Synthea patients and TCIA imaging data.
"""

import pytest
import pandas as pd
from datetime import date, timedelta
from medical_claims_generator.patient_mapper import PatientMapper
from medical_claims_generator.models import (
    Patient, Address, Insurance, Encounter, Condition, ImagingStudy
)


@pytest.fixture
def sample_synthea_patients():
    """Create sample Synthea patients for testing."""
    return [
        Patient(
            id="synthea-001",
            name="John Doe",
            birth_date=date(1960, 1, 1),
            gender="M",
            address=Address("123 Main St", None, "Boston", "MA", "02101"),
            insurance=Insurance("Blue Cross", "POL123", "GRP456"),
            encounters=[
                Encounter(
                    id="enc-001",
                    date=date(2023, 6, 15),
                    type="outpatient",
                    provider="Dr. Smith",
                    reason=["chest pain"]
                )
            ],
            conditions=[
                Condition(
                    code="C34.90",
                    display="Lung cancer",
                    onset_date=date(2023, 6, 1),
                    category="lung_cancer"
                )
            ]
        ),
        Patient(
            id="synthea-002",
            name="Jane Smith",
            birth_date=date(1965, 5, 10),
            gender="F",
            address=Address("456 Oak Ave", None, "Boston", "MA", "02102"),
            insurance=Insurance("Aetna", "POL789", "GRP012"),
            encounters=[
                Encounter(
                    id="enc-002",
                    date=date(2023, 7, 20),
                    type="outpatient",
                    provider="Dr. Jones",
                    reason=["abdominal pain"]
                )
            ],
            conditions=[
                Condition(
                    code="C18.9",
                    display="Colorectal cancer",
                    onset_date=date(2023, 7, 1),
                    category="colorectal_cancer"
                )
            ]
        )
    ]


@pytest.fixture
def sample_tcia_metadata():
    """Create sample TCIA metadata DataFrame."""
    return pd.DataFrame({
        'PatientID': ['TCIA-001', 'TCIA-001', 'TCIA-002', 'TCIA-002', 'TCIA-003'],
        'StudyInstanceUID': ['1.2.3.001', '1.2.3.002', '1.2.3.003', '1.2.3.004', '1.2.3.005'],
        'Modality': ['CT', 'CT', 'CT', 'CT', 'CT'],
        'StudyDate': ['20230615', '20230620', '20230720', '20230725', '20230801'],
        'SeriesDescription': ['Chest CT', 'Chest CT Follow-up', 'Abdomen CT', 'Pelvis CT', 'Head CT']
    })


class TestPatientMapper:
    """Test suite for PatientMapper class."""
    
    def test_initialization_with_seed(self):
        """Test PatientMapper initialization with seed."""
        mapper = PatientMapper(seed=42)
        assert mapper.seed == 42
    
    def test_initialization_without_seed(self):
        """Test PatientMapper initialization without seed."""
        mapper = PatientMapper()
        assert mapper.seed is None
    
    def test_validate_tcia_data_success(self, sample_tcia_metadata):
        """Test TCIA data validation with valid CT studies."""
        mapper = PatientMapper()
        validated = mapper._validate_tcia_data(sample_tcia_metadata)
        
        assert len(validated) == 5
        assert all(validated['Modality'] == 'CT')
        assert 'StudyDate' in validated.columns
    
    def test_validate_tcia_data_missing_columns(self):
        """Test TCIA data validation fails with missing columns."""
        mapper = PatientMapper()
        invalid_df = pd.DataFrame({
            'PatientID': ['TCIA-001'],
            'StudyInstanceUID': ['1.2.3.001']
            # Missing required columns
        })
        
        with pytest.raises(ValueError, match="Missing required columns"):
            mapper._validate_tcia_data(invalid_df)
    
    def test_validate_tcia_data_no_ct_studies(self):
        """Test TCIA data validation fails when no CT studies found."""
        mapper = PatientMapper()
        no_ct_df = pd.DataFrame({
            'PatientID': ['TCIA-001'],
            'StudyInstanceUID': ['1.2.3.001'],
            'Modality': ['MR'],  # Not CT
            'StudyDate': ['20230615'],
            'SeriesDescription': ['Brain MRI']
        })
        
        with pytest.raises(ValueError, match="No CT studies found"):
            mapper._validate_tcia_data(no_ct_df)
    
    def test_create_patient_mapping_one_to_one(self, sample_synthea_patients):
        """Test 1:1 patient mapping constraint."""
        mapper = PatientMapper(seed=42)
        tcia_ids = ['TCIA-001', 'TCIA-002', 'TCIA-003']
        
        mapping = mapper._create_patient_mapping(sample_synthea_patients, tcia_ids)
        
        # Check all Synthea patients are mapped
        assert len(mapping) == len(sample_synthea_patients)
        assert all(p.id in mapping for p in sample_synthea_patients)
        
        # Check each TCIA ID is used at most once
        tcia_values = list(mapping.values())
        assert len(tcia_values) == len(set(tcia_values))
    
    def test_create_patient_mapping_reproducibility(self, sample_synthea_patients):
        """Test mapping reproducibility with same seed."""
        tcia_ids = ['TCIA-001', 'TCIA-002', 'TCIA-003']
        
        mapper1 = PatientMapper(seed=42)
        mapping1 = mapper1._create_patient_mapping(sample_synthea_patients, tcia_ids)
        
        mapper2 = PatientMapper(seed=42)
        mapping2 = mapper2._create_patient_mapping(sample_synthea_patients, tcia_ids)
        
        assert mapping1 == mapping2
    
    def test_map_encounters_to_studies(self, sample_synthea_patients, sample_tcia_metadata):
        """Test encounter to study mapping based on date proximity."""
        mapper = PatientMapper(seed=42)
        
        # Create patient mapping
        patient_mapping = {
            'synthea-001': 'TCIA-001',
            'synthea-002': 'TCIA-002'
        }
        
        # Validate TCIA data first
        validated_tcia = mapper._validate_tcia_data(sample_tcia_metadata)
        
        # Map encounters to studies
        encounter_mapping = mapper._map_encounters_to_studies(
            patient_mapping,
            sample_synthea_patients,
            validated_tcia
        )
        
        # Check all encounters are in mapping
        assert 'enc-001' in encounter_mapping
        assert 'enc-002' in encounter_mapping
        
        # Check encounter-001 (date: 2023-06-15) maps to TCIA-001 studies
        enc_001_studies = encounter_mapping['enc-001']
        assert len(enc_001_studies) > 0
        assert all(s.tcia_patient_id == 'TCIA-001' for s in enc_001_studies)
    
    def test_extract_anatomical_region(self):
        """Test anatomical region extraction from series descriptions."""
        mapper = PatientMapper()
        
        assert mapper._extract_anatomical_region("Chest CT") == "chest"
        assert mapper._extract_anatomical_region("Thorax scan") == "chest"
        assert mapper._extract_anatomical_region("Abdomen CT") == "abdomen"
        assert mapper._extract_anatomical_region("Pelvic region") == "pelvis"
        assert mapper._extract_anatomical_region("Brain scan") == "head"
        assert mapper._extract_anatomical_region("Unknown scan") == "unknown"
    
    def test_map_patients_success(self, sample_synthea_patients, sample_tcia_metadata):
        """Test complete patient mapping workflow."""
        mapper = PatientMapper(seed=42)
        
        result = mapper.map_patients(sample_synthea_patients, sample_tcia_metadata)
        
        # Check patient mapping
        assert len(result.patient_id_mapping) == len(sample_synthea_patients)
        
        # Check encounter mapping
        assert len(result.encounter_study_mapping) > 0
        
        # Verify mapping can be serialized to JSON
        json_output = result.to_json()
        assert 'patient_mappings' in json_output
        assert 'encounter_study_mappings' in json_output
    
    def test_map_patients_insufficient_tcia_patients(self, sample_synthea_patients):
        """Test error when insufficient TCIA patients available."""
        mapper = PatientMapper()
        
        # Only one TCIA patient for two Synthea patients
        insufficient_tcia = pd.DataFrame({
            'PatientID': ['TCIA-001'],
            'StudyInstanceUID': ['1.2.3.001'],
            'Modality': ['CT'],
            'StudyDate': ['20230615'],
            'SeriesDescription': ['Chest CT']
        })
        
        with pytest.raises(ValueError, match="Insufficient TCIA patients"):
            mapper.map_patients(sample_synthea_patients, insufficient_tcia)
