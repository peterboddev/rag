"""
Data Validator

Validates completeness of generated data.
"""

import json
import logging
from pathlib import Path
from typing import List

from .models import ValidationResult

logger = logging.getLogger(__name__)


class DataValidator:
    """
    Validates completeness of generated dataset.
    
    Checks:
    - Patient count is between 20 and 30
    - Each patient directory contains required documents
    - mapping.json file exists and is complete
    """
    
    def __init__(self, root_dir: Path):
        """
        Initialize validator with root directory.
        
        Args:
            root_dir: Root directory of generated data
        """
        self.root_dir = Path(root_dir)
    
    def validate(self) -> ValidationResult:
        """
        Validate completeness of generated dataset.
        
        Returns:
            ValidationResult with success status and any errors/warnings
        """
        logger.info("Starting data validation")
        
        errors: List[str] = []
        warnings: List[str] = []
        
        # Run all validation checks
        logger.debug("Validating patient count")
        errors.extend(self._validate_patient_count())
        
        logger.debug("Validating patient documents")
        errors.extend(self._validate_patient_documents())
        
        logger.debug("Validating mapping file")
        errors.extend(self._validate_mapping_file())
        
        # Determine overall success
        success = len(errors) == 0
        
        if success:
            logger.info("Validation completed successfully with no errors")
        else:
            logger.warning(f"Validation completed with {len(errors)} error(s)")
            for error in errors:
                logger.error(f"Validation error: {error}")
        
        return ValidationResult(
            success=success,
            errors=errors,
            warnings=warnings
        )
    
    def _validate_patient_count(self) -> List[str]:
        """
        Verify patient count is between 20 and 30.
        
        Returns:
            List of error messages (empty if valid)
        """
        errors: List[str] = []
        
        patients_dir = self.root_dir / "patients"
        
        # Check if patients directory exists
        if not patients_dir.exists():
            errors.append("patients/ directory does not exist")
            return errors
        
        # Count patient directories
        patient_dirs = [d for d in patients_dir.iterdir() if d.is_dir()]
        patient_count = len(patient_dirs)
        
        # Validate count is in range
        if patient_count < 20:
            errors.append(f"Patient count ({patient_count}) is less than minimum (20)")
        elif patient_count > 30:
            errors.append(f"Patient count ({patient_count}) exceeds maximum (30)")
        
        return errors
    
    def _validate_patient_documents(self) -> List[str]:
        """
        Verify each patient has required documents.
        
        Required documents per patient:
        - At least one CMS-1500 PDF in claims/
        - At least one EOB PDF in claims/
        - At least one radiology report PDF in claims/
        
        Returns:
            List of error messages (empty if valid)
        """
        errors: List[str] = []
        
        patients_dir = self.root_dir / "patients"
        
        # Check if patients directory exists
        if not patients_dir.exists():
            errors.append("patients/ directory does not exist")
            return errors
        
        # Check each patient directory
        patient_dirs = [d for d in patients_dir.iterdir() if d.is_dir()]
        
        for patient_dir in patient_dirs:
            patient_id = patient_dir.name
            claims_dir = patient_dir / "claims"
            notes_dir = patient_dir / "clinical-notes"
            
            # Check if claims directory exists
            if not claims_dir.exists():
                errors.append(f"Patient {patient_id}: claims/ directory missing")
                continue
            
            # Check if clinical-notes directory exists
            if not notes_dir.exists():
                errors.append(f"Patient {patient_id}: clinical-notes/ directory missing")
            
            # Get all PDF files in claims directory
            claim_pdfs = list(claims_dir.glob("*.pdf"))
            
            # Check for at least one CMS-1500 form
            cms1500_pdfs = [f for f in claim_pdfs if f.name.startswith("cms1500_")]
            if not cms1500_pdfs:
                errors.append(f"Patient {patient_id}: no CMS-1500 forms found in claims/")
            
            # Check for at least one EOB document
            eob_pdfs = [f for f in claim_pdfs if f.name.startswith("eob_")]
            if not eob_pdfs:
                errors.append(f"Patient {patient_id}: no EOB documents found in claims/")
            
            # Check for at least one radiology report
            radiology_pdfs = [f for f in claim_pdfs if f.name.startswith("radiology_report_")]
            if not radiology_pdfs:
                errors.append(f"Patient {patient_id}: no radiology reports found in claims/")
        
        return errors
    
    def _validate_mapping_file(self) -> List[str]:
        """
        Verify mapping.json exists and is complete.
        
        Checks:
        - File exists
        - File is valid JSON
        - Contains patient_mappings array
        - Contains encounter_study_mappings object
        - All patient directories have corresponding mapping entries
        
        Returns:
            List of error messages (empty if valid)
        """
        errors: List[str] = []
        
        mapping_file = self.root_dir / "mapping.json"
        
        # Check if mapping.json exists
        if not mapping_file.exists():
            errors.append("mapping.json file does not exist")
            return errors
        
        # Try to parse JSON
        try:
            with open(mapping_file, 'r') as f:
                mapping_data = json.load(f)
        except json.JSONDecodeError as e:
            errors.append(f"mapping.json is not valid JSON: {e}")
            return errors
        
        # Check for required keys
        if "patient_mappings" not in mapping_data:
            errors.append("mapping.json missing 'patient_mappings' key")
        
        if "encounter_study_mappings" not in mapping_data:
            errors.append("mapping.json missing 'encounter_study_mappings' key")
        
        # If we have errors, don't continue with deeper validation
        if errors:
            return errors
        
        # Get TCIA patient IDs from mapping
        tcia_ids_in_mapping = set()
        for mapping_entry in mapping_data.get("patient_mappings", []):
            if "tcia_id" in mapping_entry:
                tcia_ids_in_mapping.add(mapping_entry["tcia_id"])
        
        # Get TCIA patient IDs from directory structure
        patients_dir = self.root_dir / "patients"
        if patients_dir.exists():
            tcia_ids_in_dirs = set(d.name for d in patients_dir.iterdir() if d.is_dir())
            
            # Check if all directories have mapping entries
            missing_mappings = tcia_ids_in_dirs - tcia_ids_in_mapping
            if missing_mappings:
                errors.append(
                    f"Patient directories without mapping entries: {', '.join(sorted(missing_mappings))}"
                )
            
            # Check if all mapping entries have directories
            missing_dirs = tcia_ids_in_mapping - tcia_ids_in_dirs
            if missing_dirs:
                errors.append(
                    f"Mapping entries without patient directories: {', '.join(sorted(missing_dirs))}"
                )
        
        return errors
