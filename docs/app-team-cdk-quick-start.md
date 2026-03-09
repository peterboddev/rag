# App Team CDK Quick Start

## ⚠️ CRITICAL: CodeBuild Role Must Have SSM Permissions

**Before you can deploy, the platform team MUST add SSM read permissions to your CodeBuild role.**

Without these permissions, `cdk synth` will fail with:
```
User: arn:aws:sts::ACCOUNT:assumed-role/CodeBuildRole/... is not authorized to perform: ssm:GetParameter
```

See "Required CodeBuild Permissions" section below for the exact IAM policy needed.

---

## Problem: CDK Synthesis Fails with "SSM parameter not found"

If you're seeing this error:
```
Error: SSM parameter /rag-app/dev/iam/application-role-arn not found. 
Ensure platform infrastructure is deployed before application stack.
```

**You're trying to read SSM parameters at synthesis time instead of deployment time.**

## Solution: Use CDK's valueFromLookup()

### Step 1: Import Required Modules

```typescript
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
```

### Step 2: Look Up Platform Resources

```typescript
export class RAGApplicationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ✅ CORRECT: Use valueFromLookup for all platform parameters
    const applicationRoleArn = ssm.StringParameter.valueFromLookup(
      this,
      '/rag-app/dev/iam/application-role-arn'
    );

    const bedrockModelId = ssm.StringParameter.valueFromLookup(
      this,
      '/rag-app/dev/bedrock/nova-pro-model-id'
    );

    const vectorDbEndpoint = ssm.StringParameter.valueFromLookup(
      this,
      '/rag-app/dev/opensearch/collection-endpoint'
    );

    const customersTableName = ssm.StringParameter.valueFromLookup(
      this,
      '/rag-app/dev/dynamodb/customers-table-name'
    );

    const documentsTableName = ssm.StringParameter.valueFromLookup(
      this,
      '/rag-app/dev/dynamodb/documents-table-name'
    );

    const apiGatewayId = ssm.StringParameter.valueFromLookup(
      this,
      '/rag-app/dev/apigateway/api-id'
    );

    const apiGatewayRootResourceId = ssm.StringParameter.valueFromLookup(
      this,
      '/rag-app/dev/apigateway/root-resource-id'
    );

    const vpcId = ssm.StringParameter.valueFromLookup(
      this,
      '/rag-app/dev/network/vpc-id'
    );

    // Import the platform-provided IAM role
    const applicationRole = iam.Role.fromRoleArn(
      this,
      'ApplicationRole',
      applicationRoleArn
    );

    // Now use these values in your resources...
  }
}
```

### Step 3: Create Your Lambda Functions

```typescript
// Create your Lambda function using platform resources
const chatFunction = new lambda.Function(this, 'ChatFunction', {
  functionName: 'rag-app-chat-dev',
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'chat.handler',
  code: lambda.Code.fromAsset('lambda'),
  role: applicationRole, // ✅ Use platform-provided role
  environment: {
    BEDROCK_MODEL_ID: bedrockModelId,
    VECTOR_DB_ENDPOINT: vectorDbEndpoint,
    CUSTOMERS_TABLE: customersTableName,
    DOCUMENTS_TABLE: documentsTableName,
  },
  timeout: cdk.Duration.seconds(30),
  memorySize: 512,
});
```

### Step 4: Create Your S3 Buckets

```typescript
import * as s3 from 'aws-cdk-lib/aws-s3';

// Create your application-specific S3 bucket
const documentsBucket = new s3.Bucket(this, 'DocumentsBucket', {
  bucketName: 'rag-app-documents-dev', // ✅ Must start with rag-app-
  encryption: s3.BucketEncryption.S3_MANAGED,
  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
  versioned: true,
  lifecycleRules: [
    {
      expiration: cdk.Duration.days(90),
      transitions: [
        {
          storageClass: s3.StorageClass.INTELLIGENT_TIERING,
          transitionAfter: cdk.Duration.days(30),
        },
      ],
    },
  ],
});

// Grant the platform role access to your bucket
documentsBucket.grantReadWrite(applicationRole);
```

### Step 5: Create Your SQS Queues

```typescript
import * as sqs from 'aws-cdk-lib/aws-sqs';

// Create processing queue
const processingQueue = new sqs.Queue(this, 'ProcessingQueue', {
  queueName: 'rag-app-processing-dev', // ✅ Must start with rag-app-
  visibilityTimeout: cdk.Duration.seconds(300),
  retentionPeriod: cdk.Duration.days(14),
  deadLetterQueue: {
    queue: new sqs.Queue(this, 'ProcessingDLQ', {
      queueName: 'rag-app-processing-dlq-dev',
    }),
    maxReceiveCount: 3,
  },
});

// Grant the platform role access to your queue
processingQueue.grantSendMessages(applicationRole);
processingQueue.grantConsumeMessages(applicationRole);
```

