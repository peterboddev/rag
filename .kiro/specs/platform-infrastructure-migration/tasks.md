# Tasks

## 1. Infrastructure Code Migration

### 1.1 Create New CDK Stack File
- [x] Create `infrastructure/rag-application-stack.ts` with new stack class
- [x] Add environment context retrieval
- [x] Add application name constant `rag-app`
- [x] Set up stack constructor with proper typing

### 1.2 Implement SSM Parameter Lookups
- [x] Add SSM parameter lookup for IAM role ARN `/rag-app/{environment}/iam/application-role-arn`
- [x] Add SSM parameter lookup for API Gateway ID `/rag-app/{environment}/apigateway/api-id`
- [x] Add SSM parameter lookup for API Gateway root resource ID `/rag-app/{environment}/apigateway/root-resource-id`
- [x] Add SSM parameter lookup for customers table name `/rag-app/{environment}/dynamodb/customers-table-name`
- [x] Add SSM parameter lookup for documents table name `/rag-app/{environment}/dynamodb/documents-table-name`
- [x] Add error handling for missing SSM parameters

### 1.3 Import Platform Resources
- [x] Import DynamoDB customers table using `Table.fromTableName()`
- [x] Import DynamoDB documents table using `Table.fromTableName()`
- [x] Import IAM role using `Role.fromRoleArn()`
- [x] Import API Gateway using `RestApi.fromRestApiAttributes()`

### 1.4 Create Application-Specific Resources
- [x] Create S3 bucket `rag-app-documents-{environment}` with encryption and CORS
- [x] Create SQS queue `rag-app-document-processing-{environment}` with encryption
- [x] Configure S3 bucket removal policy based on environment
- [x] Configure SQS queue visibility timeout and retention

### 1.5 Migrate Lambda Functions
- [x] Create customer-manager Lambda function with imported IAM role
- [x] Create document-upload Lambda function with imported IAM role
- [x] Create document-processing Lambda function with imported IAM role
- [x] Create document-summary Lambda function with imported IAM role
- [x] Create document-retry Lambda function with imported IAM role
- [x] Create document-delete Lambda function with imported IAM role
- [x] Create document-summary-selective Lambda function with imported IAM role
- [x] Create chunking-config-get Lambda function with imported IAM role
- [x] Create chunking-config-update Lambda function with imported IAM role
- [x] Create chunking-methods-list Lambda function with imported IAM role
- [x] Create chunking-cleanup-trigger Lambda function with imported IAM role
- [x] Create chunking-cleanup-status Lambda function with imported IAM role
- [x] Create chunk-visualization-get Lambda function with imported IAM role
- [x] Create embeddings-generate Lambda function with imported IAM role
- [x] Create patient-list Lambda function with imported IAM role
- [x] Create patient-detail Lambda function with imported IAM role
- [x] Create claim-loader Lambda function with imported IAM role
- [x] Create claim-status Lambda function with imported IAM role

### 1.6 Configure Lambda Environment Variables
- [x] Set CUSTOMERS_TABLE_NAME to imported table name for all relevant functions
- [x] Set DOCUMENTS_TABLE_NAME to imported table name for all relevant functions
- [x] Set DOCUMENTS_BUCKET to application bucket name for all relevant functions
- [x] Set SOURCE_BUCKET to `medical-claims-synthetic-data-dev` for Insurance Claim Portal functions
- [x] Set PROCESSING_QUEUE_URL to application queue URL for processing functions
- [x] Set REGION to deployment region for all functions
- [x] Set BEDROCK_REGION to deployment region for Bedrock functions
- [x] Set KNOWLEDGE_BASE_ID from CDK parameter for relevant functions
- [x] Set VECTOR_DB_ENDPOINT from CDK parameter for relevant functions

### 1.7 Configure API Gateway Routes
- [x] Add `/customers` POST route with customer-manager integration
- [x] Add `/customers/{customerUUID}/chunking-config` GET route with chunking-config-get integration
- [x] Add `/customers/{customerUUID}/chunking-config` PUT route with chunking-config-update integration
- [x] Add `/customers/{customerUUID}/chunking-config/cleanup` POST route with chunking-cleanup-trigger integration
- [x] Add `/customers/{customerUUID}/chunking-config/cleanup/{jobId}` GET route with chunking-cleanup-status integration
- [x] Add `/chunking-methods` GET route with chunking-methods-list integration
- [x] Add `/documents` POST route with document-upload integration
- [x] Add `/documents/process` POST route with document-processing integration
- [x] Add `/documents/summary` POST route with document-summary integration
- [x] Add `/documents/summary/selective` POST route with document-summary-selective integration
- [x] Add `/documents/retry` POST route with document-retry integration
- [x] Add `/documents/delete` DELETE route with document-delete integration
- [x] Add `/documents/chunks/visualization` POST route with chunk-visualization integration
- [x] Add `/documents/embeddings/generate` POST route with embeddings-generate integration
- [x] Add `/patients` GET route with patient-list integration
- [x] Add `/patients/{patientId}` GET route with patient-detail integration
- [x] Add `/claims/load` POST route with claim-loader integration
- [x] Add `/claims/{claimId}/status` GET route with claim-status integration

### 1.8 Configure S3 Event Notifications
- [x] Add S3 event notification for OBJECT_CREATED events on `uploads/` prefix
- [x] Configure Lambda destination for document-processing function

