# Architecture Documentation

## System Overview

The Multi-Tenant Document Manager is a serverless application built on AWS that provides secure document upload, processing, and management capabilities for multiple tenants. The system integrates with the RAG (Retrieval-Augmented Generation) platform infrastructure to enable AI-powered document processing.

## Architecture Diagram

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────────┐
│   React App     │    │   API Gateway    │    │   Lambda Functions  │
│                 │    │                  │    │                     │
│ - Tenant Setup  │───▶│ - CORS Enabled   │───▶│ - Customer Manager  │
│ - File Upload   │    │ - Rate Limiting  │    │ - Document Upload   │
│ - Progress UI   │    │ - Authentication │    │ - Document Process  │
└─────────────────┘    └──────────────────┘    └─────────────────────┘
                                                          │
                       ┌─────────────────────────────────┼─────────────────────────────────┐
                       │                                 │                                 │
                       ▼                                 ▼                                 ▼
            ┌─────────────────┐              ┌─────────────────┐              ┌─────────────────┐
            │   DynamoDB      │              │   S3 Buckets    │              │   Textract      │
            │                 │              │                 │              │                 │
            │ - Customers     │              │ - Documents     │              │ - Text Extract  │
            │ - Documents     │              │ - Platform      │              │ - OCR Process   │
            │ - GSI Indexes   │              │ - Event Trigger │              │ - Retry Logic   │
            └─────────────────┘              └─────────────────┘              └─────────────────┘
                                                          │
                                                          ▼
                                             ┌─────────────────────────────────┐
                                             │     RAG Platform Services       │
                                             │                                 │
                                             │ - Bedrock Nova Pro             │
                                             │ - Vector Database (OpenSearch) │
                                             │ - Knowledge Base               │
                                             │ - Embedding Generation         │
                                             └─────────────────────────────────┘
```

## Component Architecture

### Frontend Layer (React Application)

**Technology Stack**:
- React 18 with TypeScript
- AWS Amplify UI Components
- Context API for state management

**Key Components**:
- **TenantSetup**: Handles tenant creation and joining
- **DocumentUpload**: File upload interface with drag-and-drop
- **AuthContext**: Manages tenant authentication state

**Responsibilities**:
- User interface for tenant management
- File selection and validation
- Progress tracking and error handling
- API communication with backend services

### API Layer (AWS API Gateway)

**Configuration**:
- REST API with CORS enabled
- Rate limiting and throttling
- Request/response transformation
- Integration with Lambda functions

**Security**:
- Cognito User Pool authorization (production)
- Header-based tenant identification (development)
- Input validation and sanitization

### Business Logic Layer (AWS Lambda)

#### Customer Manager Lambda
- **Runtime**: Node.js 18.x
- **Memory**: 256 MB
- **Timeout**: 30 seconds

**Responsibilities**:
- Customer creation and lookup
- Deterministic UUID generation
- Tenant isolation enforcement
- DynamoDB customer record management

#### Document Upload Lambda
- **Runtime**: Node.js 18.x
- **Memory**: 512 MB
- **Timeout**: 60 seconds

**Responsibilities**:
- File validation and processing
- S3 upload with metadata
- DynamoDB document record creation
- Base64 decoding and file handling

#### Document Processing Lambda
- **Runtime**: Node.js 18.x
- **Memory**: 1024 MB
- **Timeout**: 5 minutes

**Responsibilities**:
- S3 event-driven processing
- Textract integration for OCR
- Text extraction and processing
- Platform S3 bucket integration
- Error handling and retry logic

### Data Layer

#### DynamoDB Tables

**Customers Table**:
```
Partition Key: uuid (Customer UUID)
Attributes:
- tenantId (String) - For tenant isolation
- customerId (String) - Unique within tenant
- email (String) - Customer email
- createdAt (String) - ISO timestamp
- updatedAt (String) - ISO timestamp
- documentCount (Number) - Count of documents

Global Secondary Indexes:
- tenant-id-index: tenantId (PK), customerId (SK)
- email-index: email (PK)
```

**Documents Table**:
```
Partition Key: id (Document ID)
Sort Key: customerUuid (Customer UUID)
Attributes:
- tenantId (String) - For tenant isolation
- fileName (String) - Original filename
- s3Key (String) - S3 object key
- contentType (String) - MIME type
- processingStatus (String) - queued|processing|completed|failed
- extractedText (String) - Processed text content
- createdAt (String) - ISO timestamp
- updatedAt (String) - ISO timestamp

Global Secondary Indexes:
- tenant-documents-index: tenantId (PK), createdAt (SK)
```

#### S3 Storage

**Documents Bucket** (`rag-app-v2-documents-dev`):
- **Structure**: `uploads/{tenant_id}/{customer_uuid}/{document_id}/{filename}`
- **Encryption**: S3-managed encryption
- **Events**: Triggers document processing Lambda
- **Lifecycle**: Configurable retention policies

**Platform Integration**:
- **Processed Documents**: Uploaded to platform S3 bucket
- **Key Format**: `processed/{tenant_id}/{customer_uuid}/{document_id}.txt`
- **Metadata**: Original file information and processing timestamps

### Integration Layer

#### AWS Textract Integration
- **Service**: DetectDocumentText API
- **Supported Formats**: PDF, PNG, JPG, TIFF
- **Retry Strategy**: Exponential backoff (3 attempts)
- **Error Handling**: Graceful degradation with status tracking

#### RAG Platform Integration
- **Bedrock Nova Pro**: Text generation and reasoning
- **Vector Database**: OpenSearch Serverless for embeddings
- **Knowledge Base**: AWS Bedrock Knowledge Base service
- **Document Processing**: Automated embedding generation

## Multi-Tenant Architecture

### Tenant Isolation Strategy

**Application-Level Isolation**:
- All database queries filtered by `tenant_id`
- S3 object keys prefixed with tenant identifier
- Lambda functions enforce tenant context

**Data Isolation Mechanisms**:

1. **DynamoDB**:
   ```typescript
   // Query with tenant filtering
   const result = await dynamoClient.send(new QueryCommand({
     TableName: 'customers',
     IndexName: 'tenant-id-index',
     KeyConditionExpression: 'tenantId = :tenantId',
     ExpressionAttributeValues: { ':tenantId': tenantId }
   }));
   ```

2. **S3**:
   ```typescript
   // Tenant-specific S3 key structure
   const s3Key = `uploads/${tenantId}/${customerUUID}/${documentId}/${fileName}`;
   ```

3. **Aurora PostgreSQL** (Future):
   ```sql
   -- Row-level security policy
   CREATE POLICY tenant_isolation_policy ON customers
     FOR ALL TO application_role
     USING (tenant_id = current_setting('app.current_tenant_id'));
   ```

### Customer UUID Generation

**Deterministic UUID Strategy**:
```typescript
import { v5 as uuidv5 } from 'uuid';

