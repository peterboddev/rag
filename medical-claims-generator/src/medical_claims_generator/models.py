"""
Data models for Medical Claims Data Generator

This module contains all dataclasses and data structures used throughout
the application for representing patients, imaging studies, documents,
and generation results.
"""

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import List, Optional, Dict, Any
from enum import Enum
from pathlib import Path


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
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    
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
    upload_summary: Optional[Dict[str, Any]] = None  # S3 upload summary if performed


@dataclass
class GenerationConfig:
    """Configuration for data generation."""
    output_dir: Path
    tcia_metadata_path: Path
    patient_count: int  # 20-30
    seed: Optional[int] = None
    synthea_path: Path = Path("./synthea")
    s3_bucket: Optional[str] = None  # Optional S3 bucket for upload
    
    # CPT code range for CT imaging
    cpt_code_min: int = 71250
    cpt_code_max: int = 71275
    
    # Claim status distribution
    approved_percentage: float = 0.6
    denied_percentage: float = 0.2
    pending_percentage: float = 0.2
    
    # Cancer types to generate
    cancer_types: List[str] = field(default_factory=lambda: ["lung_cancer", "colorectal_cancer"])
    
    def __post_init__(self) -> None:
        """Validate configuration."""
        # Validate patient count
        if not 20 <= self.patient_count <= 30:
            raise ValueError("patient_count must be between 20 and 30")
        
        # Validate status percentages sum to 1.0
        total = self.approved_percentage + self.denied_percentage + self.pending_percentage
        if not abs(total - 1.0) < 0.001:
            raise ValueError("Status percentages must sum to 1.0")
