# Requirements Document: Insurance Claim Portal Enhancement

## Introduction

The Insurance Claim Portal is an **enhancement to the existing Multi-Tenant Document Manager** that adds medical claims-specific functionality. It leverages the existing RAG infrastructure (document processing, embedding generation, summarization, vector storage) and adds new capabilities for loading synthetic patient data from S3 and providing claims-specific UI views.

**IMPORTANT**: This is NOT a separate project. It extends the existing `multi-tenant-document-manager` codebase with:
- 2 new Lambda functions for patient/claim data loading
- 2 new frontend pages for claims-specific views
- Extended DynamoDB schema for claim metadata
- Reuse of ALL existing RAG infrastructure

The portal reads medical claims data from the S3 bucket **medical-claims-synthetic-data-dev**, copies documents to the existing **rag-app-v2-documents-dev** bucket, and processes them through the existing document processing pipeline.

## Glossary

- **Claim_Portal**: The web-based insurance claim review application
- **Document_Processor**: The platform service that extracts text from uploaded documents using Textract
- **Summarization_Engine**: The service that generates claim summaries using AWS Bedrock Nova Pro
- **Vector_Store**: OpenSearch Serverless database storing document embeddings
- **Source_Data_Bucket**: S3 bucket medical-claims-synthetic-data-dev containing pre-generated synthetic patient data
- **Platform_Documents_Bucket**: S3 bucket rag-app-v2-documents-dev for processed documents in the RAG platform
- **Data_Loader**: Service that reads documents from Source_Data_Bucket and copies them to Platform_Documents_Bucket
- **TCIA_Repository**: The Cancer Imaging Archive containing real cancer imaging data
- **Claim_Record**: A complete insurance claim including all associated documents and metadata
- **Agent_User**: Insurance company employee who reviews and processes claims
- **FHIR_Data**: Fast Healthcare Interoperability Resources formatted patient data
- **CMS_1500**: Standard health insurance claim form format
- **EOB**: Explanation of Benefits document
- **Clinical_Note**: Medical documentation from healthcare providers
- **Medical_Image**: DICOM format cancer imaging from TCIA
- **Claim_Summary**: AI-generated overview of claim context, status, and history
- **Multi_Modal_Context**: Combined understanding from text documents and medical imaging
- **Patient_Mapping**: JSON file mapping Synthea patient IDs to TCIA imaging collection IDs

## Requirements

### Requirement 1: S3 Data Source Integration

**User Story:** As a developer, I want to read synthetic patient data from S3, so that the portal can load and process pre-generated medical claims.

#### Acceptance Criteria

1. THE Data_Loader SHALL read patient data from the Source_Data_Bucket (medical-claims-synthetic-data-dev)
2. WHEN listing patients, THE Data_Loader SHALL parse the patients/ prefix to enumerate available patient IDs
3. THE Data_Loader SHALL read the mapping.json file to retrieve patient ID mappings between Synthea and TCIA
4. THE Data_Loader SHALL read the statistics.json file to retrieve generation metadata
5. WHEN accessing patient documents, THE Data_Loader SHALL read from patients/TCIA-{ID}/claims/ for claim documents
6. WHEN accessing clinical notes, THE Data_Loader SHALL read from patients/TCIA-{ID}/clinical-notes/ for clinical documentation
7. THE Data_Loader SHALL support reading both text and PDF format documents from S3

### Requirement 2: Document Import and Processing Pipeline

**User Story:** As the system, I want to copy documents from the source bucket to the platform bucket, so that they can be processed through the RAG pipeline.

#### Acceptance Criteria

1. WHEN a Claim_Record is loaded, THE Data_Loader SHALL copy documents from Source_Data_Bucket to Platform_Documents_Bucket
2. THE Data_Loader SHALL preserve original document metadata during the copy operation
3. WHEN copying documents, THE Data_Loader SHALL organize them by tenant and claim ID in Platform_Documents_Bucket
4. THE Data_Loader SHALL trigger the Document_Processor after copying documents to Platform_Documents_Bucket
5. IF a document copy operation fails, THEN THE Data_Loader SHALL log the error and continue with remaining documents
6. THE Data_Loader SHALL track which documents have been imported to avoid duplicate processing