const NAMESPACE_UUID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

function generateCustomerUUID(tenantId: string, customerId: string): string {
  return uuidv5(`${tenantId}:${customerId}`, NAMESPACE_UUID);
}
```

**Benefits**:
- Consistent UUIDs across requests
- No UUID collisions between tenants
- Enables efficient database queries
- Supports both DynamoDB and PostgreSQL

## Security Architecture

### Authentication & Authorization

**Development Environment**:
- Header-based tenant identification (`X-Tenant-Id`)
- No user authentication required
- Simplified for local testing

**Production Environment**:
- AWS Cognito User Pool integration
- JWT token-based authentication
- Tenant ID extracted from custom claims
- API Gateway Cognito authorizer

### Data Protection

**Encryption**:
- **In Transit**: HTTPS/TLS 1.2+ for all communications
- **At Rest**: 
  - S3: Server-side encryption (SSE-S3)
  - DynamoDB: AWS-managed encryption
  - Aurora: Encryption at rest with KMS

**Access Control**:
- **IAM Roles**: Least-privilege principle
- **Lambda Execution**: Scoped permissions per function
- **Cross-Service**: Service-to-service authentication

### Input Validation

**File Upload Security**:
- File type validation (whitelist approach)
- File size limits (configurable)
- Content type verification
- Malware scanning (future enhancement)

**API Security**:
- Request payload validation
- SQL injection prevention
- XSS protection through proper encoding
- Rate limiting and throttling

## Scalability & Performance

### Auto-Scaling Components

**Lambda Functions**:
- Automatic scaling based on request volume
- Concurrent execution limits configurable
- Cold start optimization through provisioned concurrency

**DynamoDB**:
- On-demand billing mode for automatic scaling
- Global Secondary Indexes for efficient queries
- Point-in-time recovery enabled

**API Gateway**:
- Built-in scaling and load balancing
- Caching capabilities for improved performance
- Request/response transformation

### Performance Optimizations

**Database Design**:
- Efficient GSI design for tenant-based queries
- Composite keys for optimal query patterns
- Minimal data duplication

**File Processing**:
- Asynchronous processing via S3 events
- Parallel processing for multiple documents
- Retry mechanisms for failed operations

**Frontend Optimizations**:
- Code splitting and lazy loading
- Optimized bundle sizes
- Progressive file upload with progress tracking

## Monitoring & Observability

### Logging Strategy

**Structured Logging**:
```typescript
console.log(JSON.stringify({
  timestamp: new Date().toISOString(),
  level: 'INFO',
  service: 'customer-manager',
  tenantId: tenantId,
  customerId: customerId,
  action: 'customer_created',
  message: 'Customer created successfully'
}));
```

**Log Aggregation**:
- CloudWatch Logs for centralized logging
- Log groups per Lambda function
- Retention policies for cost optimization

### Metrics & Alarms

**Key Metrics**:
- Lambda function duration and errors
- DynamoDB read/write capacity utilization
- S3 upload success/failure rates
- Textract processing times and errors

**Alerting**:
- CloudWatch Alarms for critical metrics
- SNS notifications for operational issues
- Dashboard for real-time monitoring

## Deployment Architecture

### Infrastructure as Code

**AWS CDK**:
- TypeScript-based infrastructure definitions
- Environment-specific configurations
- Parameterized deployments for platform integration

**CI/CD Pipeline**:
- External pipeline managed by platform team
- Automated testing and deployment
- Blue-green deployment strategy

### Environment Management

**Development**:
- Local CDK deployment
- Simplified authentication
- Debug logging enabled

**Production**:
- Platform team managed deployment
- Full Cognito integration
- Production-grade monitoring and alerting

## Future Enhancements

### Planned Features

1. **Advanced Document Processing**:
   - Form and table extraction with Textract
   - Multi-page document handling
   - Document classification and routing

2. **Enhanced Security**:
   - Document encryption with customer-managed keys
   - Audit logging and compliance reporting
   - Advanced threat detection

3. **Performance Improvements**:
   - Document preview generation
   - Caching layer for frequently accessed documents
   - Batch processing capabilities

4. **User Experience**:
   - Real-time processing status updates
   - Document search and filtering
   - Bulk upload capabilities

### Integration Roadmap

1. **RAG Platform Features**:
   - Direct integration with vector database
   - Custom embedding models
   - Advanced retrieval strategies

2. **Analytics & Insights**:
   - Document processing analytics
   - Usage metrics and reporting
   - Cost optimization recommendations

3. **Multi-Region Support**:
   - Cross-region replication
   - Disaster recovery capabilities
   - Global load balancing