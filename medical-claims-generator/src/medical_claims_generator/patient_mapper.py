"""
Patient Mapper

Creates mappings between Synthea patients and TCIA imaging data.
Implements 1:1 patient mapping and encounter-to-study associations.
"""

import random
from typing import List, Dict, Optional
from datetime import date, timedelta
import pandas as pd

from .models import Patient, ImagingStudy, PatientMapping


class PatientMapper:
    """
    Maps Synthea synthetic patients to TCIA imaging data.
    
    Creates 1:1 mappings between Synthea patient IDs and TCIA patient IDs,
    and associates patient encounters with imaging studies based on date proximity.
    """
    
    def __init__(self, seed: Optional[int] = None):
        """
        Initialize mapper with optional random seed.
        
        Args:
            seed: Random seed for reproducible mapping
        """
        self.seed = seed
        if seed is not None:
            random.seed(seed)
    
    def map_patients(
        self,
        synthea_patients: List[Patient],
        tcia_metadata: pd.DataFrame
    ) -> PatientMapping:
        """
        Create 1:1 mapping between Synthea patients and TCIA patients.
        
        Args:
            synthea_patients: List of generated Synthea patients
            tcia_metadata: TCIA metadata DataFrame
            
        Returns:
            PatientMapping containing patient ID mappings and encounter-study associations
            
        Raises:
            ValueError: If insufficient TCIA patients or invalid data
        """
        # Validate and filter TCIA data
        validated_tcia = self._validate_tcia_data(tcia_metadata)
        
        # Get unique TCIA patient IDs
        tcia_patient_ids = validated_tcia['PatientID'].unique().tolist()
        
        # Check if we have enough TCIA patients
        if len(tcia_patient_ids) < len(synthea_patients):
            raise ValueError(
                f"Insufficient TCIA patients: need {len(synthea_patients)}, "
                f"but only {len(tcia_patient_ids)} available"
            )
        
        # Create 1:1 patient mapping
        patient_id_mapping = self._create_patient_mapping(
            synthea_patients,
            tcia_patient_ids
        )
        
        # Map encounters to imaging studies
        encounter_study_mapping = self._map_encounters_to_studies(
            patient_id_mapping,
            synthea_patients,
            validated_tcia
        )
        
        return PatientMapping(
            patient_id_mapping=patient_id_mapping,
            encounter_study_mapping=encounter_study_mapping
        )
    
    def _validate_tcia_data(self, tcia_metadata: pd.DataFrame) -> pd.DataFrame:
        """
        Filter TCIA data for CT studies and validate required fields.
        
        Args:
            tcia_metadata: Raw TCIA metadata DataFrame
            
        Returns:
            Filtered and validated DataFrame containing only CT studies
            
        Raises:
            ValueError: If required fields are missing or no CT studies found
        """
        # Check for required columns
        required_columns = [
            'PatientID',
            'StudyInstanceUID',
            'Modality',
            'StudyDate',
            'SeriesDescription'
        ]
        
        missing_columns = [col for col in required_columns if col not in tcia_metadata.columns]
        if missing_columns:
            raise ValueError(f"Missing required columns in TCIA metadata: {missing_columns}")
        
        # Filter for CT modality studies
        ct_studies = tcia_metadata[tcia_metadata['Modality'] == 'CT'].copy()
        
        if ct_studies.empty:
            raise ValueError("No CT studies found in TCIA metadata")
        
        # Remove rows with missing critical data
        ct_studies = ct_studies.dropna(subset=['PatientID', 'StudyInstanceUID', 'StudyDate'])
        
        if ct_studies.empty:
            raise ValueError("No valid CT studies after filtering missing data")
        
        # Parse StudyDate to datetime (try ISO format first, then YYYYMMDD)
        try:
            ct_studies['StudyDate'] = pd.to_datetime(ct_studies['StudyDate'], format='ISO8601')
        except Exception:
            try:
                ct_studies['StudyDate'] = pd.to_datetime(ct_studies['StudyDate'], format='%Y%m%d')
            except Exception as e:
                raise ValueError(f"Failed to parse StudyDate: {e}")
        
        return ct_studies
    
    def _create_patient_mapping(
        self,
        synthea_patients: List[Patient],
        tcia_patient_ids: List[str]
    ) -> Dict[str, str]:
        """
        Create 1:1 Synthea ID to TCIA ID mapping.
        
        Each Synthea patient is mapped to exactly one TCIA patient,
        and each TCIA patient is used at most once.
        
        Args:
            synthea_patients: List of Synthea patients
            tcia_patient_ids: List of available TCIA patient IDs
            
        Returns:
            Dictionary mapping Synthea patient ID to TCIA patient ID
        """
        # Shuffle TCIA patient IDs for random assignment
        shuffled_tcia_ids = tcia_patient_ids.copy()
        random.shuffle(shuffled_tcia_ids)
        
        # Create 1:1 mapping
        mapping = {}
        for i, patient in enumerate(synthea_patients):
            mapping[patient.id] = shuffled_tcia_ids[i]
        
        return mapping
    
    def _map_encounters_to_studies(
        self,
        patient_mapping: Dict[str, str],
        synthea_patients: List[Patient],
        tcia_metadata: pd.DataFrame
    ) -> Dict[str, List[ImagingStudy]]:
        """
        Map patient encounters to imaging studies based on date proximity.
        
        For each encounter, finds imaging studies from the mapped TCIA patient
        that occurred within a reasonable time window of the encounter date.
        
        Args:
            patient_mapping: Synthea ID to TCIA ID mapping
            synthea_patients: List of Synthea patients
            tcia_metadata: Validated TCIA metadata DataFrame
            
        Returns:
            Dictionary mapping encounter ID to list of associated imaging studies
        """
        encounter_study_mapping: Dict[str, List[ImagingStudy]] = {}
        
        # Date matching window (days before/after encounter)
        date_window_days = 30
        
        for patient in synthea_patients:
            # Get the mapped TCIA patient ID
            tcia_patient_id = patient_mapping[patient.id]
            
            # Get all studies for this TCIA patient
            patient_studies = tcia_metadata[
                tcia_metadata['PatientID'] == tcia_patient_id
            ]
            
            # For each encounter, find matching studies
            for encounter in patient.encounters:
                matching_studies = []
                
                # Define date range for matching
                encounter_date = encounter.date
                start_date = encounter_date - timedelta(days=date_window_days)
                end_date = encounter_date + timedelta(days=date_window_days)
                
                # Find studies within date window
                for _, study_row in patient_studies.iterrows():
                    study_date = study_row['StudyDate'].date()
                    
                    if start_date <= study_date <= end_date:
                        # Extract anatomical region from series description
                        series_desc = str(study_row.get('SeriesDescription', ''))
                        anatomical_region = self._extract_anatomical_region(series_desc)
                        
                        imaging_study = ImagingStudy(
                            study_uid=str(study_row['StudyInstanceUID']),
                            tcia_patient_id=tcia_patient_id,
                            modality=str(study_row['Modality']),
                            study_date=study_date,
                            series_description=series_desc,
                            anatomical_region=anatomical_region
                        )
                        matching_studies.append(imaging_study)
                
                # Store mapping even if no studies found (empty list)
                encounter_study_mapping[encounter.id] = matching_studies
        
        return encounter_study_mapping
    
    def _extract_anatomical_region(self, series_description: str) -> str:
        """
        Extract anatomical region from series description.
        
        Args:
            series_description: DICOM series description text
            
        Returns:
            Anatomical region string (e.g., "chest", "abdomen", "pelvis")
        """
        # Convert to lowercase for matching
        desc_lower = series_description.lower()
        
        # Common anatomical regions in CT imaging
        regions = {
            'chest': ['chest', 'thorax', 'lung', 'pulmonary'],
            'abdomen': ['abdomen', 'abdominal', 'liver', 'kidney'],
            'pelvis': ['pelvis', 'pelvic'],
            'head': ['head', 'brain', 'cranial'],
            'neck': ['neck', 'cervical'],
            'spine': ['spine', 'spinal', 'vertebral']
        }
        
        # Find matching region
        for region, keywords in regions.items():
            if any(keyword in desc_lower for keyword in keywords):
                return region
        
        # Default to "unknown" if no match found
        return "unknown"
