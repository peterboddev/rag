# Claim Portal Authorization Fix - Bugfix Design

## Overview

This bugfix addresses two critical issues in the insurance claim portal that prevent users from viewing patient information and accessing claim documents. Bug 1 causes patient names to display as "Unknown Patient" despite the Lambda functions containing correct parsing code for mapping.json. Bug 2 prevents users from loading claim documents due to missing request parameters and incomplete API implementation. The fix strategy involves verifying Lambda deployment status, adding missing API functionality, and ensuring proper data flow from frontend to backend.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bugs - when patient data is displayed or when claim documents are loaded
- **Property (P)**: The desired behavior - patient names should display correctly from mapping.json and claim documents should load successfully
- **Preservation**: Existing functionality that must remain unchanged - claim counts, S3 file access, CORS handling, routing
- **mapping.json**: S3 file containing patient_mappings array with synthea_id, tcia_id, and patient_name fields
- **patient-list.ts**: Lambda function that lists patients and enriches data with names from mapping.json
- **patient-detail.ts**: Lambda function that retrieves individual patient details with name from mapping.json
- **claim-loader.ts**: Lambda function that copies claim documents from source bucket to platform bucket
- **claimApi.ts**: Frontend service that makes API calls to backend endpoints
- **loadClaim()**: Frontend function in claimApi.ts that triggers claim document loading

## Bug Details

### Fault Condition

The bugs manifest in two distinct scenarios:

**Bug 1 - Patient Names**: When the patient list or patient detail pages load, the system displays "Unknown Patient" for all patient names. The Lambda functions (patient-list.ts and patient-detail.ts) contain correct code to parse mapping.json with the patient_mappings array structure, but the names are not appearing in the UI.

**Bug 2 - Claim Loading**: When a user clicks "Load Claims" for a patient, the system fails to load claim documents. The loadClaim() function in claimApi.ts does not pass required parameters (patientId, claimId, customerUUID) in the request body, and there is no API endpoint for retrieving individual document content for viewing.

**Formal Specification:**
```
FUNCTION isBugCondition_PatientNames(input)
  INPUT: input of type { page: string, patientData: any }
  OUTPUT: boolean
  
  RETURN (input.page == 'patient-list' OR input.page == 'patient-detail')
         AND input.patientData.patientName == 'Unknown Patient'
         AND mappingJsonExists()
         AND mappingJsonHasCorrectStructure()
END FUNCTION

FUNCTION isBugCondition_ClaimLoading(input)
  INPUT: input of type { action: string, requestBody: any }
  OUTPUT: boolean
  
  RETURN input.action == 'loadClaim'
         AND (input.requestBody.claimId IS NULL 
              OR input.requestBody.patientId IS NULL
              OR input.requestBody.customerUUID IS NULL)
END FUNCTION
```

### Examples

**Bug 1 Examples:**
- User navigates to patient list page → sees "Unknown Patient" for all entries instead of "John Smith", "Jane Doe", etc.
- User clicks on a patient → patient detail page shows "Unknown Patient" instead of actual name from mapping.json
- Claim counts display correctly (e.g., "3 claims") but patient name shows "Unknown Patient"
- mapping.json in S3 contains: `{"patient_mappings": [{"synthea_id": "...", "tcia_id": "TCIA-001", "patient_name": "John Smith"}]}` but UI shows "Unknown Patient"

**Bug 2 Examples:**
- User clicks "Load Claims" button → API receives POST request with empty body `{}` instead of `{patientId, claimId, customerUUID}`
- Backend Lambda (claim-loader.ts) returns 400 error: "Missing required fields: patientId, claimId, customerUUID"
- User clicks "View Documents & Summary" → alert shows "Feature not implemented" because no document retrieval endpoint exists
- Edge case: Even if loadClaim() is fixed, users cannot view individual document PDFs because no GET /documents/{documentId} endpoint exists

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Claim counts must continue to display correctly for each patient (e.g., "3 claims")
- S3 file access patterns must remain unchanged (medical-claims-synthetic-data-dev bucket)
- CORS configuration must continue to work for authenticated requests
- Navigation between patient list and patient detail pages must remain functional
- API Gateway Cognito authorization must continue to work as configured
- Lambda function IAM permissions for S3 and DynamoDB must remain unchanged

