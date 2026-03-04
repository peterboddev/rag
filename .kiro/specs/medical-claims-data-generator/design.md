# Design Document: Medical Claims Data Generator

## Overview

The Medical Claims Data Generator is a Python-based command-line tool that creates synthetic insurance claim datasets for testing and demonstration purposes. The tool orchestrates the generation of realistic patient records using Synthea, maps them to real medical imaging metadata from TCIA (The Cancer Imaging Archive), and produces comprehensive claim documentation including CMS-1500 forms, EOB documents, radiology reports, and clinical notes.

### Key Design Principles

- **Modularity**: Separate concerns into distinct components (patient generation, mapping, document generation, validation)
- **Testability**: Design components with clear interfaces that can be unit tested and property tested
- **Reproducibility**: Support deterministic generation through random seed control
- **Simplicity**: Command-line interface with sensible defaults, minimal configuration required
- **Data Integrity**: Validate all mappings and generated outputs to ensure completeness

### Technology Stack

- **Language**: Python 3.10+
- **PDF Generation**: ReportLab (for structured forms like CMS-1500) and WeasyPrint (for styled documents)
- **FHIR Parsing**: fhir.resources library for parsing Synthea FHIR R4 output
- **Data Processing**: pandas for CSV/JSON manipulation
- **External Tools**: Synthea (Java-based, invoked via subprocess)
- **Testing**: pytest for unit tests, Hypothesis for property-based testing

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CLI Entry Point                          │
│                  (main.py)                                  │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Generation Orchestrator                        │
│         (orchestrates entire workflow)                      │
└─┬───────┬───────┬───────┬───────┬───────┬──────────────────┘
  │       │       │       │       │       │
  ▼       ▼       ▼       ▼       ▼       ▼
┌───┐   ┌───┐   ┌───┐   ┌───┐   ┌───┐   ┌────┐
│ 1 │   │ 2 │   │ 3 │   │ 4 │   │ 5 │   │ 6  │
└───┘   └───┘   └───┘   └───┘   └───┘   └────┘

1. Patient Generator (Synthea wrapper)
2. Patient Mapper (Synthea ↔ TCIA mapping)
3. Document Generator (CMS-1500, EOB, reports, notes)
4. Output Organizer (directory structure creation)
5. Data Validator (completeness checks)
6. Statistics Generator (summary reports)
```

### Component Interaction Flow

```
┌──────────────┐
│ User invokes │
│ CLI command  │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ 1. Generate Patients (Synthea)                      │
│    - Execute Synthea with cancer modules            │
│    - Output: FHIR JSON + CSV files                  │
└──────┬───────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ 2. Load TCIA Metadata                               │
│    - Parse TCIA CSV                                  │
│    - Filter for CT studies                          │
└──────┬───────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ 3. Map Patients to Imaging                          │
│    - Create 1:1 Synthea ↔ TCIA mapping             │
│    - Map encounters to imaging studies              │
│    - Output: mapping.json                           │
└──────┬───────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ 4. Generate Documents                               │
│    - CMS-1500 forms (PDF)                           │
│    - EOB documents (PDF)                            │
│    - Radiology reports (PDF)                        │
│    - Clinical notes (PDF)                           │
└──────┬───────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ 5. Organize Output                                  │
│    - Create directory structure                     │
│    - Place files in appropriate locations           │
└──────┬───────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│ 6. Validate & Report                                │
│    - Verify completeness                            │
│    - Generate statistics                            │
│    - Output summary                                 │
└──────┬───────────────────────────────────────────────┘
       │
       ▼
┌──────────────┐
│ Complete     │
└──────────────┘
```

## Components and Interfaces

### 1. CLI Entry Point (`main.py`)

**Responsibility**: Parse command-line arguments and invoke the orchestrator.

**Interface**:
```python
def main(
    output_dir: str = "medical_data",
    tcia_metadata_path: str = "tcia_metadata.csv",
    patient_count: int = 25,
    seed: Optional[int] = None,
    synthea_path: str = "./synthea"
) -> int:
    """
    Main entry point for the data generator.
    
    Args:
        output_dir: Root directory for generated data
        tcia_metadata_path: Path to TCIA metadata CSV
        patient_count: Number of patients to generate (20-30)
        seed: Random seed for reproducibility
        synthea_path: Path to Synthea installation
        
    Returns:
        Exit code (0 for success, non-zero for failure)
    """
