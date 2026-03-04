import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, CopyObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, PutCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { CloudWatchClient, PutMetricDataCommand, StandardUnit } from '@aws-sdk/client-cloudwatch';
import { v4 as uuidv4 } from 'uuid';
import { DocumentRecord, ClaimMetadata, ProcessingMetadata } from '../types';

const s3Client = new S3Client({ 
  region: process.env.REGION,
  maxAttempts: 3 // Enable automatic retries for S3 operations
});
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ 
  region: process.env.REGION,
  maxAttempts: 3 // Enable automatic retries for DynamoDB operations
}));
const cloudWatchClient = new CloudWatchClient({ region: process.env.REGION });

// Retry configuration
interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
  backoffMultiplier: 2
};

/**
 * Structured logging helper
 */
function logStructured(level: 'INFO' | 'WARN' | 'ERROR', message: string, metadata: Record<string, any> = {}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    service: 'claim-loader',
    ...metadata
  };
  console.log(JSON.stringify(logEntry));
}

/**
 * Publish CloudWatch metric
 */
async function publishMetric(metricName: string, value: number, unit: StandardUnit = StandardUnit.Count, dimensions: Record<string, string> = {}) {
  try {
    await cloudWatchClient.send(new PutMetricDataCommand({
      Namespace: 'InsuranceClaimPortal',
      MetricData: [
        {
          MetricName: metricName,
          Value: value,
          Unit: unit,
          Timestamp: new Date(),
          Dimensions: Object.entries(dimensions).map(([Name, Value]) => ({ Name, Value }))
        }
      ]
    }));
  } catch (error) {
    // Don't fail the Lambda if metrics publishing fails
    console.error('Failed to publish metric:', error);
  }
}

const DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE_NAME!;
const SOURCE_BUCKET = process.env.SOURCE_BUCKET || 'medical-claims-synthetic-data-dev';
const PLATFORM_BUCKET = process.env.PLATFORM_DOCUMENTS_BUCKET || 'rag-app-v2-documents-dev';

interface ClaimLoaderRequest {
  patientId: string;
  claimId: string;
  customerUUID: string;
}

interface ClaimLoaderResponse {
  jobId: string;
  status: string;
  documentsProcessed: number;
  totalDocuments: number;
  message: string;
}

interface PatientMapping {
  syntheaId: string;
  tciaId: string;
  patientName: string;
  tciaCollectionId: string;
}

/**
 * Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if an error is retryable
 */
function isRetryableError(error: any): boolean {
  // Retry on network errors, throttling, and temporary service issues
  const retryableErrors = [
    'NetworkingError',
    'TimeoutError',
    'ThrottlingException',
    'TooManyRequestsException',
    'ServiceUnavailable',
    'InternalServerError',
    'RequestTimeout',
    'SlowDown'
  ];

  const errorName = error.name || error.code || '';
  const errorMessage = error.message || '';

  return retryableErrors.some(retryable => 
    errorName.includes(retryable) || errorMessage.includes(retryable)
  );
}

/**
 * Execute operation with exponential backoff retry
 */
