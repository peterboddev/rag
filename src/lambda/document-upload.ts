import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { v4 as uuidv4 } from 'uuid';
import { DocumentUploadRequest, DocumentUploadResponse, DocumentRecord, validateFileType, isTextDocument, requiresTextract, ProcessingMetadata } from '../types';
import { PDFValidatorService } from '../services/pdf-validator';
import { EnhancedTextractService } from '../services/enhanced-textract';

const s3Client = new S3Client({ region: process.env.REGION });
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.REGION }));

const DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE_NAME!;
const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    console.log('Document Upload Lambda invoked', { 
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

    const request: DocumentUploadRequest = JSON.parse(event.body || '{}');
    const { customerUUID, fileName, contentType, fileData } = request;

    // Validate required fields
    if (!customerUUID || !fileName || !contentType || !fileData) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ 
          error: 'Missing required fields: customerUUID, fileName, contentType, fileData' 
        }),
      };
    }

    // Validate file type
    const validation = validateFileType(fileName, contentType);
    if (!validation.isValid) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: validation.error }),
      };
    }

    // Generate document ID and S3 key
    const documentId = uuidv4();
    const s3Key = `uploads/${tenantId}/${customerUUID}/${documentId}/${fileName}`;

    // Upload file to S3
    const fileBuffer = Buffer.from(fileData, 'base64');
    
    // Enhanced PDF validation for PDF files
    let processingMetadata: ProcessingMetadata = {
      isEncrypted: false,
      hasTextContent: true,
      processingMode: 'sync',
      retryHistory: []
    };

    if (contentType === 'application/pdf') {
      console.log('Validating PDF document', { documentId, fileName });
      
      const pdfValidation = await PDFValidatorService.validatePDF(fileBuffer, fileName);
      
      if (!pdfValidation.isValid) {
        const errorMessage = PDFValidatorService.createErrorMessage(pdfValidation);
        const suggestedActions = PDFValidatorService.getSuggestedActions(pdfValidation);
        
        return {
          statusCode: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: JSON.stringify({ 
            error: 'PDF validation failed',
            message: errorMessage,
            suggestedActions,
            validationDetails: pdfValidation
          }),
        };
      }

      // Update processing metadata with PDF validation results
      const documentType = EnhancedTextractService.determineDocumentType(fileName, contentType);
      processingMetadata = {
        pdfVersion: pdfValidation.pdfVersion,
        pageCount: pdfValidation.pageCount,
        isEncrypted: pdfValidation.isEncrypted,
        hasTextContent: pdfValidation.hasTextContent,
        processingMode: EnhancedTextractService.determineProcessingMode(pdfValidation.fileSizeBytes, documentType),
        retryHistory: []
      };

      console.log('PDF validation successful', { 
        documentId, 
        pdfVersion: pdfValidation.pdfVersion,
        pageCount: pdfValidation.pageCount,
        processingMode: processingMetadata.processingMode
      });
    }

    await s3Client.send(new PutObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: s3Key,
      Body: fileBuffer,
      ContentType: contentType,
      Metadata: {
        customeruuid: customerUUID,
        tenantid: tenantId,
        documentid: documentId,
        originalfilename: fileName,
        processingmode: processingMetadata.processingMode,
      },
    }));

    // Process document immediately if it's a text document
    let extractedText: string | undefined;
    let textLength: number | undefined;
    let processingStatus: 'queued' | 'completed' | 'processing' = 'queued';
    const processingStartedAt = new Date().toISOString();

    if (isTextDocument(contentType)) {
      try {
        console.log('Processing text document directly', { documentId });
        extractedText = fileBuffer.toString('utf-8');
        textLength = extractedText.length;
        processingStatus = 'completed';
        processingMetadata.processingMode = 'sync';
        
        console.log('Text document processed successfully', { 
          documentId, 
          textLength 
        });
      } catch (error) {
        console.error('Error processing text document:', error);
        processingStatus = 'queued'; // Fall back to queued for later processing
        
        processingMetadata.errorDetails = {
          errorCode: 'TEXT_PROCESSING_ERROR',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          errorType: 'processing',
          suggestedAction: 'Document will be retried automatically',
          isRetryable: true
        };
      }
    } else if (requiresTextract(contentType)) {
      // For non-text documents, we'll process them asynchronously
      processingStatus = 'queued';
      console.log('Non-text document queued for processing', { 
        documentId, 
        contentType,
        processingMode: processingMetadata.processingMode
      });
    }

    // Create document record in DynamoDB
    const documentRecord: DocumentRecord = {
      id: documentId,
      customerUuid: customerUUID,
      tenantId,
      fileName,
      s3Key,
      contentType,
      processingStatus,
      extractedText,
      textLength,
      processingMetadata,
      retryCount: 0,
      maxRetries: 3,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      processingStartedAt: processingStatus === 'completed' ? processingStartedAt : undefined,
      processingCompletedAt: processingStatus === 'completed' ? new Date().toISOString() : undefined,
    };

    await dynamoClient.send(new PutCommand({
      TableName: DOCUMENTS_TABLE,
      Item: documentRecord,
    }));

    const response: DocumentUploadResponse = {
      documentId,
      s3Key,
      processingStatus,
      message: processingStatus === 'completed' 
        ? 'Document uploaded and processed successfully'
        : 'Document uploaded successfully and queued for processing',
    };

    console.log('Document uploaded successfully', { 
      documentId, 
      s3Key, 
      tenantId, 
      customerUUID 
    });

    return {
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(response),
    };

  } catch (error) {
    console.error('Error in document upload:', error);
    
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

function extractTenantFromToken(event: APIGatewayProxyEvent): string | null {
  // For local development, allow tenant_id in headers
  const tenantIdHeader = event.headers['x-tenant-id'] || event.headers['X-Tenant-Id'];
  if (tenantIdHeader) {
    return tenantIdHeader;
  }

  // TODO: Implement proper JWT parsing when Cognito is integrated
  return 'local-dev-tenant'; // Default for local development
}