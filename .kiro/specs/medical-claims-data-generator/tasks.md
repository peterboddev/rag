# Implementation Plan: Medical Claims Data Generator

## Overview

This implementation plan breaks down the Medical Claims Data Generator into discrete coding tasks. The tool is a Python 3.10+ CLI application that generates synthetic insurance claim datasets by orchestrating Synthea patient generation, mapping to TCIA imaging metadata, and producing comprehensive claim documentation as PDFs.

## Tasks

- [x] 1. Set up project structure and dependencies
  - Create Python package structure with src/ directory
  - Create setup.py or pyproject.toml with project metadata
  - Define dependencies: fhir.resources, pandas, reportlab, weasyprint, boto3, pytest, hypothesis
  - Create requirements.txt and requirements-dev.txt
  - Set up pytest configuration
  - Create README with installation and usage instructions
  - _Requirements: All requirements depend on proper project setup_

- [x] 2. Implement core data models
  - [x] 2.1 Create data models module (src/models.py)
    - Implement Address, Insurance, Condition, Encounter, Patient dataclasses
    - Implement ImagingStudy dataclass
    - Implement ClaimStatus enum
    - Implement PaymentInfo dataclass
    - Implement document dataclasses (CMS1500Document, EOBDocument, RadiologyReport, ClinicalNote)
    - Implement PatientMapping with to_json() method
    - Implement DocumentSet dataclass
    - Implement ValidationResult with to_report() method
    - Implement Statistics with to_json() method
    - Implement GenerationResult and GenerationConfig dataclasses
    - _Requirements: 1.6, 2.4, 3.1-3.7, 4.1-4.8, 5.1-5.8, 6.1-6.6, 7.12, 8.5, 9.5-9.6, 10.1-10.8_

  - [x]* 2.2 Write unit tests for data models
    - Test dataclass initialization and field validation
    - Test to_json() serialization methods
    - Test GenerationConfig validation (patient count 20-30, status percentages sum to 1.0)
    - _Requirements: 1.1, 4.2-4.4, 8.1_

- [x] 3. Implement Patient Generator component
  - [x] 3.1 Create PatientGenerator class (src/patient_generator.py)
    - Implement __init__ with synthea_path, output_dir, seed parameters
    - Implement generate_patients() method that orchestrates Synthea execution and FHIR parsing
    - Implement _execute_synthea() to invoke Synthea via subprocess with cancer modules
    - Implement _parse_fhir_output() to parse FHIR R4 JSON files into Patient objects
    - Use fhir.resources library for FHIR parsing
    - Extract patient demographics, encounters, conditions from FHIR Bundle resources
    - _Requirements: 1.1-1.6, 9.2_

  - [x]* 3.2 Write unit tests for PatientGenerator
    - Mock subprocess calls to Synthea
    - Test FHIR parsing with sample FHIR Bundle JSON
    - Test patient count validation
    - Test seed parameter passing
    - _Requirements: 1.1-1.6_

- [x] 4. Implement Patient Mapper component
  - [x] 4.1 Create PatientMapper class (src/patient_mapper.py)
    - Implement __init__ with seed parameter
    - Implement map_patients() method that creates 1:1 Synthea-to-TCIA mapping
    - Implement _validate_tcia_data() to filter for CT studies and validate required fields
    - Implement _create_patient_mapping() for 1:1 patient ID mapping
    - Implement _map_encounters_to_studies() to associate encounters with imaging studies
    - Use pandas to load and filter TCIA metadata CSV
    - Use random.seed() for reproducible shuffling when creating mappings
    - _Requirements: 2.1-2.6, 9.3_

  - [x]* 4.2 Write unit tests for PatientMapper
    - Test 1:1 mapping constraint (each TCIA ID used at most once)
    - Test TCIA data validation and CT study filtering
    - Test encounter-to-study date matching logic
    - Test reproducibility with same seed
    - _Requirements: 2.2-2.3, 2.5-2.6, 9.3, 9.5_

