# Implementation Plan

- [x] 1. Write bug condition exploration tests (Bug 1 - Patient Names)
  - **Property 1: Fault Condition** - Patient Names Display "Unknown Patient"
  - **CRITICAL**: These tests MUST FAIL on unfixed code - failure confirms the bugs exist
  - **DO NOT attempt to fix the tests or the code when they fail**
  - **NOTE**: These tests encode the expected behavior - they will validate the fix when they pass after implementation
  - **GOAL**: Surface counterexamples that demonstrate Bug 1 exists
  - **Scoped PBT Approach**: Test concrete failing cases - patient list and patient detail pages showing "Unknown Patient"
  - Test that patient list page displays actual patient names from mapping.json (not "Unknown Patient")
  - Test that patient detail page displays actual patient name from mapping.json (not "Unknown Patient")
  - Verify mapping.json exists in S3 with correct patient_mappings structure
  - Check CloudWatch logs for Lambda execution and parsing logic
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct - it proves Bug 1 exists)
  - Document counterexamples found:
    - Which patients show "Unknown Patient"
    - Lambda deployment status (check LastModified timestamp)
    - Cache status (check if 10-minute cache is stale)
    - S3 file verification (confirm mapping.json exists and has correct structure)
    - CloudWatch log analysis (look for parsing errors or old code patterns)
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 2.1, 2.2_

- [x] 2. Write bug condition exploration tests (Bug 2 - Claim Loading)
  - **Property 1: Fault Condition** - Claim Loading Fails with Missing Parameters
  - **CRITICAL**: These tests MUST FAIL on unfixed code - failure confirms the bugs exist
  - **DO NOT attempt to fix the tests or the code when they fail**
  - **NOTE**: These tests encode the expected behavior - they will validate the fix when they pass after implementation
  - **GOAL**: Surface counterexamples that demonstrate Bug 2 exists
  - **Scoped PBT Approach**: Test concrete failing cases - loadClaim() missing request parameters and missing document retrieval endpoint
  - Test that loadClaim() includes patientId, claimId, customerUUID in request body
  - Test that backend Lambda receives all required parameters
  - Test that document retrieval endpoint (GET /documents/{documentId}) exists
  - Inspect network requests in browser DevTools when clicking "Load Claims"
  - Check backend Lambda logs for 400 validation errors
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct - it proves Bug 2 exists)
  - Document counterexamples found:
    - Request body is empty or missing required fields
    - Backend returns 400 error: "Missing required fields"
    - No GET /documents/{documentId} endpoint exists in API Gateway
    - "View Documents & Summary" shows "not implemented" alert
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 2.3, 2.4, 2.5_

