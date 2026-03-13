# Bug Exploration Results - Document Processing Error Logging

## Test Execution Summary

**Date**: Task 1 Execution
**Test File**: `unit_tests/bug-document-processing-error-logging.test.ts`
**Status**: ✅ Tests written and executed on UNFIXED code
**Outcome**: Tests FAIL as expected (confirms bug exists)

## Counterexamples Found

### Counterexample 1: S3 AccessDenied Error - Missing Message Property

**Test**: `should log complete S3 AccessDenied error details including message property`

**Expected Behavior**: Error logs should contain "Access Denied" message

**Actual Behavior (UNFIXED CODE)**:
```
Non-retryable error in processDocument-patients/TCIA-001/claims/cms1500_claim_123.pdf: 
{"name":"AccessDenied","code":"AccessDenied","statusCode":403,"$metadata":{"httpStatusCode":403,"requestId":"test-request-id-123","attempts":1}}
```

**Analysis**:
- ❌ Error.message ("Access Denied") is MISSING from the log
- ✅ Error.name ("AccessDenied") is present
- ✅ Error.code ("AccessDenied") is present
- ✅ AWS SDK metadata is present
- **Root Cause**: Error.message is a non-enumerable property and doesn't appear in JSON.stringify output

### Counterexample 2: DynamoDB ValidationException - Missing Message Property

**Test**: `should log complete DynamoDB ValidationException error details including message`

**Expected Behavior**: Error logs should contain "Invalid attribute value" message

**Actual Behavior (UNFIXED CODE)**:
```
Non-retryable error in processDocument-patients/TCIA-002/claims/eob_claim_456.pdf: 
{"name":"ValidationException","code":"ValidationException","statusCode":400,"$metadata":{"httpStatusCode":400,"requestId":"test-request-id-456","attempts":1}}
```

**Analysis**:
- ❌ Error.message ("Invalid attribute value") is MISSING from the log
- ✅ Error.name ("ValidationException") is present
- ✅ Error.code ("ValidationException") is present
- ✅ AWS SDK metadata is present
- **Root Cause**: Same as Counterexample 1 - non-enumerable message property

### Counterexample 3: withRetry Error Logging - Missing Message Property

**Test**: `should log complete error details including message in withRetry`

**Expected Behavior**: Error object logged by withRetry should include message property

**Actual Behavior (UNFIXED CODE)**:
```json
{"name":"AccessDenied","code":"AccessDenied","statusCode":403}
```

**Analysis**:
- ❌ Error.message is MISSING
- ✅ Error.name and Error.code are present
- **Location**: Line 157 in `src/lambda/claim-loader.ts`
- **Code**: `console.error('Non-retryable error in ${operationName}:', error);`
- **Root Cause**: Error object is logged directly without serializing non-enumerable properties

### Counterexample 4: Promise.allSettled Error Logging - PASSES

**Test**: `should log complete error details in Promise.allSettled for result.reason`

**Status**: ✅ PASSES (no bug in this location)

**Analysis**:
- This test passes because the structured logging already handles the error properly
- The logStructured function may be doing some serialization already
- No fix needed for this specific location

### Counterexample 5: Error Serialization Behavior Documentation

**Test**: `documents that Error.message and Error.stack are non-enumerable`

**Status**: ✅ PASSES (documents the root cause)

**Findings**:
```javascript
const error = new Error('Test error message');
error.name = 'TestError';
error.code = 'TEST_CODE';

const serialized = JSON.stringify(error);
// Result: {"name":"TestError","code":"TEST_CODE"}

// Missing from serialization:
// - error.message (non-enumerable)
// - error.stack (non-enumerable)

// Present in serialization:
// - error.name (enumerable when set)
// - error.code (enumerable when set as custom property)
```

**Root Cause Confirmed**:
- JavaScript Error objects have non-enumerable properties: `message`, `stack`
- JSON.stringify() only serializes enumerable properties
- AWS SDK errors add enumerable properties: `name`, `code`, `statusCode`, `$metadata`
- Result: Logs show error codes but not error messages

## Bug Condition Validation

### Bug Condition (from design.md)

```
FUNCTION isBugCondition(input)
  INPUT: input of type { error: Error, loggingContext: string }
  OUTPUT: boolean
  
  RETURN input.error instanceof Error
         AND (input.loggingContext IN ['withRetry', 'Promise.allSettled', 'processDocument'])
         AND errorIsLoggedDirectly(input.error)
END FUNCTION
```

### Validation Results

✅ **Confirmed**: Bug condition holds for:
- withRetry function (line 157, 163)
- Error objects are logged directly
- Non-enumerable properties (message, stack) are missing from logs

❌ **Not Confirmed**: Bug condition does NOT hold for:
- Promise.allSettled error logging (already working correctly)

## Impact Assessment

### Severity: HIGH

**Why**: Developers cannot diagnose document processing failures because error messages are missing from CloudWatch logs.

**Example Real-World Impact**:
- Developer sees: `{"name":"AccessDenied","code":"AccessDenied"}`
- Developer needs: `{"name":"AccessDenied","code":"AccessDenied","message":"Access Denied: Insufficient permissions to access bucket rag-app-v2-documents-dev"}`

### Affected Code Locations

1. **src/lambda/claim-loader.ts:157** - withRetry non-retryable error logging
2. **src/lambda/claim-loader.ts:163** - withRetry max retries error logging
3. **src/lambda/claim-loader.ts:349** - loadPatientMapping error logging (needs verification)