- [x] 5. Checkpoint - Ensure core data flow works
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement PDF generators
  - [x] 6.1 Create CMS1500Generator class (src/pdf_generators/cms1500_generator.py)
    - Implement generate() method using ReportLab
    - Create CMS-1500 form layout with proper field positioning
    - Populate patient demographics, provider info, diagnosis codes, procedure codes
    - Include Study UID in notes section
    - Return PDF as bytes
    - _Requirements: 3.1-3.7_

  - [x] 6.2 Create EOBGenerator class (src/pdf_generators/eob_generator.py)
    - Implement generate() method using WeasyPrint or ReportLab
    - Create EOB document layout with claim number, patient info, status
    - Include payment info for approved claims
    - Include denial reason for denied claims
    - Reference corresponding CMS-1500 claim number
    - Return PDF as bytes
    - _Requirements: 4.1-4.8_

  - [x] 6.3 Create RadiologyReportGenerator class (src/pdf_generators/radiology_report_generator.py)
    - Implement generate() method using WeasyPrint
    - Create radiology report layout with Study UID, modality, anatomical region
    - Generate realistic findings text based on cancer type
    - Include radiologist name and report date
    - Return PDF as bytes
    - _Requirements: 5.1-5.8_

  - [x] 6.4 Create ClinicalNoteGenerator class (src/pdf_generators/clinical_note_generator.py)
    - Implement generate() method using WeasyPrint
    - Create clinical note layout with patient symptoms, imaging orders, treatment plan
    - Include physician name and encounter date
    - Return PDF as bytes
    - _Requirements: 6.1-6.6_

  - [x]* 6.5 Write unit tests for PDF generators
    - Test PDF generation produces valid PDF bytes
    - Test required fields are present in generated PDFs
    - Test different claim statuses produce appropriate EOB content
    - Test different cancer types produce appropriate radiology findings
    - _Requirements: 3.1-3.7, 4.1-4.8, 5.1-5.8, 6.1-6.6_

- [x] 7. Implement Document Generator orchestrator
  - [x] 7.1 Create DocumentGenerator class (src/document_generator.py)
    - Implement __init__ with seed parameter
    - Implement generate_all_documents() that orchestrates all document generation
    - Implement generate_cms1500() using CMS1500Generator
    - Implement generate_eob() using EOBGenerator with status distribution (60% approved, 20% denied, 20% pending)
    - Implement generate_radiology_report() using RadiologyReportGenerator
    - Implement generate_clinical_note() using ClinicalNoteGenerator
    - Use random.seed() for reproducible claim status assignment
    - Generate unique claim numbers, EOB numbers, report IDs, note IDs
    - _Requirements: 3.1-3.7, 4.1-4.8, 5.1-5.8, 6.1-6.6, 9.4_

  - [x]* 7.2 Write unit tests for DocumentGenerator
    - Test claim status distribution (60/20/20 split)
    - Test document count matches patient and encounter count
    - Test reproducibility of status assignment with same seed
    - Test unique ID generation
    - _Requirements: 4.2-4.4, 9.4-9.5_

- [x] 8. Implement Output Organizer component
  - [x] 8.1 Create OutputOrganizer class (src/output_organizer.py)
    - Implement __init__ with root_dir parameter
    - Implement organize() method that creates directory structure and places files
    - Implement _create_directory_structure() to create patients/, metadata/ directories
    - Implement _place_documents() to write PDFs to appropriate subdirectories
    - Implement _copy_metadata() to copy TCIA CSV and Synthea output
    - Create directory structure: medical_data/patients/{TCIA-ID}/claims/ and clinical-notes/
    - Write mapping.json at root level
    - _Requirements: 7.1-7.12_

  - [x]* 8.2 Write unit tests for OutputOrganizer
    - Test directory structure creation
    - Test file placement in correct directories
    - Test mapping.json creation
    - Test metadata copying
    - _Requirements: 7.1-7.12_

- [x] 9. Implement Data Validator component
  - [x] 9.1 Create DataValidator class (src/validator.py)
    - Implement __init__ with root_dir parameter
    - Implement validate() method that runs all validation checks
    - Implement _validate_patient_count() to check 20-30 range
    - Implement _validate_patient_documents() to verify each patient has required PDFs
    - Implement _validate_mapping_file() to verify mapping.json completeness
    - Return ValidationResult with success status, errors, warnings
    - _Requirements: 8.1-8.7_

  - [x]* 9.2 Write unit tests for DataValidator
    - Test patient count validation
    - Test missing document detection
    - Test mapping file validation
    - Test validation report generation
    - _Requirements: 8.1-8.7_

- [x] 10. Implement Statistics Generator component
  - [x] 10.1 Create StatisticsGenerator class (src/statistics_generator.py)
    - Implement generate() method that computes all statistics
    - Count patients by cancer type
    - Count claims by status
    - Count documents by type
    - Extract TCIA patient IDs from mapping
    - Include random seed and generation timestamp
    - Return Statistics object with to_json() method
    - _Requirements: 10.1-10.8_

  - [x]* 10.2 Write unit tests for StatisticsGenerator
    - Test statistics computation accuracy
    - Test JSON serialization
    - Test all required fields are present
    - _Requirements: 10.1-10.8_

