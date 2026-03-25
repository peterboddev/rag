# Bugfix Requirements Document

## Introduction

The `claim-loader.ts` Lambda's `listClaimDocuments()` function loads ALL documents for a patient across ALL claims instead of filtering to only the documents belonging to the requested claim. This causes mixed patient data in claim summaries — when the claim loader is called for `claimId: EOB000061`, it loads all 30 documents for patient TCIA-030 (spanning claims 061–065) and tags every one with `claimId: EOB000061`. Repeated invocations compound the problem by creating duplicate DynamoDB records (90 records from 3 loads × 30 docs). The downstream summary orchestrator then feeds all these misattributed documents to the LLM, which picks up names from unrelated clinical notes and produces summaries with mixed patient data.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN `listClaimDocuments(patientId)` is called with a patientId THEN the system returns ALL documents under `patients/{patientId}/claims/` and `patients/{patientId}/clinical-notes/` without filtering by the requested claimId

1.2 WHEN claim documents (CMS1500, EOB, radiology reports) belonging to other claims (e.g., CLM000062–065, EOB000062–065, RAD000062–065) exist for the same patient THEN the system includes them in the result set and tags them all with the single requested claimId

1.3 WHEN clinical notes from unrelated encounters (e.g., NOTE000011–015, NOTE000096–100) exist for the same patient THEN the system includes them in the result set and tags them with the requested claimId, introducing text mentioning other patients (Cletus494 Hahn503, Rudy520 Rutherford999)

1.4 WHEN `processDocument()` is called multiple times for the same source document and claimId THEN the system creates duplicate DynamoDB records with new documentIds each time, because no deduplication check exists

1.5 WHEN the claim loader is invoked 3 times for patient TCIA-030 with claimId EOB000061 THEN the system creates 90 DynamoDB records (3 × 30 documents) all tagged with `claimId: EOB000061`

1.6 WHEN the summary orchestrator reads all documents tagged with claimId EOB000061 THEN the system generates summaries containing mixed patient names and data from unrelated claims and encounters

### Expected Behavior (Correct)

2.1 WHEN `listClaimDocuments(patientId, claimId)` is called THEN the system SHALL return only claim documents (CMS1500, EOB, radiology reports) whose filenames contain the claim number extracted from the claimId (e.g., files matching `*CLM000061*`, `*EOB000061*`, `*RAD000061*` for claimId `EOB000061`)

2.2 WHEN claim documents belonging to other claims exist for the same patient THEN the system SHALL exclude them from the result set

2.3 WHEN clinical notes exist for the patient THEN the system SHALL only include clinical notes that are associated with the encounter corresponding to the requested claim, or exclude clinical notes if the association cannot be determined

2.4 WHEN `processDocument()` is called for a source document that has already been processed for the same claimId THEN the system SHALL skip creating a duplicate DynamoDB record and log that the document was already processed

2.5 WHEN the claim loader is invoked multiple times for the same patient and claimId THEN the system SHALL produce the same number of DynamoDB records as there are unique claim-specific documents (not multiplied by invocation count)

2.6 WHEN the summary orchestrator reads documents for a claimId THEN the system SHALL only find documents that genuinely belong to that claim, producing summaries with consistent patient data

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a valid patientId and claimId are provided and matching documents exist in S3 THEN the system SHALL CONTINUE TO copy those documents from the source bucket to the platform bucket with correct metadata

3.2 WHEN documents are processed THEN the system SHALL CONTINUE TO create DynamoDB records with correct documentId, fileName, s3Key, contentType, claimMetadata, and processingMetadata fields

3.3 WHEN documents are copied to the platform bucket THEN the system SHALL CONTINUE TO write `.metadata.json` sidecar files with correct claimId, patientId, patientName, and documentType attributes

3.4 WHEN the patient mapping is loaded from `mapping.json` THEN the system SHALL CONTINUE TO resolve patientName and tciaCollectionId correctly

3.5 WHEN S3 listing encounters pagination (more documents than a single ListObjectsV2 response) THEN the system SHALL CONTINUE TO handle continuation tokens and return all matching documents

3.6 WHEN document processing encounters retryable errors THEN the system SHALL CONTINUE TO retry with exponential backoff per the existing retry configuration

3.7 WHEN the claim loader completes processing THEN the system SHALL CONTINUE TO return a response with jobId, status, documentsProcessed, totalDocuments, and message fields

3.8 WHEN CloudWatch metrics are published for document processing THEN the system SHALL CONTINUE TO emit LambdaInvocations, ClaimDocumentsFound, DocumentsProcessedSuccessfully, and LambdaDuration metrics