### 1.9 Add Stack Outputs
- [x] Add output for API Gateway URL
- [x] Add output for documents bucket name
- [x] Add output for processing queue URL
- [x] Add outputs for all Lambda function ARNs
- [x] Add export names for cross-stack references

### 1.10 Update CDK App Entry Point
- [x] Update `infrastructure/app.ts` to instantiate `RAGApplicationStack`
- [x] Change stack name from `RAGInfrastructureStack` to `RAGApplicationStack`
- [ ] Add environment context retrieval
- [x] Update stack tags with environment variable
- [x] Remove hardcoded `dev` environment tag

### 1.11 Remove Old Stack File
- [x] Delete `infrastructure/multi-tenant-document-manager-stack.ts`
- [x] Verify no other files import the old stack

## 2. CDK Configuration Updates

### 2.1 Update CDK Context
- [x] Add `environment` context variable to `cdk.json`
- [x] Add default values for local development
- [x] Document context variables in `cdk.json`

### 2.2 Add CDK Parameters
- [x] Keep existing `UserPoolId` parameter for backward compatibility
- [x] Keep existing `KnowledgeBaseId` parameter
- [x] Keep existing `VectorDbEndpoint` parameter
- [x] Remove `ProcessingQueueUrl` parameter (now created by stack)

## 3. Testing Updates

### 3.1 Update Unit Tests
- [x] Update unit tests to mock imported DynamoDB tables
- [x] Update unit tests to mock imported IAM role
- [x] Update unit tests to mock imported API Gateway
- [x] Update unit tests with new resource names (`rag-app` instead of `rag-app-v2`)
- [x] Verify all unit tests pass

### 3.2 Add Integration Test Scenarios
- [x] Document test scenario for customer creation
- [x] Document test scenario for document upload
- [x] Document test scenario for document processing
- [x] Document test scenario for chunking configuration
- [x] Document test scenario for Insurance Claim Portal

## 4. Documentation Updates

### 4.1 Update README
- [x] Update deployment instructions with SSM parameter requirements
- [x] Document platform infrastructure prerequisites
- [x] Update resource naming conventions
- [x] Add troubleshooting section for SSM parameter issues

### 4.2 Update Architecture Documentation
- [x] Create architecture diagram showing platform vs application resources
- [x] Document SSM parameter structure
- [x] Document API Gateway integration pattern
- [x] Document multi-tenant architecture preservation

### 4.3 Create Migration Guide
- [x] Document step-by-step migration process
- [x] Add rollback procedures
- [x] Document verification steps
- [x] Add troubleshooting guide

## 5. Deployment Preparation

### 5.1 Verify Platform Infrastructure
- [x] Confirm platform team has deployed DynamoDB tables
- [x] Confirm platform team has deployed IAM role
- [x] Confirm platform team has deployed API Gateway
- [x] Confirm all SSM parameters exist in dev environment

### 5.2 Pre-Deployment Validation
- [x] Run `cdk diff` to review changes
- [x] Verify no unexpected resource deletions
- [x] Verify all Lambda functions are included
- [x] Verify all API routes are included

### 5.3 Deployment Execution
- [x] Deploy to dev environment
- [x] Verify stack deployment succeeds
- [x] Verify all outputs are correct
- [x] Run smoke tests on all API endpoints

### 5.4 Post-Deployment Validation
- [x] Test customer creation endpoint
- [x] Test document upload endpoint
- [x] Test document processing pipeline
- [x] Test chunking configuration endpoints
- [x] Test Insurance Claim Portal endpoints
- [x] Verify CloudWatch logs are being generated
- [x] Verify DynamoDB data is accessible

## 6. Cleanup

### 6.1 Remove Obsolete Code
- [x] Remove old stack file if not already deleted
- [x] Remove obsolete CDK parameters
- [x] Remove obsolete environment variables
- [x] Clean up unused imports

### 6.2 Update CI/CD Pipeline
- [x] Update pipeline to use new stack name `RAGApplicationStack`
- [x] Update pipeline environment variables
- [x] Update pipeline deployment commands
- [x] Verify pipeline runs successfully

## 7. Supersede Old Bugfix Spec

### 7.1 Review Existing Bugfix Spec
- [x] Review `.kiro/specs/infrastructure-parameterization-fix/bugfix.md`
- [x] Identify requirements that are superseded by this migration
- [x] Document which requirements are still relevant

### 7.2 Update Bugfix Spec Status
- [x] Add note to bugfix spec that it's superseded by platform migration
- [x] Reference this spec in the bugfix spec
- [x] Mark bugfix spec as obsolete or completed

## 8. Environment-Specific Deployments

### 8.1 Staging Environment
- [x] Verify platform infrastructure exists in staging
- [x] Update SSM parameter paths for staging environment
- [x] Deploy stack to staging
- [x] Run full test suite in staging

### 8.2 Production Environment
- [x] Verify platform infrastructure exists in production
- [x] Update SSM parameter paths for production environment
- [x] Review production-specific configurations (removal policies, etc.)
- [x] Deploy stack to production
- [x] Run smoke tests in production
- [x] Monitor for issues

## Notes

- All tasks should be completed in order within each section
- Section 1 (Infrastructure Code Migration) is the critical path
- Testing (Section 3) should be done incrementally as code is migrated
- Deployment (Section 5) should only proceed after all code changes are complete
- The old bugfix spec `.kiro/specs/infrastructure-parameterization-fix/bugfix.md` is superseded by this migration
