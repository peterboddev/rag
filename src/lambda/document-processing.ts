import { S3Event, S3EventRecord } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DocumentProcessingResponse, isTextDocument, requiresTextract, ProcessingMetadata, ErrorDetails, RetryAttempt } from '../types';
import { EnhancedTextractService } from '../services/enhanced-textract';
import { EmbeddingGenerationService } from '../services/embedding-generation';
import { ChunkingConfigurationService } from '../services/chunking-configuration';

const s3Client = new S3Client({ region: process.env.REGION });
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.REGION }));
const textractService = new EnhancedTextractService(process.env.REGION!);
const embeddingService = new EmbeddingGenerationService();
const chunkingService = new ChunkingConfigurationService();

const DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE_NAME!;
const PLATFORM_DOCUMENTS_BUCKET = process.env.PLATFORM_DOCUMENTS_BUCKET!;

export const handler = async (event: S3Event): Promise<void> => {
  console.log('Document Processing Lambda invoked', { 
    recordCount: event.Records.length 
  });

  for (const record of event.Records) {
    try {
      await processDocument(record);
    } catch (error) {
      console.error('Error processing document:', error, { record });
      // Continue processing other documents even if one fails
    }
  }
};

async function processDocument(record: S3EventRecord): Promise<void> {
  const bucket = record.s3.bucket.name;
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
  
  console.log('Processing document', { bucket, key });

  const processingStartTime = Date.now();

  try {
    // Get object metadata
    const getObjectResponse = await s3Client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }));

    const metadata = getObjectResponse.Metadata || {};
    const customerUUID = metadata.customeruuid;
    const tenantId = metadata.tenantid;
    const documentId = metadata.documentid;
    const contentType = getObjectResponse.ContentType || '';

    if (!customerUUID || !tenantId || !documentId) {
      throw new Error('Missing required metadata: customerUUID, tenantId, or documentId');
    }

    // Update document status to processing
    await updateDocumentStatus(documentId, customerUUID, 'processing');

    let extractedText = '';
    let textLength = 0;
    let confidence = 0;
    let pageCount = 1;

    if (isTextDocument(contentType)) {
      // Handle text documents directly
      console.log('Processing text document directly', { documentId });
      try {
        console.log('Getting text content from S3 object', { documentId });
        const textContent = await getObjectResponse.Body?.transformToString();
        console.log('Text content retrieved', { documentId, contentLength: textContent?.length || 0 });
        
        extractedText = textContent || '';
        textLength = extractedText.length;
        confidence = 100; // Text documents have 100% confidence
        
        console.log('Text document processing completed', { documentId, textLength, confidence });
      } catch (textError) {
        console.error('Error processing text document:', textError, { documentId });
        throw textError;
      }
    } else if (requiresTextract(contentType)) {
      // Use enhanced Textract service for non-text documents
      console.log('Processing document with enhanced Textract', { documentId, contentType });
      
      const documentType = EnhancedTextractService.determineDocumentType(key, contentType);
      const fileSizeBytes = getObjectResponse.ContentLength || 0;
      const processingMode = EnhancedTextractService.determineProcessingMode(fileSizeBytes, documentType);
      
      const textractParams = {
        s3Bucket: bucket,
        s3Key: key,
        documentType,
        processingMode
      };

      const textractResult = await textractService.extractTextWithRetry(textractParams);
      
      extractedText = textractResult.extractedText;
      textLength = extractedText.length;
      confidence = textractResult.confidence;
      pageCount = textractResult.pageCount;
      
      console.log('Enhanced Textract extraction completed', {
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
        originalKey: key,
        processedAt: new Date().toISOString(),
      },
    }));

    // Calculate total processing duration
    const processingDuration = Date.now() - processingStartTime;

    // Update document record with extracted text and completion status
    await updateDocumentWithText(documentId, customerUUID, extractedText, textLength, confidence, pageCount, 'completed', processingDuration);

    try {
      console.log('Document text extraction completed', { 
        documentId, 
        platformKey,
        textLength,
        confidence,
        pageCount,
        textExtractionDuration: `${processingDuration}ms`
      });

      console.log('CHECKPOINT: Document text extraction completed - skipping automatic embedding generation', { documentId });
      
      // NOTE: Automatic embedding generation is disabled for testing phase
      // Embeddings will be generated when user selects a chunking method
      console.log('Embeddings will be generated when chunking method is selected', { 
        documentId,
        textLength: extractedText.length 
      });

      console.log('Document processed successfully', { 
        documentId, 
        platformKey,
        textLength,
        confidence,
        pageCount,
        totalProcessingDuration: `${Date.now() - processingStartTime}ms`
      });

    } catch (postProcessingError) {
      console.error('CRITICAL: Error in post-processing section:', postProcessingError, {
        documentId,
        errorMessage: postProcessingError instanceof Error ? postProcessingError.message : 'Unknown error',
        errorStack: postProcessingError instanceof Error ? postProcessingError.stack : undefined
      });
      
      // Still log the final success message even if post-processing fails
      console.log('Document processed successfully (despite post-processing error)', { 
        documentId, 
        platformKey,
        textLength,
        confidence,
        pageCount,
        totalProcessingDuration: `${Date.now() - processingStartTime}ms`
      });
    }

  } catch (error) {
    console.error('Error processing document:', error, { bucket, key });
    
    // Calculate processing duration even for failures
    const processingDuration = Date.now() - processingStartTime;
    
    // Try to extract document ID from key for status update
    const pathParts = key.split('/');
    if (pathParts.length >= 4) {
      const documentId = pathParts[3];
      const customerUUID = pathParts[2];
      
      try {
        const errorDetails = EnhancedTextractService.createErrorDetails(error instanceof Error ? error : new Error('Unknown error'));
        await updateDocumentStatus(documentId, customerUUID, 'failed', errorDetails, processingDuration);
      } catch (updateError) {
        console.error('Failed to update document status to failed:', updateError);
      }
    }
    
    throw error;
  }
}

