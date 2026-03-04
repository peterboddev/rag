# Design Document: Insurance Claim Portal Enhancement

## 1. System Architecture

### 1.1 Overview

The Insurance Claim Portal is an **enhancement to the existing Multi-Tenant Document Manager** that adds medical claims-specific functionality. It leverages the existing RAG infrastructure (document processing, embedding generation, summarization, vector storage) and adds new capabilities for loading synthetic patient data from S3 and providing claims-specific UI views.

**IMPORTANT**: This is NOT a separate project. It extends the existing `multi-tenant-document-manager` codebase with:
- New Lambda functions for patient/claim data loading
- New frontend pages for claims-specific views
- Extended DynamoDB schema for claim metadata
- Reuse of ALL existing RAG infrastructure

### 1.2 What Already Exists (Reuse)

The existing Multi-Tenant Document Manager already provides:

**✅ Document Processing Pipeline:**
- `document-processing.ts` - Textract extraction, text storage
- `enhanced-textract.ts` - Advanced PDF processing
- S3 event triggers for automatic processing

**✅ Embedding Generation:**
- `embedding-generation.ts` - Bedrock Titan Embed integration
- `chunking-configuration.ts` - Configurable chunking methods
- OpenSearch vector storage

**✅ RAG Summarization:**
- `document-summary.ts` - Bedrock Nova Pro summarization
- `token-aware-summarization.ts` - Token management
- `document-summary-selective.ts` - Selective document summarization

**✅ Frontend Infrastructure:**
- React app with authentication
- Document upload and viewing
- Summary display panels
- Chunk visualization

**✅ Infrastructure:**
- DynamoDB tables (customers, documents)
- S3 buckets for document storage
- Lambda functions with proper IAM roles
- API Gateway with CORS

### 1.3 What Needs to Be Added (New)

**NEW: Patient/Claim Data Loading:**
- `patient-list.ts` - Read patients from medical-claims-synthetic-data-dev
- `claim-loader.ts` - Copy claim documents to existing document bucket

**NEW: Frontend Pages:**
- Patient list page (reuse existing DocumentItem components)
- Claim detail page (reuse existing DocumentSummary components)

**NEW: DynamoDB Schema Extensions:**
- Add claim-specific metadata fields to existing documents table
- Track patient-to-claim associations

### 1.4 Data Flow Architecture

```
S3 Source Bucket (medical-claims-synthetic-data-dev)
    ↓
NEW: Patient List Lambda (reads patient directories)
    ↓
NEW: Claim Loader Lambda (copies to existing bucket)
    ↓
EXISTING: Document Processing (document-processing.ts)
    ↓
EXISTING: Embedding Generation (embedding-generation.ts)
    ↓
EXISTING: OpenSearch Vector Store
    ↓
EXISTING: RAG Summarization (document-summary.ts)
    ↓
NEW: Claims-specific Frontend Pages
```

### 1.5 Component Architecture

#### NEW Backend Components
- **Patient Listing Lambda** (`patient-list.ts`): Lists patients from S3 source bucket
- **Claim Loader Lambda** (`claim-loader.ts`): Loads claim documents from S3 and copies to existing document bucket

#### EXISTING Backend Components (Reused)
- **Document Processing Lambda** (`document-processing.ts`): Textract extraction
- **Document Summary Lambda** (`document-summary.ts`): RAG-based summarization
- **Embedding Generation Service** (`embedding-generation.ts`): Vector generation
- **Chunking Configuration Service** (`chunking-configuration.ts`): Chunking methods

#### NEW Frontend Components
- **Patient List View**: Displays available patients (reuses DocumentItem styling)
- **Claim Detail View**: Shows claim documents and metadata (reuses DocumentSummary)

#### EXISTING Frontend Components (Reused)
- **DocumentSummary**: AI-generated summaries
- **DocumentUpload**: File upload functionality
- **ChunkVisualizationPanel**: Chunk display
- **DocumentSelectionPanel**: Document selection

#### EXISTING Storage Components (Reused)
- **DynamoDB Tables**: customers, documents (extend with claim fields)
- **S3 Buckets**: rag-app-v2-documents-dev (existing)
- **OpenSearch Collection**: Existing vector database


## 2. Data Model

### 2.1 S3 Source Bucket Structure (Read-Only)

```
medical-claims-synthetic-data-dev/
├── patients/
│   ├── TCIA-{ID}/
│   │   ├── claims/
│   │   │   ├── cms1500_claim_{id}.pdf
│   │   │   ├── cms1500_claim_{id}.txt
│   │   │   ├── eob_{id}.pdf
│   │   │   ├── eob_{id}.txt
│   │   │   ├── radiology_report_{id}.pdf
│   │   │   └── radiology_report_{id}.txt
│   │   └── clinical-notes/
│   │       ├── clinical_note_{date}.pdf
│   │       └── clinical_note_{date}.txt
├── mapping.json
└── statistics.json
```

### 2.2 DynamoDB Schema Extensions

#### EXISTING: Customers Table (rag-app-v2-customers-dev)
**No changes needed** - existing schema supports claims use case

```typescript
{
  uuid: string,              // Customer UUID (primary key)
  tenantId: string,          // Tenant isolation
  customerId: string,        // Customer ID
  email: string,             // Customer email
  name: string,              // Customer name
  createdAt: string,
  updatedAt: string
}
```

#### EXISTING: Documents Table (rag-app-v2-documents-dev)
**EXTEND with new optional fields** for claims:

```typescript
{
  // EXISTING FIELDS (keep all)
  id: string,                // Document ID (primary key)
  customerUuid: string,      // Sort key
  tenantId: string,
  fileName: string,
  contentType: string,
  s3Key: string,
  processingStatus: string,
  extractedText?: string,
  textLength?: number,
  createdAt: string,
  updatedAt: string,
  
  // NEW OPTIONAL FIELDS for claims
  claimMetadata?: {
    patientId: string,           // TCIA patient ID
    patientName: string,         // From mapping.json
    tciaCollectionId: string,    // TCIA imaging collection
    claimId: string,             // Claim identifier
    documentType: "CMS1500" | "EOB" | "Clinical Note" | "Radiology Report",
    filingDate?: string,
    primaryDiagnosis?: string,
    claimedAmount?: number,
    approvedAmount?: number
  }
}
```

**GSI Addition** (if needed for claim queries):
- Index name: `claim-documents-index`
- Partition key: `claimMetadata.claimId`
- Sort key: `createdAt`

### 2.3 OpenSearch Index Schema

**EXISTING schema already supports claims** - no changes needed. The existing vector index already has:
- `documentId`, `tenantId` for filtering
- `text` and `embedding` for RAG
- `metadata` for custom fields

