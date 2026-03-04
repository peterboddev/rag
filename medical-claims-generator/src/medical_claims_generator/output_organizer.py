"""
Output Organizer

Creates directory structure and places generated files.
"""

import json
import shutil
from pathlib import Path
from typing import List

from .models import DocumentSet, PatientMapping


class OutputOrganizer:
    """
    Organizes generated documents into a structured directory hierarchy.
    
    Creates the following structure:
    medical_data/
    ├── patients/
    │   ├── TCIA-001/
    │   │   ├── claims/
    │   │   │   ├── cms1500_001.pdf
    │   │   │   ├── eob_001.pdf
    │   │   │   └── radiology_report_001.pdf
    │   │   └── clinical-notes/
    │   │       └── note_001.pdf
    ├── metadata/
    │   ├── tcia_metadata.csv
    │   └── synthea-output/
    ├── mapping.json
    └── statistics.json
    """
    
    def __init__(self, root_dir: Path):
        """
        Initialize organizer with root output directory.
        
        Args:
            root_dir: Root directory for all output files
        """
        self.root_dir = Path(root_dir)
    
    def organize(
        self,
        documents: DocumentSet,
        mapping: PatientMapping,
        synthea_output_path: Path,
        tcia_metadata_path: Path
    ) -> None:
        """
        Create directory structure and place all files.
        
        Args:
            documents: Collection of all generated documents
            mapping: Patient mapping information
            synthea_output_path: Path to Synthea output directory
            tcia_metadata_path: Path to TCIA metadata CSV file
        """
        # Get list of TCIA patient IDs from mapping
        tcia_patient_ids = list(set(mapping.patient_id_mapping.values()))
        
        # Create directory structure
        self._create_directory_structure(tcia_patient_ids)
        
        # Place documents in appropriate directories
        self._place_documents(documents, mapping)
        
        # Copy metadata files
        self._copy_metadata(synthea_output_path, tcia_metadata_path)
        
        # Write mapping.json at root level
        mapping_file = self.root_dir / "mapping.json"
        with open(mapping_file, 'w') as f:
            json.dump(mapping.to_json(), f, indent=2)
    
    def _create_directory_structure(self, tcia_patient_ids: List[str]) -> None:
        """
        Create all required directories.
        
        Args:
            tcia_patient_ids: List of TCIA patient IDs
        """
        # Create root directory
        self.root_dir.mkdir(parents=True, exist_ok=True)
        
        # Create patients directory
        patients_dir = self.root_dir / "patients"
        patients_dir.mkdir(exist_ok=True)
        
        # Create directory for each TCIA patient
        for tcia_id in tcia_patient_ids:
            patient_dir = patients_dir / tcia_id
            patient_dir.mkdir(exist_ok=True)
            
            # Create claims subdirectory
            claims_dir = patient_dir / "claims"
            claims_dir.mkdir(exist_ok=True)
            
            # Create clinical-notes subdirectory
            notes_dir = patient_dir / "clinical-notes"
            notes_dir.mkdir(exist_ok=True)
        
        # Create metadata directory
        metadata_dir = self.root_dir / "metadata"
        metadata_dir.mkdir(exist_ok=True)
        
        # Create synthea-output subdirectory within metadata
        synthea_output_dir = metadata_dir / "synthea-output"
        synthea_output_dir.mkdir(exist_ok=True)
    
    def _place_documents(self, documents: DocumentSet, mapping: PatientMapping) -> None:
        """
        Write PDFs to appropriate subdirectories.
        
        Args:
            documents: Collection of all generated documents
            mapping: Patient mapping information
        """
        patients_dir = self.root_dir / "patients"
        
        # Place CMS-1500 forms in claims subdirectory
        for cms1500 in documents.cms1500_forms:
            tcia_id = cms1500.tcia_patient_id
            claims_dir = patients_dir / tcia_id / "claims"
            file_path = claims_dir / cms1500.filename
            with open(file_path, 'wb') as f:
                f.write(cms1500.pdf_bytes)
        
        # Place EOB documents in claims subdirectory
        for eob in documents.eob_documents:
            tcia_id = eob.tcia_patient_id
            claims_dir = patients_dir / tcia_id / "claims"
            file_path = claims_dir / eob.filename
            with open(file_path, 'wb') as f:
                f.write(eob.pdf_bytes)
        
        # Place radiology reports in claims subdirectory
        for report in documents.radiology_reports:
            tcia_id = report.tcia_patient_id
            claims_dir = patients_dir / tcia_id / "claims"
            file_path = claims_dir / report.filename
            with open(file_path, 'wb') as f:
                f.write(report.pdf_bytes)
        
        # Place clinical notes in clinical-notes subdirectory
        for note in documents.clinical_notes:
            tcia_id = note.tcia_patient_id
            notes_dir = patients_dir / tcia_id / "clinical-notes"
            file_path = notes_dir / note.filename
            with open(file_path, 'wb') as f:
                f.write(note.pdf_bytes)
    
    def _copy_metadata(self, synthea_output_path: Path, tcia_metadata_path: Path) -> None:
        """
        Copy metadata files to output directory.
        
        Args:
            synthea_output_path: Path to Synthea output directory
            tcia_metadata_path: Path to TCIA metadata CSV file
        """
        metadata_dir = self.root_dir / "metadata"
        
        # Copy TCIA metadata CSV to metadata directory
        if tcia_metadata_path.exists():
            dest_path = metadata_dir / "tcia_metadata.csv"
            shutil.copy2(tcia_metadata_path, dest_path)
        
        # Copy Synthea output files to synthea-output subdirectory
        if synthea_output_path.exists():
            synthea_dest = metadata_dir / "synthea-output"
            
            # Copy all files and subdirectories from Synthea output
            for item in synthea_output_path.iterdir():
                if item.is_file():
                    shutil.copy2(item, synthea_dest / item.name)
                elif item.is_dir():
                    dest_subdir = synthea_dest / item.name
                    if dest_subdir.exists():
                        shutil.rmtree(dest_subdir)
                    shutil.copytree(item, dest_subdir)