- [x] 3. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Existing Functionality Remains Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for non-buggy operations:
    - Claim counts display correctly for each patient (e.g., "3 claims")
    - S3 file access patterns work (medical-claims-synthetic-data-dev bucket)
    - CORS configuration works for authenticated requests
    - Navigation between patient list and patient detail pages works
    - API Gateway Cognito authorization works
    - Other API endpoints work (customers, documents, chunking, etc.)
  - Write property-based tests capturing observed behavior patterns from Preservation Requirements
  - Property-based testing generates many test cases for stronger guarantees
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 4. Fix Bug 1 - Patient Names Display Issue

  - [x] 4.1 Verify Lambda deployment status
    - Check CloudWatch logs for patient-list and patient-detail Lambda functions
    - Compare log output with expected parsing logic for patient_mappings array
    - Check Lambda function LastModified timestamp
    - Verify esbuild bundling is working correctly in buildspec.yml
    - If Lambda code is outdated, redeploy using CDK: `cdk deploy`
    - _Bug_Condition: isBugCondition_PatientNames(input) where input.patientData.patientName == 'Unknown Patient'_
    - _Expected_Behavior: result.patientName matches mapping.json entry (not 'Unknown Patient')_
    - _Preservation: Claim counts, S3 access, CORS, navigation must remain unchanged_
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 4.2 Clear Lambda cache if needed
    - Check if Lambda is caching old version of mapping.json (10-minute TTL)
    - Option A: Redeploy Lambda to clear in-memory cache
    - Option B: Wait for 10-minute cache TTL to expire
    - Option C: Add cache version parameter to force refresh (if needed)
    - Add cache debugging logs: `console.log('Cache status:', { hit: !!patientListCache, age: Date.now() - (patientListCache?.timestamp || 0) });`
    - _Requirements: 2.1, 2.2_

  - [x] 4.3 Verify S3 mapping.json file
    - Run: `aws s3 cp s3://medical-claims-synthetic-data-dev/mapping.json -`
    - Verify patient_mappings array exists with patient_name fields
    - Check file size and LastModified timestamp
    - Confirm structure matches: `{"patient_mappings": [{"synthea_id": "...", "tcia_id": "...", "patient_name": "..."}]}`
    - If file is missing or malformed, regenerate using medical-claims-generator
    - _Requirements: 2.1, 2.2_

  - [x] 4.4 Check CloudWatch logs for errors
    - Search for "Error loading patient mapping" in CloudWatch logs
    - Search for "Empty mapping.json file" in CloudWatch logs
    - Verify successful parsing log messages appear
    - If errors found, add improved error logging: `console.error('Failed to parse mapping.json:', { error, fileSize, structure });`
    - _Requirements: 2.1, 2.2_

  - [x] 4.5 Add deployment verification logging (if code changes needed)
    - Add version logging to patient-list.ts: `console.log('Lambda version: 2024-01-XX-patient-names-fix');`
    - Add version logging to patient-detail.ts: `console.log('Lambda version: 2024-01-XX-patient-names-fix');`
    - Redeploy and verify new logs appear in CloudWatch
    - _Requirements: 2.1, 2.2_

  - [x] 4.6 Verify bug condition exploration tests now pass (Bug 1)
    - **Property 1: Expected Behavior** - Patient Names Display Correctly
    - **IMPORTANT**: Re-run the SAME tests from task 1 - do NOT write new tests
    - The tests from task 1 encode the expected behavior
    - When these tests pass, it confirms patient names display correctly
    - Run bug condition exploration tests from step 1
    - **EXPECTED OUTCOME**: Tests PASS (confirms Bug 1 is fixed)
    - Verify patient list shows actual names (e.g., "John Smith", "Jane Doe")
    - Verify patient detail shows actual name from mapping.json
    - _Requirements: 2.1, 2.2_

