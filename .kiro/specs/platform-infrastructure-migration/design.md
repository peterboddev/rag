# Design Document: Platform Infrastructure Migration

## Introduction

This design document outlines the technical approach for migrating the RAG application infrastructure from the current `rag-app-v2` self-managed implementation to the platform team's standardized architecture. The migration involves transitioning from creating our own DynamoDB tables, IAM roles, and API Gateway to importing platform-provided resources while maintaining all existing functionality.

## High-Level Design

### Architecture Overview

The new architecture follows a clear separation of concerns:

**Platform-Provided Infrastructure (Managed by Platform Team):**
- DynamoDB tables: `rag-app-customers-dev` and `rag-app-documents-dev`
- IAM role: Retrieved from SSM `/rag-app/dev/iam/application-role-arn`
- API Gateway: Retrieved from SSM `/rag-app/dev/apigateway/api-id`
- SSM Parameter Store: Configuration repository for resource identifiers

**Application-Managed Infrastructure (Managed by Development Team):**
- Lambda functions (18 functions for document management, chunking, and insurance claims)
- S3 bucket: `rag-app-documents-dev` for application-specific document storage
- SQS queue: `rag-app-document-processing-dev` for asynchronous processing
- API Gateway routes and methods (added to platform-provided API Gateway)
- S3 event notifications for document processing triggers

### Key Design Decisions

1. **Import vs Create Pattern**: Use CDK's `fromTableName()`, `fromRoleArn()`, and `fromRestApiId()` methods to import platform resources instead of creating new ones.

2. **SSM Parameter Store Integration**: Retrieve all platform resource identifiers from SSM Parameter Store at deployment time, enabling environment-agnostic configuration.

3. **Stack Naming**: Use stack ID `rag-app-development` to match platform pipeline expectation (class name remains `RAGApplicationStack`).

4. **Resource Naming Convention**: Standardize on `rag-app-{resourceType}-{environment}` pattern, removing the `-v2` suffix.

5. **Backward Compatibility**: Maintain all existing Lambda function environment variables and API endpoints to ensure zero code changes in Lambda functions.

### Migration Strategy

The migration will be executed as a single deployment that:
1. Removes creation of DynamoDB tables, IAM roles, and API Gateway
2. Adds SSM parameter lookups for platform resources
3. Imports platform resources using CDK constructs
4. Creates application-specific resources (S3, SQS) with new naming
5. Updates all Lambda functions to use imported resources
6. Adds API routes to the imported API Gateway

### Data Flow

```
API Request → Platform API Gateway → Lambda Function → Platform DynamoDB Tables
                                   ↓
                                   Application S3 Bucket
                                   ↓
                                   SQS Queue → Async Processing
                                   ↓
                                   Bedrock/Textract/OpenSearch
```

### Multi-Tenant Architecture

The multi-tenant architecture remains unchanged:
- Tenant isolation via `tenantId` field in DynamoDB
- Customer-specific chunking configurations
- Tenant-based GSI indexes for efficient queries
- API-level tenant validation

## Low-Level Design

### CDK Stack Structure

#### File: `infrastructure/rag-application-stack.ts`

New stack class replacing `MultiTenantDocumentManagerStack`:

```typescript
export class RAGApplicationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    
    // 1. Retrieve environment from context
    const environment = this.node.tryGetContext('environment') || 'dev';
    const applicationName = 'rag-app';
    
    // 2. Import platform resources via SSM
    // 3. Create application-specific resources
    // 4. Create Lambda functions with imported IAM role
    // 5. Add API routes to imported API Gateway
    // 6. Configure S3 event notifications
    // 7. Export stack outputs
  }
}
```

#### File: `infrastructure/app.ts`

Updated entry point:

```typescript
const app = new cdk.App();

const environment = app.node.tryGetContext('environment') || 'dev';

// Stack name must match platform pipeline expectation
new RAGApplicationStack(app, 'rag-app-development', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  description: 'RAG Application - Multi-tenant document management',
  tags: {
    Project: 'RAG-Platform',
    Component: 'Application',
    Environment: environment
  }
});
```

### SSM Parameter Retrieval

All platform resource identifiers will be retrieved using `ssm.StringParameter.valueFromLookup()`:

```typescript
// IAM Role
const applicationRoleArn = ssm.StringParameter.valueFromLookup(
  this,
  `/rag-app/${environment}/iam/application-role-arn`
);

// API Gateway
const apiGatewayId = ssm.StringParameter.valueFromLookup(
  this,
  `/rag-app/${environment}/apigateway/api-id`
);

const apiGatewayRootResourceId = ssm.StringParameter.valueFromLookup(
  this,
  `/rag-app/${environment}/apigateway/root-resource-id`
);

// DynamoDB Tables
const customersTableName = ssm.StringParameter.valueFromLookup(
  this,
  `/rag-app/${environment}/dynamodb/customers-table-name`
);

const documentsTableName = ssm.StringParameter.valueFromLookup(
  this,
  `/rag-app/${environment}/dynamodb/documents-table-name`
);
```

### Resource Import Pattern

#### DynamoDB Tables

```typescript
const customersTable = dynamodb.Table.fromTableName(
  this,
  'CustomersTable',
  customersTableName
);

const documentsTable = dynamodb.Table.fromTableName(
  this,
  'DocumentsTable',
  documentsTableName
);
```

#### IAM Role

```typescript
const lambdaExecutionRole = iam.Role.fromRoleArn(
  this,
  'LambdaExecutionRole',
  applicationRoleArn,
  { mutable: false }
);
```

#### API Gateway

```typescript
const api = apigateway.RestApi.fromRestApiAttributes(
  this,
  'ImportedApi',
  {
    restApiId: apiGatewayId,
    rootResourceId: apiGatewayRootResourceId
  }
);
```

### Application-Specific Resources

#### S3 Bucket

```typescript
const documentsBucket = new s3.Bucket(this, 'DocumentsBucket', {
  bucketName: `${applicationName}-documents-${environment}`,
  removalPolicy: environment === 'prod' 
    ? cdk.RemovalPolicy.RETAIN 
    : cdk.RemovalPolicy.DESTROY,
  autoDeleteObjects: environment !== 'prod',
  encryption: s3.BucketEncryption.S3_MANAGED,
  cors: [
    {
      allowedMethods: [
        s3.HttpMethods.GET,
        s3.HttpMethods.POST,
        s3.HttpMethods.PUT
      ],
      allowedOrigins: ['*'],
      allowedHeaders: ['*'],
    },
  ],
});
```

#### SQS Queue

```typescript
const processingQueue = new sqs.Queue(this, 'ProcessingQueue', {
  queueName: `${applicationName}-document-processing-${environment}`,
  visibilityTimeout: cdk.Duration.seconds(900),
  retentionPeriod: cdk.Duration.days(14),
  encryption: sqs.QueueEncryption.SQS_MANAGED,
});
```

### Lambda Function Configuration

All Lambda functions will use the imported IAM role and updated environment variables:

```typescript
const customerManagerFunction = new lambda.Function(this, 'CustomerManagerFunction', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'dist/src/lambda/customer-manager.handler',
  code: lambda.Code.fromAsset('.', {
    exclude: ['cdk.out', 'unit_tests', 'infrastructure', '*.md', 'tests_ongoing', 'frontend']
  }),
  role: lambdaExecutionRole,
  timeout: cdk.Duration.seconds(30),
  memorySize: 256,
  environment: {
    CUSTOMERS_TABLE_NAME: customersTable.tableName,
    DOCUMENTS_TABLE_NAME: documentsTable.tableName,
    REGION: this.region,
  },
});
```

### API Gateway Route Configuration

Routes will be added to the imported API Gateway:

```typescript
// Create resource hierarchy
const customersResource = api.root.addResource('customers');
customersResource.addMethod('POST', new apigateway.LambdaIntegration(customerManagerFunction));

const customerResource = customersResource.addResource('{customerUUID}');
const chunkingConfigResource = customerResource.addResource('chunking-config');
chunkingConfigResource.addMethod('GET', new apigateway.LambdaIntegration(chunkingConfigGetFunction));
chunkingConfigResource.addMethod('PUT', new apigateway.LambdaIntegration(chunkingConfigUpdateFunction));

// ... additional routes
```

### Environment Variable Mapping

