"""
Unit tests for DocumentGenerator

Tests claim status distribution (60/20/20 split), document count matching,
reproducibility of status assignment with same seed, and unique ID generation.

Validates Requirements 4.2-4.4, 9.4-9.5
"""

import pytest
import random
from datetime import date, timedelta
from unittest.mock import Mock, patch

from medical_claims_generator.document_generator import DocumentGenerator
from medical_claims_generator.models import (
    Patient, Address, Insurance, Encounter, Condition,
    PatientMapping, ImagingStudy, ClaimStatus
)


@pytest.fixture
def sample_patients():
    """Create sample patients for testing."""
    return [
        Patient(
            id="patient-001",
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
            id="patient-002",
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
def sample_mapping():
    """Create sample patient mapping for testing."""
    return PatientMapping(
        patient_id_mapping={
            "patient-001": "TCIA-001",
            "patient-002": "TCIA-002"
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


class TestDocumentGeneratorInitialization:
    """Tests for DocumentGenerator initialization."""
    
    def test_initialization_with_seed(self):
        """Test DocumentGenerator initializes with seed."""
        generator = DocumentGenerator(seed=42)
        assert generator.seed == 42
    
    def test_initialization_without_seed(self):
        """Test DocumentGenerator initializes without seed."""
        generator = DocumentGenerator()
        assert generator.seed is None
    
    def test_initialization_sets_random_seed(self):
        """Test that initialization sets random seed when provided."""
        # Get initial random state
        random.seed(None)
        val1 = random.random()
        
        # Initialize with seed
        generator = DocumentGenerator(seed=42)
        val2 = random.random()
        
        # Reset and verify reproducibility
        random.seed(42)
        val3 = random.random()
        
        assert val2 == val3
        assert val1 != val2
    
    def test_initialization_creates_pdf_generators(self):
        """Test that initialization creates all PDF generators."""
        generator = DocumentGenerator(seed=42)
        assert generator.cms1500_generator is not None
        assert generator.eob_generator is not None
        assert generator.radiology_generator is not None
        assert generator.clinical_note_generator is not None
    
    def test_initialization_resets_counters(self):
        """Test that initialization resets ID counters."""
        generator = DocumentGenerator(seed=42)
        assert generator._claim_counter == 1
        assert generator._eob_counter == 1
        assert generator._report_counter == 1
        assert generator._note_counter == 1


class TestClaimStatusDistribution:
    """Tests for claim status distribution (Requirement 4.2-4.4)."""
    
    def test_status_distribution_60_20_20(self, sample_patients, sample_mapping):
        """Test that claim statuses follow 60% approved, 20% denied, 20% pending distribution."""
        generator = DocumentGenerator(seed=42)
        
        # Generate a large number of documents to test distribution
        # We'll generate 100 EOBs to get statistically significant results
        # Need to increment claim counter to avoid randint(1, 0) error
        generator._claim_counter = 100
        
        statuses = []
        for i in range(100):
            # Mock CMS1500 document
            mock_cms1500 = Mock()
            mock_cms1500.claim_number = f"CLM{i:06d}"
            mock_cms1500.procedure_code = "71250"
            mock_cms1500.tcia_patient_id = "TCIA-001"
            
            eob = generator.generate_eob(
                cms1500=mock_cms1500,
                patient=sample_patients[0],
                encounter=sample_patients[0].encounters[0]
            )
            statuses.append(eob.status)
        
        # Count statuses
        approved_count = sum(1 for s in statuses if s == ClaimStatus.APPROVED)
        denied_count = sum(1 for s in statuses if s == ClaimStatus.DENIED)
        pending_count = sum(1 for s in statuses if s == ClaimStatus.PENDING)
        
        # Check distribution (allow 10% tolerance for randomness)
        assert 50 <= approved_count <= 70, f"Expected ~60 approved, got {approved_count}"
        assert 10 <= denied_count <= 30, f"Expected ~20 denied, got {denied_count}"
        assert 10 <= pending_count <= 30, f"Expected ~20 pending, got {pending_count}"
        assert approved_count + denied_count + pending_count == 100
    
    def test_status_distribution_reproducibility(self, sample_patients, sample_mapping):
        """Test that status assignment is reproducible with same seed (Requirement 9.4-9.5)."""
        # Generate with seed 42
        generator1 = DocumentGenerator(seed=42)
        generator1._claim_counter = 100  # Avoid randint(1, 0) error
        statuses1 = []
        for i in range(50):
            mock_cms1500 = Mock()
            mock_cms1500.claim_number = f"CLM{i:06d}"
            mock_cms1500.procedure_code = "71250"
            mock_cms1500.tcia_patient_id = "TCIA-001"
            
            eob = generator1.generate_eob(
                cms1500=mock_cms1500,
                patient=sample_patients[0],
                encounter=sample_patients[0].encounters[0]
            )
            statuses1.append(eob.status)
        
        # Generate again with same seed
        generator2 = DocumentGenerator(seed=42)
        generator2._claim_counter = 100  # Avoid randint(1, 0) error
        statuses2 = []
        for i in range(50):
            mock_cms1500 = Mock()
            mock_cms1500.claim_number = f"CLM{i:06d}"
            mock_cms1500.procedure_code = "71250"
            mock_cms1500.tcia_patient_id = "TCIA-001"
            
            eob = generator2.generate_eob(
                cms1500=mock_cms1500,
                patient=sample_patients[0],
                encounter=sample_patients[0].encounters[0]
            )
            statuses2.append(eob.status)
        
        # Verify identical status sequences
        assert statuses1 == statuses2
    
    def test_approved_claims_have_payment_info(self, sample_patients):
        """Test that approved claims include payment information."""
        generator = DocumentGenerator(seed=42)
        generator._claim_counter = 100  # Avoid randint(1, 0) error
        
        # Generate EOBs until we get an approved one
        approved_eob = None
        for i in range(100):
            mock_cms1500 = Mock()
            mock_cms1500.claim_number = f"CLM{i:06d}"
            mock_cms1500.procedure_code = "71250"
            mock_cms1500.tcia_patient_id = "TCIA-001"
            
            eob = generator.generate_eob(
                cms1500=mock_cms1500,
                patient=sample_patients[0],
                encounter=sample_patients[0].encounters[0]
            )
            
            if eob.status == ClaimStatus.APPROVED:
                approved_eob = eob
                break
        
        assert approved_eob is not None
        assert approved_eob.payment_info is not None
        assert approved_eob.payment_info.amount > 0
        assert approved_eob.payment_info.payment_date is not None
        assert approved_eob.denial_reason is None
    
    def test_denied_claims_have_denial_reason(self, sample_patients):
        """Test that denied claims include denial reason."""
        generator = DocumentGenerator(seed=42)
        generator._claim_counter = 100  # Avoid randint(1, 0) error
        
        # Generate EOBs until we get a denied one
        denied_eob = None
        for i in range(100):
            mock_cms1500 = Mock()
            mock_cms1500.claim_number = f"CLM{i:06d}"
            mock_cms1500.procedure_code = "71250"
            mock_cms1500.tcia_patient_id = "TCIA-001"
            
            eob = generator.generate_eob(
                cms1500=mock_cms1500,
                patient=sample_patients[0],
                encounter=sample_patients[0].encounters[0]
            )
            
            if eob.status == ClaimStatus.DENIED:
                denied_eob = eob
                break
        
        assert denied_eob is not None
        assert denied_eob.denial_reason is not None
        assert len(denied_eob.denial_reason) > 0
        assert denied_eob.payment_info is None
    
    def test_pending_claims_have_no_payment_or_denial(self, sample_patients):
        """Test that pending claims have neither payment info nor denial reason."""
        generator = DocumentGenerator(seed=42)
        generator._claim_counter = 100  # Avoid randint(1, 0) error
        
        # Generate EOBs until we get a pending one
        pending_eob = None
        for i in range(100):
            mock_cms1500 = Mock()
            mock_cms1500.claim_number = f"CLM{i:06d}"
            mock_cms1500.procedure_code = "71250"
            mock_cms1500.tcia_patient_id = "TCIA-001"
            
            eob = generator.generate_eob(
                cms1500=mock_cms1500,
                patient=sample_patients[0],
                encounter=sample_patients[0].encounters[0]
            )
            
            if eob.status == ClaimStatus.PENDING:
                pending_eob = eob
                break
        
        assert pending_eob is not None
        assert pending_eob.payment_info is None
        assert pending_eob.denial_reason is None


class TestDocumentCountMatching:
    """Tests for document count matching patient and encounter count."""
    
    @patch.object(DocumentGenerator, 'generate_cms1500')
    @patch.object(DocumentGenerator, 'generate_eob')
    @patch.object(DocumentGenerator, 'generate_radiology_report')
    @patch.object(DocumentGenerator, 'generate_clinical_note')
    def test_document_count_matches_encounters(
        self, mock_note, mock_rad, mock_eob, mock_cms,
        sample_patients, sample_mapping
    ):
        """Test that document count matches patient and encounter count."""
        # Setup mocks to return simple objects
        mock_cms.return_value = Mock()
        mock_eob.return_value = Mock()
        mock_rad.return_value = Mock()
        mock_note.return_value = Mock()
        
        generator = DocumentGenerator(seed=42)
        document_set = generator.generate_all_documents(sample_patients, sample_mapping)
        
        # Calculate expected counts
        total_encounters = sum(len(p.encounters) for p in sample_patients)
        total_studies = sum(
            len(studies) 
            for studies in sample_mapping.encounter_study_mapping.values()
        )
        
        # Verify clinical notes: one per encounter
        assert mock_note.call_count == total_encounters
        
        # Verify CMS1500, EOB, and radiology reports: one per imaging study
        assert mock_cms.call_count == total_studies
        assert mock_eob.call_count == total_studies
        assert mock_rad.call_count == total_studies
    
    @patch.object(DocumentGenerator, 'generate_cms1500')
    @patch.object(DocumentGenerator, 'generate_eob')
    @patch.object(DocumentGenerator, 'generate_radiology_report')
    @patch.object(DocumentGenerator, 'generate_clinical_note')
    def test_one_clinical_note_per_encounter(
        self, mock_note, mock_rad, mock_eob, mock_cms,
        sample_patients, sample_mapping
    ):
        """Test that exactly one clinical note is generated per encounter."""
        mock_cms.return_value = Mock()
        mock_eob.return_value = Mock()
        mock_rad.return_value = Mock()
        mock_note.return_value = Mock()
        
        generator = DocumentGenerator(seed=42)
        generator.generate_all_documents(sample_patients, sample_mapping)
        
        # Each patient has 1 encounter
        assert mock_note.call_count == 2
    
    @patch.object(DocumentGenerator, 'generate_cms1500')
    @patch.object(DocumentGenerator, 'generate_eob')
    @patch.object(DocumentGenerator, 'generate_radiology_report')
    @patch.object(DocumentGenerator, 'generate_clinical_note')
    def test_one_cms1500_per_imaging_study(
        self, mock_note, mock_rad, mock_eob, mock_cms,
        sample_patients, sample_mapping
    ):
        """Test that exactly one CMS-1500 is generated per imaging study."""
        mock_cms.return_value = Mock()
        mock_eob.return_value = Mock()
        mock_rad.return_value = Mock()
        mock_note.return_value = Mock()
        
        generator = DocumentGenerator(seed=42)
        generator.generate_all_documents(sample_patients, sample_mapping)
        
        # Each encounter has 1 imaging study
        assert mock_cms.call_count == 2
    
    @patch.object(DocumentGenerator, 'generate_cms1500')
    @patch.object(DocumentGenerator, 'generate_eob')
    @patch.object(DocumentGenerator, 'generate_radiology_report')
    @patch.object(DocumentGenerator, 'generate_clinical_note')
    def test_one_eob_per_cms1500(
        self, mock_note, mock_rad, mock_eob, mock_cms,
        sample_patients, sample_mapping
    ):
        """Test that exactly one EOB is generated per CMS-1500."""
        mock_cms.return_value = Mock()
        mock_eob.return_value = Mock()
        mock_rad.return_value = Mock()
        mock_note.return_value = Mock()
        
        generator = DocumentGenerator(seed=42)
        generator.generate_all_documents(sample_patients, sample_mapping)
        
        # One EOB per CMS-1500
        assert mock_eob.call_count == mock_cms.call_count


class TestUniqueIDGeneration:
    """Tests for unique ID generation."""
    
    def test_claim_numbers_are_unique(self, sample_patients, sample_mapping):
        """Test that all claim numbers are unique."""
        generator = DocumentGenerator(seed=42)
        
        # Mock PDF generators to avoid actual PDF generation
        with patch.object(generator.cms1500_generator, 'generate', return_value=b'mock_pdf'):
            document_set = generator.generate_all_documents(sample_patients, sample_mapping)
            
            claim_numbers = [doc.claim_number for doc in document_set.cms1500_forms]
            assert len(claim_numbers) == len(set(claim_numbers))
    
    def test_eob_numbers_are_unique(self, sample_patients, sample_mapping):
        """Test that all EOB numbers are unique."""
        generator = DocumentGenerator(seed=42)
        
        # Mock PDF generators
        with patch.object(generator.cms1500_generator, 'generate', return_value=b'mock_pdf'), \
             patch.object(generator.eob_generator, 'generate', return_value=b'mock_pdf'):
            document_set = generator.generate_all_documents(sample_patients, sample_mapping)
            
            eob_numbers = [doc.eob_number for doc in document_set.eob_documents]
            assert len(eob_numbers) == len(set(eob_numbers))
    
    def test_report_ids_are_unique(self, sample_patients, sample_mapping):
        """Test that all radiology report IDs are unique."""
        generator = DocumentGenerator(seed=42)
        
        # Mock PDF generators
        with patch.object(generator.radiology_generator, 'generate', return_value=b'mock_pdf'):
            document_set = generator.generate_all_documents(sample_patients, sample_mapping)
            
            report_ids = [doc.report_id for doc in document_set.radiology_reports]
            assert len(report_ids) == len(set(report_ids))
    
    def test_note_ids_are_unique(self, sample_patients, sample_mapping):
        """Test that all clinical note IDs are unique."""
        generator = DocumentGenerator(seed=42)
        
        # Mock PDF generators
        with patch.object(generator.clinical_note_generator, 'generate', return_value=b'mock_pdf'):
            document_set = generator.generate_all_documents(sample_patients, sample_mapping)
            
            note_ids = [doc.note_id for doc in document_set.clinical_notes]
            assert len(note_ids) == len(set(note_ids))
    
    def test_claim_numbers_sequential(self, sample_patients, sample_mapping):
        """Test that claim numbers are sequential."""
        generator = DocumentGenerator(seed=42)
        
        with patch.object(generator.cms1500_generator, 'generate', return_value=b'mock_pdf'):
            document_set = generator.generate_all_documents(sample_patients, sample_mapping)
            
            claim_numbers = [doc.claim_number for doc in document_set.cms1500_forms]
            # Extract numeric parts
            numbers = [int(cn.replace('CLM', '')) for cn in claim_numbers]
            # Check they are sequential starting from 1
            assert numbers == list(range(1, len(numbers) + 1))
    
    def test_id_format_consistency(self, sample_patients, sample_mapping):
        """Test that IDs follow consistent format patterns."""
        generator = DocumentGenerator(seed=42)
        
        with patch.object(generator.cms1500_generator, 'generate', return_value=b'mock_pdf'), \
             patch.object(generator.eob_generator, 'generate', return_value=b'mock_pdf'), \
             patch.object(generator.radiology_generator, 'generate', return_value=b'mock_pdf'), \
             patch.object(generator.clinical_note_generator, 'generate', return_value=b'mock_pdf'):
            
            document_set = generator.generate_all_documents(sample_patients, sample_mapping)
            
            # Check claim number format: CLM######
            for doc in document_set.cms1500_forms:
                assert doc.claim_number.startswith('CLM')
                assert len(doc.claim_number) == 9
                assert doc.claim_number[3:].isdigit()
            
            # Check EOB number format: EOB######
            for doc in document_set.eob_documents:
                assert doc.eob_number.startswith('EOB')
                assert len(doc.eob_number) == 9
                assert doc.eob_number[3:].isdigit()
            
            # Check report ID format: RAD######
            for doc in document_set.radiology_reports:
                assert doc.report_id.startswith('RAD')
                assert len(doc.report_id) == 9
                assert doc.report_id[3:].isdigit()
            
            # Check note ID format: NOTE######
            for doc in document_set.clinical_notes:
                assert doc.note_id.startswith('NOTE')
                assert len(doc.note_id) == 10
                assert doc.note_id[4:].isdigit()


class TestReproducibilityWithSeed:
    """Tests for reproducibility of document generation with same seed."""
    
    def test_reproducible_claim_numbers(self, sample_patients, sample_mapping):
        """Test that claim numbers are reproducible with same seed."""
        # Generate with seed 42
        generator1 = DocumentGenerator(seed=42)
        with patch.object(generator1.cms1500_generator, 'generate', return_value=b'mock_pdf'):
            docs1 = generator1.generate_all_documents(sample_patients, sample_mapping)
            claim_numbers1 = [doc.claim_number for doc in docs1.cms1500_forms]
        
        # Generate again with same seed
        generator2 = DocumentGenerator(seed=42)
        with patch.object(generator2.cms1500_generator, 'generate', return_value=b'mock_pdf'):
            docs2 = generator2.generate_all_documents(sample_patients, sample_mapping)
            claim_numbers2 = [doc.claim_number for doc in docs2.cms1500_forms]
        
        assert claim_numbers1 == claim_numbers2
    
    def test_reproducible_status_sequence(self, sample_patients, sample_mapping):
        """Test that EOB status sequence is reproducible with same seed."""
        # Generate with seed 42
        generator1 = DocumentGenerator(seed=42)
        with patch.object(generator1.cms1500_generator, 'generate', return_value=b'mock_pdf'), \
             patch.object(generator1.eob_generator, 'generate', return_value=b'mock_pdf'):
            docs1 = generator1.generate_all_documents(sample_patients, sample_mapping)
            statuses1 = [doc.status for doc in docs1.eob_documents]
        
        # Generate again with same seed
        generator2 = DocumentGenerator(seed=42)
        with patch.object(generator2.cms1500_generator, 'generate', return_value=b'mock_pdf'), \
             patch.object(generator2.eob_generator, 'generate', return_value=b'mock_pdf'):
            docs2 = generator2.generate_all_documents(sample_patients, sample_mapping)
            statuses2 = [doc.status for doc in docs2.eob_documents]
        
        assert statuses1 == statuses2
    
    def test_different_seeds_produce_different_results(self, sample_patients, sample_mapping):
        """Test that different seeds produce different status sequences."""
        # Generate with seed 42
        generator1 = DocumentGenerator(seed=42)
        with patch.object(generator1.cms1500_generator, 'generate', return_value=b'mock_pdf'), \
             patch.object(generator1.eob_generator, 'generate', return_value=b'mock_pdf'):
            docs1 = generator1.generate_all_documents(sample_patients, sample_mapping)
            statuses1 = [doc.status for doc in docs1.eob_documents]
        
        # Generate with seed 99
        generator2 = DocumentGenerator(seed=99)
        with patch.object(generator2.cms1500_generator, 'generate', return_value=b'mock_pdf'), \
             patch.object(generator2.eob_generator, 'generate', return_value=b'mock_pdf'):
            docs2 = generator2.generate_all_documents(sample_patients, sample_mapping)
            statuses2 = [doc.status for doc in docs2.eob_documents]
        
        # Different seeds should produce different sequences
        # (with very high probability for 2+ documents)
        if len(statuses1) > 1:
            assert statuses1 != statuses2
