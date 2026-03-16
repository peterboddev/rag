# Claim-Loader DocumentId Validation Fix - Bugfix Design

## Overview

This bugfix addresses a field name mismatch between the `DocumentRecord` TypeScript interface and the DynamoDB table schema. The interface defines the partition key field as `id`, but the DynamoDB table `rag-app-v2-documents-dev` expects `documentId`. This causes a `ValidationException: Missing the key documentId in the item` for every document write, resulting in 100% failure rate (30/30 documents) during claim loading. The fix renames the `id` field to `documentId` in the interface and updates all references across the codebase.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug - when any Lambda function creates a `DocumentRecord` object and writes it to DynamoDB, the record contains `id` instead of `documentId`, causing a ValidationException
- **Property (P)**: The desired behavior - DynamoDB PutCommand succeeds because the record contains `documentId` matching the table's partition key
- **Preservation**: Existing document query patterns, S3 operations, response formats, and all non-DynamoDB-write behaviors must remain unchanged
- **DocumentRecord**: The TypeScript interface in `src/types/index.ts` that defines the shape of document records stored in DynamoDB
- **processDocument**: The function in `src/lambda/claim-loader.ts` that copies claim documents to S3 and creates DynamoDB records
- **DOCUMENTS_TABLE**: Environment variable pointing to `rag-app-v2-documents-dev`, the DynamoDB table with `documentId` as partition key and `customerUuid` as sort key

## Bug Details

### Bug Condition

The bug manifests when any Lambda function constructs a `DocumentRecord` object and writes it to DynamoDB using `PutCommand`. The TypeScript interface defines the partition key field as `id`, but DynamoDB expects `documentId`. TypeScript compilation succeeds (the field name is valid TypeScript), but every runtime DynamoDB write fails with a ValidationException.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { record: DocumentRecord, operation: 'PutCommand' }
  OUTPUT: boolean
  
  RETURN input.operation == 'PutCommand'
         AND input.record HAS FIELD 'id'
         AND input.record DOES NOT HAVE FIELD 'documentId'
         AND targetTable.partitionKey == 'documentId'
