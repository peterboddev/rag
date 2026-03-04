import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DocumentRecord, isTextDocument, requiresTextract, ProcessingMetadata, ErrorDetails } from '../types';
import { PDFValidatorService } from '../services/pdf-validator';
import { EnhancedTextractService } from '../services/enhanced-textract';

const s3Client = new S3Client({ region: process.env.REGION });
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.REGION }));
const textractService = new EnhancedTextractService(process.env.REGION!);

const DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE_NAME!;
const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET!;
const PLATFORM_DOCUMENTS_BUCKET = process.env.PLATFORM_DOCUMENTS_BUCKET!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    console.log('Document Retry Lambda invoked', { 
      httpMethod: event.httpMethod,
      path: event.path 
    });

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
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Unauthorized: Missing tenant_id' }),
      };
    }

    const { documentId, customerUUID } = JSON.parse(event.body || '{}');

    if (!documentId || !customerUUID) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ 
          error: 'Missing required fields: documentId, customerUUID' 
        }),
      };
    }

    // Get document record from DynamoDB
    const getResponse = await dynamoClient.send(new GetCommand({
      TableName: DOCUMENTS_TABLE,
      Key: {
        id: documentId,
        customerUuid: customerUUID,
      },
    }));

    if (!getResponse.Item) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Document not found' }),
      };
    }

    const document = getResponse.Item as DocumentRecord;

    // Verify tenant access
    if (document.tenantId !== tenantId) {
      return {
        statusCode: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Access denied' }),
      };
    }

    // Check if document is in a retryable state
    if (document.processingStatus !== 'failed') {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ 
          error: `Document is not in a failed state. Current status: ${document.processingStatus}` 
        }),
      };
    }

    // Check retry limits
    const currentRetryCount = document.retryCount || 0;
    const maxRetries = document.maxRetries || 3;

    if (currentRetryCount >= maxRetries) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ 
          error: `Maximum retry attempts (${maxRetries}) exceeded` 
        }),
      };
    }

    console.log('Retrying document processing', { 
      documentId, 
      customerUUID, 
      currentRetryCount,
      maxRetries 
    });

    // Update retry count and status
    await updateDocumentStatus(documentId, customerUUID, 'processing', currentRetryCount + 1);

    try {
      // Get the original file from S3
      const getObjectResponse = await s3Client.send(new GetObjectCommand({
        Bucket: DOCUMENTS_BUCKET,
        Key: document.s3Key,
      }));

      if (!getObjectResponse.Body) {
        throw new Error('Could not retrieve file content from S3');
      }

      // Convert stream to buffer using the transformToByteArray method
      const fileBuffer = Buffer.from(await getObjectResponse.Body.transformToByteArray());

      const contentType = document.contentType;
      let extractedText = '';
      let textLength = 0;
      let confidence = 0;
      let pageCount = 1;
      const processingStartTime = Date.now();

      if (isTextDocument(contentType)) {
        // Handle text documents directly
        console.log('Retrying text document processing', { documentId });
        extractedText = Buffer.from(fileBuffer).toString('utf-8');
        textLength = extractedText.length;
        confidence = 100;
      } else if (requiresTextract(contentType)) {
        // Re-validate PDF if it's a PDF document
        if (contentType === 'application/pdf') {
          console.log('Re-validating PDF document', { documentId });
          
          const pdfValidation = await PDFValidatorService.validatePDF(Buffer.from(fileBuffer), document.fileName);
          
          if (!pdfValidation.isValid) {
            const errorMessage = PDFValidatorService.createErrorMessage(pdfValidation);
            throw new Error(`PDF validation failed: ${errorMessage}`);
          }

          // Check for encryption specifically
          const pdfContent = fileBuffer.toString();
          if (pdfContent.includes('/Encrypt') || pdfContent.includes('/Filter')) {
            throw new Error('PDF is encrypted or password-protected. Textract cannot process encrypted documents. Please provide an unencrypted version.');
          }
        }

        // Use enhanced Textract service for retry
        console.log('Retrying document with enhanced Textract', { documentId, contentType });
        
        const documentType = EnhancedTextractService.determineDocumentType(document.fileName, contentType);
        const fileSizeBytes = fileBuffer.length;
        const processingMode = EnhancedTextractService.determineProcessingMode(fileSizeBytes, documentType);
        
        const textractParams = {
          s3Bucket: DOCUMENTS_BUCKET,
          s3Key: document.s3Key,
          documentType,
          processingMode
        };

        const textractResult = await textractService.extractTextWithRetry(textractParams);
        
        extractedText = textractResult.extractedText;
        textLength = extractedText.length;
        confidence = textractResult.confidence;
        pageCount = textractResult.pageCount;
        
        console.log('Enhanced Textract retry completed', {
          documentId,
          textLength,
          confidence,
          pageCount,
          processingTime: textractResult.processingTime
        });
      } else {
        throw new Error(`Unsupported content type: ${contentType}`);
      }

      // Upload processed document to platform bucket
      const platformKey = `processed/${tenantId}/${customerUUID}/${documentId}.txt`;
      
      await s3Client.send(new PutObjectCommand({
        Bucket: PLATFORM_DOCUMENTS_BUCKET,
        Key: platformKey,
        Body: extractedText,
        ContentType: 'text/plain',
        Metadata: {
          customerUUID,
          tenantId,
          documentId,
          originalKey: document.s3Key,
          processedAt: new Date().toISOString(),
          retryAttempt: (currentRetryCount + 1).toString(),
        },
      }));

      // Calculate processing duration
      const processingDuration = Date.now() - processingStartTime;

      // Update document record with success
      await updateDocumentWithText(documentId, customerUUID, extractedText, textLength, confidence, pageCount, processingDuration, currentRetryCount + 1);

      console.log('Document retry successful', { 
        documentId, 
        textLength,
        confidence,
        pageCount,
        retryAttempt: currentRetryCount + 1,
        processingDuration: `${processingDuration}ms`
      });

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          message: 'Document retry successful',
          documentId,
          processingStatus: 'completed',
          textLength,
          confidence,
          pageCount,
          retryAttempt: currentRetryCount + 1
        }),
      };

    } catch (processingError) {
      console.error('Document retry failed:', processingError);
      
      const errorDetails: ErrorDetails = {
        errorCode: 'RETRY_FAILED',
        errorMessage: processingError instanceof Error ? processingError.message : 'Unknown error during retry',
        errorType: 'processing',
        suggestedAction: currentRetryCount + 1 >= maxRetries 
          ? 'Maximum retries exceeded. Please check the document and try uploading again.'
          : 'Retry failed. You can try again or upload a different version of the document.',
        isRetryable: currentRetryCount + 1 < maxRetries
      };

      // Update document with retry failure
      await updateDocumentStatus(documentId, customerUUID, 'failed', currentRetryCount + 1, errorDetails);

      return {
        statusCode: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Document retry failed',
          message: errorDetails.errorMessage,
          suggestedAction: errorDetails.suggestedAction,
          retryAttempt: currentRetryCount + 1,
          canRetry: errorDetails.isRetryable
        }),
      };
    }

  } catch (error) {
    console.error('Error in document retry:', error);
    
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

async function updateDocumentStatus(
  documentId: string,
  customerUUID: string,
  status: 'processing' | 'failed',
  retryCount: number,
  errorDetails?: ErrorDetails
): Promise<void> {
  try {
    const timestamp = new Date().toISOString();
    let updateExpression = 'SET processingStatus = :status, updatedAt = :updatedAt, retryCount = :retryCount';
    const expressionAttributeValues: any = {
      ':status': status,
      ':updatedAt': timestamp,
      ':retryCount': retryCount,
    };

    if (status === 'processing') {
      updateExpression += ', processingStartedAt = :startedAt';
      expressionAttributeValues[':startedAt'] = timestamp;
      
      // Remove error fields when processing starts
      updateExpression += ' REMOVE errorMessage, errorDetails';
    } else if (status === 'failed' && errorDetails) {
      updateExpression += ', errorMessage = :errorMessage, errorDetails = :errorDetails';
      expressionAttributeValues[':errorMessage'] = errorDetails.errorMessage;
      expressionAttributeValues[':errorDetails'] = errorDetails;
    }

    await dynamoClient.send(new UpdateCommand({
      TableName: DOCUMENTS_TABLE,
      Key: {
        id: documentId,
        customerUuid: customerUUID,
      },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
    }));

    console.log('Document status updated for retry', { 
      documentId, 
      status, 
      retryCount 
    });
  } catch (error) {
    console.error('Error updating document status for retry:', error);
    throw error;
  }
}

async function updateDocumentWithText(
  documentId: string,
  customerUUID: string,
  extractedText: string,
  textLength: number,
  confidence: number,
  pageCount: number,
  processingDuration: number,
  retryCount: number
): Promise<void> {
  try {
    const timestamp = new Date().toISOString();
    
    // Create text preview (first 200 characters)
    const textPreview = extractedText.length > 200 
      ? extractedText.substring(0, 200) + '...' 
      : extractedText;
    
    await dynamoClient.send(new UpdateCommand({
      TableName: DOCUMENTS_TABLE,
      Key: {
        id: documentId,
        customerUuid: customerUUID,
      },
      UpdateExpression: 'SET extractedText = :text, textLength = :textLength, processingStatus = :status, updatedAt = :updatedAt, processingCompletedAt = :completedAt, confidence = :confidence, pageCount = :pageCount, processingDurationMs = :duration, textPreview = :preview, retryCount = :retryCount',
      ExpressionAttributeValues: {
        ':text': extractedText,
        ':textLength': textLength,
        ':status': 'completed',
        ':updatedAt': timestamp,
        ':completedAt': timestamp,
        ':confidence': confidence,
        ':pageCount': pageCount,
        ':duration': processingDuration,
        ':preview': textPreview,
        ':retryCount': retryCount,
      },
    }));

    console.log('Document updated with extracted text after retry', { 
      documentId, 
      textLength,
      confidence,
      pageCount,
      retryCount,
      processingDuration: `${processingDuration}ms`
    });
  } catch (error) {
    console.error('Error updating document with text after retry:', error);
    throw error;
  }
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