async function withRetry<T>(
  operation: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  operationName: string = 'operation'
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt < config.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      // Don't retry if error is not retryable
      if (!isRetryableError(error)) {
        console.error(`Non-retryable error in ${operationName}:`, error);
        throw error;
      }

      // Don't retry on last attempt
      if (attempt === config.maxRetries - 1) {
        console.error(`Max retries reached for ${operationName}:`, error);
        throw error;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        config.baseDelay * Math.pow(config.backoffMultiplier, attempt),
        config.maxDelay
      );

      console.log(`Retrying ${operationName} after ${delay}ms (attempt ${attempt + 1}/${config.maxRetries})`);
      await sleep(delay);
    }
  }

  throw lastError!;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const startTime = Date.now();
  
  try {
    logStructured('INFO', 'Claim Loader Lambda invoked', {
      httpMethod: event.httpMethod,
      path: event.path
    });

    // Publish invocation metric
    await publishMetric('LambdaInvocations', 1, StandardUnit.Count, { FunctionName: 'claim-loader' });

    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Method not allowed' }),
      };
    }

    // Extract tenant_id from JWT token
    const tenantId = extractTenantFromToken(event);
    if (!tenantId) {
      await publishMetric('AuthenticationErrors', 1, StandardUnit.Count, { FunctionName: 'claim-loader' });
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Unauthorized: Missing tenant_id' }),
      };
    }

    const request: ClaimLoaderRequest = JSON.parse(event.body || '{}');
    const { patientId, claimId, customerUUID } = request;

    // Validate required fields
    if (!patientId || !claimId || !customerUUID) {
      await publishMetric('ValidationErrors', 1, StandardUnit.Count, { FunctionName: 'claim-loader' });
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Missing required fields: patientId, claimId, customerUUID'
        }),
      };
    }

    logStructured('INFO', 'Loading claim documents', { patientId, claimId, customerUUID, tenantId });

    // Load patient mapping to get patient name and TCIA collection ID
    const patientMapping = await loadPatientMapping(patientId);

    // Generate job ID for tracking
    const jobId = uuidv4();

    // List all documents for this patient's claim
    const claimDocuments = await listClaimDocuments(patientId);
    const totalDocuments = claimDocuments.length;

    logStructured('INFO', 'Found claim documents', { patientId, claimId, totalDocuments });

    // Publish document count metric
    await publishMetric('ClaimDocumentsFound', totalDocuments, StandardUnit.Count, { 
      FunctionName: 'claim-loader',
      PatientId: patientId 
    });

    // Process documents in batches of 10 for parallel processing
    const batchSize = 10;
    let documentsProcessed = 0;
    const errors: string[] = [];

    for (let i = 0; i < claimDocuments.length; i += batchSize) {
      const batch = claimDocuments.slice(i, i + batchSize);
      
      const batchResults = await Promise.allSettled(
        batch.map(doc => processDocument(doc, patientId, claimId, customerUUID, tenantId, patientMapping))
      );

      // Count successful and failed documents
      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          documentsProcessed++;
        } else {
          const docKey = batch[index];
          errors.push(`Failed to process ${docKey}: ${result.reason}`);
          logStructured('ERROR', 'Document processing failed', { docKey, error: result.reason });
        }
      });

      logStructured('INFO', 'Batch processed', {
        batchNumber: Math.floor(i / batchSize) + 1,
        documentsProcessed,
        totalDocuments
      });
    }

    // Publish success/failure metrics
    await publishMetric('DocumentsProcessedSuccessfully', documentsProcessed, StandardUnit.Count, { 
      FunctionName: 'claim-loader' 
    });
    
    if (errors.length > 0) {
      await publishMetric('DocumentProcessingErrors', errors.length, StandardUnit.Count, { 
        FunctionName: 'claim-loader' 
      });
    }

    // Publish duration metric
    const duration = Date.now() - startTime;
    await publishMetric('LambdaDuration', duration, StandardUnit.Milliseconds, { 
      FunctionName: 'claim-loader' 
    });

    const response: ClaimLoaderResponse = {
      jobId,
      status: errors.length === 0 ? 'completed' : 'completed_with_errors',
      documentsProcessed,
      totalDocuments,
      message: errors.length === 0
        ? `Successfully loaded ${documentsProcessed} documents`
        : `Loaded ${documentsProcessed} of ${totalDocuments} documents. ${errors.length} errors occurred.`
    };

    logStructured('INFO', 'Claim loading completed', {
      jobId,
      documentsProcessed,
      totalDocuments,
      errorCount: errors.length,
      duration
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(response),
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    
    logStructured('ERROR', 'Error in claim loader', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      duration
    });

    // Publish error metric
    await publishMetric('LambdaErrors', 1, StandardUnit.Count, { FunctionName: 'claim-loader' });

    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
    };
  }
};

async function loadPatientMapping(patientId: string): Promise<PatientMapping> {
  return withRetry(async () => {
    console.log('Loading patient mapping', { patientId });

    const response = await s3Client.send(new GetObjectCommand({
      Bucket: SOURCE_BUCKET,
      Key: 'mapping.json'
    }));

    const mappingData = await response.Body?.transformToString();
    if (!mappingData) {
      throw new Error('Failed to read mapping.json');
    }

    const mapping = JSON.parse(mappingData);
    
    // Find the patient in the mapping
    const patientEntry = mapping.patients?.find((p: any) => p.tciaId === patientId);
    
    if (!patientEntry) {
      // If not found, create a default mapping
      console.warn('Patient not found in mapping, using default', { patientId });
      return {
        syntheaId: 'unknown',
        tciaId: patientId,
        patientName: `Patient ${patientId}`,
        tciaCollectionId: 'unknown'
      };
    }

    return {
      syntheaId: patientEntry.syntheaId || 'unknown',
      tciaId: patientEntry.tciaId,
      patientName: patientEntry.patientName || `Patient ${patientId}`,
      tciaCollectionId: patientEntry.tciaCollectionId || 'unknown'
    };
  }, DEFAULT_RETRY_CONFIG, 'loadPatientMapping').catch(error => {
    console.error('Error loading patient mapping after retries:', error);
    // Return default mapping on error
    return {
      syntheaId: 'unknown',
      tciaId: patientId,
      patientName: `Patient ${patientId}`,
      tciaCollectionId: 'unknown'
    };
  });
}

