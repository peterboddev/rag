# Bugfix Requirements Document

## Introduction

This document addresses two critical bugs in the insurance claim portal that prevent users from viewing patient information and accessing claim documents. Bug 1 causes patient names to display as "Unknown Patient" despite the mapping.json file containing correct patient name data. Bug 2 prevents users from loading and viewing claim documents due to authorization errors and missing API functionality.

These bugs significantly impact the user experience by making it impossible to identify patients or access their claim documentation, which are core features of the portal.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the patient list page loads THEN the system displays "Unknown Patient" for all patient names instead of actual names from mapping.json

1.2 WHEN the patient detail page loads THEN the system displays "Unknown Patient" as the patient name instead of the actual name from mapping.json

1.3 WHEN a user clicks "Load Claims" for a patient THEN the system sends a request without the claimId in the request body

1.4 WHEN a user attempts to load claim documents THEN the system returns an "Unauthorized" error

1.5 WHEN a user clicks "View Documents & Summary" on a claim THEN the system shows an alert indicating the feature is not implemented

### Expected Behavior (Correct)

2.1 WHEN the patient list page loads THEN the system SHALL display actual patient names from mapping.json (e.g., "John Smith", "Jane Doe")

2.2 WHEN the patient detail page loads THEN the system SHALL display the actual patient name from mapping.json corresponding to the patient's synthea_id

2.3 WHEN a user clicks "Load Claims" for a patient THEN the system SHALL send a request with the claimId included in the request body

2.4 WHEN a user attempts to load claim documents THEN the system SHALL successfully retrieve and display the claim documents without authorization errors

2.5 WHEN a user clicks "View Documents & Summary" on a claim THEN the system SHALL retrieve and display the claim document content (PDF or summary)

### Unchanged Behavior (Regression Prevention)

3.1 WHEN claims are displayed for a patient THEN the system SHALL CONTINUE TO show the correct claim count

3.2 WHEN mapping.json is read by Lambda functions THEN the system SHALL CONTINUE TO parse the structure correctly with patient_mappings array

3.3 WHEN users navigate between patient list and patient detail pages THEN the system SHALL CONTINUE TO maintain proper routing and state management

3.4 WHEN S3 files are accessed by Lambda functions THEN the system SHALL CONTINUE TO use the correct bucket name (medical-claims-synthetic-data-dev)

3.5 WHEN API Gateway endpoints are called THEN the system SHALL CONTINUE TO handle CORS properly for authenticated requests