END FUNCTION
```

### Examples

- **Example 1 - Claim Loader**: `processDocument()` creates `{ id: "abc-123", customerUuid: "cust-456", ... }` and calls `PutCommand`
  - Expected: DynamoDB accepts the record
  - Actual: `ValidationException: Missing the key documentId in the item`

- **Example 2 - Document Upload**: `handler()` in `document-upload.ts` creates `{ id: documentId, customerUuid: customerUUID, ... }` and calls `PutCommand`
  - Expected: DynamoDB accepts the record
  - Actual: `ValidationException: Missing the key documentId in the item`

- **Example 3 - Batch Processing**: All 30 claim documents fail individually, resulting in `documentsProcessed: 0, errorCount: 30`
  - Expected: `documentsProcessed: 30, errorCount: 0`
  - Actual: Complete batch failure

- **Edge Case - Read Operations**: Lambdas that only read from DynamoDB (claim-status, document-summary) are not directly affected by the write bug, but they reference `doc.id` when mapping results, which reads whatever field DynamoDB returns. After the fix, these must reference `doc.documentId`.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- UUID generation for document identifiers must continue to use `uuidv4()`
- S3 document copy operations and metadata must remain unchanged
- Textract text extraction and processing must remain unchanged
- All other DocumentRecord fields (`customerUuid`, `tenantId`, `fileName`, `s3Key`, `contentType`, `processingStatus`, etc.) must retain the same names and types
- DynamoDB table name sourced from `DOCUMENTS_TABLE` environment variable must remain unchanged
- Response structure from claim-loader (`statusCode`, `body`, `documentsProcessed`, `totalDocuments`, `errorCount`) must remain unchanged
- GSI query patterns using `customer-documents-index` and `tenant-documents-index` must remain unchanged
- Token estimation, text truncation, and summarization services that consume `DocumentRecord` objects must continue to function correctly
- Embedding generation that references document IDs must continue to function correctly

**Scope:**
All inputs that do NOT involve DynamoDB write operations with DocumentRecord objects should be completely unaffected by this fix. This includes:
- S3 operations (copy, put, get)
- Textract operations
- Bedrock model invocations
- CloudWatch metrics publishing
- API Gateway request/response handling
- Authentication and tenant extraction

## Hypothesized Root Cause

Based on the bug description and code analysis, the root cause is:

1. **Interface Field Name Mismatch**: `src/types/index.ts` line 21 defines `id: string` as the partition key field in the `DocumentRecord` interface. The DynamoDB table `rag-app-v2-documents-dev` was created with `documentId` as the partition key name. This mismatch means every object conforming to the interface will have the wrong field name for DynamoDB.

2. **Two Affected Write Paths**: Both `src/lambda/claim-loader.ts` (line 589) and `src/lambda/document-upload.ts` (line 192) create `DocumentRecord` objects with `id: documentId` and write them to DynamoDB. Both fail with the same ValidationException.

3. **Multiple Affected Read Paths**: Several files reference `doc.id` when reading DocumentRecord objects returned from DynamoDB queries. After the fix, DynamoDB will return records with `documentId` instead of `id`, so these read paths must also be updated:
   - `src/lambda/claim-status.ts` line 98: `documentId: doc.id`
   - `src/lambda/document-summary.ts` line 471: `documentId: doc.id`
   - `src/lambda/document-summary-selective.ts` lines 173, 182: `documentId: doc.id`
   - `src/services/token-estimation.ts` lines 69, 77, 89, 93-94, 102, 104: `doc.id`
   - `src/services/text-truncation.ts` lines 93, 102, 105: `doc.id`
   - `src/services/token-aware-summarization.ts` lines 254, 267, 297: `doc.id`
   - `src/lambda/embeddings-generate.ts` line 391: `document.id`
   - `src/lambda/chunking-config-update.ts` lines 242, 256, 260, 269: `document.id`
   - `src/services/embedding-generation.ts` lines 97, 105, 117: `document.id`

4. **Test Files Also Affected**: Multiple test files create mock `DocumentRecord` objects with `id` field that must be updated to `documentId`.

## Correctness Properties

Property 1: Bug Condition - DocumentRecord DynamoDB Write Success

_For any_ `DocumentRecord` object written to DynamoDB via `PutCommand`, the fixed interface and all record creation code SHALL use `documentId` as the partition key field name, matching the DynamoDB table schema, so that the write operation succeeds without ValidationException.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

Property 2: Preservation - Non-Write Behavior Unchanged

_For any_ operation that does NOT involve creating or writing a `DocumentRecord` to DynamoDB (S3 operations, Textract processing, query operations, response formatting, metrics publishing), the fixed code SHALL produce exactly the same behavior as the original code, preserving all existing functionality including UUID generation, field population, response structures, and GSI query patterns.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File 1**: `src/types/index.ts`

**Interface**: `DocumentRecord`

**Specific Changes**:
1. **Rename partition key field**: Change `id: string` to `documentId: string` on line 21
   - Update the comment to reflect it is the partition key

**File 2**: `src/lambda/claim-loader.ts`

**Function**: `processDocument`

**Specific Changes**:
2. **Update record creation**: Change `id: documentId` to `documentId: documentId` (or shorthand `documentId`) on line 589

**File 3**: `src/lambda/document-upload.ts`

**Function**: `handler`

**Specific Changes**:
3. **Update record creation**: Change `id: documentId` to `documentId: documentId` on line 192

**File 4**: `src/lambda/claim-status.ts`

**Specific Changes**:
4. **Update read mapping**: Change `documentId: doc.id` to `documentId: doc.documentId` on line 98

**File 5**: `src/lambda/document-summary.ts`

**Function**: `mapToSummaryItem`

**Specific Changes**:
5. **Update read mapping**: Change `documentId: doc.id` to `documentId: doc.documentId` on line 471

**File 6**: `src/lambda/document-summary-selective.ts`

**Specific Changes**:
6. **Update read mappings**: Change `documentId: doc.id` to `documentId: doc.documentId` on lines 173 and 182

**File 7**: `src/services/token-estimation.ts`

**Function**: `distributeTokens`

**Specific Changes**:
7. **Update all doc.id references**: Change `doc.id` to `doc.documentId` on lines 69, 77, 89, 93, 94, 102, 104

**File 8**: `src/services/text-truncation.ts`

**Specific Changes**:
8. **Update all doc.id references**: Change `doc.id` to `doc.documentId` on lines 93, 102, 105

**File 9**: `src/services/token-aware-summarization.ts`

**Specific Changes**:
9. **Update all doc.id references**: Change `doc.id` to `doc.documentId` on lines 254, 267, 297

**File 10**: `src/lambda/embeddings-generate.ts`

**Specific Changes**:
10. **Update all document.id references**: Change `document.id` to `document.documentId` on line 391 and related log statements

**File 11**: `src/lambda/chunking-config-update.ts`

**Specific Changes**:
11. **Update all document.id references**: Change `document.id` to `document.documentId` on lines 242, 256, 260, 269

**File 12**: `src/services/embedding-generation.ts`

**Specific Changes**:
12. **Update all document.id references**: Change `document.id` to `document.documentId` on lines 97, 105, 117

**Test Files** (update mock objects):
13. **Update test files**: Change `id:` to `documentId:` in all mock `DocumentRecord` objects in:
    - `unit_tests/token-estimation.test.ts`
    - `unit_tests/token-aware-summarization.test.ts`
    - `unit_tests/text-truncation.test.ts`
    - `unit_tests/content-prioritization.test.ts`
    - `unit_tests/claim-metadata.test.ts`

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code (DynamoDB writes fail with ValidationException), then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm that DocumentRecord objects created with `id` field cause DynamoDB ValidationException.

**Test Plan**: Write tests that create DocumentRecord objects using the current interface and simulate DynamoDB PutCommand operations. Mock DynamoDB to validate that the item contains `documentId` as the partition key. Run these tests on the UNFIXED code to observe failures.

**Test Cases**:
1. **Claim Loader Write Test**: Create a DocumentRecord via processDocument and assert DynamoDB PutCommand item contains `documentId` field (will fail on unfixed code - item has `id` instead)
2. **Document Upload Write Test**: Create a DocumentRecord via document-upload handler and assert DynamoDB PutCommand item contains `documentId` field (will fail on unfixed code)
3. **Field Name Validation Test**: Construct a DocumentRecord from the interface and assert `'documentId' in record` (will fail on unfixed code - only `id` exists)
4. **Batch Processing Test**: Process multiple documents and assert all DynamoDB writes succeed (will fail on unfixed code - all 30 fail)

**Expected Counterexamples**:
- DocumentRecord objects contain `id` field but not `documentId` field
- DynamoDB PutCommand fails with `ValidationException: Missing the key documentId in the item`
- Possible cause: Interface field name `id` does not match DynamoDB partition key name `documentId`

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds (DocumentRecord written to DynamoDB), the fixed function produces the expected behavior (successful write).

**Pseudocode:**
```
FOR ALL record WHERE isBugCondition(record) DO
  result := putCommand_fixed(record)
  ASSERT result.success == true
  ASSERT record HAS FIELD 'documentId'
  ASSERT record DOES NOT HAVE FIELD 'id'
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold (read operations, S3 operations, response formatting), the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL operation WHERE NOT isBugCondition(operation) DO
  ASSERT fixedFunction(operation) = originalFunction(operation)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-write operations

