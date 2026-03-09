# Multi-Tenant Document Manager

A serverless multi-tenant document management system built with AWS CDK, featuring secure document upload, processing, and RAG (Retrieval-Augmented Generation) integration. This application provides a complete solution for organizations to upload, process, and manage documents with AI-powered text extraction and multi-tenant isolation.

## Features

- **Multi-tenant Architecture**: Secure tenant isolation using ABAC (Attribute-Based Access Control)
- **Document Processing**: Support for PDF, DOC, DOCX, TXT, JPG, PNG files with automatic text extraction
- **AWS Integration**: Seamless integration with Textract, Bedrock, and OpenSearch Serverless
- **Self-service Tenants**: Users can create tenants or join existing ones using tenant codes
- **Real-time Processing**: Automatic document processing pipeline with status tracking
- **Platform Integration**: Leverages platform-provided DynamoDB tables, IAM roles, and API Gateway

## Architecture

- **Frontend**: React with TypeScript and AWS Amplify authentication
- **Backend**: AWS Lambda functions with TypeScript (Node.js 20.x)
- **Storage**: Platform-managed DynamoDB tables, application-managed S3 bucket
- **Processing**: AWS Textract for text extraction, platform RAG pipeline for embeddings
- **Security**: Platform-managed Cognito authentication, IAM roles, and API Gateway
- **Infrastructure**: CDK-based infrastructure as code

## Local Development Setup

### Prerequisites

- Node.js 20.x LTS
- npm 11.x
- AWS CLI configured with appropriate permissions
- AWS CDK CLI installed globally

### Installation

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests
npm test
```

### Infrastructure Deployment

#### Platform Infrastructure Prerequisites

Before deploying the application stack, ensure the platform team has deployed the following resources and SSM parameters:

**Required SSM Parameters:**
- `/rag-app/dev/iam/application-role-arn` - IAM role ARN for Lambda functions
- `/rag-app/dev/apigateway/api-id` - API Gateway REST API ID
- `/rag-app/dev/apigateway/root-resource-id` - API Gateway root resource ID
- `/rag-app/dev/dynamodb/customers-table-name` - DynamoDB customers table name
- `/rag-app/dev/dynamodb/documents-table-name` - DynamoDB documents table name

**Platform-Managed Resources:**
- DynamoDB tables: `rag-app-customers-dev` and `rag-app-documents-dev`
- IAM role with permissions for Bedrock, Textract, S3, DynamoDB, OpenSearch, SQS
- API Gateway REST API with Cognito authorizer
- Cognito User Pool for authentication

#### Deployment Commands

```bash
# Deploy to AWS (development environment)
npm run deploy

# Deploy to specific environment
cdk deploy --context environment=dev

# Destroy infrastructure
npm run destroy
```

#### Deployment Parameters

The stack requires the following CDK parameters:

- `UserPoolId` - Cognito User Pool ID (default: us-east-1_XXXXXXXXX)
- `KnowledgeBaseId` - Bedrock Knowledge Base ID (default: rag-app-kb-dev)
- `VectorDbEndpoint` - OpenSearch Serverless endpoint

### Environment Variables

The following environment variables are automatically configured by CDK for Lambda functions:

**Platform Resources:**
- `CUSTOMERS_TABLE_NAME`: Platform-managed DynamoDB customers table
- `DOCUMENTS_TABLE_NAME`: Platform-managed DynamoDB documents table
- `USER_POOL_ID`: Platform-managed Cognito User Pool ID

**Application Resources:**
- `DOCUMENTS_BUCKET`: Application-managed S3 bucket for document storage
- `PROCESSING_QUEUE_URL`: Application-managed SQS queue for async processing

**External Services:**
- `KNOWLEDGE_BASE_ID`: Bedrock Knowledge Base ID
- `VECTOR_DB_ENDPOINT`: OpenSearch Serverless endpoint
- `BEDROCK_REGION`: AWS region for Bedrock services
- `REGION`: AWS region for deployment

**Insurance Claim Portal:**
- `SOURCE_BUCKET`: External bucket for medical claims data (medical-claims-synthetic-data-dev)

## API Endpoints

### Customer Management
- `POST /customers` - Create or retrieve customer record
- `GET /customers/{customerUUID}/chunking-config` - Get chunking configuration
- `PUT /customers/{customerUUID}/chunking-config` - Update chunking configuration
- `POST /customers/{customerUUID}/chunking-config/cleanup` - Trigger cleanup job
- `GET /customers/{customerUUID}/chunking-config/cleanup/{jobId}` - Get cleanup status

### Document Management
- `POST /documents` - Upload document for processing
- `POST /documents/process` - Trigger document processing
- `POST /documents/summary` - Generate document summary
- `POST /documents/summary/selective` - Generate selective summary
- `POST /documents/retry` - Retry failed document processing
- `DELETE /documents/delete` - Delete document
- `POST /documents/chunks/visualization` - Get chunk visualization
- `POST /documents/embeddings/generate` - Generate embeddings

### Chunking Methods
- `GET /chunking-methods` - List available chunking methods

### Insurance Claim Portal
- `GET /patients` - List patients from external data source
- `GET /patients/{patientId}` - Get patient details
- `POST /claims/load` - Load claim documents
- `GET /claims/{claimId}/status` - Get claim processing status

## Multi-Tenant Flow

### Tenant Creation (First User)
1. User registers with email, password, and company name
2. System generates unique `tenant_id`
3. User receives `tenant_id` to share with team members

### Tenant Joining (Additional Users)
1. User gets `tenant_id` from team member
2. Registers with email, password, and existing `tenant_id`
3. Gains access to shared tenant data

### Document Upload
1. User uploads document with customer email
2. System creates/retrieves customer record
3. Document processed through Textract (if needed)
4. Processed text uploaded to platform RAG pipeline

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run property-based tests
npm test -- --testNamePattern="Property"
```

