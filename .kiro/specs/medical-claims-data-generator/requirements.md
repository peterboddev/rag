# Requirements Document

## Introduction

The Medical Claims Data Generator is a synthetic data generation tool that creates realistic insurance claim datasets for testing and demonstrating the Insurance Claim Portal POC. The tool combines Synthea-generated synthetic patient records with real TCIA (The Cancer Imaging Archive) medical imaging metadata to produce comprehensive claim datasets that include patient demographics, clinical encounters, medical imaging references, and claim documents.

## Glossary

- **Data_Generator**: The medical claims data generation system
- **Synthea**: Open-source synthetic patient generator that creates realistic FHIR-compliant medical records
- **TCIA**: The Cancer Imaging Archive, a public repository of medical imaging data
- **FHIR**: Fast Healthcare Interoperability Resources, a standard for healthcare data exchange
- **DICOM**: Digital Imaging and Communications in Medicine, the standard for medical imaging files
- **CMS_1500**: Standard paper claim form used by healthcare providers to bill insurance
- **EOB**: Explanation of Benefits, document showing how an insurance claim was processed
- **CPT_Code**: Current Procedural Terminology code used to describe medical procedures
- **Study_UID**: Unique identifier for a DICOM imaging study
- **Patient_Mapping**: Association between synthetic Synthea patient and real TCIA patient imaging data

## Requirements

### Requirement 1: Generate Synthetic Patient Records

**User Story:** As a data engineer, I want to generate synthetic patient records with cancer diagnoses, so that I can create realistic insurance claims for testing.

#### Acceptance Criteria

1. WHEN the generation process starts, THE Data_Generator SHALL execute Synthea to create between 20 and 30 synthetic patients
2. THE Data_Generator SHALL configure Synthea to generate patients with lung cancer diagnoses
3. THE Data_Generator SHALL configure Synthea to generate patients with colorectal cancer diagnoses
4. WHEN Synthea completes execution, THE Data_Generator SHALL output FHIR R4 JSON format patient records
5. WHEN Synthea completes execution, THE Data_Generator SHALL output CSV format patient records
6. THE Data_Generator SHALL preserve all Synthea-generated patient identifiers for mapping purposes

### Requirement 2: Map Synthetic Patients to Real Imaging Data

**User Story:** As a data engineer, I want to link synthetic patient records with real medical imaging metadata, so that claims reference actual DICOM studies.

#### Acceptance Criteria

1. THE Data_Generator SHALL load TCIA EAY131 collection metadata from CSV format
2. WHEN mapping patients, THE Data_Generator SHALL associate each Synthea patient with exactly one TCIA patient identifier
3. THE Data_Generator SHALL ensure each TCIA patient identifier is mapped to at most one Synthea patient
4. THE Data_Generator SHALL record the mapping between Synthea patient IDs and TCIA patient IDs in JSON format
5. WHEN a Synthea patient has multiple encounters, THE Data_Generator SHALL map imaging studies to appropriate encounter dates
6. THE Data_Generator SHALL validate that mapped TCIA patients have CT imaging studies available

### Requirement 3: Generate CMS-1500 Claim Forms

**User Story:** As a claims processor, I want CMS-1500 forms for imaging procedures, so that I can process insurance claims through the portal.

#### Acceptance Criteria

1. WHEN generating claims, THE Data_Generator SHALL create at least one CMS-1500 form per patient
2. THE Data_Generator SHALL populate CMS-1500 forms with CPT codes between 71250 and 71275 for CT imaging procedures
3. THE Data_Generator SHALL include patient demographic information from Synthea records in CMS-1500 forms
4. THE Data_Generator SHALL include provider information in CMS-1500 forms
5. THE Data_Generator SHALL include diagnosis codes matching the patient's cancer diagnosis in CMS-1500 forms
6. THE Data_Generator SHALL reference the mapped DICOM Study UID in CMS-1500 form notes
7. THE Data_Generator SHALL output CMS-1500 forms as PDF files

### Requirement 4: Generate Explanation of Benefits Documents

**User Story:** As a claims processor, I want EOB documents showing claim processing results, so that I can demonstrate various claim statuses in the portal.

#### Acceptance Criteria

1. WHEN generating an EOB, THE Data_Generator SHALL create one EOB document per CMS-1500 claim
2. THE Data_Generator SHALL assign claim status as approved for 60 percent of claims
3. THE Data_Generator SHALL assign claim status as denied for 20 percent of claims
4. THE Data_Generator SHALL assign claim status as pending for 20 percent of claims
5. WHEN claim status is approved, THE Data_Generator SHALL include payment amount and date in the EOB
6. WHEN claim status is denied, THE Data_Generator SHALL include denial reason code in the EOB
7. THE Data_Generator SHALL reference the corresponding CMS-1500 claim number in each EOB
8. THE Data_Generator SHALL output EOB documents as PDF files

### Requirement 5: Generate Radiology Reports

**User Story:** As a radiologist, I want radiology reports that reference actual DICOM studies, so that claims have supporting clinical documentation.

#### Acceptance Criteria

