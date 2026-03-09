# Requirements Document

## Introduction

This document defines the requirements for migrating the RAG application infrastructure from the current `rag-app-v2` implementation to align with the platform team's standardized architecture pattern. The migration involves transitioning from self-managed infrastructure resources to platform-provided services while maintaining all existing functionality and multi-tenant capabilities.

The current implementation creates its own DynamoDB tables, IAM roles, and API Gateway, which conflicts with the platform team's architecture where these resources are centrally managed. This migration will ensure proper separation of concerns between platform-provided infrastructure and application-specific resources.

## Glossary

- **Platform_Infrastructure**: Centrally managed AWS resources provided by the platform team including DynamoDB tables, IAM roles, API Gateway, and SSM parameters
- **Application_Stack**: CDK stack containing application-specific resources such as Lambda functions, S3 buckets, and SQS queues
- **SSM_Parameter_Store**: AWS Systems Manager Parameter Store used to retrieve platform-provided resource identifiers
- **Multi_Tenant_Architecture**: System design supporting multiple isolated customer tenants with shared infrastructure
- **CDK_Stack**: AWS Cloud Development Kit infrastructure-as-code stack definition
- **Lambda_Function**: AWS Lambda serverless compute function
- **API_Gateway**: AWS API Gateway REST API for HTTP endpoints
- **DynamoDB_Table**: AWS DynamoDB NoSQL database table
- **IAM_Role**: AWS Identity and Access Management role for service permissions
- **S3_Bucket**: AWS Simple Storage Service bucket for object storage
- **SQS_Queue**: AWS Simple Queue Service queue for asynchronous message processing
- **Insurance_Claim_Portal**: Feature that processes medical claim documents from external bucket
- **External_Bucket**: S3 bucket `medical-claims-synthetic-data-dev` managed outside the application

## Requirements

### Requirement 1: Application Naming Standardization

**User Story:** As a platform engineer, I want all resources to use the standardized `rag-app` naming convention, so that infrastructure management and monitoring are consistent across environments.

#### Acceptance Criteria

1. THE Application_Stack SHALL use application name `rag-app` instead of `rag-app-v2`
2. WHEN resources are created, THE Application_Stack SHALL construct names using pattern `rag-app-{resourceType}-{environment}`
3. WHEN the stack is instantiated, THE Application_Stack SHALL use stack name `RAGApplicationStack`
4. WHEN Lambda functions reference buckets, THE Lambda_Function SHALL use bucket names with `rag-app` prefix
5. WHEN environment variables are set, THE Lambda_Function SHALL reference resources using `rag-app` naming pattern

### Requirement 2: Platform DynamoDB Table Integration

**User Story:** As a platform engineer, I want the application to use platform-provided DynamoDB tables, so that data storage is centrally managed and backed up.

#### Acceptance Criteria

1. THE Application_Stack SHALL NOT create DynamoDB tables
2. WHEN the stack is deployed, THE Application_Stack SHALL import table `rag-app-customers-dev` from platform infrastructure
3. WHEN the stack is deployed, THE Application_Stack SHALL import table `rag-app-documents-dev` from platform infrastructure
4. WHEN Lambda functions access tables, THE Lambda_Function SHALL use imported table references
5. THE Application_Stack SHALL preserve all existing Global Secondary Index (GSI) usage patterns
6. WHEN querying customers, THE Lambda_Function SHALL continue to use `tenant-id-index` and `email-index` GSIs
7. WHEN querying documents, THE Lambda_Function SHALL continue to use `tenant-documents-index`, `customer-documents-index`, and `claim-documents-index` GSIs

### Requirement 3: Platform IAM Role Integration

**User Story:** As a security engineer, I want the application to use the platform-provided IAM role, so that permissions are centrally managed and audited.

#### Acceptance Criteria

1. THE Application_Stack SHALL NOT create IAM roles for Lambda functions
2. WHEN the stack is deployed, THE Application_Stack SHALL retrieve IAM role ARN from SSM parameter `/rag-app/dev/iam/application-role-arn`
3. WHEN Lambda functions are created, THE Application_Stack SHALL assign the platform-provided IAM role
4. THE Lambda_Function SHALL have permissions for Bedrock, Textract, S3, DynamoDB, OpenSearch, and SQS operations
5. WHEN accessing AWS services, THE Lambda_Function SHALL use the platform-provided role credentials

### Requirement 4: Platform API Gateway Integration

**User Story:** As a platform engineer, I want the application to use the platform-provided API Gateway, so that API management and monitoring are centralized.