| Lambda Function | Environment Variables |
|----------------|----------------------|
| customer-manager | CUSTOMERS_TABLE_NAME, DOCUMENTS_TABLE_NAME, REGION |
| document-upload | CUSTOMERS_TABLE_NAME, DOCUMENTS_TABLE_NAME, DOCUMENTS_BUCKET, REGION |
| document-processing | CUSTOMERS_TABLE_NAME, DOCUMENTS_TABLE_NAME, DOCUMENTS_BUCKET, KNOWLEDGE_BASE_ID, VECTOR_DB_ENDPOINT, BEDROCK_REGION, REGION |
| document-summary | CUSTOMERS_TABLE_NAME, DOCUMENTS_TABLE_NAME, BEDROCK_REGION, REGION |
| document-retry | DOCUMENTS_TABLE_NAME, DOCUMENTS_BUCKET, REGION |
| document-delete | DOCUMENTS_TABLE_NAME, DOCUMENTS_BUCKET, REGION |
| document-summary-selective | CUSTOMERS_TABLE_NAME, DOCUMENTS_TABLE_NAME, BEDROCK_REGION, REGION |
| chunking-config-get | CUSTOMERS_TABLE_NAME, REGION |
| chunking-config-update | CUSTOMERS_TABLE_NAME, DOCUMENTS_TABLE_NAME, KNOWLEDGE_BASE_ID, VECTOR_DB_ENDPOINT, PROCESSING_QUEUE_URL, BEDROCK_REGION, REGION |
| chunking-methods-list | REGION |
| chunking-cleanup-trigger | CUSTOMERS_TABLE_NAME, DOCUMENTS_TABLE_NAME, KNOWLEDGE_BASE_ID, VECTOR_DB_ENDPOINT, PROCESSING_QUEUE_URL, BEDROCK_REGION, REGION |
| chunking-cleanup-status | CUSTOMERS_TABLE_NAME, REGION |
| chunk-visualization-get | CUSTOMERS_TABLE_NAME, DOCUMENTS_TABLE_NAME, BEDROCK_REGION, REGION |
| embeddings-generate | CUSTOMERS_TABLE_NAME, DOCUMENTS_TABLE_NAME, BEDROCK_REGION, VECTOR_DB_ENDPOINT, REGION |
| patient-list | SOURCE_BUCKET, REGION |
| patient-detail | SOURCE_BUCKET, REGION |
| claim-loader | SOURCE_BUCKET, DOCUMENTS_BUCKET, DOCUMENTS_TABLE_NAME, REGION |
| claim-status | DOCUMENTS_TABLE_NAME, REGION |

### S3 Event Notification

Configure S3 to trigger document processing on upload:

```typescript
documentsBucket.addEventNotification(
  s3.EventType.OBJECT_CREATED,
  new s3n.LambdaDestination(documentProcessingFunction),
  { prefix: 'uploads/' }
);
```

### Stack Outputs

```typescript
new cdk.CfnOutput(this, 'ApiGatewayUrl', {
  value: api.url,
  description: 'API Gateway URL',
  exportName: `${applicationName}-${environment}-api-url`
});

new cdk.CfnOutput(this, 'DocumentsBucketName', {
  value: documentsBucket.bucketName,
  description: 'S3 Documents Bucket Name',
  exportName: `${applicationName}-${environment}-documents-bucket`
});

new cdk.CfnOutput(this, 'ProcessingQueueUrl', {
  value: processingQueue.queueUrl,
  description: 'SQS Processing Queue URL',
  exportName: `${applicationName}-${environment}-processing-queue-url`
});

// ... additional outputs for all Lambda function ARNs
```

### Insurance Claim Portal Integration

The Insurance Claim Portal feature requires special handling for the external bucket:

```typescript
// Patient List and Detail functions
const patientListFunction = new lambda.Function(this, 'PatientListFunction', {
  // ... standard configuration
  environment: {
    SOURCE_BUCKET: 'medical-claims-synthetic-data-dev',
    REGION: this.region,
  },
});

// Claim Loader function
const claimLoaderFunction = new lambda.Function(this, 'ClaimLoaderFunction', {
  // ... standard configuration
  environment: {
    SOURCE_BUCKET: 'medical-claims-synthetic-data-dev',
    DOCUMENTS_BUCKET: documentsBucket.bucketName,
    DOCUMENTS_TABLE_NAME: documentsTable.tableName,
    REGION: this.region,
  },
});
```

The platform-provided IAM role must include permissions for the external bucket:

```json
{
  "Effect": "Allow",
  "Action": [
    "s3:GetObject",
    "s3:ListBucket"
  ],
  "Resource": [
    "arn:aws:s3:::medical-claims-synthetic-data-dev",
    "arn:aws:s3:::medical-claims-synthetic-data-dev/*"
  ]
}
```

### CORS Configuration

CORS will be configured on the API Gateway to support web applications:

```typescript
const corsOptions = {
  allowOrigins: apigateway.Cors.ALL_ORIGINS,
  allowMethods: apigateway.Cors.ALL_METHODS,
  allowHeaders: [
    'Content-Type',
    'X-Amz-Date',
    'Authorization',
    'X-Api-Key',
    'X-Tenant-Id',
    'Accept',
    'Origin',
    'Referer',
    'User-Agent'
  ],
  allowCredentials: false,
  maxAge: cdk.Duration.days(1),
};
```

### Error Handling

If SSM parameters are not found during deployment, the stack will fail with descriptive errors:

```typescript
if (!applicationRoleArn || applicationRoleArn === 'dummy-value-for-rag-app-dev-iam-application-role-arn') {
  throw new Error(
    `SSM parameter /rag-app/${environment}/iam/application-role-arn not found. ` +
    `Ensure platform infrastructure is deployed before application stack.`
  );
}
```

### Deployment Order

1. Platform team deploys platform infrastructure (DynamoDB, IAM, API Gateway, SSM parameters)
2. Development team deploys application stack (Lambda, S3, SQS, API routes)
3. Application stack imports platform resources via SSM
4. Application stack creates application-specific resources
5. Application stack adds routes to platform API Gateway

### Testing Strategy

1. **Unit Tests**: Update unit tests to mock imported resources
2. **Integration Tests**: Platform team validates end-to-end functionality
3. **Smoke Tests**: Verify all API endpoints respond correctly
4. **Data Migration**: No data migration needed (tables remain the same)

### Rollback Plan

If migration fails:
1. Revert to previous CDK stack version
2. Platform team can independently manage their infrastructure
3. No data loss (DynamoDB tables are platform-managed)
4. S3 bucket data can be copied if needed

### Security Considerations

1. **IAM Permissions**: Platform-provided role must include all necessary permissions
2. **SSM Access**: Application stack needs read access to SSM parameters
3. **API Gateway**: Cognito authorizer configuration managed by platform team
4. **S3 Encryption**: All buckets use S3-managed encryption
5. **SQS Encryption**: Queue uses SQS-managed encryption

### Performance Considerations

1. **SSM Lookups**: Performed at deployment time, not runtime (no performance impact)
2. **Lambda Cold Starts**: No change from current implementation
3. **API Gateway**: Shared API Gateway may have different throttling limits
4. **DynamoDB**: Platform-managed tables may have different capacity settings

### Monitoring and Observability

1. **CloudWatch Logs**: Lambda function logs remain in `/aws/lambda/{function-name}`
2. **CloudWatch Metrics**: Application-specific metrics for Lambda, S3, SQS
3. **X-Ray Tracing**: Can be enabled on Lambda functions
4. **API Gateway Metrics**: Managed by platform team

### Cost Implications

1. **Reduced Costs**: No longer paying for separate DynamoDB tables and API Gateway
2. **Shared Infrastructure**: Platform team manages capacity and scaling
3. **Application Resources**: Still pay for Lambda, S3, and SQS usage

## Migration Checklist

- [ ] Platform team deploys platform infrastructure with SSM parameters
- [ ] Verify SSM parameters exist in target environment
- [ ] Update CDK stack to import platform resources
- [ ] Rename stack from `RAGInfrastructureStack` to `RAGApplicationStack`
- [ ] Update all resource names from `rag-app-v2` to `rag-app`
- [ ] Remove DynamoDB table creation code
- [ ] Remove IAM role creation code
- [ ] Remove API Gateway creation code
- [ ] Add SSM parameter lookups
- [ ] Import platform resources using CDK constructs
- [ ] Create application-specific S3 bucket
- [ ] Create application-specific SQS queue
- [ ] Update all Lambda function environment variables
- [ ] Add API routes to imported API Gateway
- [ ] Configure S3 event notifications
- [ ] Update stack outputs
- [ ] Run CDK diff to verify changes
- [ ] Deploy to dev environment
- [ ] Run smoke tests on all API endpoints
- [ ] Verify document upload and processing
- [ ] Verify Insurance Claim Portal functionality
- [ ] Update unit tests
- [ ] Update documentation
- [ ] Deploy to staging environment
- [ ] Deploy to production environment

## Conclusion

This migration aligns the RAG application with the platform team's standardized architecture while maintaining all existing functionality. The clear separation between platform-provided and application-managed resources enables better governance, security, and operational efficiency.
