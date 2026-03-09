# RAG Application Architecture

## Overview

The RAG Application follows a clear separation of concerns between platform-provided infrastructure and application-specific resources. This architecture enables centralized management of shared resources while allowing application teams to manage their own business logic and data processing pipelines.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    Platform-Managed Resources                    │
│                     (Managed by Platform Team)                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   DynamoDB   │  │   DynamoDB   │  │  API Gateway │          │
│  │  Customers   │  │  Documents   │  │   REST API   │          │
│  │    Table     │  │    Table     │  │              │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   IAM Role   │  │   Cognito    │  │     SSM      │          │
│  │  (Lambda)    │  │  User Pool   │  │  Parameters  │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ SSM Parameter Lookup
                              │ (Deployment Time)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Application-Managed Resources                   │
│                  (Managed by Development Team)                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  S3 Bucket   │  │  SQS Queue   │  │   Lambda     │          │
│  │  Documents   │  │  Processing  │  │  Functions   │          │
│  │              │  │              │  │   (18 total) │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                   │
│  ┌──────────────────────────────────────────────────┐           │
│  │           API Gateway Routes/Methods             │           │
│  │  (Added to platform-provided API Gateway)        │           │
│  └──────────────────────────────────────────────────┘           │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ AWS Service Calls
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      External AWS Services                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │   Bedrock    │  │   Textract   │  │  OpenSearch  │          │
│  │   Nova Pro   │  │              │  │  Serverless  │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

### Platform-Managed Resources

The platform team manages these resources centrally for all applications:

#### DynamoDB Tables
- **Customers Table** (`rag-app-customers-dev`)
  - Partition Key: `uuid`
  - GSI: `tenant-id-index` (tenantId, customerId)
  - GSI: `email-index` (email)
  - Purpose: Store customer metadata and tenant associations

- **Documents Table** (`rag-app-documents-dev`)
  - Partition Key: `id`
  - Sort Key: `customerUuid`
  - GSI: `tenant-documents-index` (tenantId, createdAt)
  - GSI: `customer-documents-index` (customerUuid, createdAt)
  - GSI: `claim-documents-index` (claimId, createdAt)
  - Purpose: Store document metadata and processing status

#### IAM Role
- **Application Role**: Centrally managed role with permissions for:
  - Bedrock: Model invocation and knowledge base access
  - Textract: Document text extraction
  - S3: Read/write access to application and external buckets
  - DynamoDB: Full access to platform tables
  - OpenSearch: Vector database operations
  - SQS: Queue operations
  - CloudWatch: Logging

#### API Gateway
- **REST API**: Shared API Gateway with:
  - Cognito authorizer for authentication
  - CORS configuration
  - CloudWatch logging
  - Throttling and rate limiting

#### Cognito User Pool
- **User Pool**: User authentication and authorization
- **Identity Pool**: AWS credential vending for authenticated users

#### SSM Parameter Store
- Configuration repository for resource identifiers
- Parameters follow pattern: `/rag-app/{environment}/{service}/{parameter}`

### Application-Managed Resources

The development team manages these application-specific resources:

#### S3 Bucket
- **Documents Bucket** (`rag-app-documents-dev`)
  - Purpose: Store uploaded documents
  - Encryption: S3-managed keys
  - CORS: Enabled for web uploads
  - Event Notifications: Trigger Lambda on object creation

#### SQS Queue
- **Processing Queue** (`rag-app-document-processing-dev`)
  - Purpose: Asynchronous document processing
  - Visibility Timeout: 900 seconds
  - Retention: 14 days
  - Encryption: SQS-managed keys

#### Lambda Functions (18 total)
1. **customer-manager**: Customer CRUD operations
2. **document-upload**: Handle document uploads
3. **document-processing**: Process documents with Textract
4. **document-summary**: Generate document summaries
5. **document-retry**: Retry failed processing
6. **document-delete**: Delete documents
7. **document-summary-selective**: Selective summarization
8. **chunking-config-get**: Get chunking configuration
9. **chunking-config-update**: Update chunking configuration
10. **chunking-methods-list**: List available chunking methods
11. **chunking-cleanup-trigger**: Trigger cleanup jobs
12. **chunking-cleanup-status**: Get cleanup job status
13. **chunk-visualization-get**: Visualize document chunks
14. **embeddings-generate**: Generate embeddings
15. **patient-list**: List patients (Insurance Claim Portal)
16. **patient-detail**: Get patient details
17. **claim-loader**: Load claim documents
18. **claim-status**: Get claim processing status