### Requirement 3: Patient and Claim Listing

**User Story:** As an agent user, I want to see a list of available patients and their claims, so that I can select which claim to review.

#### Acceptance Criteria

1. THE Claim_Portal SHALL list all patients available in the Source_Data_Bucket
2. WHEN displaying patients, THE Claim_Portal SHALL show patient ID, name (from mapping), and claim count
3. THE Claim_Portal SHALL display claims associated with each patient
4. WHEN an Agent_User selects a patient, THE Claim_Portal SHALL display all claims for that patient
5. THE Claim_Portal SHALL display claim metadata including claim ID, filing date, and status
6. THE Claim_Portal SHALL support pagination when displaying more than 50 patients

### Requirement 4: Claim Document Upload

**User Story:** As an agent user, I want to upload additional claim-related documents, so that the system can process and analyze them alongside existing data.

#### Acceptance Criteria

1. WHEN an Agent_User uploads a document, THE Claim_Portal SHALL accept PDF, PNG, JPG, and DICOM formats
2. THE Claim_Portal SHALL support uploading multiple documents per Claim_Record
3. WHEN a document is uploaded, THE Claim_Portal SHALL associate it with the correct Claim_Record
4. THE Claim_Portal SHALL validate document format before accepting uploads
5. IF an invalid document format is uploaded, THEN THE Claim_Portal SHALL return a descriptive error message
6. WHEN a document upload succeeds, THE Claim_Portal SHALL store it in Platform_Documents_Bucket and trigger the Document_Processor
7. THE Claim_Portal SHALL display upload progress to the Agent_User

### Requirement 5: Medical Document Text Extraction

**User Story:** As the system, I want to extract text from medical documents, so that I can generate embeddings and enable semantic search.

#### Acceptance Criteria

1. WHEN a PDF document is copied to Platform_Documents_Bucket, THE Document_Processor SHALL extract all text content using AWS Textract
2. WHEN a CMS-1500 form is processed, THE Document_Processor SHALL extract form fields as structured key-value pairs
3. WHEN clinical notes are processed, THE Document_Processor SHALL preserve paragraph structure and formatting
4. THE Document_Processor SHALL extract text from radiology reports
5. IF text extraction fails, THEN THE Document_Processor SHALL log the error and notify the system
6. WHEN text extraction completes, THE Document_Processor SHALL store extracted text with document metadata

### Requirement 6: Medical Image Metadata Processing

**User Story:** As the system, I want to process medical imaging metadata, so that I can include imaging context in claim summaries.

#### Acceptance Criteria

1. WHEN loading patient data, THE Data_Loader SHALL read TCIA imaging collection IDs from the Patient_Mapping file
2. THE Claim_Portal SHALL display associated TCIA imaging collection information for each patient
3. THE Claim_Portal SHALL display imaging modality, body part, and collection name from TCIA metadata
4. THE Claim_Portal SHALL associate medical imaging references with corresponding Claim_Records
5. THE Claim_Portal SHALL store image metadata in a queryable format

### Requirement 7: Document Embedding Generation

**User Story:** As the system, I want to generate embeddings for claim documents, so that I can perform semantic search across claim history.

#### Acceptance Criteria

1. WHEN text extraction completes, THE Vector_Store SHALL generate embeddings using AWS Bedrock Titan Embed
2. THE Vector_Store SHALL store embeddings with document identifiers and metadata
3. THE Vector_Store SHALL support semantic similarity search across all claim documents
4. WHEN generating embeddings, THE Vector_Store SHALL chunk documents into segments of 8000 characters or less
5. THE Vector_Store SHALL preserve document relationships when chunking multi-page documents
6. THE Vector_Store SHALL associate embeddings with patient ID and claim ID for filtering

