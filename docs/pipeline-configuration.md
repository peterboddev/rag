# Pipeline Configuration Guide

## Overview

This document describes the CodeBuild pipeline configuration required for deploying the RAG Application Stack.

## CodeBuild Environment Variables

The pipeline must set the following environment variable to match the target deployment environment:

### ENVIRONMENT Variable

| Environment | Value | SSM Parameter Prefix |
|-------------|-------|---------------------|
| Development | `dev` | `/rag-app/dev/` |
| Staging | `staging` | `/rag-app/staging/` |
| Production | `prod` | `/rag-app/prod/` |

**Example CodeBuild Configuration:**

```yaml
environment:
  variables:
    ENVIRONMENT: "dev"  # Change to "staging" or "prod" as needed
```

## Build Process

The `buildspec.yml` handles environment configuration automatically:

1. If `ENVIRONMENT` variable is set, CDK synth uses: `cdk synth --context environment=$ENVIRONMENT`
2. If `ENVIRONMENT` is not set, defaults to `dev` (from `cdk.json`)

## Stack Name

The CDK stack name has been updated from `MultiTenantDocumentManagerStack` to `RAGApplicationStack`.

**Important**: Update any pipeline deployment scripts that reference the old stack name.

## CloudFormation Template

The build process generates:
- `cdk.out/RAGApplicationStack.template.json` - CDK-generated template
- `cdk.out/template.yaml` - Copy for SAM/CloudFormation deployment

## Required Platform Infrastructure

Before deploying the application stack, ensure the following platform resources exist:

### SSM Parameters (per environment)

```bash
/rag-app/{environment}/iam/application-role-arn
/rag-app/{environment}/apigateway/api-id
/rag-app/{environment}/apigateway/root-resource-id
/rag-app/{environment}/dynamodb/customers-table-name
/rag-app/{environment}/dynamodb/documents-table-name
```

### Platform Resources

- DynamoDB tables: `rag-app-customers-{environment}` and `rag-app-documents-{environment}`
- IAM role with permissions for Lambda, Bedrock, Textract, S3, DynamoDB, OpenSearch, SQS
- API Gateway REST API with Cognito authorizer
- Cognito User Pool

## Deployment Parameters

The CDK deployment requires the following parameters (can be passed via CloudFormation parameters or environment variables):

- `UserPoolId` - Cognito User Pool ID
- `KnowledgeBaseId` - Bedrock Knowledge Base ID
- `VectorDbEndpoint` - OpenSearch Serverless endpoint

## Verification Steps

After deployment, verify:

1. Stack deployed successfully: `aws cloudformation describe-stacks --stack-name RAGApplicationStack`
2. Lambda functions created: `aws lambda list-functions --query 'Functions[?starts_with(FunctionName, \`RAGApplicationStack\`)].FunctionName'`
3. S3 bucket created: `aws s3 ls | grep rag-app-documents-{environment}`
4. SQS queue created: `aws sqs list-queues | grep rag-app-document-processing-{environment}`

## Troubleshooting

### Stack Name Mismatch

If deployment fails with "Stack not found" error, verify the stack name in deployment scripts is `RAGApplicationStack` (not the old `MultiTenantDocumentManagerStack`).

### SSM Parameter Not Found

If CDK synthesis fails with SSM parameter errors, verify:
1. Platform infrastructure is deployed in the target environment
2. `ENVIRONMENT` variable matches the deployed platform environment
3. SSM parameters exist with correct naming pattern

### Template File Not Found

If `cdk.out/template.yaml` is not found, verify:
1. CDK synthesis completed successfully
2. `cdk.out/RAGApplicationStack.template.json` exists
3. Post-build step in `buildspec.yml` is executing

## Migration Notes

### Changes from Previous Version

1. **Stack Name**: `MultiTenantDocumentManagerStack` → `RAGApplicationStack`
2. **Application Name**: `rag-app-v2` → `rag-app`
3. **Resource Imports**: Now imports platform-provided DynamoDB tables, IAM role, and API Gateway
4. **Environment Context**: Now supports environment-specific deployments via `ENVIRONMENT` variable

### Pipeline Updates Required

- Update stack name references in deployment scripts
- Add `ENVIRONMENT` variable to CodeBuild project
- Verify SSM parameters exist for target environment
- Update any monitoring/alerting that references old stack name
