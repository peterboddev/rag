# Multi-Tenant Document Manager

A serverless multi-tenant document management system built with AWS CDK, featuring secure document upload, processing, and RAG (Retrieval-Augmented Generation) integration. This application provides a complete solution for organizations to upload, process, and manage documents with AI-powered text extraction and multi-tenant isolation.

## Features

- **Multi-tenant Architecture**: Secure tenant isolation using ABAC (Attribute-Based Access Control)
- **Document Processing**: Support for PDF, DOC, DOCX, TXT, JPG, PNG files with automatic text extraction
- **AWS Integration**: Seamless integration with Textract, Bedrock, and OpenSearch Serverless
- **Self-service Tenants**: Users can create tenants or join existing ones using tenant codes
- **Real-time Processing**: Automatic document processing pipeline with status tracking

## Architecture

- **Frontend**: React with TypeScript and AWS Amplify authentication
- **Backend**: AWS Lambda functions with TypeScript
- **Storage**: DynamoDB for metadata, S3 for documents, Aurora PostgreSQL for relational data
- **Processing**: AWS Textract for text extraction, platform RAG pipeline for embeddings
- **Security**: Cognito authentication with custom tenant attributes, row-level security

## Local Development Setup

### Prerequisites

- Node.js 18+
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

```bash
# Deploy to AWS (local development)
npm run deploy

# Destroy infrastructure
npm run destroy
```

### Environment Variables

The following environment variables are automatically configured by CDK:

- `CUSTOMERS_TABLE_NAME`: DynamoDB table for customer records
- `DOCUMENTS_TABLE_NAME`: DynamoDB table for document metadata
- `DOCUMENTS_BUCKET`: S3 bucket for document storage
- `USER_POOL_ID`: Cognito User Pool ID (rag-app-v2-users-dev)
- `KNOWLEDGE_BASE_ID`: Bedrock Knowledge Base ID
- `VECTOR_DB_ENDPOINT`: OpenSearch Serverless endpoint

## API Endpoints

### Customer Management
- `POST /customers` - Create or retrieve customer record

### Document Management
- `POST /documents` - Upload document for processing
- `POST /documents/process` - Trigger document processing

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
├── unit_tests/         # Unit and property-based tests
├── docs/               # Additional documentation
└── README.md           # This file
```

## Integration with Platform

This application integrates with the existing RAG platform:

- Uses platform-provided Cognito User Pool (`rag-app-v2-users-dev`)
- Uploads processed documents to platform S3 bucket
- Leverages platform's Knowledge Base and vector database
- Follows platform's IAM and security patterns

## Deployment Pipeline

- **Local Development**: Deploy directly using CDK
- **Production**: Push to repository triggers platform team's deployment pipeline
- **Environment**: Automatically configured through platform team's infrastructure
- **CDK Template**: Platform pipeline configured to handle CDK-generated CloudFormation templates