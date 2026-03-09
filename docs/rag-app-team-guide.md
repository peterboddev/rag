# RAG Application Team Guide

## Overview

This guide explains how to build RAG applications using the platform-provided foundational infrastructure. The platform provides core AI/ML services, while you create application-specific resources and business logic.

## Architecture: Platform vs Application Responsibilities

### What Platform Provides (Read-Only for App Teams)

The platform team deploys and manages these foundational services:

| Service | What Platform Provides | Your Access Level |
|---------|----------------------|-------------------|
| **VPC & Networking** | VPC, subnets, security groups, NAT gateways | Use for Lambda/resources |
| **AWS Bedrock** | Nova Pro model access, embedding models | Invoke models via IAM role |
| **Vector Database** | OpenSearch Serverless collection | Read/write vectors via IAM role |
| **DynamoDB Tables** | Customers and documents tables | Read/write data via IAM role |
| **Authentication** | Cognito user pools, identity pools | Authenticate users, manage tokens |
| **API Gateway** | REST API with Cognito authorizer | Add methods and integrations |
| **IAM Role** | Lambda execution role with all permissions | Attach to your Lambda functions |

**Key Point**: Platform provides the foundation. You build on top of it.

### What You Create (Full Control)

You are responsible for creating and managing these application-specific resources:

| Resource Type | Your Responsibility | IAM Permissions Granted |
|--------------|---------------------|------------------------|
| **S3 Buckets** | Create buckets for documents, uploads, website hosting, backups | Full S3 permissions for `rag-app-*` buckets |
| **Lambda Functions** | Write business logic (chat, search, upload, processing) | Create, update, invoke functions |
| **SQS Queues** | Create queues for async processing, dead-letter queues | Full SQS permissions for `rag-app-*` queues |
| **EventBridge Rules** | Create rules for event-driven workflows | Create and manage rules |
| **Step Functions** | Create state machines for orchestration | Create and manage state machines |
| **API Gateway Methods** | Add methods to platform-provided API Gateway | Add resources, methods, integrations |

**Key Point**: You have full control over application-specific resources. Platform provides IAM permissions to create them.

**Note**: You have read/write access to platform-provided DynamoDB tables and can manage Global Secondary Indexes (GSIs), but cannot delete the tables themselves.

## IAM Permissions Granted to Your Lambda Functions

The platform-provided IAM role (`rag-app-rag-role-dev`) includes these permissions:

### Core AI/ML Services
- **Bedrock**: Invoke Nova Pro model, retrieve from knowledge bases
- **Textract**: Extract text from documents, analyze forms and tables
- **OpenSearch Serverless**: Read/write vectors, create indexes

### Data Storage
- **DynamoDB**: Read/write access to platform-provided tables (customers and documents)
  - Can add, modify, and remove Global Secondary Indexes (GSIs)
  - Can update table settings (e.g., billing mode, TTL)
  - Cannot delete tables
- **S3**: Full access to buckets prefixed with `rag-app-*`

### Application Resources (You Create These)
- **Lambda**: Create, update, invoke functions prefixed with `rag-app-*`
- **SQS**: Create, manage, send/receive messages for queues prefixed with `rag-app-*`
- **EventBridge**: Create and manage rules prefixed with `rag-app-*`
- **Step Functions**: Create and manage state machines prefixed with `rag-app-*`

### Authentication & API
- **Cognito**: Manage users, authenticate, get user attributes
- **API Gateway**: Add methods and integrations to platform-provided API

## Getting Started

### Step 1: Retrieve Platform Configuration

All platform configuration is stored in SSM Parameter Store with prefix `/rag-app/dev/`:

```bash
# Get all platform configuration
aws ssm get-parameters-by-path \
  --path "/rag-app/dev/" \
  --recursive \
  --query 'Parameters[*].[Name,Value]' \
  --output table
```

