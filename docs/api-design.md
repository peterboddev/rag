# API Design Documentation

## Overview

This document describes the REST API endpoints for the Multi-Tenant Document Manager system. The API follows RESTful conventions and implements tenant-based access control.

## Base URL

- **Local Development**: `https://0128pkytnc.execute-api.us-east-1.amazonaws.com/prod`
- **Production**: Will be provided by platform team

## Authentication

All API endpoints require tenant identification through the `X-Tenant-Id` header for local development. In production, this will be extracted from JWT tokens provided by Cognito.

### Headers

```
Content-Type: application/json
X-Tenant-Id: <tenant-id>  // For local development only
Authorization: Bearer <jwt-token>  // For production (Cognito)
```

## Endpoints

### Customer Management

#### Create or Get Customer

Creates a new customer or returns existing customer information.

**Endpoint**: `POST /customers`

**Request Body**:
```json
{
  "customerEmail": "user@example.com"
}
```

**Response** (201 Created or 200 OK):
```json
{
  "customerUUID": "d542b18c-aab9-573f-998f-7a8cb2e763fc",
  "customerId": "customer_1767637785012_l5wsucp4m",
  "isNewCustomer": true
}
```

**Error Responses**:
- `400 Bad Request`: Missing customerEmail
- `401 Unauthorized`: Missing tenant_id
- `500 Internal Server Error`: Database or processing error

### Document Management

#### Upload Document

Uploads a document for processing and storage.

**Endpoint**: `POST /documents`

**Request Body**:
```json
{
  "customerUUID": "d542b18c-aab9-573f-998f-7a8cb2e763fc",
  "fileName": "document.pdf",
  "contentType": "application/pdf",
  "fileData": "<base64-encoded-file-content>"
}
```

**Response** (201 Created):
```json
{
  "documentId": "de0d670c-ed99-4e40-be4d-2eae3a3981de",
  "s3Key": "uploads/tenant-123/customer-uuid/document-id/document.pdf",
  "processingStatus": "queued",
  "message": "Document uploaded successfully and queued for processing"
}
```

**Error Responses**:
- `400 Bad Request`: Missing required fields or invalid file type
- `401 Unauthorized`: Missing tenant_id
- `500 Internal Server Error`: Upload or processing error

#### Process Document

Processes uploaded documents (triggered automatically by S3 events).

**Endpoint**: `POST /documents/process`

**Note**: This endpoint is primarily used internally by S3 event triggers, but can be called manually for reprocessing.

#### Get Document Summary

Retrieves a summary of all documents for a customer.

**Endpoint**: `POST /documents/summary`

**Request Body**:
```json
{
  "customerEmail": "user@example.com"
}
```

**Response** (200 OK):
```json
{
  "customerUUID": "d542b18c-aab9-573f-998f-7a8cb2e763fc",
  "customerEmail": "user@example.com",
  "documents": [
    {
      "documentId": "de0d670c-ed99-4e40-be4d-2eae3a3981de",
      "fileName": "document.pdf",
      "contentType": "application/pdf",
      "processingStatus": "completed",
      "textLength": 1250,
      "createdAt": "2024-01-05T10:30:00.000Z"
    }
  ],
  "totalDocuments": 1,
  "completedDocuments": 1,
  "failedDocuments": 0
}
```

#### Generate Selective Summary

Generates an AI summary for selected documents.

**Endpoint**: `POST /documents/summary/selective`

**Request Body**:
```json
{
  "customerEmail": "user@example.com",
  "documentIds": ["de0d670c-ed99-4e40-be4d-2eae3a3981de"]
}
```

**Response** (200 OK):
```json
{
  "summary": "Generated AI summary of the selected documents...",
  "documentCount": 1,
  "totalTokens": 1500,
  "processingTime": 2500,
  "generatedAt": "2024-01-05T10:35:00.000Z"
}
```

#### Retry Document Processing

Retries processing for a failed document.

**Endpoint**: `POST /documents/retry`

