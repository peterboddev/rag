# Integration Testing Guide: Insurance Claim Portal

## Overview

This document provides comprehensive integration testing procedures for the Insurance Claim Portal enhancement. These tests verify end-to-end workflows across the frontend, backend Lambda functions, and AWS services.

## Prerequisites

- Access to AWS account with deployed infrastructure
- Test data uploaded to S3 bucket: `medical-claims-synthetic-data-dev`
- Valid Cognito user credentials for testing
- API Gateway endpoint URL configured
- Minimum 10 test patients in S3 source bucket

## Test Environment Setup

### 1. Verify S3 Source Data

```bash
# Check that test data exists
aws s3 ls s3://medical-claims-synthetic-data-dev/patients/

# Verify mapping.json exists
aws s3 ls s3://medical-claims-synthetic-data-dev/mapping.json

# Count patients
aws s3 ls s3://medical-claims-synthetic-data-dev/patients/ | grep "PRE TCIA-" | wc -l
```

Expected: At least 10 patient directories

### 2. Verify Lambda Functions

```bash
# List deployed Lambda functions
aws lambda list-functions --query 'Functions[?contains(FunctionName, `patient`) || contains(FunctionName, `claim`)].FunctionName'
```

Expected functions:
- `patient-list`
- `patient-detail`
- `claim-loader`
- `claim-status`

### 3. Verify API Gateway Endpoints

```bash
# Get API Gateway ID
export API_ID=$(aws apigateway get-rest-apis --query 'items[?name==`rag-app-v2-api`].id' --output text)

# List resources
aws apigateway get-resources --rest-api-id $API_ID
```

Expected endpoints:
- `GET /api/patients`
- `GET /api/patients/{patientId}`
- `POST /api/claims/{claimId}/load`
- `GET /api/claims/{claimId}/status`

## Integration Test Cases

### Test Suite 1: Patient List Loading

#### Test 1.1: Load Patient List from S3

**Objective**: Verify that the patient list endpoint successfully reads from S3 source bucket

**Steps**:
1. Open browser and navigate to application URL
2. Log in with test credentials
3. Click "🏥 Patients" tab
4. Wait for patient list to load

**Expected Results**:
- ✅ Patient list displays within 3 seconds
- ✅ At least 10 patients shown
- ✅ Each patient shows: ID, name, TCIA collection ID, claim count
- ✅ No error messages displayed

**Verification**:
```bash
# Check CloudWatch logs for patient-list Lambda
aws logs tail /aws/lambda/patient-list --follow
```

#### Test 1.2: Patient List Pagination

**Objective**: Verify pagination works correctly

**Steps**:
1. Load patient list (should show 50 patients max)
2. Scroll to bottom
3. Click "Load More" button if present
4. Verify additional patients load

**Expected Results**:
- ✅ "Load More" button appears if more than 50 patients exist
- ✅ Clicking "Load More" appends additional patients
- ✅ No duplicate patients shown
- ✅ Button disappears when all patients loaded

#### Test 1.3: Patient Search Functionality

**Objective**: Verify search filters patients correctly

**Steps**:
1. Load patient list
2. Enter "TCIA-001" in search box
3. Verify filtered results
4. Clear search
5. Enter patient name in search box
6. Verify filtered results

**Expected Results**:
- ✅ Search filters in real-time
- ✅ Filtered count displayed correctly
- ✅ Clearing search shows all patients
- ✅ Search works for patient ID, name, and TCIA collection ID

### Test Suite 2: Claim Document Loading

#### Test 2.1: Load Claim Documents Workflow

**Objective**: Verify end-to-end claim loading from S3 to platform bucket

**Steps**:
1. Navigate to patient list
2. Click on a patient (e.g., TCIA-001)
3. View patient detail page with claims
4. Click "📥 Load Claim Documents" for first claim
5. Wait for processing to complete

