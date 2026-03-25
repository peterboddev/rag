# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Claim Loader Returns Documents From Other Claims
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate `listClaimDocuments` returns documents belonging to other claims and `processDocument` creates duplicates
  - **Scoped PBT Approach**: For any `{ patientId, claimId }` input where the patient's S3 directories contain documents for multiple claims, scope the property to verify that only documents whose filename numeric suffix matches the claim number suffix are returned
  - Create test file `unit_tests/bug-claim-loader-mixed-patient-exploration.property.test.ts`
  - Mock `S3Client.send` for `ListObjectsV2Command` to return files spanning multiple claims for a patient (e.g., `cms1500_CLM000061.pdf`, `eob_EOB000062.pdf`, `radiology_report_RAD000063.pdf`, `clinical_note_NOTE000096.pdf`, `clinical_note_NOTE000061.pdf`)
  - Use fast-check to generate random `{ patientId, claimId }` inputs where claimId has a numeric suffix (e.g., `EOB000061`)
  - For each generated input, call `listClaimDocuments(patientId)` and assert:
    - Every returned document's filename contains the numeric suffix extracted from claimId
    - Documents with non-matching numeric suffixes are NOT in the result set
  - Also test `processDocument` deduplication: call `processDocument` twice for the same sourceKey and claimId, mock DynamoDB, assert only 1 `PutCommand` is sent (not 2)
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists because `listClaimDocuments` returns ALL documents regardless of claim, and `processDocument` creates duplicate records)
  - Document counterexamples found: `listClaimDocuments("TCIA-030")` returns 30 files instead of 6 for claim 000061; `processDocument` called twice creates 2 DynamoDB records with different documentIds
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Matching Document Processing Behavior Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Create test file `unit_tests/preservation-claim-loader-mixed-patient.property.test.ts`
  - Observe behavior on UNFIXED code for non-buggy inputs (documents whose filename numeric suffix matches the requested claim's numeric suffix)
  - Observe: `processDocument` copies document from source bucket to platform bucket via `CopyObjectCommand` with correct metadata (customeruuid, tenantid, documentid, originalfilename, processingmode, sourcebucket, sourcekey)
  - Observe: `processDocument` writes `.metadata.json` sidecar via `PutObjectCommand` with `{ metadataAttributes: { claimId, patientId, patientName, documentType } }`
  - Observe: `processDocument` creates DynamoDB record via `PutCommand` with correct documentId, customerUuid, tenantId, fileName, s3Key, contentType, processingStatus='queued', claimMetadata, processingMetadata
  - Observe: `determineDocumentType` correctly classifies filenames containing 'cms1500', 'eob', 'radiology'/'report', 'clinical'/'note'
  - Observe: Handler response includes `{ jobId, status, documentsProcessed, totalDocuments, message }` with correct counts
  - Observe: S3 pagination via continuation tokens returns all matching documents across multiple pages
  - Write property-based tests with fast-check capturing observed behavior:
    - For all random matching documents, verify `CopyObjectCommand` destination key follows pattern `uploads/{tenantId}/{customerUUID}/{documentId}/{fileName}`
    - For all random matching documents, verify `.metadata.json` sidecar contains correct claimId, patientId, patientName, documentType
    - For all random matching documents, verify DynamoDB `PutCommand` item has correct structure with processingStatus='queued' and retryCount=0
    - For all random filenames, verify `determineDocumentType` returns correct type based on filename content
    - For all random document sets, verify handler response documentsProcessed matches actual successful count
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

- [x] 3. Fix for claim loader returning documents from other claims and creating duplicates

  - [x] 3.1 Add `extractClaimNumber` helper function
    - In `src/lambda/claim-loader.ts`, add a new exported function `extractClaimNumber(claimId: string): string`
    - Extract the numeric suffix from a claimId using regex `/(\d+)$/` (e.g., `"EOB000061"` → `"000061"`, `"CLM000061"` → `"000061"`)
    - Return the matched numeric string, or throw an error if no numeric suffix is found
    - _Requirements: 2.1_

  - [x] 3.2 Update `listClaimDocuments` to accept claimId and filter by claim number suffix
    - Change function signature from `listClaimDocuments(patientId: string)` to `listClaimDocuments(patientId: string, claimId: string)`
    - Call `extractClaimNumber(claimId)` to get the numeric suffix
    - After listing S3 objects under `patients/{patientId}/claims/`, filter to only files whose filenames contain the claim number (matching patterns like `CLM{number}`, `EOB{number}`, `RAD{number}`)
    - After listing S3 objects under `patients/{patientId}/clinical-notes/`, filter to only files whose filenames contain `NOTE{number}` where number matches the claim number suffix
    - Keep existing S3 pagination logic (continuation tokens) unchanged
    - Keep existing `.pdf` and `.txt` file extension filtering unchanged
    - _Bug_Condition: isBugCondition(input) where fileNumber != claimNumber — documents from other claims are currently included_
    - _Expected_Behavior: Only documents whose filename numeric suffix matches the claim's numeric suffix are returned_
    - _Preservation: S3 pagination, file extension filtering, and return type unchanged_
    - _Requirements: 2.1, 2.2, 2.3, 3.5_

  - [x] 3.3 Add deduplication check in `processDocument`
    - Before generating a new documentId and creating a DynamoDB record, query/scan the documents table for an existing record with the same `fileName` and `claimMetadata.claimId`
    - If a matching record exists, log a structured message (`"Document already processed, skipping duplicate"`) and return early without copying to S3 or writing to DynamoDB
    - If no matching record exists, proceed with existing processing logic unchanged
    - _Bug_Condition: documentAlreadyExistsInDynamo(sourceKey, claimId) — duplicate records created on repeated invocations_
    - _Expected_Behavior: Only 1 DynamoDB record per unique fileName + claimId combination_
    - _Preservation: First-time processing behavior unchanged — S3 copy, metadata sidecar, DynamoDB record creation all preserved_
    - _Requirements: 2.4, 2.5, 3.1, 3.2, 3.3_

  - [x] 3.4 Update handler to pass claimId to `listClaimDocuments`
    - In the `handler` function, change `listClaimDocuments(patientId)` call to `listClaimDocuments(patientId, claimId)`
    - No other handler changes needed — response format, metrics, error handling all unchanged
    - _Requirements: 2.1, 3.7, 3.8_

  - [x] 3.5 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Claim-Specific Document Filtering
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms `listClaimDocuments` only returns claim-matching documents and `processDocument` deduplicates
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.6 Verify preservation tests still pass
    - **Property 2: Preservation** - Matching Document Processing Behavior Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - Verify matching documents still get copied to S3 with correct metadata
    - Verify `.metadata.json` sidecars still written correctly
    - Verify DynamoDB records still created with correct structure
    - Verify handler response format unchanged
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)

