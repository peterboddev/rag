import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ChunkingMethod, DocumentRecord } from '../types';

// Inline interfaces to avoid import issues
interface DocumentChunk {
  id: string;
  text: string;
  metadata: ChunkMetadata;
  tokenCount: number;
  characterCount: number;
  sourceDocument: {
    documentId: string;
    fileName: string;
    pageNumber?: number;
    sectionTitle?: string;
  };
}

interface ChunkMetadata {
  chunkIndex: number;
  totalChunks: number;
  chunkingMethod: string;
  overlapStart?: number;
  overlapEnd?: number;
  confidence?: number;
  semanticBoundary?: boolean;
}

interface ChunkVisualizationError {
  documentId: string;
  fileName: string;
  errorMessage: string;
  errorType: 'chunking' | 'processing' | 'network' | 'validation' | 'access_denied';
  isRetryable: boolean;
  timestamp: string;
}

export interface ChunkVisualizationRequest {
  customerUUID: string;
  documentIds: string[];
  chunkingMethod?: ChunkingMethod;
}

export interface ChunkVisualizationResponse {
  chunks: Array<{
    id: string;
    text: string;
    tokenCount: number;
    characterCount: number;
    metadata: {
      chunkIndex: number;
      totalChunks: number;
      chunkingMethod: string;
      overlapStart?: number;
      overlapEnd?: number;
      confidence?: number;
      semanticBoundary?: boolean;
    };
    sourceDocument: {
      documentId: string;
      fileName: string;
      pageNumber?: number;
      sectionTitle?: string;
    };
  }>;
  totalChunks: number;
  chunkingMethod: ChunkingMethod;
  processingTime: number;
  generatedAt: string;
  errors?: Array<{
    documentId: string;
    fileName: string;
    errorMessage: string;
    errorType: string;
    isRetryable: boolean;
  }>;
  warnings?: string[];
}

