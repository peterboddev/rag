# Document Processing Failure Fix - Bugfix Design

## Overview

This bugfix addresses the error serialization issue in the claim-loader Lambda function where AWS SDK Error objects are logged as empty `{}` objects in CloudWatch. The root cause is that JavaScript Error objects don't serialize to JSON properly - only enumerable properties are included, and standard Error properties (message, name, stack, code) are non-enumerable. The fix involves creating a utility function to properly serialize Error objects before logging, ensuring developers can diagnose document processing failures.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug - when AWS SDK errors occur and are logged directly without proper serialization
- **Property (P)**: The desired behavior when errors are logged - complete error information including message, name, code, and stack trace should be visible in CloudWatch
- **Preservation**: Existing document processing, retry logic, and batch processing behavior that must remain unchanged by the fix
- **processDocument**: The function in `src/lambda/claim-loader.ts` that copies documents to the platform bucket and creates DynamoDB records
- **withRetry**: The retry wrapper function that implements exponential backoff for AWS SDK operations
- **Promise.allSettled**: The batch processing pattern that processes multiple documents in parallel and captures both successes and failures

## Bug Details

### Bug Condition

The bug manifests when AWS SDK errors (from S3 CopyObject or DynamoDB PutItem operations) are caught and logged. The error objects are logged directly using `console.log()` or `console.error()`, which uses JSON.stringify() internally. Since Error objects have non-enumerable properties, JSON.stringify() produces `{}` instead of the error details.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { error: Error, loggingContext: string }
  OUTPUT: boolean
  
  RETURN input.error instanceof Error
         AND (input.loggingContext IN ['withRetry', 'Promise.allSettled', 'processDocument'])
         AND errorIsLoggedDirectly(input.error)
