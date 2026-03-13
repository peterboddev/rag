# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Error Serialization Failure
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate Error objects are logged as `{}` in CloudWatch
  - **Scoped PBT Approach**: Scope the property to concrete failing cases - AWS SDK errors (S3 AccessDenied, DynamoDB ValidationException) logged in withRetry and Promise.allSettled contexts
  - Test that when AWS SDK errors occur, the logged output contains `{}` instead of error details (from Bug Condition in design)
  - Mock S3 CopyObject to throw AccessDenied error, capture console.error output, verify it contains empty object
  - Mock DynamoDB PutItem to throw ValidationException, capture console.error output, verify it contains empty object
  - Test withRetry function error logging produces `{}` for non-retryable errors
  - Test Promise.allSettled error logging produces `{}` for result.reason
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)
  - Document counterexamples found: specific console output showing `error: {}` or similar empty representations
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-Error Logging and Processing
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for successful document processing flows
  - Observe: Successful S3 copy operations complete without errors
  - Observe: Successful DynamoDB PutItem operations complete without errors
  - Observe: Retry logic correctly retries on retryable errors
  - Observe: Promise.allSettled processes all documents even when some fail
  - Observe: HTTP response format and status codes remain consistent
  - Write property-based tests capturing observed behavior patterns from Preservation Requirements
  - Test successful document processing: for all valid documents, S3 copy and DynamoDB put succeed
  - Test retry logic preservation: for all retryable errors, withRetry attempts retries with exponential backoff
  - Test batch processing preservation: for all document batches, Promise.allSettled processes all documents
  - Test response format preservation: for all requests, HTTP responses have correct structure
  - Test non-error logging preservation: for all info/success logs, output format is unchanged
  - Property-based testing generates many test cases for stronger guarantees
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. Fix for error serialization in claim-loader Lambda

  - [x] 3.1 Implement the serializeError utility function
    - Create new utility function `serializeError()` in `src/lambda/claim-loader.ts`
    - Place function after `logStructured()` utility (around line 140)
    - Extract standard Error properties: message, name, stack
    - Extract AWS SDK specific properties: code, statusCode, requestId, retryable
    - Handle non-Error values gracefully (return as-is)
    - Handle edge cases: null, undefined, circular references
    - _Bug_Condition: isBugCondition(input) where input.error instanceof Error AND errorIsLoggedDirectly(input.error)_
    - _Expected_Behavior: Serialized error object contains message, name, code, stack, and AWS-specific properties_
    - _Preservation: Non-error logging and all document processing logic remain unchanged_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 3.2 Update withRetry error logging
    - Modify line 157: Change `console.error('Non-retryable error...', error)` to use `serializeError(error)`
    - Modify line 163: Change `console.error('Max retries reached...', error)` to use `serializeError(error)`
    - Ensure retry logic and decision-making remain unchanged
    - _Bug_Condition: Errors logged in withRetry context_
    - _Expected_Behavior: Complete error information visible in CloudWatch logs_
    - _Preservation: Retry logic with exponential backoff unchanged_
    - _Requirements: 2.1, 2.2, 2.3, 3.2_

  - [x] 3.3 Update Promise.allSettled error logging
    - Modify line 254: Change `logStructured('ERROR', 'Document processing failed', { docKey, error: result.reason })` to use `serializeError(result.reason)`
    - Ensure batch processing continues to process all documents
    - _Bug_Condition: Errors logged in Promise.allSettled context_
    - _Expected_Behavior: Complete error information for failed documents in CloudWatch_
    - _Preservation: Batch processing with Promise.allSettled unchanged_
    - _Requirements: 2.1, 2.2, 2.3, 3.3_

  - [x] 3.4 Update main handler error logging for consistency
    - Review line 293 error logging in main handler
    - Update to use serializeError() for consistency (currently uses error.message and error.stack separately)
    - Ensure HTTP response format remains unchanged
    - _Bug_Condition: Errors logged in main handler context_
    - _Expected_Behavior: Consistent error serialization across all logging points_
    - _Preservation: HTTP response format and status codes unchanged_
    - _Requirements: 2.1, 2.2, 2.4, 3.4_

  - [x] 3.5 Update loadPatientMapping error logging
    - Review line 349 error logging in loadPatientMapping function
    - Update to use serializeError() if needed for consistency
    - Ensure patient mapping logic remains unchanged
    - _Bug_Condition: Errors logged in loadPatientMapping context_
    - _Expected_Behavior: Complete error information for patient mapping failures_
    - _Preservation: Patient mapping logic unchanged_
    - _Requirements: 2.1, 2.2, 2.4, 3.5_

  - [x] 3.6 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Error Serialization Success
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - Verify that AWS SDK errors are now logged with complete information (message, name, code, stack)
    - Verify console output contains error details instead of `{}`
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 3.7 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-Error Logging and Processing
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - Verify successful document processing still works
    - Verify retry logic still works correctly
    - Verify batch processing still processes all documents
    - Verify HTTP response format unchanged
    - Verify non-error logging unchanged
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)

- [x] 4. Checkpoint - Ensure all tests pass
  - Run all unit tests: `npm test`
  - Verify bug condition test passes (errors are properly serialized)
  - Verify preservation tests pass (no regressions in document processing)
  - Review CloudWatch logs manually if possible to confirm error details are visible
  - Ensure all tests pass, ask the user if questions arise