- [x] 11. Checkpoint - Ensure all components work independently
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Implement Generation Orchestrator
  - [x] 12.1 Create GenerationOrchestrator class (src/orchestrator.py)
    - Implement __init__ with GenerationConfig parameter
    - Implement generate() method that coordinates entire workflow
    - Implement _setup_random_seed() to initialize or generate seed
    - Implement _generate_patients() using PatientGenerator
    - Implement _load_tcia_metadata() using pandas
    - Implement _map_patients() using PatientMapper
    - Implement _generate_documents() using DocumentGenerator
    - Implement _organize_output() using OutputOrganizer
    - Implement _validate_output() using DataValidator
    - Implement _generate_statistics() using StatisticsGenerator
    - Write statistics.json to output directory
    - Return GenerationResult with statistics and validation result
    - _Requirements: All requirements 1-10_

  - [x]* 12.2 Write integration tests for GenerationOrchestrator
    - Test complete workflow with small patient count
    - Test error handling for missing Synthea installation
    - Test error handling for invalid TCIA metadata
    - Test reproducibility with same seed
    - _Requirements: 9.1-9.6_

- [x] 13. Implement CLI entry point
  - [x] 13.1 Create main.py CLI module
    - Use argparse or click for command-line argument parsing
    - Define arguments: --output-dir, --tcia-metadata, --patient-count, --seed, --synthea-path
    - Set default values matching GenerationConfig defaults
    - Validate patient count is between 20 and 30
    - Create GenerationConfig from CLI arguments
    - Instantiate and invoke GenerationOrchestrator
    - Print validation report and statistics summary to console
    - Return exit code 0 for success, non-zero for failure
    - _Requirements: 1.1, 8.1, 8.6-8.7, 9.1, 10.1-10.8_

  - [x]* 13.2 Write CLI tests
    - Test argument parsing
    - Test default values
    - Test patient count validation
    - Test exit codes
    - _Requirements: 1.1, 8.1_

- [x] 14. Add S3 upload functionality (optional feature)
  - [x] 14.1 Create S3Uploader class (src/s3_uploader.py)
    - Implement __init__ with bucket_name parameter
    - Implement upload_directory() method using boto3
    - Recursively upload all files from output directory to S3
    - Preserve directory structure in S3 keys
    - Handle upload errors gracefully
    - Return upload summary with file count and total size
    - _Requirements: Extension of Requirement 7 for cloud storage_

  - [x] 14.2 Integrate S3 upload into orchestrator
    - Add optional s3_bucket parameter to GenerationConfig
    - Add _upload_to_s3() method to GenerationOrchestrator
    - Invoke S3Uploader after validation succeeds
    - Include upload summary in GenerationResult
    - _Requirements: Extension of Requirement 7 for cloud storage_

  - [x] 14.3 Add --s3-bucket CLI argument
    - Add optional --s3-bucket argument to CLI
    - Pass to GenerationConfig if provided
    - Print upload summary to console
    - _Requirements: Extension of Requirement 7 for cloud storage_

  - [x]* 14.4 Write tests for S3 uploader
    - Mock boto3 S3 client
    - Test directory upload
    - Test error handling
    - _Requirements: Extension of Requirement 7 for cloud storage_

- [x] 15. Final integration and documentation
  - [x] 15.1 Create example usage scripts
    - Create example script showing basic usage
    - Create example script showing usage with seed for reproducibility
    - Create example script showing S3 upload
    - _Requirements: 9.1-9.6_

  - [x] 15.2 Update README with comprehensive documentation
    - Document installation steps
    - Document Synthea setup requirements
    - Document TCIA metadata CSV format requirements
    - Document CLI usage with all arguments
    - Document output directory structure
    - Document mapping.json and statistics.json formats
    - Include example commands
    - _Requirements: All requirements_

  - [x] 15.3 Add logging throughout application
    - Use Python logging module
    - Add INFO level logs for major workflow steps
    - Add DEBUG level logs for detailed operations
    - Add ERROR level logs for failures
    - Configure logging in CLI entry point
    - _Requirements: 8.6-8.7_

- [x] 16. Final checkpoint - End-to-end validation
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- The implementation uses Python 3.10+ as specified in the design
- Synthea must be installed separately (Java-based tool)
- TCIA metadata CSV must be obtained from The Cancer Imaging Archive
- Property tests are optional but recommended for data validation logic
- S3 upload functionality (task 14) is optional and can be implemented later