Claims-specific metadata will be stored in DynamoDB, not OpenSearch.


## 3. API Design

### 3.1 NEW REST Endpoints (Add to Existing API Gateway)

#### Patient Management (NEW)

**GET /api/patients**
- Lists all patients from S3 source bucket
- Query params: `limit`, `nextToken` (pagination)
- Response: `{ patients: Array<PatientSummary>, nextToken?: string }`

**GET /api/patients/{patientId}**
- Retrieves patient details and associated claims
- Response: `{ patient: PatientDetail, claims: Array<ClaimSummary> }`

#### Claim Management (NEW)

**GET /api/claims/{claimId}**
- Retrieves claim details and documents from existing documents table
- Response: `{ claim: ClaimDetail, documents: Array<DocumentInfo> }`

**POST /api/claims/{claimId}/load**
- Loads claim documents from S3 source to existing documents bucket
- Triggers existing document processing pipeline
- Response: `{ jobId: string, status: string }`

**GET /api/claims/{claimId}/status**
- Retrieves claim processing status from existing documents table
- Response: `{ status: string, documentsProcessed: number, totalDocuments: number }`

### 3.2 EXISTING Endpoints (Reused)

**POST /documents** - Upload documents (already exists)
**POST /documents/summary** - Generate summary (already exists, works for claims)
**POST /documents/summary/selective** - Selective summary (already exists)
**POST /documents/chunks/visualization** - Chunk visualization (already exists)
**POST /documents/embeddings/generate** - Generate embeddings (already exists)

### 3.3 Authentication

**EXISTING authentication mechanism** - no changes needed:
- Authorization header: `Bearer {jwt_token}`
- Token validation performed by existing API Gateway authorizer
- User tenant ID extracted from JWT claims


## 4. Implementation Details

### 4.1 NEW: Patient Listing Service

**Lambda: patient-list.ts** (NEW)

```typescript
// Reads patient directories from S3 source bucket
// Parses mapping.json for patient metadata
// Returns paginated list of patients

Key Functions:
- listPatientDirectories(): Lists patients/ prefix in S3
- loadPatientMapping(): Reads and parses mapping.json
- enrichPatientData(): Combines directory listing with mapping data
```

**S3 Operations:**
- Read: `s3://medical-claims-synthetic-data-dev/patients/`
- Read: `s3://medical-claims-synthetic-data-dev/mapping.json`

### 4.2 NEW: Claim Loader Service

**Lambda: claim-loader.ts** (NEW)

```typescript
// Copies documents from source bucket to existing documents bucket
// Creates records in EXISTING documents table with claim metadata
// Triggers EXISTING document processing pipeline

Key Functions:
- loadClaimDocuments(patientId, claimId): Copies claim files
- copyToDocumentsBucket(sourceKey, destKey): S3 copy operation
- createDocumentRecord(documentData): DynamoDB write to EXISTING documents table
- triggerProcessing(documentId): S3 event triggers EXISTING document-processing.ts
```

**S3 Operations:**
- Read: `s3://medical-claims-synthetic-data-dev/patients/{patientId}/claims/*`
- Read: `s3://medical-claims-synthetic-data-dev/patients/{patientId}/clinical-notes/*`
- Write: `s3://rag-app-v2-documents-dev/uploads/{tenantId}/{customerUuid}/*`

**DynamoDB Operations:**
- Write: EXISTING documents table (with new claimMetadata field)

**Integration:**
- S3 write to `uploads/` prefix triggers EXISTING `document-processing.ts` Lambda
- No new processing logic needed - reuse existing pipeline

### 4.3 EXISTING: Document Processing Pipeline (Reused)

**Lambda: document-processing.ts** (NO CHANGES)

The existing document processing Lambda already handles:
- Text extraction with Textract
- Text storage in DynamoDB
- S3 event triggers

Claims documents will flow through this existing pipeline automatically when copied to the `uploads/` prefix.

### 4.4 EXISTING: Embedding Generation (Reused)

**Service: embedding-generation.ts** (NO CHANGES)

The existing embedding service already handles:
- Chunking with configurable methods
- Bedrock Titan Embed API calls
- OpenSearch vector storage

Claims documents will use the existing chunking configuration.

### 4.5 EXISTING: Claim Summary Service (Reused)

**Lambda: document-summary.ts** (NO CHANGES)

The existing summary Lambda already provides:
- RAG-based summarization with Bedrock Nova Pro
- Token-aware content processing
- Multi-document summarization

To generate claim summaries:
1. Query documents table by customerUuid (patient)
2. Filter by claimMetadata.claimId
3. Call existing `/documents/summary` endpoint

### 4.6 EXISTING: Document Upload Service (Reused)

**Lambda: document-upload.ts** (NO CHANGES)

The existing upload Lambda already handles:
- Multipart file uploads
- Format validation
- S3 storage
- Processing pipeline trigger

Additional claim documents can be uploaded using the existing endpoint.


## 5. Frontend Design

### 5.1 Component Hierarchy (NEW + EXISTING)

```
App (EXISTING)
├── AuthProvider (EXISTING - Cognito authentication)
├── Router (EXISTING)
│   ├── EXISTING PAGES:
│   │   ├── TenantSetup (existing)
│   │   ├── DocumentUpload (existing)
│   │   └── DocumentSummary (existing)
│   ├── NEW PAGES:
│   │   ├── PatientListPage (NEW)
│   │   │   ├── PatientListTable (NEW - reuse DocumentItem styling)
│   │   │   └── PatientSearchBar (NEW)
│   │   └── ClaimDetailPage (NEW)
│   │       ├── ClaimHeader (NEW)
│   │       ├── DocumentSummary (EXISTING - reused)
│   │       ├── DocumentSelectionPanel (EXISTING - reused)
│   │       └── ClaimStatusBadge (NEW)
```

### 5.2 NEW Frontend Components

#### PatientListPage (NEW)
- Displays paginated list of patients from S3
- Shows patient ID, name, claim count
- Supports search/filter by patient ID or name
- Click to navigate to patient's claims
- **Reuses**: DocumentItem component styling

#### ClaimDetailPage (NEW)
- Displays claim metadata and status
- Shows AI-generated summary using EXISTING DocumentSummary component
- Lists all claim documents using EXISTING DocumentSelectionPanel
- Shows processing status for each document
- **Reuses**: DocumentSummary, DocumentSelectionPanel, DocumentUpload

#### ClaimStatusBadge (NEW)
- Simple status indicator component
- Shows claim processing status with color coding

### 5.3 EXISTING Components (Reused)