- [x] 5. Fix Bug 2 - Claim Loading Issue

  - [x] 5.1 Update loadClaim() function signature in frontend
    - File: `frontend/src/services/claimApi.ts`
    - Change signature from: `async function loadClaim(claimId: string)`
    - To: `async function loadClaim(patientId: string, claimId: string, customerUUID: string)`
    - Add request body: `body: JSON.stringify({ patientId, claimId, customerUUID })`
    - Full implementation:
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
    - _Bug_Condition: isBugCondition_ClaimLoading(input) where request body is missing required fields_
    - _Expected_Behavior: request includes patientId, claimId, customerUUID in body_
    - _Preservation: Other API calls must remain unchanged_
    - _Requirements: 2.3, 2.4, 3.1, 3.2, 3.3_

  - [x] 5.2 Update frontend components calling loadClaim()
    - Identify all components that call loadClaim() (search codebase)
    - Update each call to pass patientId, claimId, customerUUID from component state/props
    - Example: `await loadClaim(patient.id, claim.id, customerUUID)`
    - Ensure all three parameters are available in component context
    - _Requirements: 2.3, 2.4_

  - [x] 5.3 Create document retrieval Lambda function
    - File: `src/lambda/document-retrieval.ts` (NEW FILE)
    - Implement Lambda to retrieve document content from S3
    - Input: documentId from path parameters
    - Query DynamoDB documents table to get s3Key using documentId
    - Generate presigned URL for document access from platform bucket
    - Return: `{ documentUrl: string, contentType: string, fileName: string }`
    - Set presigned URL expiration to 1 hour
    - Add error handling for missing documents
    - _Requirements: 2.5_

  - [x] 5.4 Add document retrieval Lambda to CDK stack
    - File: `infrastructure/rag-application-stack.ts`
    - Create Lambda function:
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
    - Grant S3 read permissions: `documentsBucket.grantRead(documentRetrievalFunction);`
    - Grant DynamoDB read permissions: `documentsTable.grantReadData(documentRetrievalFunction);`
    - _Requirements: 2.5_

  - [x] 5.5 Add API Gateway route for document retrieval
    - File: `infrastructure/rag-application-stack.ts`
    - Create GET /documents/{documentId} endpoint:
      ```typescript
      const documentResource = documentsResource.addResource('{documentId}');
      addCorsOptions(documentResource);
      documentResource.addMethod('GET', new apigateway.LambdaIntegration(documentRetrievalFunction, { proxy: true }), methodOptions);
      ```
    - Ensure CORS is configured for the new endpoint
    - Ensure Cognito authorization is applied via methodOptions
    - _Requirements: 2.5_

  - [x] 5.6 Add getDocument() function to frontend API service
    - File: `frontend/src/services/claimApi.ts`
    - Add new function:
      ```typescript
      export async function getDocument(documentId: string): Promise<{ documentUrl: string, contentType: string, fileName: string }> {
        return withRetry(() =>
          apiRequest(`/documents/${encodeURIComponent(documentId)}`)
        );
      }
      ```
    - Update frontend components to use getDocument() for viewing documents
    - Replace "not implemented" alert with actual document retrieval logic
    - _Requirements: 2.5_

  - [x] 5.7 Deploy infrastructure changes
    - Run: `npm run build` to compile TypeScript
    - Run: `cdk synth` to verify CloudFormation template
    - Run: `cdk deploy` to deploy Lambda and API Gateway changes
    - Verify deployment completes successfully
    - Check CloudFormation stack outputs for new resources
    - _Requirements: 2.3, 2.4, 2.5_

  - [x] 5.8 Verify bug condition exploration tests now pass (Bug 2)
    - **Property 1: Expected Behavior** - Claim Loading Succeeds
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - The tests from task 2 encode the expected behavior
    - When these tests pass, it confirms claim loading works correctly
    - Run bug condition exploration tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms Bug 2 is fixed)
    - Verify loadClaim() includes all required parameters in request body
    - Verify backend Lambda processes request successfully
    - Verify document retrieval endpoint returns presigned URLs
    - _Requirements: 2.3, 2.4, 2.5_

  - [x] 5.9 Verify preservation tests still pass
    - **Property 2: Preservation** - No Regressions
    - **IMPORTANT**: Re-run the SAME tests from task 3 - do NOT write new tests
    - Run preservation property tests from step 3
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm claim counts still display correctly
    - Confirm S3 access patterns still work
    - Confirm CORS still works for all requests
    - Confirm navigation still works
    - Confirm other API endpoints still work
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 6. Checkpoint - Ensure all tests pass and functionality works
  - Run all bug condition exploration tests (tasks 1 and 2) - should now PASS
  - Run all preservation property tests (task 3) - should still PASS
  - Manual verification:
    - Navigate to patient list page - verify actual patient names display (not "Unknown Patient")
    - Navigate to patient detail page - verify actual patient name displays
    - Click "Load Claims" button - verify claims load successfully without errors
    - Click "View Documents & Summary" - verify documents can be viewed
    - Verify claim counts still display correctly
    - Verify navigation between pages still works
  - Check CloudWatch logs for any errors or warnings
  - Verify API Gateway metrics show successful requests
  - Ask user if any questions or issues arise