**Test Plan**: Observe behavior on UNFIXED code first for read operations, token estimation, text truncation, and summarization services, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Token Estimation Preservation**: Observe that token distribution across documents works correctly on unfixed code (uses doc.id as map key), then verify the same distribution results after fix (using doc.documentId)
2. **Text Truncation Preservation**: Observe that text truncation mapping works correctly on unfixed code, then verify same results after fix
3. **Document Summary Preservation**: Observe that document-to-summary-item mapping produces correct output on unfixed code, then verify same output after fix
4. **Response Format Preservation**: Observe that claim-loader response structure is unchanged after fix

### Unit Tests

- Test that DocumentRecord interface has `documentId` field (not `id`)
- Test that claim-loader processDocument creates records with `documentId` field
- Test that document-upload handler creates records with `documentId` field
- Test that claim-status correctly maps `doc.documentId` to response
- Test that all service files (token-estimation, text-truncation, token-aware-summarization) correctly reference `doc.documentId`
- Test edge cases: empty document list, single document, maximum batch size

### Property-Based Tests

- Generate random DocumentRecord objects and verify they always contain `documentId` as the partition key field
- Generate random document batches and verify token distribution produces consistent results using `documentId` as the key
- Generate random document sets and verify text truncation mapping is consistent using `documentId`

### Integration Tests

- Test full claim loading flow: invoke claim-loader, verify all 30 documents written to DynamoDB successfully
- Test document upload flow: upload a document, verify DynamoDB record created with `documentId`
- Test claim status flow: load documents then query status, verify response contains correct document IDs
- Test document summary flow: load documents then request summary, verify document references use correct IDs