#### Acceptance Criteria

1. THE Application_Stack SHALL NOT create a new API Gateway REST API
2. WHEN the stack is deployed, THE Application_Stack SHALL retrieve API Gateway ID from SSM parameter `/rag-app/dev/apigateway/api-id`
3. WHEN the stack is deployed, THE Application_Stack SHALL retrieve root resource ID from SSM parameter `/rag-app/dev/apigateway/root-resource-id`
4. WHEN API routes are defined, THE Application_Stack SHALL add methods to the imported API Gateway
5. THE Application_Stack SHALL preserve all existing API endpoints and routes
6. WHEN CORS is configured, THE Application_Stack SHALL maintain existing CORS settings
7. THE Application_Stack SHALL create API routes: `/customers`, `/documents`, `/chunking-methods`, `/patients`, `/claims`

### Requirement 5: Application-Specific S3 Bucket Management

**User Story:** As a developer, I want the application to manage its own S3 buckets for document storage, so that application-specific data is isolated.

#### Acceptance Criteria

1. THE Application_Stack SHALL create S3 bucket with name `rag-app-documents-dev`
2. WHEN the bucket is created, THE S3_Bucket SHALL use encryption with S3-managed keys
3. WHEN the bucket is created, THE S3_Bucket SHALL configure CORS for web access
4. WHEN objects are created in prefix `uploads/`, THE S3_Bucket SHALL trigger document processing Lambda function
5. THE Application_Stack SHALL configure removal policy DESTROY for development environment

### Requirement 6: Asynchronous Processing Queue

**User Story:** As a developer, I want SQS queues for asynchronous document processing, so that long-running operations don't block API responses.

#### Acceptance Criteria

1. THE Application_Stack SHALL create SQS queue with name `rag-app-document-processing-dev`
2. WHEN the queue is created, THE SQS_Queue SHALL configure visibility timeout of 900 seconds
3. WHEN the queue is created, THE SQS_Queue SHALL configure message retention of 14 days
4. WHEN the queue is created, THE SQS_Queue SHALL enable server-side encryption
5. WHEN Lambda functions send messages, THE Lambda_Function SHALL use the application-created queue

### Requirement 7: Environment Configuration via SSM

**User Story:** As a DevOps engineer, I want all platform resource identifiers retrieved from SSM Parameter Store, so that configuration is environment-agnostic.

#### Acceptance Criteria

1. WHEN the stack is deployed, THE Application_Stack SHALL retrieve all platform resource identifiers from SSM Parameter Store
2. THE Application_Stack SHALL retrieve parameter `/rag-app/dev/iam/application-role-arn`
3. THE Application_Stack SHALL retrieve parameter `/rag-app/dev/apigateway/api-id`
4. THE Application_Stack SHALL retrieve parameter `/rag-app/dev/apigateway/root-resource-id`
5. THE Application_Stack SHALL retrieve parameter `/rag-app/dev/dynamodb/customers-table-name`
6. THE Application_Stack SHALL retrieve parameter `/rag-app/dev/dynamodb/documents-table-name`
7. WHEN SSM parameters are not found, THE Application_Stack SHALL fail deployment with descriptive error message

### Requirement 8: Lambda Function Environment Variables

**User Story:** As a developer, I want Lambda functions to receive correct environment variables, so that they can access platform and application resources.

#### Acceptance Criteria

1. WHEN Lambda functions are created, THE Application_Stack SHALL set environment variable `CUSTOMERS_TABLE_NAME` to platform table name
2. WHEN Lambda functions are created, THE Application_Stack SHALL set environment variable `DOCUMENTS_TABLE_NAME` to platform table name
3. WHEN Lambda functions are created, THE Application_Stack SHALL set environment variable `DOCUMENTS_BUCKET` to application bucket name
4. WHEN Lambda functions are created, THE Application_Stack SHALL set environment variable `REGION` to deployment region
5. WHEN document processing functions are created, THE Application_Stack SHALL set environment variable `PROCESSING_QUEUE_URL` to application queue URL
6. WHEN Bedrock functions are created, THE Application_Stack SHALL set environment variable `BEDROCK_REGION` to deployment region

### Requirement 9: Insurance Claim Portal External Bucket Access

**User Story:** As a healthcare application developer, I want the Insurance Claim Portal to access the external medical claims bucket, so that synthetic medical data can be processed.

#### Acceptance Criteria

