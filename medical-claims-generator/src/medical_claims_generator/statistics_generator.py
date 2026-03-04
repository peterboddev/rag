"""
Statistics Generator

Generates summary statistics about the dataset.
"""

from datetime import datetime
from typing import List, Dict

from .models import (
    Patient,
    PatientMapping,
    DocumentSet,
    Statistics,
    ClaimStatus
)


class StatisticsGenerator:
    """
    Generates comprehensive statistics about the generated dataset.
    
    Computes:
    - Total patient count
    - Patients by cancer type
    - Total claim count
    - Claims by status (approved/denied/pending)
    - Documents by type
    - TCIA patient IDs used
    - Random seed and generation timestamp
    """
    
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
        
        Args:
            patients: List of generated patients
            mapping: Patient mapping information
            documents: Collection of all generated documents
            seed: Random seed used for generation
            generation_time: Timestamp when generation started
        
        Returns:
            Statistics object with all metrics
        """
        # Count total patients
        total_patients = len(patients)
        
        # Count patients by cancer type
        patients_by_cancer_type = self._count_patients_by_cancer_type(patients)
        
        # Count total claims
        total_claims = len(documents.cms1500_forms)
        
        # Count claims by status
        claims_by_status = self._count_claims_by_status(documents)
        
        # Count documents by type
        documents_by_type = self._count_documents_by_type(documents)
        
        # Extract TCIA patient IDs from mapping
        tcia_patient_ids = sorted(set(mapping.patient_id_mapping.values()))
        
        # Format generation timestamp
        generation_timestamp = generation_time.isoformat()
        
        return Statistics(
            total_patients=total_patients,
            patients_by_cancer_type=patients_by_cancer_type,
            total_claims=total_claims,
            claims_by_status=claims_by_status,
            documents_by_type=documents_by_type,
            tcia_patient_ids=tcia_patient_ids,
            random_seed=seed,
            generation_timestamp=generation_timestamp
        )
    
    def _count_patients_by_cancer_type(self, patients: List[Patient]) -> Dict[str, int]:
        """
        Count patients by cancer diagnosis type.
        
        Args:
            patients: List of patients
        
        Returns:
            Dictionary mapping cancer type to patient count
        """
        cancer_type_counts: Dict[str, int] = {}
        
        for patient in patients:
            # Get cancer conditions for this patient
            cancer_conditions = [
                condition for condition in patient.conditions
                if "cancer" in condition.category.lower()
            ]
            
            # Count each cancer type
            for condition in cancer_conditions:
                cancer_type = condition.category
                cancer_type_counts[cancer_type] = cancer_type_counts.get(cancer_type, 0) + 1
        
        return cancer_type_counts
    
    def _count_claims_by_status(self, documents: DocumentSet) -> Dict[str, int]:
        """
        Count claims by processing status.
        
        Args:
            documents: Collection of all generated documents
        
        Returns:
            Dictionary mapping status to claim count
        """
        status_counts: Dict[str, int] = {
            ClaimStatus.APPROVED.value: 0,
            ClaimStatus.DENIED.value: 0,
            ClaimStatus.PENDING.value: 0
        }
        
        for eob in documents.eob_documents:
            status_value = eob.status.value
            status_counts[status_value] = status_counts.get(status_value, 0) + 1
        
        return status_counts
    
    def _count_documents_by_type(self, documents: DocumentSet) -> Dict[str, int]:
        """
        Count documents by type.
        
        Args:
            documents: Collection of all generated documents
        
        Returns:
            Dictionary mapping document type to count
        """
        return {
            "cms1500_forms": len(documents.cms1500_forms),
            "eob_documents": len(documents.eob_documents),
            "radiology_reports": len(documents.radiology_reports),
            "clinical_notes": len(documents.clinical_notes)
        }