**Request Body**:
```json
{
  "documentId": "de0d670c-ed99-4e40-be4d-2eae3a3981de",
  "customerUUID": "d542b18c-aab9-573f-998f-7a8cb2e763fc"
}
```

**Response** (200 OK):
```json
{
  "message": "Document retry successful",
  "textLength": 1250,
  "processingTime": 3200
}
```

#### Delete Document

Deletes a document and its associated data.

**Endpoint**: `DELETE /documents/delete`

**Request Body**:
```json
{
  "documentId": "de0d670c-ed99-4e40-be4d-2eae3a3981de",
  "customerUUID": "d542b18c-aab9-573f-998f-7a8cb2e763fc"
}
```

**Response** (200 OK):
```json
{
  "message": "Document deleted successfully",
  "deletedFiles": ["s3://bucket/path/to/file.pdf"]
}
```

#### Generate Chunk Visualization

Generates document chunks for visualization without storing embeddings.

**Endpoint**: `POST /documents/chunks/visualization`

**Request Body**:
```json
{
  "customerUUID": "d542b18c-aab9-573f-998f-7a8cb2e763fc",
  "documentIds": ["de0d670c-ed99-4e40-be4d-2eae3a3981de"],
  "chunkingMethod": {
    "id": "semantic",
    "name": "Semantic Chunking",
    "description": "Semantic boundary chunking",
    "parameters": {
      "strategy": "semantic",
      "maxTokens": 800
    }
  }
}
```

**Response** (200 OK):
```json
{
  "chunks": [
    {
      "id": "chunk-uuid-1",
      "text": "This is the first chunk of text...",
      "tokenCount": 150,
      "characterCount": 750,
      "metadata": {
        "chunkIndex": 0,
        "totalChunks": 5,
        "chunkingMethod": "semantic",
        "confidence": 0.85,
        "semanticBoundary": true
      },
      "sourceDocument": {
        "documentId": "de0d670c-ed99-4e40-be4d-2eae3a3981de",
        "fileName": "document.pdf"
      }
    }
  ],
  "totalChunks": 5,
  "chunkingMethod": {
    "id": "semantic",
    "name": "Semantic Chunking",
    "description": "Semantic boundary chunking",
    "parameters": {
      "strategy": "semantic",
      "maxTokens": 800
    }
  },
  "processingTime": 1200,
  "generatedAt": "2024-01-05T10:40:00.000Z",
  "warnings": ["Only 1 of 2 requested documents were found and processable"]
}
```

**Error Responses**:
- `400 Bad Request`: Invalid request data or validation errors
- `422 Unprocessable Entity`: Critical errors in chunk generation
- `500 Internal Server Error`: Unexpected processing error

### Insurance Claim Portal Endpoints

#### List All Patients

Retrieves a list of all patients from the medical claims synthetic data bucket.

**Endpoint**: `GET /patients`

**Query Parameters**:
- `limit` (optional): Maximum number of patients to return (default: 50)
- `nextToken` (optional): Pagination token for retrieving next page

**Response** (200 OK):
```json
{
  "patients": [
    {
      "patientId": "TCIA-001",
      "patientName": "John Doe",
      "tciaCollectionId": "TCGA-BRCA",
      "claimCount": 3
    }
  ],
  "nextToken": "pagination-token-here"
}
```

**Error Responses**:
- `500 Internal Server Error`: Failed to retrieve patient list

#### Get Patient Details

Retrieves detailed information about a specific patient and their claims.

**Endpoint**: `GET /patients/{patientId}`

**Path Parameters**:
- `patientId`: The TCIA patient ID (e.g., "TCIA-001")

**Response** (200 OK):
```json
{
  "patientId": "TCIA-001",
  "patientName": "John Doe",
  "tciaCollectionId": "TCGA-BRCA",
  "claims": [
    {
      "claimId": "claim-123",
      "documentCount": 3,
      "documentTypes": ["CMS1500", "EOB", "Radiology Report"]
    }
  ]
}
```