END FUNCTION
```

### Examples

- **Example 1**: S3 CopyObject fails with AccessDenied error
  - Expected: `{ name: 'AccessDenied', message: 'Access Denied', code: 'AccessDenied', stack: '...' }`
  - Actual: `{}`

- **Example 2**: DynamoDB PutItem fails with ValidationException
  - Expected: `{ name: 'ValidationException', message: 'Invalid attribute value', code: 'ValidationException', stack: '...' }`
  - Actual: `{}`

- **Example 3**: Network timeout during S3 operation
  - Expected: `{ name: 'TimeoutError', message: 'Connection timed out', code: 'TimeoutError', stack: '...' }`
  - Actual: `{}`

- **Edge Case**: Non-Error objects (strings, numbers) should be logged as-is without modification

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Document processing logic (S3 copy and DynamoDB record creation) must continue to work exactly as before
- Retry logic with exponential backoff must remain unchanged
- Batch processing with Promise.allSettled must continue to process all documents even if some fail
- HTTP response format and status codes must remain unchanged
- CloudWatch metrics publishing must remain unchanged

**Scope:**
All inputs that do NOT involve error logging should be completely unaffected by this fix. This includes:
- Successful document processing flows
- Retry decision logic (isRetryableError function)
- Batch processing logic
- Request validation and authentication
- Response formatting

## Hypothesized Root Cause

Based on the bug description and code analysis, the root cause is:

1. **JavaScript Error Serialization**: Error objects in JavaScript have non-enumerable properties (message, name, stack, code). When JSON.stringify() is called on an Error object (either directly or indirectly through console.log), it produces `{}` because only enumerable properties are serialized.

2. **Direct Error Logging in withRetry**: Lines 157 and 163 log errors directly:
   ```typescript
   console.error(`Non-retryable error in ${operationName}:`, error);
   console.error(`Max retries reached for ${operationName}:`, error);
   ```

3. **Direct Error Logging in Promise.allSettled**: Line 254 logs `result.reason` directly:
   ```typescript
   logStructured('ERROR', 'Document processing failed', { docKey, error: result.reason });
   ```

4. **Missing Error Serialization Utility**: The codebase lacks a utility function to extract error properties before logging.

## Correctness Properties

Property 1: Bug Condition - Error Serialization

_For any_ error that occurs during document processing (S3 operations, DynamoDB operations, or retry logic), the fixed logging SHALL serialize the Error object to extract message, name, code, stack, and AWS-specific properties (requestId, statusCode) before logging to CloudWatch.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

Property 2: Preservation - Non-Error Logging

_For any_ logging that does NOT involve Error objects (success messages, info logs, metrics), the fixed code SHALL produce exactly the same log output as the original code, preserving all existing logging behavior.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

**File**: `src/lambda/claim-loader.ts`

**Function**: Multiple functions (withRetry, handler, processDocument batch processing)

**Specific Changes**:

1. **Add Error Serialization Utility**: Create a new utility function `serializeError()` that extracts all relevant properties from Error objects
   - Extract standard properties: message, name, stack
   - Extract AWS SDK properties: code, statusCode, requestId, retryable
   - Handle non-Error values gracefully (return as-is)
   - Place function near other utility functions (after logStructured)

2. **Update withRetry Error Logging**: Modify lines 157 and 163 to use serializeError()
   - Change: `console.error('Non-retryable error...', error)`
   - To: `console.error('Non-retryable error...', serializeError(error))`

3. **Update Promise.allSettled Error Logging**: Modify line 254 to serialize result.reason
   - Change: `logStructured('ERROR', 'Document processing failed', { docKey, error: result.reason })`
   - To: `logStructured('ERROR', 'Document processing failed', { docKey, error: serializeError(result.reason) })`

4. **Update Main Handler Error Logging**: Verify line 293 properly serializes errors (already uses error.message and error.stack, but should use serializeError for consistency)

5. **Update loadPatientMapping Error Logging**: Verify line 349 properly serializes errors

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code by observing empty error objects in logs, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm that Error objects are logged as `{}` in the current implementation.

**Test Plan**: Write tests that trigger AWS SDK errors (S3 AccessDenied, DynamoDB ValidationException) and capture console.log/console.error output. Run these tests on the UNFIXED code to observe empty error objects in logs.

**Test Cases**:
1. **S3 CopyObject Error Test**: Mock S3 to throw AccessDenied error, verify logs show `{}` (will fail on unfixed code)
2. **DynamoDB PutItem Error Test**: Mock DynamoDB to throw ValidationException, verify logs show `{}` (will fail on unfixed code)
3. **Retry Logic Error Test**: Trigger non-retryable error in withRetry, verify logs show `{}` (will fail on unfixed code)
4. **Promise.allSettled Error Test**: Process batch with one failing document, verify logs show `{}` for result.reason (will fail on unfixed code)

**Expected Counterexamples**:
- Console output contains `error: {}` or similar empty object representations
- Possible causes: JSON.stringify() on Error objects, direct error logging without serialization

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds (Error objects being logged), the fixed function produces the expected behavior (complete error information in logs).

**Pseudocode:**
```
FOR ALL error WHERE error instanceof Error DO
  serialized := serializeError(error)
  ASSERT serialized.message IS NOT EMPTY
  ASSERT serialized.name IS NOT EMPTY
  ASSERT serialized.stack IS NOT EMPTY
  ASSERT serialized IS NOT EQUAL TO {}
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold (non-error logging, successful operations), the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL operation WHERE NOT involvesErrorLogging(operation) DO
  ASSERT fixedFunction(operation) = originalFunction(operation)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-error scenarios

**Test Plan**: Observe behavior on UNFIXED code first for successful document processing, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Successful Document Processing**: Observe that successful S3 copy and DynamoDB put operations work correctly on unfixed code, then write test to verify this continues after fix
2. **Retry Logic Preservation**: Observe that retryable errors trigger retries correctly on unfixed code, then write test to verify this continues after fix
3. **Batch Processing Preservation**: Observe that Promise.allSettled processes all documents on unfixed code, then write test to verify this continues after fix
4. **Response Format Preservation**: Observe that HTTP responses have correct format on unfixed code, then write test to verify this continues after fix

### Unit Tests

- Test serializeError() utility with various Error types (Error, AWS SDK errors, custom errors)
- Test serializeError() with non-Error inputs (strings, numbers, objects)
- Test that withRetry logs contain error details after fix
- Test that Promise.allSettled error handling logs contain error details after fix
- Test edge cases (null, undefined, circular references)

### Property-Based Tests

- Generate random Error objects with various properties and verify serializeError() extracts all properties
- Generate random AWS SDK error scenarios and verify complete error information is logged
- Test that all successful operations continue to work across many random inputs

### Integration Tests

- Test full document processing flow with intentional S3 errors, verify CloudWatch logs contain error details
- Test full document processing flow with intentional DynamoDB errors, verify CloudWatch logs contain error details
- Test batch processing with mix of successful and failing documents, verify all errors are properly logged