### Not Affected

- Promise.allSettled error logging (line 254) - already working correctly
- Main handler error logging (line 293) - uses error.message and error.stack directly

## Recommended Fix

Based on the counterexamples, the fix should:

1. **Create serializeError() utility function** that extracts:
   - `message` (non-enumerable)
   - `name` (enumerable on AWS SDK errors)
   - `code` (enumerable on AWS SDK errors)
   - `stack` (non-enumerable)
   - `statusCode` (enumerable on AWS SDK errors)
   - `$metadata` (enumerable on AWS SDK errors)

2. **Update error logging calls** to use serializeError():
   - Line 157: `console.error('Non-retryable error...', serializeError(error))`
   - Line 163: `console.error('Max retries reached...', serializeError(error))`

3. **Preserve existing behavior** for:
   - Successful operations
   - Retry logic
   - Batch processing
   - Response formatting

## Test Results Summary

| Test Case | Status | Bug Confirmed |
|-----------|--------|---------------|
| S3 AccessDenied Error | ❌ FAIL | ✅ Yes |
| DynamoDB ValidationException | ❌ FAIL | ✅ Yes |
| withRetry Error Logging | ❌ FAIL | ✅ Yes |
| Promise.allSettled Logging | ✅ PASS | ❌ No |
| Error Serialization Docs | ✅ PASS | ✅ Yes (root cause) |

**Overall**: 3 out of 4 bug condition tests FAIL as expected, confirming the bug exists.

## Next Steps

1. ✅ Task 1 Complete: Bug exploration test written and executed
2. ⏭️ Task 2: Write preservation property tests (before implementing fix)
3. ⏭️ Task 3: Implement serializeError() utility and update error logging
4. ⏭️ Task 4: Verify bug exploration tests now PASS after fix

## Conclusion

The bug exploration successfully demonstrated that:
- Error.message property is missing from CloudWatch logs
- The root cause is non-enumerable properties not being serialized by JSON.stringify
- The bug affects withRetry error logging (lines 157, 163)
- The fix requires a serializeError() utility function to extract all error properties

**Bug Confirmed**: ✅ Ready to proceed with fix implementation

## Next Steps

1. ✅ Task 1 Complete: Bug exploration test written and executed
2. ✅ Task 2 Complete: Preservation property tests written and passed
3. ✅ Task 3 Complete: serializeError() utility implemented and error logging updated
4. ✅ Task 4 Complete: Bug exploration tests now PASS after fix

## Fix Verification Results (Task 3.6)

**Date**: Task 3.6 Execution
**Test File**: `unit_tests/bug-document-processing-error-logging.test.ts`
**Status**: ✅ All tests PASS
**Outcome**: Bug fix confirmed successful

### Test Results After Fix

```
PASS  unit_tests/bug-document-processing-error-logging.test.ts (9.408 s)
  Bug Condition Exploration - Error Serialization
    Property 1: Bug Condition - Error Serialization Failure
      ✓ should log complete S3 AccessDenied error details including message property (33 ms)
      ✓ should log complete DynamoDB ValidationException error details including message (8 ms)
      ✓ should log complete error details including message in withRetry (7 ms)
      ✓ should log complete error details in Promise.allSettled for result.reason (10 ms)
    Counterexample Documentation
      ✓ documents that Error.message and Error.stack are non-enumerable (6 ms)

Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
```

### Verification Analysis

**All 5 tests now PASS**, confirming:

1. ✅ **S3 AccessDenied errors** are now logged with complete information including message
2. ✅ **DynamoDB ValidationException errors** are now logged with complete information including message
3. ✅ **withRetry error logging** now includes error.message property
4. ✅ **Promise.allSettled error logging** continues to work correctly
5. ✅ **Error serialization behavior** is properly documented

### Before vs After Comparison

**Before Fix (Task 1)**:
```json
{
  "name": "AccessDenied",
  "code": "AccessDenied",
  "statusCode": 403,
  "$metadata": {"httpStatusCode": 403, "requestId": "test-request-id-123", "attempts": 1}
}
```
❌ Missing: error.message, error.stack

**After Fix (Task 3.6)**:
```json
{
  "message": "Access Denied",
  "name": "AccessDenied",
  "code": "AccessDenied",
  "statusCode": 403,
  "stack": "Error: Access Denied\n    at ...",
  "$metadata": {"httpStatusCode": 403, "requestId": "test-request-id-123", "attempts": 1}
}
```
✅ Includes: error.message, error.name, error.code, error.stack, error.$metadata

## Conclusion

The bug exploration successfully demonstrated that:
- Error.message property is missing from CloudWatch logs
- The root cause is non-enumerable properties not being serialized by JSON.stringify
- The bug affects withRetry error logging (lines 157, 163)
- The fix requires a serializeError() utility function to extract all error properties

**Bug Confirmed**: ✅ Ready to proceed with fix implementation

**Fix Verified**: ✅ All bug exploration tests now pass, confirming the fix is successful

### Impact of Fix

Developers can now:
- See complete error messages in CloudWatch logs
- Diagnose document processing failures effectively
- Understand the root cause of AWS SDK errors
- Access full stack traces for debugging

The serializeError() utility successfully extracts all error properties (message, name, code, stack, statusCode, $metadata) and makes them available in CloudWatch logs.