**Error Responses**:
- `400 Bad Request`: Missing patientId
- `404 Not Found`: Patient not found
- `500 Internal Server Error`: Failed to retrieve patient details

#### Load Claim Documents

Loads claim documents from the synthetic data bucket to the platform documents bucket for processing.

**Endpoint**: `POST /claims/load`

**Request Body**:
```json
{
  "patientId": "TCIA-001",
  "claimId": "claim-123",
  "customerUUID": "d542b18c-aab9-573f-998f-7a8cb2e763fc",
  "tenantId": "tenant-123"
}
```

**Response** (200 OK):
```json
{
  "message": "Claim documents loaded successfully",
  "documentsLoaded": 3,
  "claimId": "claim-123",
  "patientId": "TCIA-001"
}
```

**Error Responses**:
- `400 Bad Request`: Missing required fields
- `500 Internal Server Error`: Failed to load claim documents

#### Get Claim Processing Status

Retrieves the processing status of a claim and its documents.

**Endpoint**: `GET /claims/{claimId}/status`

**Path Parameters**:
- `claimId`: The claim identifier

**Response** (200 OK):
```json
{
  "claimId": "claim-123",
  "status": "completed",
  "documentsProcessed": 3,
  "totalDocuments": 3,
  "documents": [
    {
      "documentId": "doc-uuid-1",
      "fileName": "cms1500_claim_123.pdf",
      "processingStatus": "completed",
      "documentType": "CMS1500",
      "createdAt": "2024-01-05T10:30:00.000Z",
      "updatedAt": "2024-01-05T10:35:00.000Z"
    }
  ]
}
```

**Status Values**:
- `not_loaded`: Claim has not been loaded yet
- `loading`: Documents are being copied to platform bucket
- `processing`: Documents are being processed (Textract, embeddings)
- `completed`: All documents processed successfully
- `failed`: All documents failed processing

**Error Responses**:
- `400 Bad Request`: Missing claimId
- `500 Internal Server Error`: Failed to retrieve claim status

### Chunking Configuration Management

#### Get Customer Chunking Configuration

**Endpoint**: `GET /customers/{customerUUID}/chunking-config`

**Response** (200 OK):
```json
{
  "customerUUID": "d542b18c-aab9-573f-998f-7a8cb2e763fc",
  "chunkingMethod": {
    "id": "semantic",
    "name": "Semantic Chunking",
    "description": "Semantic boundary chunking",
    "parameters": {
      "strategy": "semantic",
      "maxTokens": 800
    }
  },
  "lastUpdated": "2024-01-05T10:00:00.000Z"
}
```

#### Update Customer Chunking Configuration

**Endpoint**: `PUT /customers/{customerUUID}/chunking-config`

**Request Body**:
```json
{
  "chunkingMethod": {
    "id": "fixed_size_512",
    "name": "Fixed Size (512 tokens)",
    "description": "Fixed-size chunks with 512 token limit",
    "parameters": {
      "strategy": "fixed_size",
      "chunkSize": 512,
      "chunkOverlap": 50,
      "maxTokens": 512
    }
  }
}
```

**Response** (200 OK):
```json
{
  "message": "Chunking configuration updated successfully",
  "jobId": "cleanup-job-uuid",
  "estimatedProcessingTime": "5-10 minutes"
}
```

#### List Available Chunking Methods

**Endpoint**: `GET /chunking-methods`

**Response** (200 OK):
```json
{
  "methods": [
    {
      "id": "default",
      "name": "Default Chunking",
      "description": "Default chunking strategy",
      "parameters": {
        "strategy": "default"
      }
    },
    {
      "id": "fixed_size_512",
      "name": "Fixed Size (512 tokens)",
      "description": "Fixed-size chunks with 512 token limit",
      "parameters": {
        "strategy": "fixed_size",
        "chunkSize": 512,
        "chunkOverlap": 50,
        "maxTokens": 512
      }
    }
  ]
}
```

## Supported File Types

The system supports the following file types:

### Documents
- **PDF**: `application/pdf` (`.pdf`)
- **Word**: `application/msword` (`.doc`)
- **Word (Modern)**: `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (`.docx`)
- **Text**: `text/plain` (`.txt`)

### Images
- **JPEG**: `image/jpeg` (`.jpg`, `.jpeg`)
- **PNG**: `image/png` (`.png`)
- **TIFF**: `image/tiff` (`.tiff`, `.tif`)

## Multi-Tenant Architecture

### Tenant Isolation

All data is isolated by `tenant_id`:

1. **DynamoDB**: Uses GSI (Global Secondary Index) on `tenant_id` for efficient querying
2. **S3**: Objects are stored with tenant-specific prefixes: `uploads/{tenant_id}/{customer_uuid}/...`
3. **Aurora PostgreSQL**: Row-level security policies enforce tenant isolation

### Customer UUID Generation

Customer UUIDs are generated deterministically using:
```
UUID = uuidv5(tenant_id + ":" + customer_id, namespace_uuid)
```

This ensures:
- Same customer gets same UUID across requests
- UUIDs are unique across tenants
- No collisions between tenants

## Error Handling

### Standard Error Response Format

```json
{
  "error": "Error message",
  "message": "Detailed error description"
}
```

### HTTP Status Codes

- `200 OK`: Successful GET request
- `201 Created`: Successful POST request (resource created)
- `400 Bad Request`: Invalid request data
- `401 Unauthorized`: Missing or invalid authentication
- `403 Forbidden`: Access denied (tenant isolation)
- `404 Not Found`: Resource not found
- `405 Method Not Allowed`: HTTP method not supported
- `500 Internal Server Error`: Server-side error

## Rate Limiting

Rate limiting is handled by API Gateway and follows AWS default limits:
- 10,000 requests per second per account
- 5,000 requests per second per API

## CORS Configuration

CORS is enabled for all origins during development. In production, this will be restricted to specific domains.

## Data Flow

### Document Upload Flow

1. **Frontend** → `POST /customers` → **Customer Manager Lambda**
   - Creates or retrieves customer record
   - Returns customer UUID

2. **Frontend** → `POST /documents` → **Document Upload Lambda**
   - Validates file type and size
   - Uploads file to S3 with metadata
   - Creates document record in DynamoDB
   - Returns document ID and processing status

3. **S3 Event** → **Document Processing Lambda**
   - Triggered automatically when file is uploaded
   - Extracts text using Textract (for non-text files)
   - Uploads processed text to platform S3 bucket
   - Updates document record with extracted text

### Multi-Tenant Data Access

All database queries include tenant filtering:

```sql
-- DynamoDB Query Example
Query: tenant-id-index
KeyConditionExpression: tenant_id = :tenant_id
FilterExpression: additional_filters

-- PostgreSQL Example
SELECT * FROM customers 
WHERE tenant_id = current_setting('app.current_tenant_id')
```

## Integration with Platform Services

### RAG Platform Integration

Processed documents are uploaded to the platform's S3 bucket for RAG processing:

- **Bucket**: `rag-app-v2-documents-dev`
- **Key Format**: `processed/{tenant_id}/{customer_uuid}/{document_id}.txt`
- **Metadata**: Includes original file information and processing timestamps

### Textract Integration

Non-text documents are processed using AWS Textract:

- **Service**: `textract:DetectDocumentText`
- **Retry Logic**: Exponential backoff with 3 retry attempts
- **Error Handling**: Failed extractions are logged and marked as failed

## Security Considerations

### Data Protection
- All data encrypted in transit (HTTPS)
- S3 objects encrypted at rest (S3-managed encryption)
- DynamoDB encrypted at rest (AWS-managed keys)

### Access Control
- Tenant-based isolation at application level
- IAM roles with least-privilege access
- No cross-tenant data access possible

### Input Validation
- File type validation on both frontend and backend
- File size limits enforced
- Email format validation
- SQL injection prevention through parameterized queries