async function listClaimDocuments(patientId: string): Promise<string[]> {
  try {
    const documents: string[] = [];
    
    // List documents from claims directory
    const claimsPrefix = `patients/${patientId}/claims/`;
    let continuationToken: string | undefined;

    do {
      const response = await s3Client.send(new ListObjectsV2Command({
        Bucket: SOURCE_BUCKET,
        Prefix: claimsPrefix,
        ContinuationToken: continuationToken
      }));

      if (response.Contents) {
        // Filter for PDF and TXT files
        const files = response.Contents
          .filter((obj: any) => obj.Key && (obj.Key.endsWith('.pdf') || obj.Key.endsWith('.txt')))
          .map((obj: any) => obj.Key!);
        
        documents.push(...files);
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    // Also list clinical notes
    const clinicalNotesPrefix = `patients/${patientId}/clinical-notes/`;
    continuationToken = undefined;

    do {
      const clinicalResponse: any = await s3Client.send(new ListObjectsV2Command({
        Bucket: SOURCE_BUCKET,
        Prefix: clinicalNotesPrefix,
        ContinuationToken: continuationToken
      }));

      if (clinicalResponse.Contents) {
        const files = clinicalResponse.Contents
          .filter((obj: any) => obj.Key && (obj.Key.endsWith('.pdf') || obj.Key.endsWith('.txt')))
          .map((obj: any) => obj.Key!);
        
        documents.push(...files);
      }

      continuationToken = clinicalResponse.NextContinuationToken;
    } while (continuationToken);

    console.log('Listed claim documents', { patientId, documentCount: documents.length });
    return documents;

  } catch (error) {
    console.error('Error listing claim documents:', error);
    throw error;
  }
}

async function processDocument(
  sourceKey: string,
  patientId: string,
  claimId: string,
  customerUUID: string,
  tenantId: string,
  patientMapping: PatientMapping
): Promise<void> {
  return withRetry(async () => {
    console.log('Processing document', { sourceKey, patientId, claimId });

    // Extract file name and determine document type
    const fileName = sourceKey.split('/').pop()!;
    const documentType = determineDocumentType(fileName);
    const contentType = fileName.endsWith('.pdf') ? 'application/pdf' : 'text/plain';

    // Generate document ID and destination key
    const documentId = uuidv4();
    const destKey = `uploads/${tenantId}/${customerUUID}/${documentId}/${fileName}`;

    // Copy document from source to platform bucket with retry
    await s3Client.send(new CopyObjectCommand({
      Bucket: PLATFORM_BUCKET,
      CopySource: `${SOURCE_BUCKET}/${sourceKey}`,
      Key: destKey,
      ContentType: contentType,
      Metadata: {
        customeruuid: customerUUID,
        tenantid: tenantId,
        documentid: documentId,
        originalfilename: fileName,
        processingmode: 'sync',
        sourcebucket: SOURCE_BUCKET,
        sourcekey: sourceKey
      }
    }));

    console.log('Document copied to platform bucket', { sourceKey, destKey, documentId });

    // Create claim metadata
    const claimMetadata: ClaimMetadata = {
      patientId,
      patientName: patientMapping.patientName,
      tciaCollectionId: patientMapping.tciaCollectionId,
      claimId,
      documentType
    };

    // Create processing metadata
    const processingMetadata: ProcessingMetadata = {
      isEncrypted: false,
      hasTextContent: true,
      processingMode: 'sync',
      retryHistory: []
    };

    // Create document record in DynamoDB with retry
    const documentRecord: DocumentRecord = {
      id: documentId,
      customerUuid: customerUUID,
      tenantId,
      fileName,
      s3Key: destKey,
      contentType,
      processingStatus: 'queued',
      processingMetadata,
      claimMetadata,
      retryCount: 0,
      maxRetries: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await dynamoClient.send(new PutCommand({
      TableName: DOCUMENTS_TABLE,
      Item: documentRecord
    }));

    console.log('Document record created', { documentId, fileName, documentType });
  }, DEFAULT_RETRY_CONFIG, `processDocument-${sourceKey}`);
}

function determineDocumentType(fileName: string): 'CMS1500' | 'EOB' | 'Clinical Note' | 'Radiology Report' {
  const lowerFileName = fileName.toLowerCase();
  
  if (lowerFileName.includes('cms1500') || lowerFileName.includes('cms_1500')) {
    return 'CMS1500';
  } else if (lowerFileName.includes('eob')) {
    return 'EOB';
  } else if (lowerFileName.includes('radiology') || lowerFileName.includes('report')) {
    return 'Radiology Report';
  } else if (lowerFileName.includes('clinical') || lowerFileName.includes('note')) {
    return 'Clinical Note';
  }
  
  // Default to Clinical Note if type cannot be determined
  return 'Clinical Note';
}

function extractTenantFromToken(event: APIGatewayProxyEvent): string | null {
  // For local development, allow tenant_id in headers
  const tenantIdHeader = event.headers['x-tenant-id'] || event.headers['X-Tenant-Id'];
  if (tenantIdHeader) {
    return tenantIdHeader;
  }

  // TODO: Implement proper JWT parsing when Cognito is integrated
  return 'local-dev-tenant'; // Default for local development
}