**Scope:**
All inputs that do NOT involve displaying patient names or loading claim documents should be completely unaffected by this fix. This includes:
- Listing patient directories from S3
- Counting claim files per patient
- Authentication and authorization flows
- Other API endpoints (customers, documents, chunking, etc.)
- S3 event notifications and document processing pipeline

## Hypothesized Root Cause

Based on the bug description and code analysis, the most likely issues are:

### Bug 1 - Patient Names Showing "Unknown Patient"

1. **Lambda Deployment Issue**: The Lambda functions may not have been deployed after the code changes were made
   - The code in patient-list.ts and patient-detail.ts correctly parses the patient_mappings array
   - However, the deployed Lambda may still contain old code that doesn't handle the new structure
   - CloudWatch logs would show old parsing logic if this is the case

2. **Lambda Caching Issue**: The Lambda may be caching an old version of mapping.json
   - patient-list.ts implements a 10-minute cache for patient data
   - If mapping.json was updated but Lambda cache wasn't cleared, old data persists
   - The cache key includes the mapping data, so stale cache could return "Unknown Patient"

3. **S3 File Timestamp Issue**: The mapping.json file may not have been uploaded or may be corrupted
   - Need to verify the file exists at s3://medical-claims-synthetic-data-dev/mapping.json
   - Need to verify the file has the correct structure with patient_mappings array
   - Need to check LastModified timestamp to confirm recent upload

4. **Error Handling Fallback**: The Lambda may be catching an error and falling back to "Unknown Patient"
   - The code has try-catch blocks that return "Unknown Patient" on errors
   - CloudWatch logs would show error messages if this is happening

### Bug 2 - Claim Loading Fails with Unauthorized Error

1. **Missing Request Body Parameters**: The loadClaim() function in claimApi.ts doesn't pass required parameters
   - Current code: `apiRequest<LoadClaimResponse>('/claims/load', { method: 'POST' })`
   - Missing: `body: JSON.stringify({ patientId, claimId, customerUUID })`
   - Backend Lambda expects these fields and returns 400 error when missing

2. **Missing Document Retrieval Endpoint**: No API endpoint exists for viewing individual documents
   - Frontend needs GET /documents/{documentId} endpoint to retrieve document content
   - Current infrastructure only has document upload, processing, summary, retry, and delete endpoints
   - Need to create new Lambda function and API Gateway route for document retrieval

3. **Frontend Missing Parameters**: The loadClaim() function signature doesn't accept required parameters
   - Current signature: `async function loadClaim(claimId: string)`
   - Needs: `async function loadClaim(patientId: string, claimId: string, customerUUID: string)`
   - Frontend components calling loadClaim() need to pass these parameters

## Correctness Properties

Property 1: Fault Condition - Patient Names Display Correctly

_For any_ patient data request where the patient exists in mapping.json (isBugCondition_PatientNames returns true), the fixed Lambda functions SHALL retrieve the patient_name from the patient_mappings array and return it to the frontend, causing the UI to display the actual patient name instead of "Unknown Patient".

**Validates: Requirements 2.1, 2.2**

Property 2: Fault Condition - Claim Documents Load Successfully

_For any_ claim loading request where the user clicks "Load Claims" (isBugCondition_ClaimLoading returns true), the fixed loadClaim() function SHALL include patientId, claimId, and customerUUID in the request body, and the backend Lambda SHALL successfully process the request and copy documents to the platform bucket without authorization errors.

**Validates: Requirements 2.3, 2.4, 2.5**

Property 3: Preservation - Claim Counts and S3 Access

_For any_ operation that does NOT involve displaying patient names or loading claim documents (isBugCondition returns false), the fixed code SHALL produce exactly the same behavior as the original code, preserving claim count accuracy, S3 file access patterns, and all other existing functionality.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct:

#### Bug 1 Fix - Patient Names

**File**: `src/lambda/patient-list.ts` and `src/lambda/patient-detail.ts`

**Verification Steps** (no code changes needed if deployment is the issue):
1. **Check Lambda Deployment Status**: Verify the deployed Lambda code matches the source code
   - Compare CloudWatch logs output with expected parsing logic
   - Check Lambda function LastModified timestamp
   - Verify esbuild bundling is working correctly in buildspec.yml