async function updateDocumentStatus(
  documentId: string, 
  customerUUID: string, 
  status: 'processing' | 'completed' | 'failed',
  errorDetails?: ErrorDetails,
  processingDuration?: number
): Promise<void> {
  try {
    const timestamp = new Date().toISOString();
    let updateExpression = 'SET processingStatus = :status, updatedAt = :updatedAt';
    const expressionAttributeValues: any = {
      ':status': status,
      ':updatedAt': timestamp,
    };
    
    if (status === 'processing') {
      updateExpression += ', processingStartedAt = :startedAt';
      expressionAttributeValues[':startedAt'] = timestamp;
    } else if (status === 'completed') {
      updateExpression += ', processingCompletedAt = :completedAt';
      expressionAttributeValues[':completedAt'] = timestamp;
      
      if (processingDuration !== undefined) {
        updateExpression += ', processingDurationMs = :duration';
        expressionAttributeValues[':duration'] = processingDuration;
      }
    } else if (status === 'failed' && errorDetails) {
      updateExpression += ', errorMessage = :errorMessage, errorDetails = :errorDetails';
      expressionAttributeValues[':errorDetails'] = errorDetails;
      expressionAttributeValues[':errorMessage'] = errorDetails.errorMessage;
      
      if (processingDuration !== undefined) {
        updateExpression += ', processingDurationMs = :duration';
        expressionAttributeValues[':duration'] = processingDuration;
      }
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

    console.log('Document status updated', { 
      documentId, 
      status, 
      processingDuration: processingDuration ? `${processingDuration}ms` : 'N/A'
    });
  } catch (error) {
    console.error('Error updating document status:', error);
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
  status: 'completed',
  processingDuration: number
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
      UpdateExpression: 'SET extractedText = :text, textLength = :textLength, processingStatus = :status, updatedAt = :updatedAt, processingCompletedAt = :completedAt, confidence = :confidence, pageCount = :pageCount, processingDurationMs = :duration, textPreview = :preview',
      ExpressionAttributeValues: {
        ':text': extractedText,
        ':textLength': textLength,
        ':status': status,
        ':updatedAt': timestamp,
        ':completedAt': timestamp,
        ':confidence': confidence,
        ':pageCount': pageCount,
        ':duration': processingDuration,
        ':preview': textPreview,
      },
    }));

    console.log('Document updated with extracted text', { 
      documentId, 
      textLength,
      confidence,
      pageCount,
      processingDuration: `${processingDuration}ms`
    });
  } catch (error) {
    console.error('Error updating document with text:', error);
    throw error;
  }
}