```

### 2. Generation Orchestrator (`orchestrator.py`)

**Responsibility**: Coordinate the entire generation workflow.

**Interface**:
```python
class GenerationOrchestrator:
    def __init__(
        self,
        output_dir: Path,
        tcia_metadata_path: Path,
        patient_count: int,
        seed: Optional[int],
        synthea_path: Path
    ):
        """Initialize orchestrator with configuration."""
        
    def generate(self) -> GenerationResult:
        """
        Execute the complete generation workflow.
        
        Returns:
            GenerationResult containing statistics and validation status
        """
        
    def _setup_random_seed(self) -> int:
        """Setup and record random seed."""
        
    def _generate_patients(self) -> List[Patient]:
        """Generate synthetic patients using Synthea."""
        
    def _load_tcia_metadata(self) -> pd.DataFrame:
        """Load and validate TCIA metadata."""
        
    def _map_patients(self, patients: List[Patient], tcia_data: pd.DataFrame) -> PatientMapping:
        """Create patient-to-imaging mappings."""
        
    def _generate_documents(self, mapping: PatientMapping) -> DocumentSet:
        """Generate all claim and clinical documents."""
        
    def _organize_output(self, documents: DocumentSet, mapping: PatientMapping) -> None:
        """Create directory structure and place files."""
        
    def _validate_output(self) -> ValidationResult:
        """Validate completeness of generated data."""
        
    def _generate_statistics(self, mapping: PatientMapping, documents: DocumentSet) -> Statistics:
        """Generate summary statistics."""
```

### 3. Patient Generator (`patient_generator.py`)

**Responsibility**: Wrapper for Synthea execution and FHIR parsing.

**Interface**:
```python
class PatientGenerator:
    def __init__(self, synthea_path: Path, output_dir: Path, seed: Optional[int]):
        """Initialize patient generator."""
        
    def generate_patients(self, count: int, cancer_types: List[str]) -> List[Patient]:
        """
        Generate synthetic patients with specified cancer diagnoses.
        
        Args:
            count: Number of patients to generate
            cancer_types: List of cancer types (e.g., ["lung_cancer", "colorectal_cancer"])
            
        Returns:
            List of Patient objects parsed from FHIR output
        """
        
    def _execute_synthea(self, count: int, modules: List[str]) -> Path:
        """Execute Synthea command-line tool."""
        
    def _parse_fhir_output(self, output_path: Path) -> List[Patient]:
        """Parse FHIR R4 JSON files into Patient objects."""

class Patient:
    """Represents a synthetic patient with encounters and conditions."""
    id: str
    name: str
    birth_date: date
    gender: str
    address: Address
    insurance: Insurance
    encounters: List[Encounter]
    conditions: List[Condition]
```

### 4. Patient Mapper (`patient_mapper.py`)

**Responsibility**: Create mappings between Synthea patients and TCIA imaging data.

**Interface**:
```python
class PatientMapper:
    def __init__(self, seed: Optional[int]):
        """Initialize mapper with random seed."""
        
    def map_patients(
        self,
        synthea_patients: List[Patient],
        tcia_metadata: pd.DataFrame
    ) -> PatientMapping:
        """
        Create 1:1 mapping between Synthea patients and TCIA patients.
        
        Args:
            synthea_patients: List of generated patients
            tcia_metadata: TCIA metadata DataFrame
            
        Returns:
            PatientMapping containing all associations
        """
        
    def _validate_tcia_data(self, tcia_metadata: pd.DataFrame) -> pd.DataFrame:
        """Filter TCIA data for CT studies and validate required fields."""
        
    def _create_patient_mapping(
        self,
        synthea_patients: List[Patient],
        tcia_patients: List[str]
    ) -> Dict[str, str]:
        """Create 1:1 Synthea ID to TCIA ID mapping."""
        
    def _map_encounters_to_studies(
        self,
        patient_mapping: Dict[str, str],
        synthea_patients: List[Patient],
        tcia_metadata: pd.DataFrame
    ) -> Dict[str, List[ImagingStudy]]:
        """Map patient encounters to imaging studies."""