#### API Gateway Routes
Routes added to platform-provided API Gateway:
- `/customers` - Customer management
- `/documents` - Document operations
- `/chunking-methods` - Chunking configuration
- `/patients` - Insurance Claim Portal
- `/claims` - Claim processing

## Data Flow

### Document Upload Flow

```
1. User uploads document via API
   ↓
2. API Gateway (Platform) → document-upload Lambda
   ↓
3. Lambda validates request and creates metadata
   ↓
4. Document stored in S3 bucket (Application)
   ↓
5. S3 event triggers document-processing Lambda
   ↓
6. Lambda extracts text using Textract
   ↓
7. Text and embeddings stored in OpenSearch
   ↓
8. Metadata updated in DynamoDB (Platform)
```

### Multi-Tenant Query Flow

```
1. User makes API request with tenant context
   ↓
2. API Gateway (Platform) validates Cognito token
   ↓
3. Lambda function receives request
   ↓
4. Lambda queries DynamoDB with tenant filter
   ↓
5. Results filtered by tenantId for isolation
   ↓
6. Response returned to user
```

## Security Architecture

### Authentication & Authorization
- **Cognito User Pool**: User authentication
- **JWT Tokens**: API request authorization
- **Tenant Attributes**: Custom attributes for tenant context
- **API Gateway Authorizer**: Token validation

### Data Isolation
- **Tenant ID**: All data tagged with tenantId
- **GSI Indexes**: Efficient tenant-based queries
- **Lambda Validation**: Tenant context validation in all functions
- **Row-Level Security**: Enforced at application layer

### IAM Permissions
- **Least Privilege**: Platform role has minimal required permissions
- **Service-Specific**: Separate permissions for each AWS service
- **Resource-Based**: Policies scoped to specific resources
- **Audit Trail**: CloudTrail logging for all API calls

## Deployment Architecture

### CDK Stack Structure

```
RAGApplicationStack
├── SSM Parameter Lookups (Deployment Time)
│   ├── IAM Role ARN
│   ├── API Gateway ID
│   ├── DynamoDB Table Names
│   └── Root Resource ID
│
├── Resource Imports
│   ├── DynamoDB Tables (fromTableName)
│   ├── IAM Role (fromRoleArn)
│   └── API Gateway (fromRestApiAttributes)
│
├── Application Resources
│   ├── S3 Bucket
│   ├── SQS Queue
│   └── Lambda Functions
│
└── API Gateway Routes
    └── Methods added to imported API
```

### Environment Configuration

Configuration is managed through:
1. **SSM Parameters**: Platform resource identifiers
2. **CDK Parameters**: Service-specific configuration
3. **CDK Context**: Environment-specific values
4. **Lambda Environment Variables**: Runtime configuration

## Monitoring & Observability

### CloudWatch Logs
- Lambda function logs: `/aws/lambda/{function-name}`
- API Gateway logs: Managed by platform team
- Log retention: Configured per environment

### CloudWatch Metrics
- Lambda: Invocations, errors, duration, throttles
- API Gateway: Request count, latency, errors
- DynamoDB: Read/write capacity, throttles
- S3: Bucket size, request metrics
- SQS: Messages sent, received, deleted

### X-Ray Tracing
- Optional tracing for Lambda functions
- End-to-end request tracing
- Performance bottleneck identification

## Scalability

### Auto-Scaling
- **Lambda**: Automatic scaling up to account limits
- **DynamoDB**: On-demand billing mode (platform-managed)
- **API Gateway**: Automatic scaling with throttling
- **S3**: Unlimited storage capacity

### Performance Optimization
- **DynamoDB GSI**: Efficient tenant-based queries
- **Lambda Memory**: Optimized per function (256MB - 2048MB)
- **Lambda Timeout**: Configured per function (30s - 15min)
- **S3 Event Notifications**: Asynchronous processing

## Cost Optimization

### Shared Resources
- Platform-managed resources shared across applications
- Reduced operational overhead
- Centralized capacity planning

### Application Resources
- Pay-per-use Lambda pricing
- S3 storage costs based on usage
- SQS charges per message
- DynamoDB on-demand billing

## Disaster Recovery

### Backup Strategy
- **DynamoDB**: Point-in-time recovery (platform-managed)
- **S3**: Versioning enabled for document bucket
- **Lambda**: Code stored in version control
- **Infrastructure**: CDK code in Git repository

### Recovery Procedures
1. Platform team restores platform infrastructure
2. Development team redeploys application stack
3. S3 data recovered from versioning
4. DynamoDB data recovered from backups

## Future Enhancements

### Planned Improvements
- Multi-region deployment support
- Enhanced monitoring dashboards
- Automated testing pipeline
- Performance optimization
- Cost allocation tagging