2. **Clear Lambda Cache**: If cache is the issue, add cache-busting logic or wait for 10-minute TTL
   - Option A: Redeploy Lambda to clear in-memory cache
   - Option B: Add cache version parameter to force refresh
   - Option C: Reduce cache TTL for testing

3. **Verify S3 File**: Confirm mapping.json exists and has correct structure
   - Run: `aws s3 cp s3://medical-claims-synthetic-data-dev/mapping.json -`
   - Verify patient_mappings array exists with patient_name fields
   - Check file size and LastModified timestamp

4. **Check CloudWatch Logs**: Look for error messages in Lambda execution logs
   - Search for "Error loading patient mapping"
   - Search for "Empty mapping.json file"
   - Verify successful parsing log messages

**Specific Changes** (if code changes are needed):
1. **Add Deployment Verification**: Add logging to confirm code version
   ```typescript
   console.log('Lambda version: 2024-01-XX-patient-names-fix');
   ```

2. **Add Cache Debugging**: Log cache hits/misses for troubleshooting
   ```typescript
   console.log('Cache status:', { hit: !!patientListCache, age: Date.now() - (patientListCache?.timestamp || 0) });
   ```

3. **Improve Error Logging**: Add more detailed error messages
   ```typescript
   console.error('Failed to parse mapping.json:', { error, fileSize, structure });
   ```

#### Bug 2 Fix - Claim Loading

**File**: `frontend/src/services/claimApi.ts`

**Specific Changes**:
1. **Update loadClaim() Function Signature**: Add required parameters
   ```typescript
   export async function loadClaim(
     patientId: string,
     claimId: string,
     customerUUID: string
   ): Promise<LoadClaimResponse> {
     return withRetry(() =>
       apiRequest<LoadClaimResponse>('/claims/load', {
         method: 'POST',
         body: JSON.stringify({ patientId, claimId, customerUUID })
       })
     );
   }
   ```

2. **Update Frontend Components**: Pass required parameters when calling loadClaim()
   - Identify all components that call loadClaim()
   - Update to pass patientId, claimId, customerUUID from component state/props

**File**: `src/lambda/document-retrieval.ts` (NEW FILE)

**Specific Changes**:
1. **Create Document Retrieval Lambda**: New Lambda function to retrieve document content
   ```typescript
   // Retrieve document from S3 and return presigned URL or content
   // Input: documentId from path parameters
   // Output: { documentUrl: string, contentType: string, fileName: string }
   ```

2. **Add S3 GetObject Logic**: Retrieve document from platform bucket
   - Query DynamoDB documents table to get s3Key
   - Generate presigned URL for document access
   - Return URL with appropriate expiration time

**File**: `infrastructure/rag-application-stack.ts`

**Specific Changes**:
1. **Create Document Retrieval Lambda Function**: Add new Lambda to CDK stack
   ```typescript
   const documentRetrievalFunction = createLambdaFunction(
     'DocumentRetrievalFunction',
     'dist/src/lambda/document-retrieval.handler',
     {
       DOCUMENTS_TABLE_NAME: documentsTable.tableName,
       DOCUMENTS_BUCKET: documentsBucket.bucketName,
       REGION: this.region,
     }
   );
   ```

2. **Add API Gateway Route**: Create GET /documents/{documentId} endpoint
   ```typescript
   const documentResource = documentsResource.addResource('{documentId}');
   addCorsOptions(documentResource);
   documentResource.addMethod('GET', new apigateway.LambdaIntegration(documentRetrievalFunction, { proxy: true }), methodOptions);
   ```

3. **Grant S3 Permissions**: Allow Lambda to read from documents bucket
   ```typescript
   documentsBucket.grantRead(documentRetrievalFunction);
   ```

**File**: `frontend/src/services/claimApi.ts`

**Specific Changes**:
1. **Add getDocument() Function**: New API function to retrieve document content
   ```typescript
   export async function getDocument(documentId: string): Promise<{ documentUrl: string, contentType: string, fileName: string }> {
     return withRetry(() =>
       apiRequest(`/documents/${encodeURIComponent(documentId)}`)
     );
   }
   ```

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bugs on unfixed code, then verify the fixes work correctly and preserve existing behavior.