**Available Parameters** (17 total):
- `/rag-app/dev/bedrock/nova-pro-model-id` - Bedrock model ID
- `/rag-app/dev/cognito/user-pool-id` - Cognito user pool ID
- `/rag-app/dev/cognito/client-id` - Cognito client ID
- `/rag-app/dev/cognito/user-pool-arn` - Cognito user pool ARN
- `/rag-app/dev/iam/application-role-arn` - Your Lambda execution role ARN
- `/rag-app/dev/iam/application-role-name` - Your Lambda execution role name
- `/rag-app/dev/opensearch/collection-endpoint` - Vector database endpoint
- `/rag-app/dev/opensearch/index-name` - Vector index name
- `/rag-app/dev/opensearch/collection-name` - Collection name
- `/rag-app/dev/apigateway/api-id` - API Gateway ID
- `/rag-app/dev/apigateway/root-resource-id` - Root resource ID
- `/rag-app/dev/apigateway/url` - API Gateway URL
- `/rag-app/dev/network/vpc-id` - VPC ID
- `/rag-app/dev/region` - AWS region
- `/rag-app/dev/dynamodb/customers-table-name` - Customers table name
- `/rag-app/dev/dynamodb/customers-table-arn` - Customers table ARN
- `/rag-app/dev/dynamodb/documents-table-name` - Documents table name
- `/rag-app/dev/dynamodb/documents-table-arn` - Documents table ARN

### Step 2: Use Platform DynamoDB Tables

**Platform-Provided Tables**: The platform creates and manages these tables for you:
- `rag-app-customers-dev` - Customer/tenant management
- `rag-app-documents-dev` - Document metadata

You have read/write access and can manage Global Secondary Indexes (GSIs), but cannot delete the tables.

```bash
# Get table names from SSM
CUSTOMERS_TABLE=$(aws ssm get-parameter --name "/rag-app/dev/dynamodb/customers-table-name" --query 'Parameter.Value' --output text)
DOCUMENTS_TABLE=$(aws ssm get-parameter --name "/rag-app/dev/dynamodb/documents-table-name" --query 'Parameter.Value' --output text)

echo "Customers Table: $CUSTOMERS_TABLE"
echo "Documents Table: $DOCUMENTS_TABLE"
```

#### Adding a Global Secondary Index

You can add GSIs to optimize your query patterns:

```typescript
// Using AWS SDK
import { DynamoDBClient, UpdateTableCommand } from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({ region: "us-east-1" });

// Add a new GSI for querying by company
await client.send(new UpdateTableCommand({
  TableName: 'rag-app-customers-dev',
  AttributeDefinitions: [
    { AttributeName: 'company', AttributeType: 'S' },
  ],
  GlobalSecondaryIndexUpdates: [
    {
      Create: {
        IndexName: 'companyIndex',
        KeySchema: [
          { AttributeName: 'company', KeyType: 'HASH' },
        ],
        Projection: {
          ProjectionType: 'ALL',
        },
      },
    },
  ],
}));
```

```bash
# Using AWS CLI
aws dynamodb update-table \
  --table-name rag-app-customers-dev \
  --attribute-definitions AttributeName=company,AttributeType=S \
  --global-secondary-index-updates \
    '[{"Create":{"IndexName":"companyIndex","KeySchema":[{"AttributeName":"company","KeyType":"HASH"}],"Projection":{"ProjectionType":"ALL"}}}]'
```

### Step 3: Create Your Application Resources

#### Example: Create S3 Buckets (CDK)