1. WHEN Insurance Claim Portal Lambda functions are created, THE Application_Stack SHALL set environment variable `SOURCE_BUCKET` to `medical-claims-synthetic-data-dev`
2. THE Lambda_Function SHALL have read permissions for bucket `medical-claims-synthetic-data-dev`
3. WHEN claim documents are loaded, THE Lambda_Function SHALL copy objects from external bucket to application bucket
4. THE Application_Stack SHALL preserve all existing Insurance Claim Portal endpoints: `/patients`, `/patients/{patientId}`, `/claims/load`, `/claims/{claimId}/status`

### Requirement 10: Multi-Tenant Architecture Preservation

**User Story:** As a SaaS architect, I want the multi-tenant architecture to remain intact, so that customer data isolation is maintained.

#### Acceptance Criteria

1. THE Application_Stack SHALL preserve tenant-based data isolation patterns
2. WHEN customers are queried, THE Lambda_Function SHALL continue to filter by `tenantId`
3. WHEN documents are queried, THE Lambda_Function SHALL continue to filter by `tenantId` and `customerUuid`
4. THE Application_Stack SHALL preserve all tenant-specific GSI indexes
5. WHEN API requests are processed, THE Lambda_Function SHALL continue to validate tenant context

### Requirement 11: Chunking Configuration Management

**User Story:** As a RAG application user, I want to configure document chunking strategies per customer, so that embedding generation is optimized for different document types.

#### Acceptance Criteria

1. THE Application_Stack SHALL preserve chunking configuration endpoints: `/customers/{customerUUID}/chunking-config`
2. WHEN chunking configuration is retrieved, THE Lambda_Function SHALL return customer-specific settings
3. WHEN chunking configuration is updated, THE Lambda_Function SHALL trigger document reprocessing
4. THE Application_Stack SHALL preserve chunking cleanup endpoints: `/customers/{customerUUID}/chunking-config/cleanup`
5. THE Application_Stack SHALL preserve chunking methods list endpoint: `/chunking-methods`

### Requirement 12: Document Processing Pipeline

**User Story:** As a document management user, I want documents to be automatically processed when uploaded, so that text extraction and embedding generation happen seamlessly.

#### Acceptance Criteria

1. WHEN a document is uploaded to S3 prefix `uploads/`, THE S3_Bucket SHALL trigger document processing Lambda function
2. WHEN document processing starts, THE Lambda_Function SHALL extract text using Textract
3. WHEN text is extracted, THE Lambda_Function SHALL generate embeddings using Bedrock
4. WHEN embeddings are generated, THE Lambda_Function SHALL store them in OpenSearch vector database
5. WHEN processing completes, THE Lambda_Function SHALL update document status in DynamoDB

### Requirement 13: Stack Output Exports

**User Story:** As a DevOps engineer, I want stack outputs to export resource identifiers, so that other stacks and tools can reference them.

#### Acceptance Criteria

1. WHEN the stack is deployed, THE Application_Stack SHALL output API Gateway URL
2. WHEN the stack is deployed, THE Application_Stack SHALL output S3 bucket name
3. WHEN the stack is deployed, THE Application_Stack SHALL output SQS queue URL
4. WHEN the stack is deployed, THE Application_Stack SHALL output all Lambda function ARNs
5. THE Application_Stack SHALL export outputs with descriptive names and descriptions

### Requirement 14: Backward Compatibility

**User Story:** As a developer, I want existing Lambda function code to work without changes, so that the migration is transparent to application logic.

#### Acceptance Criteria

1. WHEN Lambda functions access DynamoDB, THE Lambda_Function SHALL use the same table names from environment variables
2. WHEN Lambda functions access S3, THE Lambda_Function SHALL use the same bucket names from environment variables
3. WHEN Lambda functions access SQS, THE Lambda_Function SHALL use the same queue URLs from environment variables
4. THE Lambda_Function SHALL NOT require code changes for platform integration
5. WHEN API requests are made, THE Lambda_Function SHALL respond with the same data structures

### Requirement 15: Development Environment Support

**User Story:** As a developer, I want the stack to support local development, so that I can test infrastructure changes before deployment.

#### Acceptance Criteria

1. WHEN SSM parameters are not available, THE Application_Stack SHALL provide fallback default values for local development
2. WHEN deployed locally, THE Application_Stack SHALL use CDK context values for configuration
3. WHEN deployed locally, THE Application_Stack SHALL create all necessary resources for standalone operation
4. THE Application_Stack SHALL support environment parameter to distinguish dev, staging, and prod deployments
5. WHEN environment is specified, THE Application_Stack SHALL construct resource names with correct environment suffix