### Exploratory Fault Condition Checking

**Goal**: Surface counterexamples that demonstrate the bugs BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: 

**Bug 1 - Patient Names**:
1. Check CloudWatch logs for patient-list and patient-detail Lambda functions
2. Verify mapping.json file exists and has correct structure in S3
3. Compare deployed Lambda code with source code (check LastModified timestamps)
4. Test with cache cleared (redeploy Lambda or wait for TTL)

**Bug 2 - Claim Loading**:
1. Inspect network requests in browser DevTools when clicking "Load Claims"
2. Verify request body is empty or missing required fields
3. Check backend Lambda logs for 400 validation errors
4. Confirm no GET /documents/{documentId} endpoint exists in API Gateway

**Test Cases**:
1. **Patient List Load Test**: Navigate to patient list page and inspect displayed names (will show "Unknown Patient" on unfixed code)
2. **Patient Detail Load Test**: Navigate to patient detail page and inspect displayed name (will show "Unknown Patient" on unfixed code)
3. **Claim Load Request Test**: Click "Load Claims" and inspect network request body (will be empty on unfixed code)
4. **Document View Test**: Click "View Documents & Summary" (will show "not implemented" alert on unfixed code)

**Expected Counterexamples**:
- Patient names display as "Unknown Patient" despite mapping.json containing correct data
- Load Claims request has empty body `{}` instead of `{patientId, claimId, customerUUID}`
- No API endpoint exists for document retrieval
- Possible causes: Lambda not deployed, cache stale, missing request parameters, missing API endpoint

### Fix Checking

**Goal**: Verify that for all inputs where the bug conditions hold, the fixed functions produce the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition_PatientNames(input) DO
  result := getPatientData_fixed(input)
  ASSERT result.patientName != 'Unknown Patient'
  ASSERT result.patientName matches mapping.json entry
END FOR

FOR ALL input WHERE isBugCondition_ClaimLoading(input) DO
  result := loadClaim_fixed(input.patientId, input.claimId, input.customerUUID)
  ASSERT result.status == 'completed' OR result.status == 'completed_with_errors'
  ASSERT result.documentsProcessed > 0
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug conditions do NOT hold, the fixed functions produce the same result as the original functions.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition_PatientNames(input) AND NOT isBugCondition_ClaimLoading(input) DO
  ASSERT originalBehavior(input) == fixedBehavior(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases that manual unit tests might miss
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

**Test Plan**: Observe behavior on UNFIXED code first for non-affected operations, then write property-based tests capturing that behavior.

**Test Cases**:
1. **Claim Count Preservation**: Verify claim counts continue to display correctly after fix
2. **S3 Access Preservation**: Verify S3 file listing and reading continues to work
3. **CORS Preservation**: Verify CORS headers continue to work for all requests
4. **Navigation Preservation**: Verify routing between pages continues to work
5. **Other Endpoints Preservation**: Verify customers, documents, chunking endpoints continue to work

### Unit Tests

- Test patient-list Lambda with mock S3 responses containing mapping.json
- Test patient-detail Lambda with mock S3 responses containing mapping.json
- Test loadClaim() function with required parameters passed correctly
- Test document-retrieval Lambda with mock DynamoDB and S3 responses
- Test edge cases: missing mapping.json, malformed JSON, missing patient in mapping
- Test error handling: S3 access denied, DynamoDB query failures

### Property-Based Tests

- Generate random patient IDs and verify names are retrieved correctly from mapping.json
- Generate random claim loading requests and verify all required parameters are included
- Generate random document IDs and verify retrieval returns correct presigned URLs
- Test that all non-patient-name operations produce identical results before and after fix

### Integration Tests

- Test full patient list flow: S3 → Lambda → API Gateway → Frontend → UI display
- Test full patient detail flow: S3 → Lambda → API Gateway → Frontend → UI display
- Test full claim loading flow: Frontend → API Gateway → Lambda → S3 copy → DynamoDB record
- Test full document viewing flow: Frontend → API Gateway → Lambda → S3 presigned URL → Browser display
- Test that claim counts remain accurate after fix
- Test that CORS works for all authenticated requests after fix