#### DocumentSummary (EXISTING - NO CHANGES)
- Already displays AI-generated summaries
- Already shows loading state
- Already handles errors with retry
- Works perfectly for claim summaries

#### DocumentSelectionPanel (EXISTING - NO CHANGES)
- Already groups documents by type
- Already shows document count per category
- Already provides download/view actions
- Works perfectly for claim documents

#### DocumentUpload (EXISTING - NO CHANGES)
- Already handles file uploads
- Already validates formats
- Already triggers processing
- Works for additional claim documents

### 5.4 State Management (EXISTING)

**React Context (NO CHANGES):**
- AuthContext: User authentication state (existing)
- Use existing patterns for claim state

**API Integration (EXISTING):**
- Axios for HTTP requests (existing)
- React Query for caching (existing)
- Automatic retry with exponential backoff (existing)


## 6. Infrastructure (AWS CDK)

### 6.1 CDK Stack Structure

```typescript
// infrastructure/insurance-claim-portal-stack.ts

export class InsuranceClaimPortalStack extends Stack {
  constructor(scope: Construct, id: string, props: StackProps) {
    // Parameters
    const apiGatewayId = new CfnParameter(this, 'ApiGatewayId', {
      type: 'String',
      description: 'API Gateway ID from platform team'
    });

    // DynamoDB Tables
    const claimsTable = new Table(this, 'ClaimsTable', {
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      sortKey: { name: 'SK', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED
    });

    const documentStatusTable = new Table(this, 'DocumentStatusTable', {
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      sortKey: { name: 'SK', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.AWS_MANAGED
    });

    // Lambda Functions
    const patientListLambda = new NodejsFunction(this, 'PatientListLambda', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: 'src/lambda/patient-list.ts',
      environment: {
        SOURCE_BUCKET: 'medical-claims-synthetic-data-dev',
        CLAIMS_TABLE: claimsTable.tableName
      }
    });

    const claimLoaderLambda = new NodejsFunction(this, 'ClaimLoaderLambda', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: 'src/lambda/claim-loader.ts',
      timeout: Duration.minutes(5),
      environment: {
        SOURCE_BUCKET: 'medical-claims-synthetic-data-dev',
        PLATFORM_BUCKET: 'rag-app-v2-documents-dev',
        CLAIMS_TABLE: claimsTable.tableName,
        DOCUMENT_STATUS_TABLE: documentStatusTable.tableName
      }
    });

    const documentProcessorLambda = new NodejsFunction(this, 'DocumentProcessorLambda', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: 'src/lambda/document-processor.ts',
      timeout: Duration.minutes(15),
      memorySize: 1024,
      environment: {
        PLATFORM_BUCKET: 'rag-app-v2-documents-dev',
        VECTOR_DB_ENDPOINT: process.env.VECTOR_DB_ENDPOINT!,
        DOCUMENT_STATUS_TABLE: documentStatusTable.tableName
      }
    });

    const claimSummaryLambda = new NodejsFunction(this, 'ClaimSummaryLambda', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler',
      entry: 'src/lambda/claim-summary.ts',
      timeout: Duration.seconds(30),
      memorySize: 512,
      environment: {
        VECTOR_DB_ENDPOINT: process.env.VECTOR_DB_ENDPOINT!,
        CLAIMS_TABLE: claimsTable.tableName
      }
    });

    // IAM Permissions
    // S3 read access to source bucket
    patientListLambda.addToRolePolicy(new PolicyStatement({
      actions: ['s3:GetObject', 's3:ListBucket'],
      resources: [
        'arn:aws:s3:::medical-claims-synthetic-data-dev',
        'arn:aws:s3:::medical-claims-synthetic-data-dev/*'
      ]
    }));

    // S3 read/write access to platform bucket
    claimLoaderLambda.addToRolePolicy(new PolicyStatement({
      actions: ['s3:GetObject', 's3:PutObject', 's3:CopyObject'],
      resources: [
        'arn:aws:s3:::medical-claims-synthetic-data-dev/*',
        'arn:aws:s3:::rag-app-v2-documents-dev/*'
      ]
    }));

    // Textract permissions
    documentProcessorLambda.addToRolePolicy(new PolicyStatement({
      actions: ['textract:DetectDocumentText', 'textract:AnalyzeDocument'],
      resources: ['*']
    }));

    // Bedrock permissions
    [documentProcessorLambda, claimSummaryLambda].forEach(lambda => {
      lambda.addToRolePolicy(new PolicyStatement({
        actions: ['bedrock:InvokeModel'],
        resources: [
          'arn:aws:bedrock:*::foundation-model/amazon.titan-embed-text-v1',
          'arn:aws:bedrock:*::foundation-model/amazon.nova-pro-v1:0'
        ]
      }));
    });

    // DynamoDB permissions
    claimsTable.grantReadWriteData(patientListLambda);
    claimsTable.grantReadWriteData(claimLoaderLambda);
    claimsTable.grantReadData(claimSummaryLambda);
    documentStatusTable.grantReadWriteData(claimLoaderLambda);
    documentStatusTable.grantReadWriteData(documentProcessorLambda);

    // API Gateway Integration (methods added to existing gateway)
    const api = RestApi.fromRestApiId(this, 'Api', apiGatewayId.valueAsString);
    
    // Add API methods (platform team manages deployment)
    const patientsResource = api.root.addResource('patients');
    patientsResource.addMethod('GET', new LambdaIntegration(patientListLambda));
    
    const claimsResource = api.root.addResource('claims');
    const claimResource = claimsResource.addResource('{claimId}');
    claimResource.addResource('summary').addMethod('POST', 
      new LambdaIntegration(claimSummaryLambda));
  }
}
```


### 6.2 Environment Configuration

**Environment Variables (from Platform Team):**
```bash
# Retrieved from CloudFormation/SSM Parameter Store
VECTOR_DB_ENDPOINT=[Retrieved from: rag-app-v2-dev-vector-db-endpoint]
KNOWLEDGE_BASE_ID=[Retrieved from: rag-app-v2-dev-knowledge-base-id]
USER_POOL_ID=[Retrieved from: rag-app-v2-dev-cognito-user-pool-id]
USER_POOL_CLIENT_ID=[Retrieved from: rag-app-v2-dev-cognito-client-id]

# Application-specific
SOURCE_BUCKET=medical-claims-synthetic-data-dev
PLATFORM_BUCKET=rag-app-v2-documents-dev
```

**CDK Parameters:**
- API Gateway ID (provided by platform team)
- Environment name (dev, staging, prod)
- Region (us-east-1)

### 6.3 Resource Naming Convention