/**
 * Lambda function to generate document chunks for visualization
 * 
 * This endpoint generates chunks from selected documents using the specified
 * chunking method without storing embeddings. It's designed for real-time
 * visualization in the frontend.
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const startTime = Date.now();
  
  console.log('Chunk visualization request received', {
    httpMethod: event.httpMethod,
    path: event.path,
    headers: event.headers,
    requestId: event.requestContext.requestId
  });

  try {
    // Validate HTTP method
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Tenant-Id, Authorization, X-Amz-Date, X-Api-Key'
        },
        body: JSON.stringify({
          error: 'Method not allowed. Use POST.',
          allowedMethods: ['POST']
        })
      };
    }

    // Extract tenant ID from headers
    const tenantId = event.headers['X-Tenant-Id'] || event.headers['x-tenant-id'];
    if (!tenantId) {
      console.error('Missing tenant ID in request headers');
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Tenant-Id, Authorization, X-Amz-Date, X-Api-Key'
        },
        body: JSON.stringify({
          error: 'Missing X-Tenant-Id header',
          details: 'Tenant ID is required for multi-tenant access control'
        })
      };
    }

    // Parse and validate request body
    let requestBody: ChunkVisualizationRequest;
    try {
      if (!event.body) {
        throw new Error('Request body is required');
      }
      requestBody = JSON.parse(event.body);
    } catch (parseError) {
      console.error('Invalid JSON in request body:', parseError);
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Tenant-Id, Authorization, X-Amz-Date, X-Api-Key'
        },
        body: JSON.stringify({
          error: 'Invalid JSON in request body',
          details: parseError instanceof Error ? parseError.message : 'Unknown parsing error'
        })
      };
    }

    // Validate required fields
    const validationErrors: string[] = [];
    
    if (!requestBody.customerUUID || typeof requestBody.customerUUID !== 'string') {
      validationErrors.push('customerUUID is required and must be a string');
    }
    
    if (!requestBody.documentIds || !Array.isArray(requestBody.documentIds)) {
      validationErrors.push('documentIds is required and must be an array');
    } else if (requestBody.documentIds.length === 0) {
      validationErrors.push('At least one document ID must be provided');
    } else if (requestBody.documentIds.length > 50) {
      validationErrors.push('Maximum 50 documents can be processed at once');
    }

    // Validate document IDs
    if (requestBody.documentIds && Array.isArray(requestBody.documentIds)) {
      requestBody.documentIds.forEach((docId, index) => {
        if (!docId || typeof docId !== 'string' || docId.trim().length === 0) {
          validationErrors.push(`Document ID at index ${index} is invalid`);
        }
      });
    }

    // Validate chunking method if provided
    if (requestBody.chunkingMethod) {
      if (!requestBody.chunkingMethod.id || !requestBody.chunkingMethod.name) {
        validationErrors.push('Chunking method must have id and name fields');
      }
      if (!requestBody.chunkingMethod.parameters || !requestBody.chunkingMethod.parameters.strategy) {
        validationErrors.push('Chunking method must have parameters with strategy field');
      }
    }

    if (validationErrors.length > 0) {
      console.error('Request validation failed:', validationErrors);
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Tenant-Id, Authorization, X-Amz-Date, X-Api-Key'
        },
        body: JSON.stringify({
          error: 'Request validation failed',
          details: validationErrors
        })
      };
    }

    console.log('Processing chunk visualization request', {
      customerUUID: requestBody.customerUUID,
      documentCount: requestBody.documentIds.length,
      chunkingMethod: requestBody.chunkingMethod?.id || 'default',
      tenantId
    });

    // Initialize DynamoDB client and generate chunks inline
    const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.REGION }));
    const documentsTable = process.env.DOCUMENTS_TABLE_NAME!;
    
    const result = await generateChunksForVisualization(
      dynamoClient,
      documentsTable,
      requestBody.documentIds,
      requestBody.customerUUID,
      tenantId,
      requestBody.chunkingMethod
    );

    // Check for critical errors
    const criticalErrors = result.errors.filter((error: ChunkVisualizationError) => !error.isRetryable);
    if (criticalErrors.length > 0 && result.chunks.length === 0) {
      console.error('Critical errors in chunk generation:', criticalErrors);
      return {
        statusCode: 422,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Tenant-Id, Authorization, X-Amz-Date, X-Api-Key'
        },
        body: JSON.stringify({
          error: 'Failed to generate chunks',
          details: criticalErrors.map((err: ChunkVisualizationError) => ({
            documentId: err.documentId,
            fileName: err.fileName,
            message: err.errorMessage,
            type: err.errorType
          })),
          retryableErrors: result.errors.filter((error: ChunkVisualizationError) => error.isRetryable).length,
          totalErrors: result.errors.length
        })
      };
    }

    // Prepare response
    const response: ChunkVisualizationResponse = {
      chunks: result.chunks.map((chunk: any) => ({
        id: chunk.id || 'mock-chunk-1',
        text: chunk.text || 'Mock chunk text for CORS testing',
        tokenCount: chunk.tokenCount || 10,
        characterCount: chunk.characterCount || 50,
        metadata: {
          chunkIndex: chunk.metadata?.chunkIndex || 0,
          totalChunks: chunk.metadata?.totalChunks || 1,
          chunkingMethod: chunk.metadata?.chunkingMethod || 'default',
          overlapStart: chunk.metadata?.overlapStart,
          overlapEnd: chunk.metadata?.overlapEnd,
          confidence: chunk.metadata?.confidence,
          semanticBoundary: chunk.metadata?.semanticBoundary
        },
        sourceDocument: {
          documentId: chunk.sourceDocument?.documentId || '',
          fileName: chunk.sourceDocument?.fileName || '',
          pageNumber: chunk.sourceDocument?.pageNumber,
          sectionTitle: chunk.sourceDocument?.sectionTitle
        }
      })),
      totalChunks: result.totalChunks,
      chunkingMethod: requestBody.chunkingMethod || {
        id: 'default',
        name: 'Default Chunking',
        description: 'Default chunking strategy',
        parameters: { strategy: 'default' }
      },
      processingTime: result.processingTime,
      generatedAt: new Date().toISOString()
    };

    // Include errors and warnings if present
    if (result.errors && result.errors.length > 0) {
      response.errors = result.errors.map((error: any) => ({
        documentId: error.documentId,
        fileName: error.fileName,
        errorMessage: error.errorMessage,
        errorType: error.errorType,
        isRetryable: error.isRetryable
      }));
    }

    if (result.warnings && result.warnings.length > 0) {
      response.warnings = result.warnings;
    }

    const totalTime = Date.now() - startTime;
    
    console.log('Chunk visualization completed successfully', {
      totalChunks: result.totalChunks,
      processingTime: result.processingTime,
      totalTime,
      errorCount: result.errors.length,
      warningCount: result.warnings.length,
      requestId: event.requestContext.requestId
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Tenant-Id, Authorization, X-Amz-Date, X-Api-Key',
        'Access-Control-Max-Age': '86400'
      },
      body: JSON.stringify(response)
    };

  } catch (error) {
    const totalTime = Date.now() - startTime;
    
    console.error('Unexpected error in chunk visualization handler:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Tenant-Id, Authorization, X-Amz-Date, X-Api-Key'
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: 'An unexpected error occurred while generating chunks',
        details: error instanceof Error ? error.message : 'Unknown error',
        requestId: event.requestContext.requestId,
        processingTime: totalTime
      })
    };
  }
};

/**
 * Handle OPTIONS requests for CORS preflight
 */
