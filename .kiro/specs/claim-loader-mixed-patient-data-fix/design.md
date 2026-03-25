# Claim Loader Mixed Patient Data Bugfix Design

## Overview

The `claim-loader.ts` Lambda loads all documents for a patient regardless of which claim was requested, then tags every document with the single requested claimId. This causes mixed patient data in downstream summaries. The fix adds claim-aware filtering to `listClaimDocuments()` using the numeric suffix embedded in filenames, adds deduplication to `processDocument()` to prevent duplicate DynamoDB records on repeated invocations, and includes a cleanup step for existing corrupt data.

## Glossary

- **Bug_Condition (C)**: The condition where `listClaimDocuments` returns documents that do not belong to the requested claim — i.e., documents whose filename-embedded number does not match the claim number suffix
- **Property (P)**: Every document returned by `listClaimDocuments` and processed by `processDocument` must have a filename whose embedded number matches the requested claim's number suffix
- **Preservation**: Existing behavior for documents that DO match the requested claim must remain unchanged — S3 copy, DynamoDB record creation, metadata sidecar writing, retry logic, response format, and CloudWatch metrics
- **listClaimDocuments**: Function in `src/lambda/claim-loader.ts` that lists S3 objects under `patients/{patientId}/claims/` and `patients/{patientId}/clinical-notes/`
- **processDocument**: Function in `src/lambda/claim-loader.ts` that copies a document from source to platform bucket and creates a DynamoDB record
- **Claim Number Suffix**: The numeric portion extracted from a claimId (e.g., `"000061"` from `"EOB000061"`) used to match filenames like `cms1500_CLM000061.pdf`, `eob_EOB000061.pdf`, `radiology_report_RAD000061.pdf`, `clinical_note_NOTE000061.pdf`

## Bug Details

### Bug Condition

The bug manifests when `listClaimDocuments(patientId)` is called without a claimId filter. The function returns ALL documents under the patient's `claims/` and `clinical-notes/` directories. When a patient has multiple claims (e.g., CLM000061–CLM000065), all documents across all claims are returned and subsequently tagged with the single requested claimId. Additionally, `processDocument()` creates a new DynamoDB record on every invocation with no deduplication, so repeated calls multiply the corrupt records.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { patientId: string, claimId: string, sourceKey: string }
  OUTPUT: boolean

  claimNumber := extractNumericSuffix(input.claimId)
  fileName := extractFileName(input.sourceKey)
  fileNumber := extractNumericSuffix(fileName)

  RETURN fileNumber != claimNumber
         OR documentAlreadyExistsInDynamo(input.sourceKey, input.claimId)
END FUNCTION

FUNCTION extractNumericSuffix(id: string): string
  RETURN id.match(/(\d+)$/)[1]   // e.g., "EOB000061" → "000061"
