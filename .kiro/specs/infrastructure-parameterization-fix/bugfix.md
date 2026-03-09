# Bugfix Requirements Document

## Introduction

The CDK infrastructure code contains multiple hardcoded environment-specific values that violate project guidelines requiring parameterization and environment-agnostic configuration. This creates deployment coupling with specific environments, prevents multi-environment deployments (dev, staging, prod), and violates the 12-factor app principle of strict separation between config and code. The bug affects the ability to deploy the same codebase to different environments without code modifications.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the CDK stack is instantiated in infrastructure/app.ts THEN the system uses hardcoded stack name 'RAGInfrastructureStack' regardless of environment

1.2 WHEN the CDK stack is instantiated in infrastructure/app.ts THEN the system uses hardcoded environment tag 'dev' in stack tags

1.3 WHEN DynamoDB tables are created in multi-tenant-document-manager-stack.ts THEN the system uses hardcoded table names 'rag-app-v2-customers-dev' and 'rag-app-v2-documents-dev' with '-dev' suffix

1.4 WHEN S3 bucket is created in multi-tenant-document-manager-stack.ts THEN the system uses hardcoded bucket name 'rag-app-v2-documents-dev' with '-dev' suffix

1.5 WHEN Lambda environment variables reference platform buckets THEN the system uses hardcoded values 'rag-app-v2-documents-dev' and 'medical-claims-synthetic-data-dev'

1.6 WHEN Lambda environment variables reference source bucket for insurance claims THEN the system uses hardcoded value 'medical-claims-synthetic-data-dev'

1.7 WHEN IAM policies grant S3 access THEN the system uses hardcoded ARNs 'arn:aws:s3:::rag-app-v2-documents-dev/*' and 'arn:aws:s3:::medical-claims-synthetic-data-dev/*'

1.8 WHEN the application name is referenced throughout the stack THEN the system uses hardcoded value 'rag-app-v2' instead of a configurable parameter

1.9 WHEN attempting to deploy to staging or production environments THEN the system fails or deploys with incorrect '-dev' suffixed resource names

1.10 WHEN the stack needs to integrate with platform-provided resources THEN the system cannot adapt to different naming conventions across environments

### Expected Behavior (Correct)

2.1 WHEN the CDK stack is instantiated THEN the system SHALL derive the stack name from configurable application name and environment parameters (e.g., '{applicationName}-stack-{environment}')

2.2 WHEN the CDK stack is instantiated THEN the system SHALL use the environment parameter value in stack tags instead of hardcoded 'dev'

2.3 WHEN DynamoDB tables are created THEN the system SHALL construct table names using pattern '{applicationName}-{resourceType}-{environment}' from configurable parameters

2.4 WHEN S3 bucket is created THEN the system SHALL construct bucket name using pattern '{applicationName}-{resourceType}-{environment}' from configurable parameters

2.5 WHEN Lambda environment variables reference platform buckets THEN the system SHALL use configurable parameters or CDK context values for bucket names

2.6 WHEN Lambda environment variables reference source bucket for insurance claims THEN the system SHALL use configurable parameters that can be set per environment

2.7 WHEN IAM policies grant S3 access THEN the system SHALL construct ARNs dynamically from configurable bucket name parameters

2.8 WHEN the application name is referenced THEN the system SHALL retrieve it from CDK context or CloudFormation parameters

2.9 WHEN deploying to any environment (dev, staging, prod) THEN the system SHALL successfully deploy with environment-appropriate resource names

2.10 WHEN the stack integrates with platform-provided resources THEN the system SHALL accept platform resource identifiers through parameters or context variables

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the stack is deployed with default context values THEN the system SHALL CONTINUE TO create all resources successfully

3.2 WHEN Lambda functions are created THEN the system SHALL CONTINUE TO use Node.js 20.x runtime

3.3 WHEN DynamoDB tables are created THEN the system SHALL CONTINUE TO include all existing GSI indexes with correct configurations

3.4 WHEN IAM roles are created THEN the system SHALL CONTINUE TO grant all necessary permissions for Bedrock, Textract, S3, DynamoDB, OpenSearch, and SQS

3.5 WHEN API Gateway routes are defined THEN the system SHALL CONTINUE TO create all existing endpoints with correct Lambda integrations

3.6 WHEN S3 event notifications are configured THEN the system SHALL CONTINUE TO trigger document processing on object creation

3.7 WHEN CDK parameters are used for platform integration THEN the system SHALL CONTINUE TO accept UserPoolId, KnowledgeBaseId, VectorDbEndpoint, and ProcessingQueueUrl

3.8 WHEN stack outputs are generated THEN the system SHALL CONTINUE TO export all resource names and ARNs for reference

3.9 WHEN CORS is configured on API Gateway THEN the system SHALL CONTINUE TO allow the same origins, methods, and headers

3.10 WHEN removal policies are set on resources THEN the system SHALL CONTINUE TO use DESTROY policy for development convenience (to be overridden in production)