export const optionsHandler = async (): Promise<APIGatewayProxyResult> => {
  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Tenant-Id, Authorization, X-Amz-Date, X-Api-Key',
      'Access-Control-Max-Age': '86400'
    },
    body: ''
  };
};

/**
 * Generate chunks for visualization without storing embeddings (inline implementation)
 */
async function generateChunksForVisualization(
  dynamoClient: DynamoDBDocumentClient,
  documentsTable: string,
  documentIds: string[],
  customerUUID: string,
  tenantId: string,
  chunkingMethod?: ChunkingMethod
): Promise<{
  chunks: DocumentChunk[];
  totalChunks: number;
  processingTime: number;
  errors: ChunkVisualizationError[];
  warnings: string[];
}> {
  const startTime = Date.now();
  const chunks: DocumentChunk[] = [];
  const errors: ChunkVisualizationError[] = [];
  const warnings: string[] = [];

  try {
    console.log('Generating chunks for visualization', {
      documentIds: documentIds.length,
      customerUUID,
      chunkingMethod: chunkingMethod?.id || 'default'
    });

    // Limit concurrent document processing to prevent memory issues
    const maxConcurrentDocs = 3;
    const documentBatches = [];
    
    for (let i = 0; i < documentIds.length; i += maxConcurrentDocs) {
      documentBatches.push(documentIds.slice(i, i + maxConcurrentDocs));
    }

    let globalChunkIndex = 0; // Track global chunk index across all documents

    // Process documents in batches
    for (const batch of documentBatches) {
      const batchPromises = batch.map(async (documentId) => {
        try {
          const result = await dynamoClient.send(new QueryCommand({
            TableName: documentsTable,
            KeyConditionExpression: 'id = :documentId',
            ExpressionAttributeValues: {
              ':documentId': documentId
            }
          }));

          if (result.Items && result.Items.length > 0) {
            const document = result.Items[0] as DocumentRecord;
            
            // Verify access and processing status
            if (document.customerUuid === customerUUID && 
                document.tenantId === tenantId && 
                document.processingStatus === 'completed' && 
                document.extractedText) {
              
              // Check document size and warn if very large
              const textLength = document.extractedText.length;
              if (textLength > 1000000) { // 1MB of text
                warnings.push(`Document ${document.fileName} is very large (${Math.round(textLength/1000)}KB) and may take longer to process`);
              }
              
              // Generate chunks for this document
              const documentChunks = await generateDocumentChunks(document, chunkingMethod, globalChunkIndex);
              return documentChunks;
            } else {
              errors.push({
                documentId,
                fileName: document.fileName || 'Unknown',
                errorMessage: 'Document not accessible or not processed',
                errorType: 'access_denied',
                isRetryable: false,
                timestamp: new Date().toISOString()
              });
              return [];
            }
          } else {
            errors.push({
              documentId,
              fileName: 'Unknown',
              errorMessage: 'Document not found',
              errorType: 'validation',
              isRetryable: false,
              timestamp: new Date().toISOString()
            });
            return [];
          }
        } catch (error) {
          console.error(`Error processing document ${documentId}:`, error);
          errors.push({
            documentId,
            fileName: 'Unknown',
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
            errorType: 'processing',
            isRetryable: true,
            timestamp: new Date().toISOString()
          });
          return [];
        }
      });

      // Wait for batch to complete and collect chunks
      const batchResults = await Promise.all(batchPromises);
      batchResults.forEach(documentChunks => {
        chunks.push(...documentChunks);
        globalChunkIndex += documentChunks.length; // Update global index
      });

      // Force garbage collection hint between batches
      if (global.gc) {
        global.gc();
      }
    }

    const processingTime = Date.now() - startTime;

    // Update all chunks with correct totalChunks after processing all documents
    const totalChunks = chunks.length;
    chunks.forEach((chunk, index) => {
      chunk.metadata.chunkIndex = index + 1; // 1-based indexing for display
      chunk.metadata.totalChunks = totalChunks;
    });

    // Add warning if we hit chunk limits
    if (totalChunks >= 1500) { // Close to our processing limit
      warnings.push(`Generated ${totalChunks} chunks. Consider using fewer documents or smaller chunk sizes for better performance.`);
    }

    return {
      chunks,
      totalChunks,
      processingTime,
      errors,
      warnings
    };

  } catch (error) {
    console.error('Error in chunk visualization service:', error);
    
    return {
      chunks: [],
      totalChunks: 0,
      processingTime: Date.now() - startTime,
      errors: [{
        documentId: 'all',
        fileName: 'Multiple',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorType: 'processing',
        isRetryable: true,
        timestamp: new Date().toISOString()
      }],
      warnings: []
    };
  }
}