**Expected Results**:
- ✅ Patient detail page loads within 2 seconds
- ✅ Claims list displays correctly
- ✅ "Load Claim Documents" button triggers loading
- ✅ Progress bar shows processing status
- ✅ Documents copied from source to platform bucket
- ✅ Status changes to "completed" when done

**Verification**:
```bash
# Check that documents were copied to platform bucket
aws s3 ls s3://rag-app-v2-documents-dev/uploads/ --recursive | grep "TCIA-001"

# Check claim-loader Lambda logs
aws logs tail /aws/lambda/claim-loader --follow

# Verify DynamoDB records created
aws dynamodb scan --table-name rag-app-v2-documents-dev --filter-expression "contains(s3Key, :patient)" --expression-attribute-values '{":patient":{"S":"TCIA-001"}}'
```

#### Test 2.2: Claim Status Polling

**Objective**: Verify claim status updates correctly during processing

**Steps**:
1. Load a claim with multiple documents
2. Observe status updates every 3 seconds
3. Verify progress bar updates
4. Wait for completion

**Expected Results**:
- ✅ Status polls every 3 seconds
- ✅ Progress bar updates with documentsProcessed count
- ✅ Status badge shows current state (processing, completed, failed)
- ✅ Polling stops when status is completed or failed

#### Test 2.3: Multiple Claim Loading

**Objective**: Verify multiple claims can be loaded simultaneously

**Steps**:
1. Navigate to patient with multiple claims
2. Click "Load Claim Documents" for first claim
3. Immediately click "Load Claim Documents" for second claim
4. Verify both process correctly

**Expected Results**:
- ✅ Both claims show loading state
- ✅ Progress tracked independently for each claim
- ✅ No interference between claim loading jobs
- ✅ Both complete successfully

### Test Suite 3: Document Processing Pipeline

#### Test 3.1: Textract Text Extraction

**Objective**: Verify documents are processed through Textract

**Steps**:
1. Load a claim with PDF documents
2. Wait for processing to complete
3. Check DynamoDB for extracted text

**Expected Results**:
- ✅ All PDF documents processed
- ✅ Extracted text stored in DynamoDB
- ✅ Text length > 0 for valid documents
- ✅ Processing status = "completed"

**Verification**:
```bash
# Check document-processing Lambda logs
aws logs tail /aws/lambda/document-processing --follow

# Query DynamoDB for processed documents
aws dynamodb query --table-name rag-app-v2-documents-dev \
  --key-condition-expression "customerUuid = :uuid" \
  --expression-attribute-values '{":uuid":{"S":"<customer-uuid>"}}'
```

#### Test 3.2: Embedding Generation

**Objective**: Verify embeddings are generated and stored in OpenSearch

**Steps**:
1. Load a claim and wait for processing
2. Verify embeddings generated
3. Check OpenSearch for vector storage

**Expected Results**:
- ✅ Embeddings generated for all processed documents
- ✅ Vectors stored in OpenSearch collection
- ✅ Document metadata includes embedding IDs

**Verification**:
```bash
# Check embedding-generation service logs
aws logs tail /aws/lambda/embeddings-generate --follow

# Query OpenSearch (requires endpoint URL)
curl -X GET "https://<opensearch-endpoint>/documents/_search?q=*"
```

#### Test 3.3: Error Handling for Failed Documents

**Objective**: Verify system handles document processing failures gracefully

**Steps**:
1. Upload an invalid/corrupted PDF
2. Trigger processing
3. Verify error handling

**Expected Results**:
- ✅ Failed document marked with status "failed"
- ✅ Error message stored in DynamoDB
- ✅ Other documents continue processing
- ✅ Retry option available for failed documents

### Test Suite 4: AI Summary Generation

#### Test 4.1: Generate Claim Summary

**Objective**: Verify AI-generated summaries work for claims

**Steps**:
1. Load a claim and wait for completion
2. Click "📄 View Documents & Summary"
3. Wait for summary generation

**Expected Results**:
- ✅ Summary generated within 10 seconds
- ✅ Summary includes relevant claim information
- ✅ Source documents referenced
- ✅ Summary is coherent and accurate