### Step 6: Add API Gateway Methods

```typescript
import * as apigateway from 'aws-cdk-lib/aws-apigateway';

// Import the platform-provided API Gateway
const api = apigateway.RestApi.fromRestApiAttributes(this, 'Api', {
  restApiId: apiGatewayId,
  rootResourceId: apiGatewayRootResourceId,
});

// Add your endpoints
const chatResource = api.root.addResource('chat');
chatResource.addMethod('POST', new apigateway.LambdaIntegration(chatFunction), {
  authorizationType: apigateway.AuthorizationType.COGNITO,
  authorizer: new apigateway.CognitoUserPoolsAuthorizer(this, 'ChatAuthorizer', {
    cognitoUserPools: [
      cognito.UserPool.fromUserPoolId(
        this,
        'UserPool',
        ssm.StringParameter.valueFromLookup(this, '/rag-app/dev/cognito/user-pool-id')
      ),
    ],
  }),
});
```

## What NOT to Do

### ❌ WRONG: Using AWS SDK at Synthesis Time

```typescript
// ❌ This will fail during cdk synth
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

const ssmClient = new SSMClient({ region: 'us-east-1' });
const response = await ssmClient.send(new GetParameterCommand({
  Name: '/rag-app/dev/iam/application-role-arn'
}));
const roleArn = response.Parameter?.Value;
```

### ❌ WRONG: Using CLI Commands at Synthesis Time

```typescript
// ❌ This will fail during cdk synth
import { execSync } from 'child_process';

const roleArn = execSync(
  'aws ssm get-parameter --name /rag-app/dev/iam/application-role-arn --query Parameter.Value --output text'
).toString().trim();
```

### ❌ WRONG: Throwing Errors When Parameters Not Found

```typescript
// ❌ Don't throw errors during synthesis
const roleArn = ssm.StringParameter.valueFromLookup(
  this,
  '/rag-app/dev/iam/application-role-arn'
);

if (!roleArn) {
  throw new Error('SSM parameter not found'); // ❌ Don't do this
}
```

## Why This Works

1. **Synthesis Time** (when you run `cdk synth`):
   - CDK generates CloudFormation templates
   - `valueFromLookup()` uses cached values from `cdk.context.json`
   - No AWS API calls are made
   - Works in CodeBuild without AWS credentials

2. **Deployment Time** (when you run `cdk deploy`):
   - CDK looks up actual SSM parameter values
   - Values are cached in `cdk.context.json` for future syntheses
   - CloudFormation uses the real values to create resources

## Testing Locally

```bash
# First deployment - CDK will look up and cache values
npx cdk deploy

# Subsequent syntheses use cached values
npx cdk synth

# Check cached values
cat cdk.context.json
```

## Complete Example

See the full example in `docs/rag-app-team-guide-v2.md` under "Step 2: Create Your CDK Application Stack".

## Available SSM Parameters

All platform configuration is available at `/rag-app/dev/`:

```bash
# List all available parameters
aws ssm get-parameters-by-path \
  --path "/rag-app/dev/" \
  --recursive \
  --query 'Parameters[*].[Name,Value]' \
  --output table
```

**Key Parameters**:
- `/rag-app/dev/iam/application-role-arn` - Your Lambda execution role
- `/rag-app/dev/bedrock/nova-pro-model-id` - Bedrock model ID
- `/rag-app/dev/opensearch/collection-endpoint` - Vector database endpoint
- `/rag-app/dev/dynamodb/customers-table-name` - Customers table
- `/rag-app/dev/dynamodb/documents-table-name` - Documents table
- `/rag-app/dev/apigateway/api-id` - API Gateway ID
- `/rag-app/dev/cognito/user-pool-id` - Cognito user pool ID

## Required CodeBuild Permissions

**IMPORTANT**: The CodeBuild role used by your application pipeline must have permission to read SSM parameters during CDK synthesis.

**Required IAM Policy for CodeBuild Role**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:GetParametersByPath"
      ],
      "Resource": [
        "arn:aws:ssm:*:*:parameter/rag-app/dev/*",
        "arn:aws:ssm:*:*:parameter/rag-app/staging/*",
        "arn:aws:ssm:*:*:parameter/rag-app/prod/*"
      ]
    }
  ]
}
```

**Why This Is Needed**:
- CDK's `valueFromLookup()` reads SSM parameters during synthesis
- Without these permissions, `cdk synth` will fail with "not authorized to perform: ssm:GetParameter"
- Platform team must add this policy to the CodeBuild service role

## Need Help?

1. Check the full guide: `docs/rag-app-team-guide-v2.md`
2. Review troubleshooting section for common issues
3. Contact platform team for infrastructure questions