class PatientMapping:
    """Complete mapping between Synthea and TCIA data."""
    patient_id_mapping: Dict[str, str]  # Synthea ID -> TCIA ID
    encounter_study_mapping: Dict[str, List[ImagingStudy]]  # Encounter ID -> Studies
    
    def to_json(self) -> dict:
        """Serialize mapping to JSON format."""
```

### 5. Document Generator (`document_generator.py`)

**Responsibility**: Generate all PDF documents (claims, EOBs, reports, notes).

**Interface**:
```python
class DocumentGenerator:
    def __init__(self, seed: Optional[int]):
        """Initialize document generator."""
        
    def generate_all_documents(
        self,
        patients: List[Patient],
        mapping: PatientMapping
    ) -> DocumentSet:
        """
        Generate all documents for all patients.
        
        Returns:
            DocumentSet containing all generated documents
        """
        
    def generate_cms1500(
        self,
        patient: Patient,
        encounter: Encounter,
        imaging_study: ImagingStudy
    ) -> CMS1500Document:
        """Generate CMS-1500 claim form PDF."""
        
    def generate_eob(
        self,
        cms1500: CMS1500Document,
        status: ClaimStatus
    ) -> EOBDocument:
        """Generate Explanation of Benefits PDF."""
        
    def generate_radiology_report(
        self,
        patient: Patient,
        imaging_study: ImagingStudy,
        cancer_type: str
    ) -> RadiologyReport:
        """Generate radiology report PDF."""
        
    def generate_clinical_note(
        self,
        patient: Patient,
        encounter: Encounter
    ) -> ClinicalNote:
        """Generate clinical note PDF."""

class DocumentSet:
    """Collection of all generated documents."""
    cms1500_forms: List[CMS1500Document]
    eob_documents: List[EOBDocument]
    radiology_reports: List[RadiologyReport]
    clinical_notes: List[ClinicalNote]
```

### 6. PDF Generators (`pdf_generators/`)

**Responsibility**: Specialized PDF generation for each document type.

**Interface**:
```python
# pdf_generators/cms1500_generator.py
class CMS1500Generator:
    def generate(
        self,
        patient: Patient,
        provider: Provider,
        diagnosis_codes: List[str],
        procedure_code: str,
        study_uid: str
    ) -> bytes:
        """Generate CMS-1500 form as PDF bytes using ReportLab."""

# pdf_generators/eob_generator.py
class EOBGenerator:
    def generate(
        self,
        claim_number: str,
        patient: Patient,
        status: ClaimStatus,
        payment_info: Optional[PaymentInfo],
        denial_reason: Optional[str]
    ) -> bytes:
        """Generate EOB document as PDF bytes."""

# pdf_generators/radiology_report_generator.py
class RadiologyReportGenerator:
    def generate(
        self,
        patient: Patient,
        study_uid: str,
        modality: str,
        anatomical_region: str,
        findings: str,
        radiologist: str,
        report_date: date
    ) -> bytes:
        """Generate radiology report as PDF bytes."""

# pdf_generators/clinical_note_generator.py
class ClinicalNoteGenerator:
    def generate(
        self,
        patient: Patient,
        encounter: Encounter,
        symptoms: List[str],
        imaging_orders: List[str],
        treatment_plan: str,
        physician: str
    ) -> bytes:
        """Generate clinical note as PDF bytes."""
```

### 7. Output Organizer (`output_organizer.py`)

**Responsibility**: Create directory structure and place files.

**Interface**:
```python
class OutputOrganizer:
    def __init__(self, root_dir: Path):
        """Initialize organizer with root output directory."""
        
    def organize(
        self,
        documents: DocumentSet,
        mapping: PatientMapping,
        synthea_output_path: Path,
        tcia_metadata_path: Path
    ) -> None:
        """
        Create directory structure and place all files.
        
        Directory structure:
        medical_data/
        ├── patients/
        │   ├── TCIA-001/
        │   │   ├── claims/
        │   │   │   ├── cms1500_001.pdf
        │   │   │   ├── eob_001.pdf
        │   │   │   └── radiology_report_001.pdf
        │   │   └── clinical-notes/
        │   │       └── note_001.pdf
        │   └── TCIA-002/
        │       └── ...
        ├── metadata/
        │   ├── tcia_metadata.csv
        │   └── synthea-output/
        │       ├── fhir/
        │       └── csv/
        ├── mapping.json
        └── statistics.json
        """
        
    def _create_directory_structure(self, tcia_patient_ids: List[str]) -> None:
        """Create all required directories."""
        
    def _place_documents(self, documents: DocumentSet, mapping: PatientMapping) -> None:
        """Place documents in appropriate directories."""
        
    def _copy_metadata(self, synthea_path: Path, tcia_path: Path) -> None:
        """Copy metadata files to output directory."""
