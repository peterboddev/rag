# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - DocumentRecord Field Name Mismatch
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate DocumentRecord objects use `id` instead of `documentId`, causing DynamoDB ValidationException
  - **Scoped PBT Approach**: Scope the property to concrete failing cases - DocumentRecord objects created by claim-loader and document-upload that are written to DynamoDB via PutCommand
  - Test that when a DocumentRecord is constructed from the interface, it contains `documentId` as the partition key field (from Bug Condition in design)
  - Import `DocumentRecord` from `src/types/index.ts` and create a record conforming to the interface
  - Assert the record has a `documentId` property (will fail on unfixed code - only `id` exists)
  - Mock DynamoDB PutCommand in claim-loader's processDocument, capture the Item parameter, assert it contains `documentId` field
  - Mock DynamoDB PutCommand in document-upload handler, capture the Item parameter, assert it contains `documentId` field
  - Verify that for any generated DocumentRecord, `'documentId' in record` is true and `'id' in record` is false
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found: DocumentRecord has `id` field but not `documentId`, DynamoDB rejects with ValidationException
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-Write Behavior Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for non-DynamoDB-write operations
  - Observe: Token estimation distributes tokens across documents using doc.id as map key on unfixed code
  - Observe: Text truncation maps documents correctly using doc.id on unfixed code
  - Observe: Document summary mapping produces correct summary items using doc.id on unfixed code
  - Observe: Claim-loader response structure (statusCode, body, documentsProcessed, totalDocuments, errorCount) is consistent
  - Observe: All other DocumentRecord fields (customerUuid, tenantId, fileName, fileType, s3Key, uploadedAt, processedAt, status, textContent) are populated correctly
  - Write property-based tests capturing observed behavior patterns from Preservation Requirements
  - Test token estimation preservation: for all valid DocumentRecord arrays, distributeTokens produces consistent allocation results using the document identifier field as map key
  - Test text truncation preservation: for all valid DocumentRecord arrays, truncation mapping produces consistent results
  - Test DocumentRecord field population preservation: for all generated records, non-id fields retain same names and types
  - Test response format preservation: claim-loader response always contains statusCode, body, documentsProcessed, totalDocuments, errorCount
  - Property-based testing generates many test cases for stronger guarantees
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 3. Fix for DocumentRecord id-to-documentId field rename

  - [x] 3.1 Rename `id` to `documentId` in DocumentRecord interface
    - Update `src/types/index.ts` line 21: change `id: string` to `documentId: string`
    - Update the field comment to indicate it is the DynamoDB partition key
    - _Bug_Condition: isBugCondition(input) where input.record HAS FIELD 'id' AND NOT 'documentId'_
    - _Expected_Behavior: DocumentRecord interface defines `documentId: string` matching DynamoDB partition key_
    - _Preservation: All other fields in DocumentRecord remain unchanged_
    - _Requirements: 2.1, 2.3_

  - [x] 3.2 Update record creation in claim-loader processDocument
    - Update `src/lambda/claim-loader.ts` line 589: change `id: documentId` to `documentId: documentId` (or shorthand `documentId`)
    - _Bug_Condition: PutCommand item contains `id` instead of `documentId`_
    - _Expected_Behavior: PutCommand item contains `documentId` matching DynamoDB partition key_
    - _Preservation: All other fields in the record creation remain unchanged_
    - _Requirements: 2.1, 2.2, 3.2, 3.3_

  - [x] 3.3 Update record creation in document-upload handler
    - Update `src/lambda/document-upload.ts` line 192: change `id: documentId` to `documentId: documentId`
    - _Bug_Condition: PutCommand item contains `id` instead of `documentId`_
    - _Expected_Behavior: PutCommand item contains `documentId` matching DynamoDB partition key_
    - _Preservation: All other fields in the record creation remain unchanged_
    - _Requirements: 2.1, 2.3_

  - [x] 3.4 Update read mappings in claim-status, document-summary, and document-summary-selective
    - Update `src/lambda/claim-status.ts` line 98: change `doc.id` to `doc.documentId`
    - Update `src/lambda/document-summary.ts` line 471: change `doc.id` to `doc.documentId`
    - Update `src/lambda/document-summary-selective.ts` lines 173, 182: change `doc.id` to `doc.documentId`
    - _Preservation: Query patterns, GSI usage, and response structures remain unchanged_
    - _Requirements: 3.5, 3.6_

  - [x] 3.5 Update doc.id references in service files
    - Update `src/services/token-estimation.ts` lines 69, 77, 89, 93, 94, 102, 104: change `doc.id` to `doc.documentId`
    - Update `src/services/text-truncation.ts` lines 93, 102, 105: change `doc.id` to `doc.documentId`
    - Update `src/services/token-aware-summarization.ts` lines 254, 267, 297: change `doc.id` to `doc.documentId`
    - _Preservation: Token estimation, text truncation, and summarization logic remain unchanged_
    - _Requirements: 3.3_

  - [x] 3.6 Update document.id references in Lambda and service files
    - Update `src/lambda/embeddings-generate.ts` line 391: change `document.id` to `document.documentId`
    - Update `src/lambda/chunking-config-update.ts` lines 242, 256, 260, 269: change `document.id` to `document.documentId`
    - Update `src/services/embedding-generation.ts` lines 97, 105, 117: change `document.id` to `document.documentId`
    - _Preservation: Embedding generation and chunking config logic remain unchanged_
    - _Requirements: 3.3_

  - [x] 3.7 Update test files with correct field name
    - Update `unit_tests/token-estimation.test.ts`: change `id:` to `documentId:` in all mock DocumentRecord objects
    - Update `unit_tests/token-aware-summarization.test.ts`: change `id:` to `documentId:` in all mock DocumentRecord objects
    - Update `unit_tests/text-truncation.test.ts`: change `id:` to `documentId:` in all mock DocumentRecord objects
    - Update `unit_tests/content-prioritization.test.ts`: change `id:` to `documentId:` in all mock DocumentRecord objects
    - Update `unit_tests/claim-metadata.test.ts`: change `id:` to `documentId:` in all mock DocumentRecord objects
    - _Preservation: Test coverage and assertions remain unchanged, only field name updated_
    - _Requirements: 2.3_

  - [x] 3.8 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - DocumentRecord DynamoDB Write Success
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms DocumentRecord objects now contain `documentId` and DynamoDB writes succeed
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.9 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-Write Behavior Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - Verify token estimation still produces same distribution results
    - Verify text truncation still produces same mapping results
    - Verify DocumentRecord non-id fields still populated correctly
    - Verify response format unchanged
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)

- [x] 4. Checkpoint - Ensure all tests pass
  - Run all unit tests: `npm test`
  - Verify bug condition test passes (DocumentRecord uses `documentId` field)
  - Verify preservation tests pass (no regressions in token estimation, text truncation, summarization)
  - Verify all existing unit tests pass with updated mock objects
  - Ensure all tests pass, ask the user if questions arise