```
insurance-claim-portal-{resource}-{environment}

Examples:
- insurance-claim-portal-claims-table-dev
- insurance-claim-portal-patient-list-lambda-dev
- insurance-claim-portal-document-status-table-dev
```


## 7. Security Design

### 7.1 Authentication and Authorization

**Cognito Integration:**
- User authentication via AWS Cognito User Pool
- JWT tokens issued on successful login
- API Gateway Cognito authorizer validates tokens
- Tenant ID extracted from JWT custom claims

**Authorization Flow:**
```
1. User logs in → Cognito issues JWT
2. Frontend stores JWT in secure storage
3. API requests include Authorization header
4. API Gateway validates JWT with Cognito
5. Lambda extracts tenantId from JWT claims
6. All queries filtered by tenantId
```

### 7.2 Data Isolation

**Multi-Tenant Strategy:**
- Tenant ID stored in all DynamoDB records
- OpenSearch queries filtered by tenantId
- S3 objects organized by tenant prefix
- Lambda functions enforce tenant filtering

**DynamoDB Access Pattern:**
```typescript
// All queries must include tenant filter
const params = {
  TableName: claimsTable,
  KeyConditionExpression: 'PK = :pk AND SK = :sk',
  FilterExpression: 'tenantId = :tenantId',
  ExpressionAttributeValues: {
    ':pk': `PATIENT#${patientId}`,
    ':sk': `CLAIM#${claimId}`,
    ':tenantId': userTenantId
  }
};
```

### 7.3 S3 Security

**Bucket Policies:**
- Source bucket (medical-claims-synthetic-data-dev): Read-only access
- Platform bucket (rag-app-v2-documents-dev): Read-write with tenant prefix
- All objects encrypted at rest (AES-256)
- Presigned URLs for document downloads (5-minute expiry)

**IAM Least Privilege:**
- Lambda execution roles scoped to specific buckets
- No wildcard permissions on production resources
- Separate roles for read vs. read-write operations

### 7.4 API Security

**Rate Limiting:**
- API Gateway throttling: 1000 requests/second per tenant
- Burst limit: 2000 requests
- Per-user rate limiting via Cognito user ID

**Input Validation:**
- All inputs validated against schemas
- File uploads scanned for malware (future enhancement)
- SQL injection prevention (parameterized queries)
- XSS prevention (output encoding)

**CORS Configuration:**
```typescript
{
  allowOrigins: ['https://insurance-portal.example.com'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowHeaders: ['Content-Type', 'Authorization'],
  allowCredentials: true
}
```


## 8. Performance Optimization

### 8.1 Caching Strategy

**Summary Caching:**
- Cache generated summaries in DynamoDB for 5 minutes
- Cache key: `SUMMARY#{claimId}#{timestamp}`
- Invalidate on document updates

**Patient List Caching:**
- Cache patient list in Lambda memory (warm start)
- Refresh every 10 minutes
- Reduces S3 ListObjects calls

**Document Metadata Caching:**
- DynamoDB stores processed document metadata
- Avoid repeated S3 head object calls
- Update cache on processing completion

### 8.2 Lambda Optimization

**Memory Allocation:**
- Patient List: 256 MB (I/O bound)
- Claim Loader: 512 MB (S3 copy operations)
- Document Processor: 1024 MB (Textract processing)
- Claim Summary: 512 MB (Bedrock API calls)
- Search: 512 MB (OpenSearch queries)

**Timeout Configuration:**
- Patient List: 30 seconds
- Claim Loader: 5 minutes (bulk copy)
- Document Processor: 15 minutes (Textract async)
- Claim Summary: 30 seconds
- Search: 10 seconds

**Provisioned Concurrency:**
- Claim Summary Lambda: 2 instances (high traffic)
- Other Lambdas: On-demand scaling

### 8.3 Database Optimization

**DynamoDB:**
- On-demand billing mode (variable traffic)
- GSI for querying by tenantId + status
- Composite sort keys for efficient range queries

**OpenSearch:**
- Index sharding: 2 primary shards, 1 replica
- Refresh interval: 5 seconds
- Approximate kNN for faster searches (trade accuracy for speed)

### 8.4 Batch Processing

**Document Loading:**
- Process up to 10 documents in parallel
- Use Promise.all for concurrent S3 copies
- Batch DynamoDB writes (up to 25 items)

**Embedding Generation:**
- Batch embed requests (up to 5 chunks per request)
- Parallel processing of independent documents
- Queue-based processing for large batches


## 9. Error Handling and Resilience

### 9.1 Error Categories

**Transient Errors:**
- AWS service throttling
- Network timeouts
- Temporary service unavailability

**Permanent Errors:**
- Invalid document format
- Missing S3 objects
- Malformed data

**Business Logic Errors:**
- Claim not found
- Unauthorized access
- Invalid state transitions

### 9.2 Retry Strategy

**Exponential Backoff:**
```typescript
const retryConfig = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
  backoffMultiplier: 2
};

// Retry logic for transient errors
async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig
): Promise<T> {
  let lastError: Error;
  for (let attempt = 0; attempt < config.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error)) throw error;
      
      const delay = Math.min(
        config.baseDelay * Math.pow(config.backoffMultiplier, attempt),
        config.maxDelay
      );
      await sleep(delay);
    }
  }
  throw lastError;
}
```

**Circuit Breaker:**
- Bedrock API calls protected by circuit breaker
- Open circuit after 5 consecutive failures
- Half-open state after 30 seconds
- Close circuit after 2 successful calls

### 9.3 Fallback Mechanisms

**Summary Generation Failure:**
- Return cached summary if available
- Provide basic metadata summary (dates, amounts, providers)
- Display error message with retry option

**Search Failure:**
- Fall back to DynamoDB metadata search
- Return recently accessed documents
- Display degraded service notice

**Document Processing Failure:**
- Mark document as failed in status table
- Store error message for debugging
- Provide manual retry option
- Alert on repeated failures

### 9.4 Monitoring and Alerting

**CloudWatch Metrics:**
- Lambda invocation count and duration
- Error rate by function
- Bedrock API latency and token usage
- OpenSearch query performance
- S3 operation latency

**CloudWatch Alarms:**
- Error rate > 5% for 5 minutes
- Lambda duration > p99 threshold
- DynamoDB throttling events
- Bedrock API errors

**Logging Strategy:**
```typescript
// Structured logging for all operations
logger.info('Processing claim', {
  claimId,
  patientId,
  tenantId,
  documentCount,
  operation: 'claim-load'
});

logger.error('Document processing failed', {
  documentId,
  claimId,
  error: error.message,
  stack: error.stack,
  operation: 'textract-extract'
});
```


## 10. Testing Strategy

### 10.1 Unit Tests

**Lambda Function Tests:**
```typescript
// unit_tests/patient-list.test.ts
describe('PatientListLambda', () => {
  it('should list patients from S3 bucket', async () => {
    // Mock S3 client
    const mockS3 = mockClient(S3Client);
    mockS3.on(ListObjectsV2Command).resolves({
      Contents: [
        { Key: 'patients/TCIA-001/' },
        { Key: 'patients/TCIA-002/' }
      ]
    });
    
    const result = await handler(mockEvent);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).patients).toHaveLength(2);
  });
  
  it('should handle S3 errors gracefully', async () => {
    const mockS3 = mockClient(S3Client);
    mockS3.on(ListObjectsV2Command).rejects(new Error('Access Denied'));
    
    const result = await handler(mockEvent);
    expect(result.statusCode).toBe(500);
  });
});

// unit_tests/claim-summary.test.ts
describe('ClaimSummaryLambda', () => {
  it('should generate summary from retrieved documents', async () => {
    // Mock OpenSearch and Bedrock
    const mockDocuments = [
      { text: 'Patient diagnosed with...', type: 'Clinical Note' },
      { text: 'Claim amount: $5000', type: 'CMS1500' }
    ];
    
    mockOpenSearch.search.mockResolvedValue({ hits: mockDocuments });
    mockBedrock.invokeModel.mockResolvedValue({ body: 'Summary text' });
    
    const result = await handler({ claimId: 'claim-123' });
    expect(result.summary).toBeDefined();
    expect(result.sources).toHaveLength(2);
  });
});
```

**Service Layer Tests:**
```typescript
// unit_tests/document-processor.test.ts
describe('DocumentProcessor', () => {
  it('should chunk text into 8000 character segments', () => {
    const longText = 'a'.repeat(20000);
    const chunks = chunkText(longText);
    
    expect(chunks).toHaveLength(3);
    expect(chunks[0].length).toBeLessThanOrEqual(8000);
  });
  
  it('should preserve document relationships in chunks', () => {
    const text = 'Document content';
    const chunks = chunkText(text, { documentId: 'doc-1' });
    
    chunks.forEach(chunk => {
      expect(chunk.metadata.documentId).toBe('doc-1');
    });
  });
});
```

### 10.2 Frontend Tests

**Component Tests:**
```typescript
// frontend/src/components/__tests__/ClaimSummaryPanel.test.tsx
describe('ClaimSummaryPanel', () => {
  it('should display loading state while generating summary', () => {
    render(<ClaimSummaryPanel claimId="claim-1" loading={true} />);
    expect(screen.getByText(/generating/i)).toBeInTheDocument();
  });
  
  it('should display summary when loaded', () => {
    const summary = 'Patient diagnosed with cancer...';
    render(<ClaimSummaryPanel claimId="claim-1" summary={summary} />);
    expect(screen.getByText(summary)).toBeInTheDocument();
  });
  
  it('should handle error state', () => {
    render(<ClaimSummaryPanel claimId="claim-1" error="Failed to generate" />);
    expect(screen.getByText(/failed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
```

### 10.3 Integration Tests (Platform Team)

**End-to-End Workflows:**
- Load patient data from S3
- Process documents through pipeline
- Generate embeddings and store in OpenSearch
- Generate claim summary
- Perform semantic search

**Performance Tests:**
- Load testing with 50 concurrent users
- Document processing throughput
- Summary generation latency
- Search query performance


## 11. Deployment Strategy

### 11.1 CI/CD Pipeline

**Build Phase:**
1. Install dependencies (npm install)
2. Run TypeScript compilation
3. Run unit tests (unit_tests/)
4. Run linting and code quality checks
5. Build frontend (React production build)

**Deploy Phase:**
1. CDK synthesize CloudFormation templates
2. Platform team reviews changes
3. Deploy to dev environment
4. Run integration tests (platform team)
5. Deploy to staging (manual approval)
6. Deploy to production (manual approval)

### 11.2 Environment Progression

**Development (dev):**
- Automatic deployment on merge to main
- Uses dev configuration
- Limited data set (10 patients)
- No SLA requirements

**Staging:**
- Manual deployment trigger
- Production-like configuration
- Full synthetic data set (100 patients)
- Performance testing environment

**Production:**
- Manual deployment with approval
- Production configuration
- Full monitoring and alerting
- SLA: 99.9% uptime

### 11.3 Rollback Strategy

**Automated Rollback Triggers:**
- Error rate > 10% for 5 minutes
- Lambda timeout rate > 5%
- Critical alarm triggered

**Manual Rollback:**
- CloudFormation stack rollback
- Previous Lambda version promotion
- Database migration rollback (if needed)

### 11.4 Database Migrations

**DynamoDB Schema Changes:**
- Backward compatible changes only
- Add new attributes (don't remove)
- Use default values for new fields
- Migrate data in background job

**OpenSearch Index Changes:**
- Create new index with updated mapping
- Reindex data from old to new index
- Switch alias to new index
- Delete old index after verification


## 12. Cost Estimation

### 12.1 AWS Service Costs (Monthly, Dev Environment)

**Lambda:**
- Invocations: ~100,000/month
- Duration: Average 2 seconds
- Memory: Average 512 MB
- Estimated cost: $5-10/month

**DynamoDB:**
- On-demand pricing
- Read/Write requests: ~50,000/month
- Storage: ~1 GB
- Estimated cost: $2-5/month

**S3:**
- Storage: ~10 GB (platform bucket)
- GET requests: ~10,000/month
- PUT requests: ~1,000/month
- Estimated cost: $1-2/month

**Textract:**
- Pages processed: ~500/month
- DetectDocumentText: $1.50 per 1,000 pages
- Estimated cost: $1/month

**Bedrock:**
- Nova Pro: ~100,000 input tokens, ~10,000 output tokens
- Titan Embed: ~500,000 tokens
- Estimated cost: $15-20/month

**OpenSearch Serverless:**
- OCU hours: ~720 hours/month (1 OCU)
- Estimated cost: $700/month (largest cost component)

**API Gateway:**
- Requests: ~100,000/month
- Estimated cost: $0.35/month

**Total Estimated Monthly Cost (Dev): ~$725-740**

### 12.2 Cost Optimization Strategies

**Reduce OpenSearch Costs:**
- Use smaller OCU allocation during off-hours
- Implement aggressive caching
- Consider Aurora Serverless for metadata queries

**Reduce Bedrock Costs:**
- Cache summaries for 5 minutes
- Implement prompt optimization (fewer tokens)
- Use smaller context windows when possible

**Reduce Lambda Costs:**
- Right-size memory allocation
- Optimize cold start times
- Use provisioned concurrency only for critical functions

**Reduce Textract Costs:**
- Process only new documents
- Use text files from S3 when available (avoid PDF processing)
- Batch processing to reduce API calls


## 13. Future Enhancements

### 13.1 Phase 2 Features

**Advanced Analytics:**
- Claim approval prediction using ML
- Fraud detection patterns
- Cost trend analysis
- Provider performance metrics

**Enhanced Multi-Modal:**
- Direct DICOM image viewing in browser
- Image annotation and markup
- AI-powered image analysis (tumor detection)
- Correlation between imaging and claims data

**Workflow Automation:**
- Automated claim routing based on complexity
- Smart document classification
- Auto-approval for low-risk claims
- Notification system for status changes

### 13.2 Technical Improvements

**Performance:**
- GraphQL API for flexible queries
- Real-time updates via WebSockets
- Progressive Web App (PWA) support
- Edge caching with CloudFront

**AI/ML:**
- Fine-tuned models for medical claim analysis
- Custom entity extraction for medical terms
- Automated ICD-10 code suggestion
- Claim similarity detection

**Integration:**
- HL7 FHIR API integration
- External EHR system connectors
- Insurance carrier API integration
- Payment processing integration

### 13.3 Scalability Improvements

**Data Partitioning:**
- Partition DynamoDB by date range
- Separate OpenSearch indices by tenant
- S3 lifecycle policies for archival

**Global Distribution:**
- Multi-region deployment
- Cross-region replication
- Edge locations for static assets
- Regional Bedrock endpoints


## 14. Acceptance Criteria Mapping

This section maps design components to requirements acceptance criteria to ensure complete coverage.

### Requirement 1: S3 Data Source Integration
- **Data Loader Service** (Section 4.1): Reads from medical-claims-synthetic-data-dev
- **Patient Listing Lambda** (Section 4.1): Lists patients/ prefix
- **Claim Loader Lambda** (Section 4.2): Reads mapping.json and patient documents

### Requirement 2: Document Import and Processing Pipeline
- **Claim Loader Service** (Section 4.2): Copies documents between buckets
- **Document Processor Lambda** (Section 4.3): Triggers processing pipeline
- **DynamoDB Schema** (Section 2.2): Tracks import status

### Requirement 3: Patient and Claim Listing
- **Patient List API** (Section 3.1): GET /api/patients endpoint
- **PatientListPage Component** (Section 5.2): Frontend display
- **Pagination Support** (Section 3.1): Query parameters for pagination

### Requirement 4: Claim Document Upload
- **Document Upload Service** (Section 4.6): Handles multipart uploads
- **Document Upload API** (Section 3.1): POST /api/documents/upload
- **Validation Rules** (Section 4.6): Format and size validation

### Requirement 5: Medical Document Text Extraction
- **Document Processor Lambda** (Section 4.3): Textract integration
- **Text Extraction** (Section 4.3): DetectDocumentText, AnalyzeDocument
- **Error Handling** (Section 9.3): Processing failure fallbacks

### Requirement 6: Medical Image Metadata Processing
- **Patient Mapping** (Section 2.1): TCIA collection ID mapping
- **Claim Detail API** (Section 3.1): Returns imaging metadata
- **ClaimDetailPage** (Section 5.2): Displays TCIA references

### Requirement 7: Document Embedding Generation
- **Document Processor Lambda** (Section 4.3): Bedrock Titan Embed integration
- **OpenSearch Schema** (Section 2.3): Vector storage with knn_vector
- **Chunking Strategy** (Section 4.3): 8000 character segments

### Requirement 8: Claim Summary Generation
- **Claim Summary Service** (Section 4.4): Bedrock Nova Pro integration
- **Summary API** (Section 3.1): POST /api/claims/{claimId}/summary
- **ClaimSummaryPanel** (Section 5.2): Frontend display
- **Caching** (Section 8.1): 5-minute summary cache

### Requirement 9: Claim Status Tracking
- **DynamoDB Schema** (Section 2.2): Status field in Claims table
- **Status API** (Section 3.1): GET /api/claims/{claimId}/status
- **ClaimStatusBadge** (Section 5.2): Visual status indicator

### Requirement 10: Claim History Visualization
- **ClaimTimelinePanel** (Section 5.2): Timeline component
- **DynamoDB Schema** (Section 2.2): Event history tracking
- **Timeline API** (Section 3.1): Chronological event retrieval

### Requirement 11: Multi-Modal Context Integration
- **Claim Summary Service** (Section 4.4): Incorporates imaging metadata
- **Prompt Engineering** (Section 4.4): Includes TCIA references
- **OpenSearch Query** (Section 4.4): Retrieves all document types

### Requirement 12: Semantic Search Across Claims
- **Search Service** (Section 4.5): OpenSearch knn query
- **Search API** (Section 3.1): POST /api/search
- **SearchPage Component** (Section 5.2): Search interface
- **Filtering** (Section 4.5): Document type and claim filters

### Requirement 13: Agent Authentication and Authorization
- **Cognito Integration** (Section 7.1): JWT authentication
- **API Gateway Authorizer** (Section 7.1): Token validation
- **Session Management** (Section 7.1): 60-minute timeout

### Requirement 14: Multi-Tenant Data Isolation
- **Tenant Filtering** (Section 7.2): All queries filtered by tenantId
- **DynamoDB Access Pattern** (Section 7.2): Tenant-scoped queries
- **OpenSearch Filtering** (Section 7.2): Tenant filter in vector search

### Requirement 15: Document Processing Status Tracking
- **Document Status Table** (Section 2.2): Processing status tracking
- **Status API** (Section 3.1): GET /api/documents/{documentId}
- **DocumentListPanel** (Section 5.2): Status badges and retry

### Requirement 16: Claim Document Organization
- **Document Categorization** (Section 2.2): Type field in schema
- **DocumentListPanel** (Section 5.2): Grouped by type
- **Sorting** (Section 5.2): Date-based sorting

### Requirement 17: Performance and Scalability
- **Lambda Configuration** (Section 8.2): Memory and timeout settings
- **Caching Strategy** (Section 8.1): Summary and metadata caching
- **Batch Processing** (Section 8.4): Parallel document processing

### Requirement 18: Error Handling and Resilience
- **Retry Strategy** (Section 9.2): Exponential backoff
- **Fallback Mechanisms** (Section 9.3): Degraded service modes
- **Circuit Breaker** (Section 9.2): Bedrock API protection

### Requirement 19: Data Export and Reporting
- **Export API** (Future enhancement - Section 13.1)
- **PDF Generation** (Future enhancement - Section 13.1)


## 15. Open Questions and Decisions

### 15.1 Technical Decisions Required

**Q1: Should we process text files or PDFs from S3?**
- Decision: Prefer text files when available to reduce Textract costs
- Rationale: Source bucket contains both .txt and .pdf versions
- Implementation: Check for .txt file first, fall back to .pdf if needed

**Q2: How to handle TCIA imaging data?**
- Decision: Store metadata only, link to TCIA for actual images
- Rationale: DICOM files are large, TCIA provides viewing infrastructure
- Implementation: Store TCIA collection ID and provide external links

**Q3: Real-time vs. batch document processing?**
- Decision: Hybrid approach - real-time for uploads, batch for S3 loads
- Rationale: User uploads need immediate feedback, bulk loads can be async
- Implementation: Separate Lambda functions for each use case

**Q4: Summary regeneration strategy?**
- Decision: Cache for 5 minutes, allow manual refresh
- Rationale: Balance cost vs. freshness, give users control
- Implementation: DynamoDB TTL for cache expiration

### 15.2 Business Decisions Required

**Q1: What constitutes a "claim" in the system?**
- Current assumption: One claim per patient per diagnosis
- Need clarification: Can patients have multiple concurrent claims?
- Impact: Data model and UI design

**Q2: Access control granularity?**
- Current assumption: Tenant-level isolation only
- Need clarification: Role-based access within tenant?
- Impact: Authorization logic and UI permissions

**Q3: Document retention policy?**
- Current assumption: Indefinite retention
- Need clarification: Archival or deletion requirements?
- Impact: S3 lifecycle policies and cost

### 15.3 Platform Team Coordination

**Required from Platform Team:**
- API Gateway ID for CDK deployment
- OpenSearch endpoint URL
- Cognito User Pool ID and Client ID
- IAM role ARNs for cross-account S3 access (if needed)
- Monitoring dashboard access
- Integration test environment setup

**Provided to Platform Team:**
- API method definitions for gateway integration
- CloudFormation template for review
- Unit test results
- Documentation for integration testing


## 16. Implementation Phases

### Phase 1: Core Infrastructure (Week 1-2)
**Deliverables:**
- CDK stack with DynamoDB tables
- Lambda functions for patient listing and claim loading
- S3 integration with source bucket
- Basic API Gateway methods
- Unit tests for core services

**Success Criteria:**
- Can list patients from S3
- Can load claim documents to platform bucket
- All unit tests passing
- CDK synthesizes without errors

### Phase 2: Document Processing (Week 3-4)
**Deliverables:**
- Document processor Lambda with Textract integration
- Embedding generation with Bedrock Titan
- OpenSearch index creation and population
- Document status tracking
- Unit tests for processing pipeline

**Success Criteria:**
- Documents extracted and text stored
- Embeddings generated and indexed
- Processing status tracked in DynamoDB
- Error handling and retry logic working

### Phase 3: RAG and Summarization (Week 5-6)
**Deliverables:**
- Claim summary Lambda with Bedrock Nova Pro
- Semantic search Lambda with OpenSearch knn
- Summary caching implementation
- API endpoints for summary and search
- Unit tests for RAG components

**Success Criteria:**
- Summaries generated with relevant context
- Search returns accurate results
- Performance meets requirements (<10s for summaries)
- Caching reduces redundant API calls

### Phase 4: Frontend Development (Week 7-8)
**Deliverables:**
- React application with routing
- Patient list and claim detail pages
- Summary and search interfaces
- Document upload functionality
- Cognito authentication integration
- Frontend unit tests

**Success Criteria:**
- All UI components functional
- Authentication working end-to-end
- Responsive design on desktop and tablet
- Frontend tests passing

### Phase 5: Security and Optimization (Week 9-10)
**Deliverables:**
- Multi-tenant isolation implementation
- API Gateway authorizer configuration
- Performance optimization (caching, batching)
- Error handling and resilience
- Monitoring and alerting setup
- Security audit and fixes

**Success Criteria:**
- Tenant isolation verified
- Performance targets met
- Error rates < 1%
- Security best practices implemented

### Phase 6: Testing and Documentation (Week 11-12)
**Deliverables:**
- Comprehensive unit test coverage
- Integration test support for platform team
- API documentation in docs/api-design.md
- Architecture documentation in docs/architecture.md
- Deployment guide in docs/deployment.md
- User guide for insurance agents

**Success Criteria:**
- Unit test coverage > 80%
- All documentation complete
- Platform team can run integration tests
- Ready for staging deployment


## 17. Dependencies and Prerequisites

### 17.1 External Dependencies

**AWS Services:**
- AWS Bedrock (Nova Pro and Titan Embed models enabled)
- Amazon Textract (service quota sufficient for workload)
- OpenSearch Serverless (collection created by platform team)
- AWS Cognito (user pool configured by platform team)
- API Gateway (deployed and managed by platform team)

**Platform Infrastructure:**
- S3 bucket: medical-claims-synthetic-data-dev (populated with data)
- S3 bucket: rag-app-v2-documents-dev (platform bucket)
- OpenSearch endpoint URL
- Cognito User Pool ID and Client ID
- API Gateway ID

**Development Tools:**
- Node.js 20.x LTS
- npm 11.x
- AWS CDK CLI
- TypeScript compiler
- AWS CLI (configured with appropriate credentials)

### 17.2 Data Prerequisites

**S3 Source Bucket Content:**
- Synthetic patient data generated by medical-claims-data-generator
- Minimum 10 patients for dev environment
- mapping.json file with patient ID mappings
- statistics.json file with generation metadata

**Verification Steps:**
```bash
# Verify source bucket exists and has data
aws s3 ls s3://medical-claims-synthetic-data-dev/patients/

# Verify mapping file exists
aws s3 ls s3://medical-claims-synthetic-data-dev/mapping.json

# Verify platform bucket is accessible
aws s3 ls s3://rag-app-v2-documents-dev/
```

### 17.3 Configuration Prerequisites

**Environment Variables Required:**
```bash
# From platform team
VECTOR_DB_ENDPOINT=<opensearch-endpoint>
KNOWLEDGE_BASE_ID=<bedrock-kb-id>
USER_POOL_ID=<cognito-pool-id>
USER_POOL_CLIENT_ID=<cognito-client-id>
API_GATEWAY_ID=<api-gateway-id>

# Application-specific
SOURCE_BUCKET=medical-claims-synthetic-data-dev
PLATFORM_BUCKET=rag-app-v2-documents-dev
AWS_REGION=us-east-1
ENVIRONMENT=dev
```

**Retrieval Commands:**
```bash
# Get configuration from SSM Parameter Store
aws ssm get-parameter --name "/rag-app-v2/dev/opensearch/collection-endpoint"
aws ssm get-parameter --name "/rag-app-v2/dev/cognito/user-pool-id"
aws ssm get-parameter --name "/rag-app-v2/dev/cognito/client-id"
```


## 18. Risk Assessment and Mitigation

### 18.1 Technical Risks

**Risk: OpenSearch cost exceeds budget**
- Probability: Medium
- Impact: High
- Mitigation: Implement aggressive caching, monitor OCU usage, consider alternative storage for metadata

**Risk: Bedrock API rate limits**
- Probability: Medium
- Impact: Medium
- Mitigation: Implement request queuing, exponential backoff, circuit breaker pattern

**Risk: Textract processing delays**
- Probability: Low
- Impact: Medium
- Mitigation: Async processing with status tracking, prefer text files over PDFs, batch processing

**Risk: S3 source bucket data format changes**
- Probability: Low
- Impact: High
- Mitigation: Version data format, implement schema validation, coordinate with data generator team

### 18.2 Security Risks

**Risk: Cross-tenant data leakage**
- Probability: Low
- Impact: Critical
- Mitigation: Mandatory tenant filtering in all queries, security audit, integration tests

**Risk: JWT token compromise**
- Probability: Low
- Impact: High
- Mitigation: Short token expiry (60 min), HTTPS only, secure token storage, token rotation

**Risk: Unauthorized S3 access**
- Probability: Low
- Impact: High
- Mitigation: IAM least privilege, bucket policies, VPC endpoints, access logging

### 18.3 Operational Risks

**Risk: Lambda cold start latency**
- Probability: High
- Impact: Low
- Mitigation: Provisioned concurrency for critical functions, optimize bundle size, keep functions warm

**Risk: DynamoDB throttling**
- Probability: Low
- Impact: Medium
- Mitigation: On-demand billing mode, exponential backoff, batch operations

**Risk: Monitoring gaps**
- Probability: Medium
- Impact: Medium
- Mitigation: Comprehensive CloudWatch metrics, structured logging, alerting on key metrics

### 18.4 Business Risks

**Risk: User adoption challenges**
- Probability: Medium
- Impact: Medium
- Mitigation: User training, intuitive UI design, comprehensive documentation, feedback loop

**Risk: Summary quality issues**
- Probability: Medium
- Impact: High
- Mitigation: Prompt engineering, context optimization, user feedback mechanism, manual review option

**Risk: Scalability limitations**
- Probability: Low
- Impact: High
- Mitigation: Load testing, auto-scaling configuration, performance monitoring, capacity planning


## 19. Success Metrics

### 19.1 Performance Metrics

**Response Time:**
- Patient list: < 2 seconds (p95)
- Claim detail: < 3 seconds (p95)
- Summary generation: < 10 seconds (p95)
- Search query: < 2 seconds (p95)
- Document upload: < 5 seconds (p95)

**Throughput:**
- Concurrent users: 50+
- Documents processed: 100/hour
- Summaries generated: 200/hour
- Search queries: 500/hour

**Availability:**
- Uptime: 99.9% (dev: 99%)
- Error rate: < 1%
- Lambda success rate: > 99%

### 19.2 Quality Metrics

**Code Quality:**
- Unit test coverage: > 80%
- TypeScript strict mode: enabled
- Linting errors: 0
- Security vulnerabilities: 0 critical/high

**Summary Quality:**
- User satisfaction: > 4/5 rating
- Accuracy (manual review): > 90%
- Completeness: All required fields present
- Relevance: Sources match query context

### 19.3 Cost Metrics

**Monthly Cost Targets (Dev):**
- Total AWS cost: < $800/month
- Cost per claim processed: < $0.50
- Cost per summary generated: < $0.10
- Cost per search query: < $0.01

### 19.4 User Experience Metrics

**Usability:**
- Time to first summary: < 30 seconds
- Clicks to view claim: < 3
- Search result relevance: > 80%
- User error rate: < 5%

**Adoption:**
- Active users: Track weekly
- Claims reviewed per user: Track daily
- Feature usage: Track per feature
- User feedback score: > 4/5


## 20. Glossary and References

### 20.1 Acronyms

- **API**: Application Programming Interface
- **AWS**: Amazon Web Services
- **CDK**: Cloud Development Kit
- **CMS**: Centers for Medicare & Medicaid Services
- **CORS**: Cross-Origin Resource Sharing
- **DICOM**: Digital Imaging and Communications in Medicine
- **DynamoDB**: AWS NoSQL database service
- **EOB**: Explanation of Benefits
- **FHIR**: Fast Healthcare Interoperability Resources
- **GSI**: Global Secondary Index
- **IAM**: Identity and Access Management
- **JWT**: JSON Web Token
- **KNN**: K-Nearest Neighbors
- **OCU**: OpenSearch Compute Unit
- **PDF**: Portable Document Format
- **POC**: Proof of Concept
- **RAG**: Retrieval-Augmented Generation
- **S3**: Simple Storage Service
- **SDK**: Software Development Kit
- **TCIA**: The Cancer Imaging Archive
- **TTL**: Time To Live
- **UI**: User Interface
- **VPC**: Virtual Private Cloud

### 20.2 Related Documentation

**Internal Documents:**
- `.kiro/specs/insurance-claim-portal/requirements.md` - Requirements specification
- `.kiro/specs/medical-claims-data-generator/design.md` - Data generator design
- `.kiro/steering/rag-platform-integration.md` - Platform integration guide
- `.kiro/steering/project-guidelines.md` - Project development guidelines

**External References:**
- [AWS Bedrock Documentation](https://docs.aws.amazon.com/bedrock/)
- [Amazon Textract Documentation](https://docs.aws.amazon.com/textract/)
- [OpenSearch Serverless Documentation](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless.html)
- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [TCIA Collections](https://www.cancerimagingarchive.net/)
- [FHIR R4 Specification](https://www.hl7.org/fhir/)
- [CMS-1500 Form Specification](https://www.cms.gov/medicare/cms-forms/cms-forms)

### 20.3 Design Document Version History

- **v1.0** (Current): Initial design document
  - Complete system architecture
  - API design and data models
  - Implementation details and phases
  - Security and performance considerations
  - Cost estimation and risk assessment

---

**Document Status:** Ready for Review  
**Next Steps:** Create implementation tasks and begin Phase 1 development  
**Review Required By:** Platform Team, Security Team, Development Team