END FUNCTION
```

### Examples

- **Mismatched claim document**: Patient TCIA-030, claimId `EOB000061`, file `eob_EOB000063.pdf` → file number `000063` ≠ claim number `000061` → should be EXCLUDED (currently included)
- **Matching claim document**: Patient TCIA-030, claimId `EOB000061`, file `cms1500_CLM000061.pdf` → file number `000061` = claim number `000061` → should be INCLUDED
- **Mismatched clinical note**: Patient TCIA-030, claimId `EOB000061`, file `clinical_note_NOTE000096.pdf` → file number `000096` ≠ `000061` → should be EXCLUDED (currently included)
- **Matching clinical note**: Patient TCIA-030, claimId `EOB000061`, file `clinical_note_NOTE000061.pdf` → file number `000061` = `000061` → should be INCLUDED
- **Duplicate invocation**: `processDocument("patients/TCIA-030/claims/eob_EOB000061.pdf", ..., "EOB000061")` called twice → should create only 1 DynamoDB record (currently creates 2)

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Documents that match the requested claim must still be copied from source bucket to platform bucket with correct S3 metadata
- DynamoDB records for matching documents must still contain correct documentId, fileName, s3Key, contentType, claimMetadata, and processingMetadata fields
- `.metadata.json` sidecar files must still be written with correct claimId, patientId, patientName, and documentType
- Patient mapping resolution from `mapping.json` must continue to work correctly
- S3 pagination via continuation tokens must still return all matching documents
- Retry with exponential backoff must continue for retryable errors
- Lambda response must still include jobId, status, documentsProcessed, totalDocuments, and message
- CloudWatch metrics (LambdaInvocations, ClaimDocumentsFound, DocumentsProcessedSuccessfully, LambdaDuration) must continue to be emitted

**Scope:**
All inputs where the document filename's numeric suffix matches the requested claim's numeric suffix should be completely unaffected by this fix. The fix only changes behavior for:
- Documents whose filename number does NOT match the claim number (now excluded)
- Duplicate processing attempts for the same document+claim (now skipped)

## Hypothesized Root Cause

Based on the bug description and code analysis, the issues are:

1. **Missing claimId parameter in listClaimDocuments**: The function signature is `listClaimDocuments(patientId: string)` with no claimId parameter. It lists everything under `patients/{patientId}/claims/` and `patients/{patientId}/clinical-notes/` without any filename-based filtering. When a patient has documents for claims 061–065, all are returned regardless of which claim was requested.

2. **No filename-based filtering logic**: Even if claimId were passed, there is no code to extract the numeric suffix from the claimId and compare it against filenames. The S3 `ListObjectsV2` prefix alone (`patients/{patientId}/claims/`) is too broad — it matches all claims for that patient.

3. **No deduplication in processDocument**: The function generates a new `uuidv4()` documentId and calls `PutCommand` unconditionally. There is no check for an existing DynamoDB record with the same `fileName` and `claimMetadata.claimId`, so every invocation creates a new record.

4. **No cleanup mechanism**: Once corrupt data exists (90 records tagged with wrong claimId), there is no built-in way to identify and remove duplicates or misattributed records.

## Correctness Properties

Property 1: Bug Condition - Claim-Specific Document Filtering

_For any_ input where `listClaimDocuments(patientId, claimId)` is called and the patient's S3 directories contain documents for multiple claims, the fixed function SHALL return only documents whose filename contains the same numeric suffix as the claimId, excluding all documents belonging to other claims.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - Matching Document Processing Unchanged

_For any_ input where the document's filename numeric suffix matches the requested claim's numeric suffix, the fixed function SHALL produce the same S3 copy, DynamoDB record, and metadata sidecar as the original function, preserving all existing processing behavior for correctly-matched documents.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `src/lambda/claim-loader.ts`

**Function**: `listClaimDocuments`

**Specific Changes**:
1. **Add claimId parameter**: Change signature from `listClaimDocuments(patientId: string)` to `listClaimDocuments(patientId: string, claimId: string)`
2. **Extract claim number suffix**: Add helper function `extractClaimNumber(claimId: string): string` that extracts the numeric suffix (e.g., `"EOB000061"` → `"000061"`)
3. **Filter claim documents by number suffix**: After listing S3 objects under `patients/{patientId}/claims/`, filter to only files whose names contain the claim number (matching `CLM{number}`, `EOB{number}`, or `RAD{number}`)
4. **Filter clinical notes by number suffix**: After listing S3 objects under `patients/{patientId}/clinical-notes/`, filter to only files whose names contain `NOTE{number}` where the number matches the claim number suffix
5. **Update caller**: Update the `handler` function to pass `claimId` to `listClaimDocuments(patientId, claimId)`

**Function**: `processDocument`

**Specific Changes**:
6. **Add deduplication check**: Before creating a new DynamoDB record, scan/query the documents table for an existing record with the same `fileName` and `claimMetadata.claimId`. If found, log a skip message and return early without creating a duplicate.

**Cleanup** (one-time script or manual):
7. **Delete duplicate/misattributed records**: Identify DynamoDB records where `claimMetadata.claimId` does not match the filename's embedded claim number, and delete them
8. **Invalidate stale cached summaries**: Clear summary cache entries for affected claimIds so summaries are regenerated with correct data

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Write unit tests that call `listClaimDocuments` with a patientId whose S3 directory contains documents for multiple claims, and verify that the function returns ALL documents (demonstrating the bug). Mock S3 `ListObjectsV2` to return a known set of files spanning multiple claims.

**Test Cases**:
1. **Multi-claim patient test**: Mock S3 with files for claims 061–065, call `listClaimDocuments("TCIA-030")`, assert all 30 files are returned (will demonstrate bug on unfixed code)
2. **Clinical notes inclusion test**: Mock S3 with clinical notes NOTE000011, NOTE000096, call `listClaimDocuments("TCIA-030")`, assert all notes are returned regardless of claim (will demonstrate bug on unfixed code)
3. **Duplicate record test**: Call `processDocument` twice for the same file and claimId, assert 2 DynamoDB records are created (will demonstrate bug on unfixed code)
4. **Cross-claim tagging test**: Process documents from multiple claims with a single claimId, verify all get tagged with that claimId (will demonstrate bug on unfixed code)

**Expected Counterexamples**:
- `listClaimDocuments("TCIA-030")` returns 30 files instead of the expected 6 for a single claim
- `processDocument` creates duplicate records with different documentIds for the same source file
- Possible causes: missing claimId parameter, no filename filtering, no deduplication check

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := listClaimDocuments_fixed(input.patientId, input.claimId)
  FOR EACH doc IN result DO
    docNumber := extractNumericSuffix(doc.fileName)
    claimNumber := extractNumericSuffix(input.claimId)
    ASSERT docNumber == claimNumber
  END FOR
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  // For documents that match the claim, processing behavior is unchanged
  result_original := processDocument_original(input)
  result_fixed := processDocument_fixed(input)
  ASSERT result_original.s3Copy == result_fixed.s3Copy
  ASSERT result_original.dynamoRecord == result_fixed.dynamoRecord
  ASSERT result_original.metadataSidecar == result_fixed.metadataSidecar
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many combinations of patientId, claimId, and filename patterns
- It catches edge cases like claimIds with unusual formats or filenames with multiple numeric segments
- It provides strong guarantees that matching-document behavior is unchanged

**Test Plan**: Observe behavior on UNFIXED code first for documents that match the claim, then write property-based tests capturing that behavior.

**Test Cases**:
1. **S3 Copy Preservation**: Verify that for matching documents, the CopyObjectCommand parameters are identical before and after the fix
2. **DynamoDB Record Preservation**: Verify that for matching documents, the PutCommand item structure is identical (except documentId which is always a new UUID)
3. **Metadata Sidecar Preservation**: Verify that `.metadata.json` content is identical for matching documents
4. **Response Format Preservation**: Verify the Lambda response structure (jobId, status, documentsProcessed, totalDocuments, message) is unchanged

### Unit Tests

- Test `extractClaimNumber` helper with various claimId formats (EOB000061, CLM000061, RAD000061)
- Test `listClaimDocuments` filtering with mock S3 responses containing multi-claim files
- Test `processDocument` deduplication with mock DynamoDB containing existing records
- Test edge cases: claimId with no numeric suffix, empty S3 directory, single-claim patient

### Property-Based Tests

- Generate random claimIds and file lists, verify only files with matching numeric suffix are returned
- Generate random document sets, verify deduplication produces exactly one record per unique file+claimId
- Generate matching documents, verify S3 copy and DynamoDB record fields are preserved

### Integration Tests

- Test full claim loading flow with mock AWS services for a multi-claim patient
- Test that repeated invocations for the same claim produce idempotent results
- Test that the summary orchestrator receives only claim-specific documents after the fix