## Project Structure

```
├── src/
│   ├── types/           # TypeScript type definitions
│   └── lambda/          # Lambda function implementations
├── infrastructure/      # CDK infrastructure code
│   ├── app.ts          # CDK app entry point
│   └── rag-application-stack.ts  # Application stack definition
├── unit_tests/         # Unit and property-based tests
├── docs/               # Additional documentation
└── README.md           # This file
```

## Integration with Platform

This application integrates with the platform-provided infrastructure:

**Platform-Managed Resources:**
- **DynamoDB Tables**: `rag-app-customers-dev` and `rag-app-documents-dev` with GSI indexes
- **IAM Role**: Centrally managed role with permissions for all AWS services
- **API Gateway**: Shared REST API with Cognito authorizer
- **Cognito User Pool**: User authentication and authorization
- **SSM Parameters**: Configuration values for resource identifiers

**Application-Managed Resources:**
- **S3 Bucket**: `rag-app-documents-dev` for document storage
- **SQS Queue**: `rag-app-document-processing-dev` for async processing
- **Lambda Functions**: 18 functions for document management and processing
- **API Routes**: Methods added to platform-provided API Gateway

**Resource Naming Convention:**
- Pattern: `rag-app-{resourceType}-{environment}`
- Example: `rag-app-documents-dev`, `rag-app-customers-dev`

## Deployment Pipeline

- **Local Development**: Deploy directly using CDK (requires platform infrastructure)
- **Production**: Push to repository triggers platform team's deployment pipeline
- **Environment Configuration**: 
  - Default environment is `dev` (configured in `cdk.json`)
  - Pipeline can override by setting `ENVIRONMENT` environment variable in CodeBuild
  - Example: Set `ENVIRONMENT=prod` in CodeBuild project for production deployments
- **CDK Template**: Platform pipeline configured to handle CDK-generated CloudFormation templates
- **Stack Name**: `RAGApplicationStack` (must match pipeline configuration)

### Pipeline Environment Variable

The CodeBuild pipeline should set the `ENVIRONMENT` variable to match the target deployment environment:

```bash
# For development
ENVIRONMENT=dev

# For staging
ENVIRONMENT=staging

# For production
ENVIRONMENT=prod
```

This ensures the CDK stack uses the correct SSM parameters for each environment (e.g., `/rag-app/prod/iam/application-role-arn`).

## Troubleshooting

### SSM Parameter Not Found

If deployment fails with SSM parameter errors:

1. Verify platform infrastructure is deployed in the target environment
2. Check SSM parameters exist:
   ```bash
   aws ssm get-parameter --name /rag-app/dev/iam/application-role-arn
   aws ssm get-parameter --name /rag-app/dev/apigateway/api-id
   aws ssm get-parameter --name /rag-app/dev/dynamodb/customers-table-name
   ```
3. Contact platform team if parameters are missing

### API Gateway Integration Issues

If API routes are not accessible:

1. Verify API Gateway ID is correct in SSM parameters
2. Check that platform team has deployed the API Gateway
3. Ensure Cognito authorizer is configured on the API Gateway

### Lambda Permission Errors

If Lambda functions fail with permission errors:

1. Verify IAM role ARN in SSM parameter is correct
2. Check that platform-provided IAM role has necessary permissions
3. Contact platform team to update IAM role permissions

## Additional Documentation

See the `docs/` directory for additional documentation:
- Architecture diagrams
- API design specifications
- Deployment guides
- Migration documentation