### Requirement 8: Claim Summary Generation

**User Story:** As an agent user, I want to see an AI-generated summary of a claim, so that I can quickly understand what the claim is about.

#### Acceptance Criteria

1. WHEN an Agent_User requests a claim summary, THE Summarization_Engine SHALL retrieve relevant documents from the Vector_Store
2. THE Summarization_Engine SHALL generate a summary using AWS Bedrock Nova Pro
3. THE Claim_Summary SHALL include the primary diagnosis or condition
4. THE Claim_Summary SHALL include key dates (claim filed, treatment dates, last update)
5. THE Claim_Summary SHALL include total claimed amount and approved amount
6. THE Claim_Summary SHALL identify the healthcare providers involved
7. WHEN generating summaries, THE Summarization_Engine SHALL process context within 200000 token limits
8. THE Claim_Summary SHALL be generated within 10 seconds for claims with fewer than 20 documents
9. THE Claim_Summary SHALL reference associated TCIA imaging collections when available

### Requirement 8: Claim Status Tracking

**User Story:** As an agent user, I want to see what stage a claim is in, so that I know what actions are required.

#### Acceptance Criteria

1. THE Claim_Portal SHALL display current claim status (Submitted, Under Review, Approved, Denied, Pending Information)
2. THE Claim_Portal SHALL display the date of last status change
3. WHEN claim status changes, THE Claim_Portal SHALL record the change in claim history
4. THE Claim_Summary SHALL include current claim status and stage
5. THE Claim_Portal SHALL highlight claims requiring agent action

### Requirement 9: Claim History Visualization

**User Story:** As an agent user, I want to see complete claim context and history, so that I understand the full claim timeline.

#### Acceptance Criteria

1. THE Claim_Portal SHALL display a chronological timeline of all claim events
2. THE Claim_Portal SHALL show document submission dates in the timeline
3. THE Claim_Portal SHALL show status changes in the timeline
4. THE Claim_Portal SHALL show communication events (requests for information, responses) in the timeline
5. WHEN an Agent_User selects a timeline event, THE Claim_Portal SHALL display associated documents and details
6. THE Claim_Portal SHALL support filtering timeline by event type

### Requirement 10: Multi-Modal Context Integration

**User Story:** As an agent user, I want summaries that incorporate both text documents and medical imaging context, so that I have complete claim understanding.

#### Acceptance Criteria

1. WHEN generating a Claim_Summary, THE Summarization_Engine SHALL retrieve both text documents and imaging metadata
2. THE Claim_Summary SHALL reference relevant medical images by study date and modality
3. WHEN imaging reports are available, THE Summarization_Engine SHALL incorporate report findings into the summary
4. THE Claim_Summary SHALL indicate when medical images support or contradict claim documentation
5. THE Summarization_Engine SHALL correlate imaging findings with diagnosis codes in billing records

### Requirement 11: Semantic Search Across Claims

**User Story:** As an agent user, I want to search across all claim documents using natural language, so that I can find relevant information quickly.

#### Acceptance Criteria

1. WHEN an Agent_User enters a search query, THE Claim_Portal SHALL perform semantic search using the Vector_Store
2. THE Claim_Portal SHALL return the top 10 most relevant document excerpts
3. THE Claim_Portal SHALL display relevance scores for search results
4. THE Claim_Portal SHALL highlight the matching text within document excerpts
5. WHEN search results are displayed, THE Claim_Portal SHALL show which Claim_Record each result belongs to
6. THE Claim_Portal SHALL support filtering search results by document type (clinical notes, billing, EOB, imaging reports)

### Requirement 12: Agent Authentication and Authorization

**User Story:** As an agent user, I want to securely log in to the portal, so that claim data remains protected.

#### Acceptance Criteria

