# Bugfix Requirements Document

## Introduction

The medical claims data generator is failing to produce claim documents (CMS-1500 forms, EOB documents, and radiology reports) because the encounter-to-imaging-study mapping logic produces empty mappings for all encounters. This results in only clinical notes being generated, while the primary claim documents that depend on imaging studies are never created. The root cause is that the date-based matching algorithm between Synthea-generated encounters and TCIA imaging studies fails to find any matches, leaving all encounters without associated imaging studies.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the patient mapper attempts to match Synthea encounter dates with TCIA imaging study dates using a ±30 day window THEN the system produces empty imaging study arrays for all encounters in the encounter_study_mapping

1.2 WHEN the document generator iterates over encounters to generate claim documents THEN the system skips CMS-1500 form generation because the imaging_studies list is empty

1.3 WHEN the document generator iterates over encounters to generate claim documents THEN the system skips EOB document generation because the imaging_studies list is empty

1.4 WHEN the document generator iterates over encounters to generate claim documents THEN the system skips radiology report generation because the imaging_studies list is empty

1.5 WHEN the data generation process completes THEN the system outputs "Generated 0 CMS-1500 forms, 0 EOBs, 0 radiology reports, N clinical notes" indicating complete failure of claim document generation

### Expected Behavior (Correct)

2.1 WHEN the patient mapper attempts to match encounters with imaging studies THEN the system SHALL successfully associate 1-3 imaging studies with each encounter

2.2 WHEN the document generator iterates over encounters with associated imaging studies THEN the system SHALL generate a CMS-1500 form for each imaging study

2.3 WHEN the document generator iterates over encounters with associated imaging studies THEN the system SHALL generate an EOB document for each imaging study

2.4 WHEN the document generator iterates over encounters with associated imaging studies THEN the system SHALL generate a radiology report for each imaging study

2.5 WHEN the data generation process completes with 100 patients averaging 2-3 encounters each THEN the system SHALL output approximately 200-300 total claim documents (CMS-1500 forms, EOBs, and radiology reports combined)

2.6 WHEN encounter dates and imaging study dates do not naturally align within a narrow time window THEN the system SHALL use an alternative matching strategy that ensures all encounters receive imaging studies

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the document generator processes encounters THEN the system SHALL CONTINUE TO generate clinical notes for each encounter regardless of imaging study associations

3.2 WHEN the patient mapper creates the PatientMapping object THEN the system SHALL CONTINUE TO include all patient demographic information, encounters, and imaging studies in the mapping structure

3.3 WHEN the document generator creates PDF documents THEN the system SHALL CONTINUE TO use the existing PDF generation classes (CMS1500Generator, EOBGenerator, RadiologyReportGenerator, ClinicalNoteGenerator)

3.4 WHEN the system processes TCIA imaging studies THEN the system SHALL CONTINUE TO extract and preserve all imaging study metadata (study date, modality, description, series information)

3.5 WHEN the system processes Synthea encounter data THEN the system SHALL CONTINUE TO extract and preserve all encounter information (date, type, reason, provider, location)