**Verification**:
```bash
# Check document-summary Lambda logs
aws logs tail /aws/lambda/document-summary --follow

# Verify Bedrock API calls
aws cloudwatch get-metric-statistics \
  --namespace AWS/Bedrock \
  --metric-name Invocations \
  --dimensions Name=ModelId,Value=amazon.nova-pro-v1:0 \
  --start-time $(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

#### Test 4.2: Summary with Multiple Documents

**Objective**: Verify summaries work with multiple claim documents

**Steps**:
1. Load a claim with 5+ documents
2. Generate summary
3. Verify all documents considered

**Expected Results**:
- ✅ Summary incorporates information from all documents
- ✅ Processing time < 15 seconds
- ✅ Token limits respected
- ✅ No truncation errors

### Test Suite 5: Multi-Tenant Isolation

#### Test 5.1: Tenant Data Isolation

**Objective**: Verify users can only see their tenant's data

**Steps**:
1. Log in as Tenant A user
2. Load patients and claims
3. Note patient IDs
4. Log out
5. Log in as Tenant B user
6. Verify Tenant A data not visible

**Expected Results**:
- ✅ Tenant A user sees only Tenant A patients
- ✅ Tenant B user sees only Tenant B patients
- ✅ No cross-tenant data leakage
- ✅ API returns 403 for unauthorized access attempts

**Verification**:
```bash
# Check DynamoDB records have correct tenantId
aws dynamodb scan --table-name rag-app-v2-documents-dev \
  --filter-expression "tenantId = :tenant" \
  --expression-attribute-values '{":tenant":{"S":"<tenant-id>"}}'
```

#### Test 5.2: API Authorization

**Objective**: Verify API endpoints enforce authentication

**Steps**:
1. Attempt to call API without auth token
2. Attempt to call API with invalid token
3. Attempt to call API with expired token

**Expected Results**:
- ✅ All requests return 401 Unauthorized
- ✅ No data returned without valid token
- ✅ Error messages don't reveal system details

### Test Suite 6: Performance Testing

#### Test 6.1: Patient List Performance

**Objective**: Verify patient list loads within SLA

**Steps**:
1. Clear browser cache
2. Load patient list
3. Measure time to display

**Expected Results**:
- ✅ Initial load < 2 seconds (p95)
- ✅ Pagination < 1 second (p95)
- ✅ Search filtering < 500ms

#### Test 6.2: Claim Loading Throughput

**Objective**: Verify system handles multiple concurrent claim loads

**Steps**:
1. Open 5 browser tabs
2. Load different claims in each tab simultaneously
3. Monitor processing

**Expected Results**:
- ✅ All claims process successfully
- ✅ No throttling errors
- ✅ Average processing time < 30 seconds per claim
- ✅ No Lambda timeout errors

#### Test 6.3: Summary Generation Performance

**Objective**: Verify summary generation meets SLA

**Steps**:
1. Generate summaries for claims with varying document counts
2. Measure generation time

**Expected Results**:
- ✅ < 10 seconds for claims with < 20 documents (p95)
- ✅ < 15 seconds for claims with 20-50 documents (p95)
- ✅ No timeout errors
- ✅ Bedrock API rate limits not exceeded

### Test Suite 7: Error Handling and Resilience

#### Test 7.1: Network Failure Recovery

**Objective**: Verify system handles network failures gracefully

**Steps**:
1. Load patient list
2. Disable network
3. Attempt to load claim
4. Re-enable network
5. Retry operation

**Expected Results**:
- ✅ Error message displayed to user
- ✅ Retry button available
- ✅ Retry succeeds after network restored
- ✅ No data corruption

#### Test 7.2: S3 Access Errors

**Objective**: Verify system handles S3 access errors

**Steps**:
1. Temporarily revoke S3 read permissions
2. Attempt to load patient list
3. Restore permissions
4. Retry

**Expected Results**:
- ✅ User-friendly error message
- ✅ No system crash
- ✅ Retry succeeds after permissions restored
- ✅ Error logged to CloudWatch

#### Test 7.3: Lambda Timeout Handling

**Objective**: Verify system handles Lambda timeouts

**Steps**:
1. Load a claim with many large documents
2. Monitor for timeout

**Expected Results**:
- ✅ Timeout handled gracefully
- ✅ Partial progress saved
- ✅ User notified of timeout
- ✅ Retry option available

## Load Testing

### Test 8.1: 50 Concurrent Users

**Objective**: Verify system supports 50 concurrent users

**Tools**: Apache JMeter or AWS Load Testing

**Test Script**:
```bash
# Install artillery for load testing
npm install -g artillery