```

### 8. Data Validator (`validator.py`)

**Responsibility**: Validate completeness of generated data.

**Interface**:
```python
class DataValidator:
    def __init__(self, root_dir: Path):
        """Initialize validator with root directory."""
        
    def validate(self) -> ValidationResult:
        """
        Validate completeness of generated dataset.
        
        Returns:
            ValidationResult with success status and any errors
        """
        
    def _validate_patient_count(self) -> List[str]:
        """Verify patient count is between 20 and 30."""
        
    def _validate_patient_documents(self) -> List[str]:
        """Verify each patient has required documents."""
        
    def _validate_mapping_file(self) -> List[str]:
        """Verify mapping.json exists and is complete."""

class ValidationResult:
    """Result of validation checks."""
    success: bool
    errors: List[str]
    warnings: List[str]
    
    def to_report(self) -> str:
        """Generate human-readable validation report."""
```

### 9. Statistics Generator (`statistics_generator.py`)

**Responsibility**: Generate summary statistics about the dataset.

**Interface**:
```python
class StatisticsGenerator:
    def generate(
        self,
        patients: List[Patient],
        mapping: PatientMapping,
        documents: DocumentSet,
        seed: int,
        generation_time: datetime
    ) -> Statistics:
        """
        Generate comprehensive statistics about the dataset.
        
        Returns:
            Statistics object with all metrics
        """

class Statistics:
    """Summary statistics for generated dataset."""
    total_patients: int
    patients_by_cancer_type: Dict[str, int]
    total_claims: int
    claims_by_status: Dict[str, int]
    documents_by_type: Dict[str, int]
    tcia_patient_ids: List[str]
    random_seed: int
    generation_timestamp: str
    
    def to_json(self) -> dict:
        """Serialize statistics to JSON format."""
```

## Data Models

### Core Data Structures

```python
from dataclasses import dataclass
from datetime import date, datetime
from typing import List, Optional, Dict
from enum import Enum

@dataclass
class Address:
    """Patient address information."""
    line1: str
    line2: Optional[str]
    city: str
    state: str
    postal_code: str

@dataclass
class Insurance:
    """Patient insurance information."""
    payer_name: str
    policy_number: str
    group_number: Optional[str]

@dataclass
class Condition:
    """Medical condition/diagnosis."""
    code: str  # ICD-10 code
    display: str
    onset_date: date
    category: str  # e.g., "lung_cancer", "colorectal_cancer"

@dataclass
class Encounter:
    """Clinical encounter."""
    id: str
    date: date
    type: str
    provider: str
    reason: List[str]

@dataclass
class Patient:
    """Synthetic patient record."""
    id: str
    name: str
    birth_date: date
    gender: str
    address: Address
    insurance: Insurance
    encounters: List[Encounter]
    conditions: List[Condition]

@dataclass
class ImagingStudy:
    """TCIA imaging study metadata."""
    study_uid: str
    tcia_patient_id: str
    modality: str
    study_date: date
    series_description: str
    anatomical_region: str

class ClaimStatus(Enum):
    """Claim processing status."""
    APPROVED = "approved"
    DENIED = "denied"
    PENDING = "pending"

@dataclass
class PaymentInfo:
    """Payment information for approved claims."""
    amount: float
    payment_date: date

@dataclass
class CMS1500Document:
    """CMS-1500 claim form."""
    claim_number: str
    patient_id: str
    tcia_patient_id: str
    encounter_id: str
    study_uid: str
    procedure_code: str
    diagnosis_codes: List[str]
    pdf_bytes: bytes
    filename: str

@dataclass
class EOBDocument:
    """Explanation of Benefits document."""
    eob_number: str
    claim_number: str
    patient_id: str
    tcia_patient_id: str
    status: ClaimStatus
    payment_info: Optional[PaymentInfo]
    denial_reason: Optional[str]
    pdf_bytes: bytes
    filename: str