1. WHEN generating radiology reports, THE Data_Generator SHALL create at least one report per imaging study
2. THE Data_Generator SHALL include the DICOM Study UID in each radiology report
3. THE Data_Generator SHALL include imaging modality information from TCIA metadata in radiology reports
4. THE Data_Generator SHALL include anatomical region information from TCIA Series descriptions in radiology reports
5. THE Data_Generator SHALL generate realistic findings text appropriate for the cancer diagnosis type
6. THE Data_Generator SHALL include radiologist name and signature in radiology reports
7. THE Data_Generator SHALL include report date matching the imaging study date
8. THE Data_Generator SHALL output radiology reports as PDF files

### Requirement 6: Generate Clinical Notes

**User Story:** As a physician, I want clinical notes documenting patient encounters, so that claims have complete medical record documentation.

#### Acceptance Criteria

1. WHEN generating clinical notes, THE Data_Generator SHALL create notes for each patient encounter from Synthea records
2. THE Data_Generator SHALL include patient symptoms and complaints in clinical notes
3. THE Data_Generator SHALL reference imaging orders in clinical notes when imaging studies are mapped to the encounter
4. THE Data_Generator SHALL include treatment plans in clinical notes
5. THE Data_Generator SHALL include physician name and signature in clinical notes
6. THE Data_Generator SHALL output clinical notes as PDF files

### Requirement 7: Organize Output in Structured Directories

**User Story:** As a system administrator, I want generated data organized in a consistent directory structure, so that I can easily ingest it into the Insurance Claim Portal.

#### Acceptance Criteria

1. THE Data_Generator SHALL create a root directory named medical_data for all output
2. THE Data_Generator SHALL create a patients subdirectory containing one directory per TCIA patient ID
3. WHEN organizing patient data, THE Data_Generator SHALL create a claims subdirectory within each patient directory
4. WHEN organizing patient data, THE Data_Generator SHALL create a clinical-notes subdirectory within each patient directory
5. THE Data_Generator SHALL place all CMS-1500 PDFs in the claims subdirectory
6. THE Data_Generator SHALL place all EOB PDFs in the claims subdirectory
7. THE Data_Generator SHALL place all radiology report PDFs in the claims subdirectory
8. THE Data_Generator SHALL place all clinical note PDFs in the clinical-notes subdirectory
9. THE Data_Generator SHALL create a metadata subdirectory at the root level
10. THE Data_Generator SHALL copy the original TCIA metadata CSV to the metadata subdirectory
11. THE Data_Generator SHALL copy all Synthea output files to a synthea-output subdirectory within metadata
12. THE Data_Generator SHALL create a mapping.json file at the root level containing patient ID mappings

### Requirement 8: Validate Generated Data Completeness

**User Story:** As a data engineer, I want validation of generated datasets, so that I can ensure all required components are present before ingestion.

#### Acceptance Criteria

1. WHEN generation completes, THE Data_Generator SHALL verify that the number of generated patients is between 20 and 30
2. THE Data_Generator SHALL verify that each patient directory contains at least one CMS-1500 PDF
3. THE Data_Generator SHALL verify that each patient directory contains at least one EOB PDF
4. THE Data_Generator SHALL verify that each patient directory contains at least one radiology report PDF
5. THE Data_Generator SHALL verify that the mapping.json file contains entries for all generated patients
6. WHEN validation fails, THE Data_Generator SHALL output an error report listing missing components
7. WHEN validation succeeds, THE Data_Generator SHALL output a summary report with patient count and document counts

### Requirement 9: Support Reproducible Data Generation

**User Story:** As a developer, I want reproducible data generation with seed values, so that I can regenerate the same dataset for testing purposes.

#### Acceptance Criteria

1. THE Data_Generator SHALL accept an optional random seed parameter
2. WHEN a random seed is provided, THE Data_Generator SHALL pass the seed to Synthea for patient generation
3. WHEN a random seed is provided, THE Data_Generator SHALL use the seed for patient-to-imaging mapping
4. WHEN a random seed is provided, THE Data_Generator SHALL use the seed for claim status assignment
5. WHEN the same seed is used, THE Data_Generator SHALL produce identical patient mappings
6. WHEN no seed is provided, THE Data_Generator SHALL generate a random seed and record it in the output metadata

### Requirement 10: Generate Summary Statistics

**User Story:** As a project manager, I want summary statistics about generated data, so that I can verify the dataset meets project requirements.

#### Acceptance Criteria

1. WHEN generation completes, THE Data_Generator SHALL output a statistics report in JSON format
2. THE Data_Generator SHALL include total patient count in the statistics report
3. THE Data_Generator SHALL include count of patients by cancer diagnosis type in the statistics report
4. THE Data_Generator SHALL include total claim count in the statistics report
5. THE Data_Generator SHALL include claim count by status in the statistics report
6. THE Data_Generator SHALL include total document count by type in the statistics report
7. THE Data_Generator SHALL include list of TCIA patient IDs used in the statistics report
8. THE Data_Generator SHALL include generation timestamp in the statistics report