# Create load test config
cat > load-test.yml <<EOF
config:
  target: 'https://<api-gateway-url>'
  phases:
    - duration: 300
      arrivalRate: 10
      name: "Ramp up to 50 users"
scenarios:
  - name: "Patient list and claim loading"
    flow:
      - get:
          url: "/api/patients?limit=50"
          headers:
            Authorization: "Bearer {{authToken}}"
      - think: 2
      - get:
          url: "/api/patients/TCIA-001"
          headers:
            Authorization: "Bearer {{authToken}}"
      - think: 3
      - post:
          url: "/api/claims/claim-001/load"
          headers:
            Authorization: "Bearer {{authToken}}"
EOF

# Run load test
artillery run load-test.yml
```

**Expected Results**:
- ✅ All requests complete successfully
- ✅ Response times < 3 seconds (p95)
- ✅ Error rate < 1%
- ✅ No Lambda throttling
- ✅ No DynamoDB throttling

### Test 8.2: Sustained Load

**Objective**: Verify system stability under sustained load

**Duration**: 30 minutes

**Load**: 20 concurrent users

**Expected Results**:
- ✅ No memory leaks
- ✅ Consistent response times
- ✅ No error rate increase over time
- ✅ All Lambda functions remain healthy

## Monitoring and Metrics

### CloudWatch Dashboards

Verify the following metrics during testing:

1. **Lambda Metrics**:
   - Invocation count
   - Duration (p50, p95, p99)
   - Error rate
   - Throttles

2. **API Gateway Metrics**:
   - Request count
   - 4xx errors
   - 5xx errors
   - Latency

3. **DynamoDB Metrics**:
   - Read/write capacity units
   - Throttled requests
   - System errors

4. **Bedrock Metrics**:
   - Model invocations
   - Token usage
   - Latency

### Alarms

Verify alarms trigger correctly:

```bash
# List CloudWatch alarms
aws cloudwatch describe-alarms --alarm-name-prefix "insurance-claim-portal"

# Test alarm by triggering condition
# (e.g., generate errors to trigger error rate alarm)
```

## Test Completion Checklist

- [ ] All Test Suite 1 tests passed (Patient List Loading)
- [ ] All Test Suite 2 tests passed (Claim Document Loading)
- [ ] All Test Suite 3 tests passed (Document Processing Pipeline)
- [ ] All Test Suite 4 tests passed (AI Summary Generation)
- [ ] All Test Suite 5 tests passed (Multi-Tenant Isolation)
- [ ] All Test Suite 6 tests passed (Performance Testing)
- [ ] All Test Suite 7 tests passed (Error Handling)
- [ ] Load testing completed successfully
- [ ] All CloudWatch metrics within acceptable ranges
- [ ] All alarms configured and tested
- [ ] No critical or high-severity bugs found
- [ ] Documentation updated with test results

## Known Issues and Limitations

Document any issues found during testing:

| Issue ID | Description | Severity | Status | Workaround |
|----------|-------------|----------|--------|------------|
| | | | | |

## Sign-off

**Tested By**: ___________________  
**Date**: ___________________  
**Environment**: ___________________  
**Test Results**: PASS / FAIL  
**Notes**: ___________________
