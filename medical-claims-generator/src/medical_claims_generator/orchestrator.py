"""
Generation Orchestrator

Coordinates the entire data generation workflow.
"""

import json
import logging
import random
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Dict, Any

import pandas as pd

from .models import (
    GenerationConfig,
    GenerationResult,
    Patient,
    PatientMapping,
    DocumentSet,
    ValidationResult,
    Statistics
)
from .patient_generator import PatientGenerator
from .patient_mapper import PatientMapper
from .document_generator import DocumentGenerator
from .output_organizer import OutputOrganizer
from .validator import DataValidator
from .statistics_generator import StatisticsGenerator
from .s3_uploader import S3Uploader, S3UploadError

logger = logging.getLogger(__name__)


class GenerationOrchestrator:
    """
    Orchestrates the complete medical claims data generation workflow.
    
    Workflow steps:
    1. Setup random seed for reproducibility
    2. Generate synthetic patients using Synthea
    3. Load TCIA metadata CSV
    4. Map Synthea patients to TCIA imaging data
    5. Generate all PDF documents
    6. Organize output into directory structure
    7. Validate completeness
    8. Generate statistics
    9. Return GenerationResult
    """
    
    def __init__(self, config: GenerationConfig):
        """
        Initialize orchestrator with configuration.
        
        Args:
            config: GenerationConfig with all generation parameters
        """
        self.config = config
        self.generation_start_time = datetime.now()
        self.actual_seed: Optional[int] = None
    
    def generate(self) -> GenerationResult:
        """
        Execute the complete generation workflow.
        
        Returns:
            GenerationResult containing statistics and validation status
            
        Raises:
            RuntimeError: If any step of the generation process fails
            ValueError: If configuration or data validation fails
        """
        try:
            logger.info("Starting medical claims data generation workflow")
            
            # Step 1: Setup random seed
            self.actual_seed = self._setup_random_seed()
            logger.info(f"Using random seed: {self.actual_seed}")
            print(f"Using random seed: {self.actual_seed}")
            
            # Step 2: Generate synthetic patients
            logger.info(f"Generating {self.config.patient_count} synthetic patients")
            print(f"Generating {self.config.patient_count} synthetic patients...")
            patients = self._generate_patients()
            logger.info(f"Successfully generated {len(patients)} patients")
            print(f"Generated {len(patients)} patients")
            
            # Step 3: Load TCIA metadata
            logger.info("Loading TCIA metadata")
            print("Loading TCIA metadata...")
            tcia_metadata = self._load_tcia_metadata()
            logger.info(f"Loaded {len(tcia_metadata)} TCIA imaging studies")
            print(f"Loaded {len(tcia_metadata)} TCIA imaging studies")
            
            # Step 4: Map patients to imaging data
            logger.info("Mapping patients to imaging studies")
            print("Mapping patients to imaging studies...")
            mapping = self._map_patients(patients, tcia_metadata)
            logger.info(f"Created mappings for {len(mapping.patient_id_mapping)} patients")
            print(f"Created mappings for {len(mapping.patient_id_mapping)} patients")
            
            # Step 5: Generate documents
            logger.info("Generating PDF documents")
            print("Generating PDF documents...")
            documents = self._generate_documents(patients, mapping)
            logger.info(f"Generated {len(documents.cms1500_forms)} CMS-1500 forms, "
                       f"{len(documents.eob_documents)} EOBs, "
                       f"{len(documents.radiology_reports)} radiology reports, "
                       f"{len(documents.clinical_notes)} clinical notes")
            print(f"Generated {len(documents.cms1500_forms)} CMS-1500 forms, "
                  f"{len(documents.eob_documents)} EOBs, "
                  f"{len(documents.radiology_reports)} radiology reports, "
                  f"{len(documents.clinical_notes)} clinical notes")
            
            # Step 6: Organize output
            logger.info("Organizing output files")
            print("Organizing output files...")
            self._organize_output(documents, mapping)
            logger.info(f"Output organized in {self.config.output_dir}")
            print(f"Output organized in {self.config.output_dir}")
            
            # Step 7: Validate output
            logger.info("Validating generated data")
            print("Validating generated data...")
            validation_result = self._validate_output()
            if validation_result.success:
                logger.info("Validation passed")
                print("✓ Validation passed")
            else:
                logger.warning("Validation failed")
                print("✗ Validation failed")
                print(validation_result.to_report())
            
            # Step 8: Generate statistics
            logger.info("Generating statistics")
            print("Generating statistics...")
            statistics = self._generate_statistics(patients, mapping, documents)
            
            # Write statistics.json to output directory
            # Ensure output directory exists
            self.config.output_dir.mkdir(parents=True, exist_ok=True)
            statistics_file = self.config.output_dir / "statistics.json"
            with open(statistics_file, 'w') as f:
                json.dump(statistics.to_json(), f, indent=2)
            logger.info(f"Statistics written to {statistics_file}")
            print(f"Statistics written to {statistics_file}")
            
            # Step 9: Upload to S3 if configured
            upload_summary = None
            if self.config.s3_bucket:
                logger.info(f"Uploading to S3 bucket: {self.config.s3_bucket}")
                print(f"Uploading to S3 bucket: {self.config.s3_bucket}...")
                upload_summary = self._upload_to_s3()
                if upload_summary and upload_summary.get('success'):
                    logger.info(f"Upload completed: {upload_summary['file_count']} files, "
                               f"{upload_summary['total_bytes']:,} bytes")
                    print(f"✓ Upload completed: {upload_summary['file_count']} files, "
                          f"{upload_summary['total_bytes']:,} bytes")
                elif upload_summary:
                    logger.warning(f"Upload completed with errors: {upload_summary.get('error_message')}")
                    print(f"⚠ Upload completed with errors: {upload_summary.get('error_message')}")
            
            # Step 10: Return result
            logger.info("Generation workflow completed successfully")
            return GenerationResult(
                success=validation_result.success,
                statistics=statistics,
                validation_result=validation_result,
                output_directory=self.config.output_dir,
                upload_summary=upload_summary
            )
            
        except Exception as e:
            # If generation fails, return failure result with error information
            logger.exception(f"Generation failed: {str(e)}")
            print(f"Generation failed: {str(e)}")
            
            # Create minimal statistics and validation result for failure case
            statistics = Statistics(
                total_patients=0,
                patients_by_cancer_type={},
                total_claims=0,
                claims_by_status={},
                documents_by_type={},
                tcia_patient_ids=[],
                random_seed=self.actual_seed or 0,
                generation_timestamp=self.generation_start_time.isoformat()
            )
            
            validation_result = ValidationResult(
                success=False,
                errors=[f"Generation failed: {str(e)}"],
                warnings=[]
            )
            
            return GenerationResult(
                success=False,
                statistics=statistics,
                validation_result=validation_result,
                output_directory=self.config.output_dir
            )
    
    def _setup_random_seed(self) -> int:
        """
        Setup and record random seed for reproducibility.
        
        If a seed is provided in config, use it. Otherwise, generate a random seed.
        
        Returns:
            The random seed being used
        """
        if self.config.seed is not None:
            seed = self.config.seed
        else:
            # Generate a random seed based on current time
            seed = int(datetime.now().timestamp() * 1000000) % (2**31)
        
        # Set the random seed for Python's random module
        random.seed(seed)
        
        return seed
    
    def _generate_patients(self) -> List[Patient]:
        """
        Generate synthetic patients using Synthea via PatientGenerator.
        
        Returns:
            List of Patient objects
            
        Raises:
            RuntimeError: If Synthea execution fails
        """
        # Create PatientGenerator
        patient_generator = PatientGenerator(
            synthea_path=self.config.synthea_path,
            output_dir=self.config.output_dir / "synthea_temp",
            seed=self.actual_seed
        )
        
        # Generate patients with specified cancer types
        patients = patient_generator.generate_patients(
            count=self.config.patient_count,
            cancer_types=self.config.cancer_types
        )
        
        return patients
    
    def _load_tcia_metadata(self) -> pd.DataFrame:
        """
        Load and validate TCIA metadata CSV using pandas.
        
        Returns:
            DataFrame containing TCIA metadata
            
        Raises:
            FileNotFoundError: If TCIA metadata file doesn't exist
            ValueError: If CSV parsing fails
        """
        # Check if file exists
        if not self.config.tcia_metadata_path.exists():
            raise FileNotFoundError(
                f"TCIA metadata file not found: {self.config.tcia_metadata_path}"
            )
        
        # Load CSV using pandas
        try:
            tcia_metadata = pd.read_csv(self.config.tcia_metadata_path)
        except Exception as e:
            raise ValueError(f"Failed to load TCIA metadata CSV: {e}")
        
        # Basic validation - check if DataFrame is not empty
        if tcia_metadata.empty:
            raise ValueError("TCIA metadata CSV is empty")
        
        return tcia_metadata
    
    def _map_patients(
        self,
        patients: List[Patient],
        tcia_metadata: pd.DataFrame
    ) -> PatientMapping:
        """
        Create patient-to-imaging mappings using PatientMapper.
        
        Args:
            patients: List of generated patients
            tcia_metadata: TCIA metadata DataFrame
            
        Returns:
            PatientMapping with patient ID and encounter-study mappings
            
        Raises:
            ValueError: If mapping fails due to insufficient data
        """
        # Create PatientMapper with same seed
        patient_mapper = PatientMapper(seed=self.actual_seed)
        
        # Create mappings
        mapping = patient_mapper.map_patients(
            synthea_patients=patients,
            tcia_metadata=tcia_metadata
        )
        
        return mapping
    
    def _generate_documents(
        self,
        patients: List[Patient],
        mapping: PatientMapping
    ) -> DocumentSet:
        """
        Generate all PDF documents using DocumentGenerator.
        
        Args:
            patients: List of patients
            mapping: Patient mapping information
            
        Returns:
            DocumentSet containing all generated documents
        """
        # Create DocumentGenerator with same seed
        document_generator = DocumentGenerator(seed=self.actual_seed)
        
        # Generate all documents
        documents = document_generator.generate_all_documents(
            patients=patients,
            mapping=mapping
        )
        
        return documents
    
    def _organize_output(
        self,
        documents: DocumentSet,
        mapping: PatientMapping
    ) -> None:
        """
        Organize output into directory structure using OutputOrganizer.
        
        Args:
            documents: Collection of all generated documents
            mapping: Patient mapping information
        """
        # Create OutputOrganizer
        output_organizer = OutputOrganizer(root_dir=self.config.output_dir)
        
        # Get Synthea output path
        synthea_output_path = self.config.output_dir / "synthea_temp" / "synthea_output"
        
        # Organize all files
        output_organizer.organize(
            documents=documents,
            mapping=mapping,
            synthea_output_path=synthea_output_path,
            tcia_metadata_path=self.config.tcia_metadata_path
        )
    
    def _validate_output(self) -> ValidationResult:
        """
        Validate completeness of generated data using DataValidator.
        
        Returns:
            ValidationResult with success status and any errors
        """
        # Create DataValidator
        validator = DataValidator(root_dir=self.config.output_dir)
        
        # Run validation
        validation_result = validator.validate()
        
        return validation_result
    
    def _generate_statistics(
        self,
        patients: List[Patient],
        mapping: PatientMapping,
        documents: DocumentSet
    ) -> Statistics:
        """
        Generate summary statistics using StatisticsGenerator.
        
        Args:
            patients: List of generated patients
            mapping: Patient mapping information
            documents: Collection of all generated documents
            
        Returns:
            Statistics object with all metrics
        """
        # Create StatisticsGenerator
        stats_generator = StatisticsGenerator()
        
        # Generate statistics
        statistics = stats_generator.generate(
            patients=patients,
            mapping=mapping,
            documents=documents,
            seed=self.actual_seed or 0,
            generation_time=self.generation_start_time
        )
        
        return statistics
    
    def _upload_to_s3(self) -> Optional[Dict[str, Any]]:
        """
        Upload generated data to S3 bucket.
        
        Returns:
            Upload summary dictionary or None if upload fails
        """
        if not self.config.s3_bucket:
            return None
        
        try:
            # Create S3 uploader
            uploader = S3Uploader(bucket_name=self.config.s3_bucket)
            
            # Upload directory
            upload_summary = uploader.upload_directory(self.config.output_dir)
            
            return upload_summary
            
        except S3UploadError as e:
            # Log warning but don't fail generation
            print(f"⚠ S3 upload failed: {str(e)}")
            return {
                'success': False,
                'file_count': 0,
                'total_bytes': 0,
                'failed_files': [],
                'error_message': str(e)
            }
        except Exception as e:
            # Catch any unexpected errors
            print(f"⚠ Unexpected error during S3 upload: {str(e)}")
            return {
                'success': False,
                'file_count': 0,
                'total_bytes': 0,
                'failed_files': [],
                'error_message': f"Unexpected error: {str(e)}"
            }