@dataclass
class RadiologyReport:
    """Radiology report document."""
    report_id: str
    patient_id: str
    tcia_patient_id: str
    study_uid: str
    modality: str
    anatomical_region: str
    findings: str
    radiologist: str
    report_date: date
    pdf_bytes: bytes
    filename: str

@dataclass
class ClinicalNote:
    """Clinical note document."""
    note_id: str
    patient_id: str
    tcia_patient_id: str
    encounter_id: str
    symptoms: List[str]
    imaging_orders: List[str]
    treatment_plan: str
    physician: str
    note_date: date
    pdf_bytes: bytes
    filename: str

@dataclass
class PatientMapping:
    """Complete mapping between Synthea and TCIA data."""
    patient_id_mapping: Dict[str, str]  # Synthea ID -> TCIA ID
    encounter_study_mapping: Dict[str, List[ImagingStudy]]  # Encounter ID -> Studies
    
    def to_json(self) -> dict:
        """Serialize to JSON format."""
        return {
            "patient_mappings": [
                {"synthea_id": sid, "tcia_id": tid}
                for sid, tid in self.patient_id_mapping.items()
            ],
            "encounter_study_mappings": {
                encounter_id: [
                    {
                        "study_uid": study.study_uid,
                        "modality": study.modality,
                        "study_date": study.study_date.isoformat()
                    }
                    for study in studies
                ]
                for encounter_id, studies in self.encounter_study_mapping.items()
            }
        }

@dataclass
class DocumentSet:
    """Collection of all generated documents."""
    cms1500_forms: List[CMS1500Document]
    eob_documents: List[EOBDocument]
    radiology_reports: List[RadiologyReport]
    clinical_notes: List[ClinicalNote]

@dataclass
class ValidationResult:
    """Result of validation checks."""
    success: bool
    errors: List[str]
    warnings: List[str]
    
    def to_report(self) -> str:
        """Generate human-readable validation report."""
        if self.success:
            report = "✓ Validation PASSED\n"
        else:
            report = "✗ Validation FAILED\n"
        
        if self.errors:
            report += "\nErrors:\n"
            for error in self.errors:
                report += f"  - {error}\n"
        
        if self.warnings:
            report += "\nWarnings:\n"
            for warning in self.warnings:
                report += f"  - {warning}\n"
        
        return report

@dataclass
class Statistics:
    """Summary statistics for generated dataset."""
    total_patients: int
    patients_by_cancer_type: Dict[str, int]
    total_claims: int
    claims_by_status: Dict[str, int]
    documents_by_type: Dict[str, int]
    tcia_patient_ids: List[str]
    random_seed: int
    generation_timestamp: str
    
    def to_json(self) -> dict:
        """Serialize to JSON format."""
        return {
            "total_patients": self.total_patients,
            "patients_by_cancer_type": self.patients_by_cancer_type,
            "total_claims": self.total_claims,
            "claims_by_status": self.claims_by_status,
            "documents_by_type": self.documents_by_type,
            "tcia_patient_ids": self.tcia_patient_ids,
            "random_seed": self.random_seed,
            "generation_timestamp": self.generation_timestamp
        }

@dataclass
class GenerationResult:
    """Result of complete generation process."""
    success: bool
    statistics: Statistics
    validation_result: ValidationResult
    output_directory: Path
```

### Configuration Model

```python
@dataclass
class GenerationConfig:
    """Configuration for data generation."""
    output_dir: Path
    tcia_metadata_path: Path
    patient_count: int  # 20-30
    seed: Optional[int]
    synthea_path: Path
    
    # CPT code range for CT imaging
    cpt_code_min: int = 71250
    cpt_code_max: int = 71275
    
    # Claim status distribution
    approved_percentage: float = 0.6
    denied_percentage: float = 0.2
    pending_percentage: float = 0.2
    
    # Cancer types to generate
    cancer_types: List[str] = None
    
    def __post_init__(self):
        if self.cancer_types is None:
            self.cancer_types = ["lung_cancer", "colorectal_cancer"]
        
        # Validate patient count
        if not 20 <= self.patient_count <= 30:
            raise ValueError("patient_count must be between 20 and 30")
        
        # Validate status percentages sum to 1.0
        total = self.approved_percentage + self.denied_percentage + self.pending_percentage
        if not abs(total - 1.0) < 0.001:
            raise ValueError("Status percentages must sum to 1.0")
```