1. THE Claim_Portal SHALL authenticate Agent_Users using AWS Cognito
2. THE Claim_Portal SHALL require username and password for authentication
3. WHEN authentication succeeds, THE Claim_Portal SHALL issue a JWT token
4. THE Claim_Portal SHALL validate JWT tokens on all API requests
5. IF authentication fails, THEN THE Claim_Portal SHALL return an error message without revealing whether the username exists
6. THE Claim_Portal SHALL enforce session timeout after 60 minutes of inactivity

### Requirement 13: Multi-Tenant Data Isolation

**User Story:** As a system administrator, I want claims data isolated by insurance company tenant, so that data privacy is maintained.

#### Acceptance Criteria

1. THE Claim_Portal SHALL associate each Claim_Record with a tenant identifier
2. THE Claim_Portal SHALL filter all queries by the Agent_User's tenant identifier
3. WHEN an Agent_User requests claim data, THE Claim_Portal SHALL return only claims belonging to their tenant
4. THE Vector_Store SHALL enforce tenant isolation in semantic search queries
5. THE Claim_Portal SHALL prevent cross-tenant data access through API manipulation

### Requirement 14: Document Processing Status Tracking

**User Story:** As an agent user, I want to see the processing status of uploaded documents, so that I know when they are ready for review.

#### Acceptance Criteria

1. THE Claim_Portal SHALL display document processing status (Uploaded, Processing, Completed, Failed)
2. WHEN document processing fails, THE Claim_Portal SHALL display the failure reason
3. THE Claim_Portal SHALL support retrying failed document processing
4. THE Claim_Portal SHALL display estimated processing time for queued documents
5. WHEN document processing completes, THE Claim_Portal SHALL notify the Agent_User

### Requirement 15: Claim Document Organization

**User Story:** As an agent user, I want documents organized by type within each claim, so that I can find specific information easily.

#### Acceptance Criteria

1. THE Claim_Portal SHALL categorize documents as Clinical Notes, Billing Records, EOBs, Imaging Reports, or Medical Images
2. THE Claim_Portal SHALL display document counts by category for each claim
3. WHEN an Agent_User selects a document category, THE Claim_Portal SHALL display all documents of that type
4. THE Claim_Portal SHALL sort documents within categories by date (most recent first)
5. THE Claim_Portal SHALL display document metadata (upload date, file size, page count)

### Requirement 16: Performance and Scalability

**User Story:** As a system administrator, I want the portal to handle multiple concurrent users, so that agent productivity is not impacted.

#### Acceptance Criteria

1. THE Claim_Portal SHALL support at least 50 concurrent Agent_Users
2. WHEN multiple users request summaries simultaneously, THE Summarization_Engine SHALL process requests within 15 seconds each
3. THE Claim_Portal SHALL cache generated summaries for 5 minutes to reduce redundant processing
4. THE Vector_Store SHALL respond to search queries within 2 seconds
5. THE Claim_Portal SHALL handle document uploads of up to 50MB per file

### Requirement 17: Error Handling and Resilience

**User Story:** As an agent user, I want clear error messages when issues occur, so that I can take appropriate action.

#### Acceptance Criteria

1. WHEN a document upload fails, THE Claim_Portal SHALL display a user-friendly error message
2. WHEN the Summarization_Engine fails, THE Claim_Portal SHALL display a fallback message and allow retry
3. IF the Vector_Store is unavailable, THEN THE Claim_Portal SHALL display cached results when available
4. THE Claim_Portal SHALL log all errors to CloudWatch for debugging
5. WHEN API rate limits are exceeded, THE Claim_Portal SHALL implement exponential backoff retry logic

### Requirement 18: Data Export and Reporting

**User Story:** As an agent user, I want to export claim summaries and documents, so that I can share information with stakeholders.

#### Acceptance Criteria

1. THE Claim_Portal SHALL support exporting Claim_Summaries as PDF documents
2. THE Claim_Portal SHALL support exporting claim timelines as PDF documents
3. WHEN exporting data, THE Claim_Portal SHALL include all associated document metadata
4. THE Claim_Portal SHALL support bulk export of multiple claims
5. THE Claim_Portal SHALL generate export files within 30 seconds for single claims