/**
 * Generate chunks for a single document (inline implementation with memory optimization)
 */
async function generateDocumentChunks(
  document: DocumentRecord,
  chunkingMethod?: ChunkingMethod,
  startingChunkIndex: number = 0
): Promise<DocumentChunk[]> {
  const chunks: DocumentChunk[] = [];
  const text = document.extractedText || '';
  
  if (!text.trim()) {
    return chunks;
  }

  // Use default chunking method if none provided
  const method = chunkingMethod || {
    id: 'fixed_size_512',
    name: 'Fixed Size (512 tokens)',
    description: 'Default chunking for visualization',
    parameters: { strategy: 'fixed_size', chunkSize: 512, chunkOverlap: 50 }
  };

  // Memory-optimized chunking for large documents
  const chunkSize = method.parameters.chunkSize || 512;
  const overlap = method.parameters.chunkOverlap || 50;
  
  // Estimate tokens (rough approximation: 1 token ≈ 4 characters)
  const chunkSizeChars = chunkSize * 4;
  const overlapChars = overlap * 4;
  
  // Limit maximum chunks per document to prevent memory issues
  const maxChunksPerDoc = 250; // Reasonable limit per document
  
  let startIndex = 0;
  let localChunkIndex = 0; // Local index within this document
  
  while (startIndex < text.length && localChunkIndex < maxChunksPerDoc) {
    const endIndex = Math.min(startIndex + chunkSizeChars, text.length);
    const chunkText = text.substring(startIndex, endIndex);
    
    if (chunkText.trim()) {
      chunks.push({
        id: `${document.id}-chunk-${localChunkIndex}`,
        text: chunkText,
        metadata: {
          chunkIndex: startingChunkIndex + localChunkIndex, // Will be updated later with correct global index
          totalChunks: 0, // Will be updated later with correct total
          chunkingMethod: method.id,
          overlapStart: localChunkIndex > 0 ? overlap : 0,
          overlapEnd: endIndex < text.length ? overlap : 0,
          confidence: 1.0,
          semanticBoundary: false
        },
        tokenCount: Math.ceil(chunkText.length / 4),
        characterCount: chunkText.length,
        sourceDocument: {
          documentId: document.id,
          fileName: document.fileName || 'Unknown',
          pageNumber: 1
        }
      });
    }
    
    // Move to next chunk with overlap
    const nextStart = endIndex - overlapChars;
    
    // Prevent infinite loop - ensure we're making progress
    if (nextStart <= startIndex) {
      startIndex = endIndex;
    } else {
      startIndex = nextStart;
    }
    
    localChunkIndex++;
    
    // Additional safety check
    if (startIndex >= text.length) {
      break;
    }
  }

  console.log(`Generated ${chunks.length} chunks for document ${document.fileName}`);
  
  return chunks;
}