```typescript
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';

export class RAGApplicationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const environment = 'dev';
    const applicationName = 'rag-app';

    // Create S3 bucket for document uploads
    const documentBucket = new s3.Bucket(this, 'DocumentBucket', {
      bucketName: `${applicationName}-documents-${environment}-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      lifecycleRules: [{
        transitions: [{
          storageClass: s3.StorageClass.INFREQUENT_ACCESS,
          transitionAfter: cdk.Duration.days(30),
        }],
      }],
      cors: [{
        allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.POST, s3.HttpMethods.PUT],
        allowedOrigins: ['*'],
        allowedHeaders: ['*'],
      }],
    });

    // Create S3 bucket for website hosting
    const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      bucketName: `${applicationName}-website-${environment}-${this.account}`,
      websiteIndexDocument: 'index.html',
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // Create S3 bucket for processed data
    const processedBucket = new s3.Bucket(this, 'ProcessedBucket', {
      bucketName: `${applicationName}-processed-${environment}-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      lifecycleRules: [{
        transitions: [{
          storageClass: s3.StorageClass.GLACIER,
          transitionAfter: cdk.Duration.days(90),
        }],
      }],
    });
  }
}
```

#### Example: Create SQS Queue (CDK)

```typescript
import * as sqs from 'aws-cdk-lib/aws-sqs';

// Create queue for document processing
const documentQueue = new sqs.Queue(this, 'DocumentQueue', {
  queueName: `${applicationName}-document-processing-${environment}`,
  visibilityTimeout: cdk.Duration.seconds(300),
  retentionPeriod: cdk.Duration.days(14),
  deadLetterQueue: {
    queue: new sqs.Queue(this, 'DocumentDLQ', {
      queueName: `${applicationName}-document-dlq-${environment}`,
    }),
    maxReceiveCount: 3,
  },
});
```

#### Example: Create EventBridge Rule (CDK)

```typescript
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';

// Create rule to trigger processing on S3 upload
const s3UploadRule = new events.Rule(this, 'S3UploadRule', {
  ruleName: `${applicationName}-s3-upload-${environment}`,
  eventPattern: {
    source: ['aws.s3'],
    detailType: ['Object Created'],
    detail: {
      bucket: {
        name: [documentBucket.bucketName],
      },
    },
  },
});

// Add Lambda target
s3UploadRule.addTarget(new targets.LambdaFunction(processingFunction));
```

#### Example: Create Step Function (CDK)

```typescript
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';

// Create state machine for document processing workflow
const processTask = new tasks.LambdaInvoke(this, 'ProcessDocument', {
  lambdaFunction: processingFunction,
  outputPath: '$.Payload',
});

const stateMachine = new sfn.StateMachine(this, 'DocumentWorkflow', {
  stateMachineName: `${applicationName}-document-workflow-${environment}`,
  definition: processTask,
});
```

### Step 4: Create Lambda Functions

#### Example: Chat Lambda Function

```typescript
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';

// Get platform-provided IAM role
const applicationRoleArn = ssm.StringParameter.valueFromLookup(
  this,
  '/rag-app/dev/iam/application-role-arn'
);

const applicationRole = iam.Role.fromRoleArn(
  this,
  'ApplicationRole',
  applicationRoleArn
);

// Create Lambda function with platform role
const chatFunction = new lambda.Function(this, 'ChatFunction', {
  functionName: `${applicationName}-chat-${environment}`,
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'chat.handler',
  code: lambda.Code.fromAsset('src/handlers'),
  role: applicationRole, // Use platform-provided role
  environment: {
    BEDROCK_MODEL_ID: ssm.StringParameter.valueFromLookup(
      this,
      '/rag-app/dev/bedrock/nova-pro-model-id'
    ),
    VECTOR_DB_ENDPOINT: ssm.StringParameter.valueFromLookup(
      this,
      '/rag-app/dev/opensearch/collection-endpoint'
    ),
    CUSTOMERS_TABLE: ssm.StringParameter.valueFromLookup(
      this,
      '/rag-app/dev/dynamodb/customers-table-name'
    ),
    DOCUMENTS_TABLE: ssm.StringParameter.valueFromLookup(
      this,
      '/rag-app/dev/dynamodb/documents-table-name'
    ),
  },
});
```

#### Lambda Function Code Example

**File: `src/handlers/chat.ts`**

```typescript
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";

const bedrockClient = new BedrockRuntimeClient({ region: process.env.AWS_REGION });
const dynamoClient = new DynamoDBClient({ region: process.env.AWS_REGION });

export const handler = async (event: any) => {
  const { userId, message } = JSON.parse(event.body);

  // Call Bedrock Nova Pro
  const response = await bedrockClient.send(new InvokeModelCommand({
    modelId: process.env.BEDROCK_MODEL_ID,
    body: JSON.stringify({
      messages: [{ role: "user", content: [{ text: message }] }],
      inferenceConfig: { max_new_tokens: 1000, temperature: 0.7 }
    })
  }));

  const answer = JSON.parse(response.body.transformToString()).content[0].text;

  // Save conversation to DynamoDB (using platform-provided table)
  await dynamoClient.send(new PutItemCommand({
    TableName: process.env.CUSTOMERS_TABLE, // Platform-provided table
    Item: {
      userId: { S: userId },
      timestamp: { N: Date.now().toString() },
      message: { S: message },
      response: { S: answer },
    }
  }));

  return {
    statusCode: 200,
    body: JSON.stringify({ answer })
  };
};
```

### Step 5: Add API Gateway Methods

```typescript
import * as apigateway from 'aws-cdk-lib/aws-apigateway';

// Get platform-provided API Gateway
const apiGatewayId = ssm.StringParameter.valueFromLookup(
  this,
  '/rag-app/dev/apigateway/api-id'
);

const api = apigateway.RestApi.fromRestApiId(this, 'API', apiGatewayId);

// Add /chat endpoint
const chatResource = api.root.addResource('chat');
chatResource.addMethod('POST', new apigateway.LambdaIntegration(chatFunction), {
  authorizationType: apigateway.AuthorizationType.COGNITO,
  authorizer: new apigateway.CognitoUserPoolsAuthorizer(this, 'Authorizer', {
    cognitoUserPools: [userPool],
  }),
});
```

## DynamoDB Table Schemas (Platform-Provided)

**Platform-Managed Tables**: The platform creates and manages these tables. You have read/write access but cannot create or delete them.

### Customers Table (`rag-app-customers-dev`)

**Purpose**: Manage customers/tenants in your RAG application

**Schema**:
```typescript
{
  customerId: string,     // Partition key (UUID)
  email: string,          // GSI partition key (emailIndex)
  name: string,
  company?: string,
  plan: string,           // 'free', 'pro', 'enterprise'
  status: string,         // 'active', 'suspended', 'deleted'
  createdAt: number,      // Unix timestamp
  updatedAt: number,
  metadata?: object
}
```

**Global Secondary Indexes**:
- `emailIndex` - Query by email address (PK: email)

### Documents Table (`rag-app-documents-dev`)

**Purpose**: Track document uploads, processing status, and metadata

**Schema**:
```typescript
{
  documentId: string,     // Partition key (UUID)
  customerId: string,     // GSI partition key (customerIdIndex)
  uploadedAt: number,     // GSI sort key (Unix timestamp)
  filename: string,
  s3Key: string,
  s3Bucket: string,
  fileSize: number,
  mimeType: string,
  status: string,         // GSI partition key (statusIndex): 'uploaded', 'processing', 'completed', 'failed'
  vectorized: boolean,
  errorMessage?: string,
  metadata?: object
}
```

**Global Secondary Indexes**:
- `customerIdIndex` - Query documents by customer (PK: customerId, SK: uploadedAt)
- `statusIndex` - Query documents by status (PK: status, SK: uploadedAt)

### Example: Read/Write Platform DynamoDB Tables

```typescript
import { DynamoDBClient, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({ region: process.env.AWS_REGION });

// Create a new customer (using platform-provided table)
await client.send(new PutItemCommand({
  TableName: 'rag-app-customers-dev', // Platform-provided table
  Item: {
    customerId: { S: 'cust-123' },
    email: { S: 'customer@example.com' },
    name: { S: 'John Doe' },
    company: { S: 'Acme Corp' },
    plan: { S: 'pro' },
    status: { S: 'active' },
    createdAt: { N: Date.now().toString() },
    updatedAt: { N: Date.now().toString() },
  }
}));

// Create document record (using platform-provided table)
await client.send(new PutItemCommand({
  TableName: 'rag-app-documents-dev', // Platform-provided table
  Item: {
    documentId: { S: 'doc-456' },
    customerId: { S: 'cust-123' },
    uploadedAt: { N: Date.now().toString() },
    filename: { S: 'report.pdf' },
    s3Key: { S: 'documents/report.pdf' },
    s3Bucket: { S: 'rag-app-documents-dev-123456789' },
    fileSize: { N: '1024000' },
    mimeType: { S: 'application/pdf' },
    status: { S: 'processing' },
    vectorized: { BOOL: false },
  }
}));

// Query customer's documents
const result = await client.send(new QueryCommand({
  TableName: 'rag-app-documents-dev',
  IndexName: 'customerIdIndex',
  KeyConditionExpression: 'customerId = :customerId',
  ExpressionAttributeValues: {
    ':customerId': { S: 'cust-123' }
  },
  ScanIndexForward: false, // Most recent first
  Limit: 10
}));
```

## Common Patterns

### Pattern 1: Document Upload and Processing

```typescript
// 1. User uploads document to your S3 bucket
// 2. S3 event triggers EventBridge rule
// 3. EventBridge invokes Lambda function
// 4. Lambda extracts text with Textract
// 5. Lambda generates embeddings with Bedrock
// 6. Lambda stores vectors in OpenSearch
// 7. Lambda updates documents table in DynamoDB

const uploadFunction = new lambda.Function(this, 'UploadHandler', {
  functionName: `${applicationName}-upload-${environment}`,
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'upload.handler',
  code: lambda.Code.fromAsset('src/handlers'),
  role: applicationRole,
  environment: {
    DOCUMENT_BUCKET: documentBucket.bucketName,
    DOCUMENTS_TABLE: documentsTableName,
  },
});

// Grant S3 permissions
documentBucket.grantReadWrite(uploadFunction);
```

### Pattern 2: RAG Chat with Vector Search

```typescript
// 1. User sends chat message
// 2. Lambda queries OpenSearch for relevant documents
// 3. Lambda builds context from retrieved documents
// 4. Lambda calls Bedrock Nova Pro with context
// 5. Lambda saves conversation to DynamoDB
// 6. Lambda returns response to user

const chatFunction = new lambda.Function(this, 'ChatHandler', {
  functionName: `${applicationName}-chat-${environment}`,
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'chat.handler',
  code: lambda.Code.fromAsset('src/handlers'),
  role: applicationRole,
  environment: {
    BEDROCK_MODEL_ID: bedrockModelId,
    VECTOR_DB_ENDPOINT: vectorDbEndpoint,
    CUSTOMERS_TABLE: ssm.StringParameter.valueFromLookup(
      this,
      '/rag-app/dev/dynamodb/customers-table-name'
    ),
  },
});
```

### Pattern 3: Async Processing with SQS

```typescript
// 1. API Gateway receives request
// 2. Lambda sends message to SQS queue
// 3. Returns immediately to user
// 4. Worker Lambda processes queue messages
// 5. Updates status in DynamoDB

const processingQueue = new sqs.Queue(this, 'ProcessingQueue', {
  queueName: `${applicationName}-processing-${environment}`,
  visibilityTimeout: cdk.Duration.seconds(300),
});

const workerFunction = new lambda.Function(this, 'Worker', {
  functionName: `${applicationName}-worker-${environment}`,
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'worker.handler',
  code: lambda.Code.fromAsset('src/handlers'),
  role: applicationRole,
});

workerFunction.addEventSource(new lambdaEventSources.SqsEventSource(processingQueue));
```

## Resource Naming Convention

**CRITICAL**: All resources you create MUST be prefixed with `rag-app-` to match IAM permissions.

✅ **Correct**:
- `rag-app-documents-dev-123456789`
- `rag-app-processing-queue-dev`
- `rag-app-upload-rule-dev`
- `rag-app-document-workflow-dev`

❌ **Incorrect** (IAM will deny):
- `my-documents-bucket`
- `processing-queue`
- `upload-rule`

## Deployment

### Using CDK

```bash
# Install dependencies
npm install

# Synthesize CloudFormation template
npx cdk synth

# Deploy to dev
npx cdk deploy --require-approval never

# Deploy to specific environment
npx cdk deploy --context environment=staging
```

### Using SAM

```bash
# Build
sam build

# Deploy
sam deploy --guided
```

## Verification

### Check Your Resources

```bash
# List your S3 buckets
aws s3 ls | grep rag-app

# List your Lambda functions
aws lambda list-functions --query 'Functions[?starts_with(FunctionName, `rag-app`)].FunctionName'

# List your SQS queues
aws sqs list-queues --query 'QueueUrls[?contains(@, `rag-app`)]'

# List your Step Functions
aws stepfunctions list-state-machines --query 'stateMachines[?starts_with(name, `rag-app`)].name'
```

### Test Platform Access

```bash
# Test Bedrock access
aws bedrock-runtime invoke-model \
  --model-id amazon.nova-pro-v1:0 \
  --body '{"messages":[{"role":"user","content":[{"text":"Hello"}]}]}' \
  --cli-binary-format raw-in-base64-out \
  output.json

# Test DynamoDB access (platform-provided tables)
aws dynamodb scan \
  --table-name rag-app-customers-dev \
  --limit 5

aws dynamodb scan \
  --table-name rag-app-documents-dev \
  --limit 5
```

## Troubleshooting

### Issue: Pipeline Build Fails - "template.yaml not found"

**Symptom**: Application pipeline deployment stage fails with:
```
File [template.yaml] does not exist in artifact [BuildOutput]
```

**Root Cause**: Build failed before CDK synthesis could create the template file.

**Common Causes**:
1. **NODE_ENV=production is set** - This causes npm to skip devDependencies
2. **Missing devDependencies** - CDK and test frameworks not installed
3. **Build commands fail** - Tests or compilation errors

**Solution**:

#### Step 1: Check Your Application Configuration

Your application pipeline configuration should NOT set `NODE_ENV=production` in the build stage:

```json
{
  "buildConfig": {
    "commands": [
      "npm ci",                    // ✅ Installs all dependencies
      "npm run test --if-present",
      "npm run build --if-present",
      "npx cdk synth --if-present"
    ],
    "environment": {
      // ❌ DO NOT set NODE_ENV: "production" here
      "NPM_CONFIG_CACHE": "/tmp/.npm"
    }
  }
}
```

#### Step 2: Verify Your package.json

Ensure CDK is in dependencies or devDependencies:

```json
{
  "dependencies": {
    "aws-cdk-lib": "^2.100.0",
    "constructs": "^10.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
```

#### Step 3: Check Your CDK App

Ensure your CDK app synthesizes correctly:

```bash
# Test locally
npm ci
npx cdk synth

# Should create cdk.out/ directory with .template.json files
ls cdk.out/
```

#### Step 4: Update templatePath in Pipeline Config

If using CDK, specify the correct template path:

```json
{
  "templatePath": "cdk.out/YourStackName.template.json"
}
```

For SAM applications, use:
```json
{
  "templatePath": "template.yaml"
}
```

### Issue: NODE_ENV=production Breaks Builds

**Symptom**: Build fails with missing devDependencies even though they're in package.json

**Root Cause**: When `NODE_ENV=production` is set, npm automatically skips devDependencies

**Why This Happens**:
```bash
# When NODE_ENV=production is set:
npm ci              # Implicitly runs: npm ci --omit=dev
npm install         # Implicitly runs: npm install --omit=dev

# Result: devDependencies are NOT installed
# CDK, TypeScript, test frameworks are missing
# Build fails before template can be created
```

**Solution**: Remove `NODE_ENV=production` from build configuration

**❌ WRONG Configuration**:
```json
{
  "buildConfig": {
    "environment": {
      "NODE_ENV": "production"  // ❌ Breaks builds
    }
  }
}
```

**✅ CORRECT Configuration**:
```json
{
  "buildConfig": {
    "environment": {
      // Do not set NODE_ENV in build stages
      "NPM_CONFIG_CACHE": "/tmp/.npm"
    }
  }
}
```

**Note**: The `--include=dev` flag does NOT work reliably with `NODE_ENV=production` due to inconsistent npm behavior across versions.

### Issue: IAM Permission Denied

**Symptom**: `AccessDenied` or `UnauthorizedOperation` errors

**Solution**: Ensure resources are prefixed with `rag-app-`:
```bash
# Check resource name
aws s3 ls | grep rag-app

# If wrong prefix, recreate with correct name
```

### Issue: Cannot Find SSM Parameters

**Symptom**: `ParameterNotFound` error

**Solution**: Verify platform infrastructure is deployed:
```bash
aws ssm get-parameters-by-path --path "/rag-app/dev/" --recursive
```

### Issue: Lambda Cannot Access DynamoDB

**Symptom**: `AccessDeniedException` when accessing platform-provided tables

**Solution**: Ensure Lambda uses platform-provided IAM role and correct table names:
```typescript
const applicationRole = iam.Role.fromRoleArn(
  this,
  'ApplicationRole',
  applicationRoleArn // From SSM parameter
);

// Get table names from SSM
const customersTable = ssm.StringParameter.valueFromLookup(
  this,
  '/rag-app/dev/dynamodb/customers-table-name'
);
```

## Best Practices

1. **Use Platform IAM Role**: Always use the platform-provided IAM role for Lambda functions
2. **Prefix Resources**: All resources you create must be prefixed with `rag-app-`
3. **Read SSM Parameters**: Get all configuration from SSM Parameter Store
4. **Use Platform Tables**: Use platform-provided DynamoDB tables (customers and documents)
5. **Tag Resources**: Tag all resources with `Application: rag-app` and `Environment: dev`
6. **Use Lifecycle Policies**: Configure S3 lifecycle rules to manage costs
7. **Enable Versioning**: Enable versioning on S3 buckets for data protection
8. **Monitor Costs**: Use AWS Cost Explorer to track resource usage

## Next Steps

1. Clone your application repository
2. Retrieve platform configuration from SSM (including DynamoDB table names)
3. Create your S3 buckets, SQS queues, and other resources
4. Write Lambda functions using platform services and tables
5. Add API Gateway methods
6. Deploy and test
7. Monitor with CloudWatch

## Support

- **Platform Issues**: Contact platform team for infrastructure problems
- **Application Issues**: Debug your Lambda functions and application code
- **IAM Permissions**: Contact platform team if you need additional permissions
