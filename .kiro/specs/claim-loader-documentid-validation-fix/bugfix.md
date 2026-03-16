# Bugfix Requirements Document

## Introduction

The claim-loader Lambda function is failing to write document records to DynamoDB due to a field name mismatch. The function creates document records with an `id` field, but the DynamoDB table schema expects `documentId` as the partition key. This causes all claim documents (30/30) to fail loading with a ValidationException, preventing users from viewing any claim documents after clicking the "Load Claim Documents" button.

**Impact**: Complete failure of claim document loading functionality. Users experience infinite loading states with continuous polling (47+ requests observed) as the frontend waits for documents that never successfully load.

**Root Cause**: The `DocumentRecord` interface in `src/types/index.ts` defines the field as `id`, but the DynamoDB table `rag-app-v2-documents-dev` expects `documentId` as the partition key name.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the claim-loader Lambda processes a document and creates a DocumentRecord with field name `id` THEN DynamoDB rejects the PutCommand with ValidationException: "Missing the key documentId in the item"

1.2 WHEN all 30 claim documents are processed with the incorrect field name THEN the Lambda reports documentsProcessed: 0, errorCount: 30, and totalDocuments: 30

1.3 WHEN the DocumentRecord interface uses `id: string` as the field name THEN TypeScript compilation succeeds but runtime DynamoDB operations fail with validation errors

1.4 WHEN users click "Load Claim Documents" in the frontend THEN they experience infinite loading with continuous polling because no documents are successfully written to DynamoDB

### Expected Behavior (Correct)

2.1 WHEN the claim-loader Lambda processes a document and creates a DocumentRecord with field name `documentId` THEN DynamoDB SHALL accept the PutCommand and successfully write the document record

2.2 WHEN all 30 claim documents are processed with the correct field name THEN the Lambda SHALL report documentsProcessed: 30, errorCount: 0, and totalDocuments: 30

2.3 WHEN the DocumentRecord interface uses `documentId: string` as the field name THEN TypeScript compilation SHALL succeed and runtime DynamoDB operations SHALL succeed without validation errors

2.4 WHEN users click "Load Claim Documents" in the frontend THEN they SHALL see the documents load successfully without infinite loading states

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the claim-loader Lambda generates a UUID for the document identifier THEN the system SHALL CONTINUE TO use `uuidv4()` to generate unique identifiers

3.2 WHEN the claim-loader Lambda processes documents from the S3 bucket THEN the system SHALL CONTINUE TO extract text using Textract and store metadata correctly

3.3 WHEN the DocumentRecord includes other fields like `customerUuid`, `tenantId`, `fileName`, `fileType`, `s3Key`, `uploadedAt`, `processedAt`, `status`, and `textContent` THEN the system SHALL CONTINUE TO populate these fields with the same values and types

3.4 WHEN the claim-loader Lambda writes to DynamoDB THEN the system SHALL CONTINUE TO use the same table name from environment variable `DOCUMENTS_TABLE` (rag-app-v2-documents-dev)

3.5 WHEN the claim-loader Lambda completes processing THEN the system SHALL CONTINUE TO return the same response structure with `statusCode`, `body`, `documentsProcessed`, `totalDocuments`, and `errorCount`

3.6 WHEN other Lambda functions or services query documents by `customerUuid` THEN the system SHALL CONTINUE TO use the same GSI (customer-documents-index) and query patterns

3.7 WHEN the frontend polls for document loading status THEN the system SHALL CONTINUE TO use the same polling mechanism and API endpoints
