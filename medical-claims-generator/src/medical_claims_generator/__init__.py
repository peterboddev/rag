"""
Medical Claims Data Generator

A Python tool for generating synthetic medical insurance claim datasets
for testing and demonstration purposes.
"""

__version__ = "0.1.0"
__author__ = "Development Team"

from medical_claims_generator.models import (
    Patient,
    Address,
    Insurance,
    Condition,
    Encounter,
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

__all__ = [
    "__version__",
    "__author__",
    "Patient",
    "Address",
    "Insurance",
    "Condition",
    "Encounter",
    "ImagingStudy",
    "ClaimStatus",
    "PaymentInfo",
    "CMS1500Document",
    "EOBDocument",
    "RadiologyReport",
    "ClinicalNote",
    "PatientMapping",
    "DocumentSet",
    "ValidationResult",
    "Statistics",
    "GenerationResult",
    "GenerationConfig",
]