- [x] 4. Data cleanup: delete duplicate and misattributed DynamoDB records
  - Delete DynamoDB records from `rag-app-documents-dev` where `claimMetadata.claimId` does not match the filename's embedded claim number (e.g., records for `eob_EOB000063.pdf` tagged with `claimId: EOB000061`)
  - Focus on affected claim EOB000061 for patient TCIA-030 — remove the ~84 misattributed records (90 total minus ~6 correct)
  - Delete duplicate records for the same fileName + claimId combination, keeping only the oldest record
  - Clear stale cached summaries from `rag-app-summary-cache-dev` for affected claimIds so summaries are regenerated with correct data
  - Clear stale summary content from `rag-app-summary-content-dev` bucket for affected claimIds
  - This can be done as a one-time script or manual AWS CLI commands
  - Verify after cleanup: only ~6 records remain for EOB000061, all with matching filename numbers
  - _Requirements: 2.5, 2.6_

- [x] 5. Checkpoint - Ensure all tests pass
  - Run all unit tests: `npx jest --run`
  - Verify bug condition exploration test passes (claim-specific filtering works, deduplication works)
  - Verify preservation tests pass (matching document processing unchanged)
  - Verify all existing tests in `unit_tests/` still pass
  - Verify data cleanup completed successfully for affected records
  - Ensure all tests pass, ask the user if questions arise
