import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { EmbeddingGenerationService } from '../services/embedding-generation';
import { ChunkingConfigurationService } from '../services/chunking-configuration';
import { DocumentRecord, ChunkingMethod } from '../types';

export interface EmbeddingGenerationRequest {
  customerUUID: string;
  documentIds?: string[]; // Optional - if not provided, process all customer documents
  chunkingMethod: ChunkingMethod;
  force?: boolean; // Force regeneration even if embeddings exist
}

export interface EmbeddingGenerationResponse {
  success: boolean;
  jobId: string;
  message: string;
  documentsToProcess: number;
  estimatedDuration: string;
  chunkingMethod: ChunkingMethod;
  startedAt: string;
}

/**
 * Lambda function to manually generate embeddings for documents
 * 
 * This endpoint allows users to generate embeddings after selecting
 * a chunking method, enabling testing of different chunking strategies.
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const startTime = Date.now();
  
  console.log('Manual embedding generation request received', {
    httpMethod: event.httpMethod,
    path: event.path,
    headers: event.headers,
    requestId: event.requestContext.requestId
  });

  try {
    // Handle OPTIONS requests for CORS preflight
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Tenant-Id, Authorization, X-Amz-Date, X-Api-Key',
          'Access-Control-Max-Age': '86400'
        },
        body: ''
      };
    }

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
    let requestBody: EmbeddingGenerationRequest;
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
    
    if (!requestBody.chunkingMethod || typeof requestBody.chunkingMethod !== 'object') {
      validationErrors.push('chunkingMethod is required and must be an object');
    } else {
      if (!requestBody.chunkingMethod.id || !requestBody.chunkingMethod.name) {
        validationErrors.push('chunkingMethod must have id and name fields');
      }
      if (!requestBody.chunkingMethod.parameters || !requestBody.chunkingMethod.parameters.strategy) {
        validationErrors.push('chunkingMethod must have parameters with strategy field');
      }
    }

    if (requestBody.documentIds && !Array.isArray(requestBody.documentIds)) {
      validationErrors.push('documentIds must be an array if provided');
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

    console.log('Processing manual embedding generation request', {
      customerUUID: requestBody.customerUUID,
      chunkingMethod: requestBody.chunkingMethod.id,
      documentIds: requestBody.documentIds?.length || 'all',
      force: requestBody.force || false,
      tenantId
    });

    // Initialize services
    const embeddingService = new EmbeddingGenerationService();
    const chunkingService = new ChunkingConfigurationService();
    const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.REGION }));

    // Validate chunking method
    if (!chunkingService.validateChunkingMethod(requestBody.chunkingMethod)) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Tenant-Id, Authorization, X-Amz-Date, X-Api-Key'
        },
        body: JSON.stringify({
          error: 'Invalid chunking method',
          details: `Chunking method ${requestBody.chunkingMethod.id} is not supported or has invalid parameters`
        })
      };
    }

    // Get documents to process
    const documents = await getDocumentsToProcess(
      dynamoClient,
      requestBody.customerUUID,
      tenantId,
      requestBody.documentIds
    );

    if (documents.length === 0) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Tenant-Id, Authorization, X-Amz-Date, X-Api-Key'
        },
        body: JSON.stringify({
          error: 'No documents found',
          details: requestBody.documentIds 
            ? 'None of the specified documents were found or are ready for processing'
            : 'No processed documents found for this customer'
        })
      };
    }

    // Generate unique job ID
    const jobId = `emb-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const startedAt = new Date().toISOString();

    // Start embedding generation (async process)
    processEmbeddingsAsync(
      embeddingService,
      chunkingService,
      documents,
      requestBody.chunkingMethod,
      requestBody.customerUUID,
      tenantId,
      jobId,
      requestBody.force || false
    ).catch(error => {
      console.error('Async embedding generation failed:', error, { jobId });
    });

    // Estimate duration (rough calculation: 2 seconds per document + chunking time)
    const estimatedSeconds = documents.length * 2 + 10;
    const estimatedDuration = estimatedSeconds > 60 
      ? `${Math.ceil(estimatedSeconds / 60)} minutes`
      : `${estimatedSeconds} seconds`;

    const response: EmbeddingGenerationResponse = {
      success: true,
      jobId,
      message: `Started embedding generation for ${documents.length} document(s) using ${requestBody.chunkingMethod.name}`,
      documentsToProcess: documents.length,
      estimatedDuration,
      chunkingMethod: requestBody.chunkingMethod,
      startedAt
    };

    const totalTime = Date.now() - startTime;
    
    console.log('Manual embedding generation started successfully', {
      jobId,
      documentsToProcess: documents.length,
      chunkingMethod: requestBody.chunkingMethod.id,
      estimatedDuration,
      requestTime: totalTime,
      requestId: event.requestContext.requestId
    });

    return {
      statusCode: 202, // Accepted - processing started
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
    
    console.error('Unexpected error in manual embedding generation handler:', error);
    
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
        message: 'An unexpected error occurred while starting embedding generation',
        details: error instanceof Error ? error.message : 'Unknown error',
        requestId: event.requestContext.requestId,
        processingTime: totalTime
      })
    };
  }
};

/**
 * Get documents that are ready for embedding generation
 */
async function getDocumentsToProcess(
  dynamoClient: DynamoDBDocumentClient,
  customerUUID: string,
  tenantId: string,
  documentIds?: string[]
): Promise<DocumentRecord[]> {
  const documents: DocumentRecord[] = [];
  const documentsTable = process.env.DOCUMENTS_TABLE_NAME!;

  if (documentIds && documentIds.length > 0) {
    // Process specific documents
    for (const documentId of documentIds) {
      try {
        const result = await dynamoClient.send(new QueryCommand({
          TableName: documentsTable,
          KeyConditionExpression: 'id = :documentId AND customerUuid = :customerUUID',
          ExpressionAttributeValues: {
            ':documentId': documentId,
            ':customerUUID': customerUUID
          }
        }));

        if (result.Items && result.Items.length > 0) {
          const document = result.Items[0] as DocumentRecord;
          
          // Verify tenant access and processing status
          if (document.tenantId === tenantId && 
              document.processingStatus === 'completed' && 
              document.extractedText) {
            documents.push(document);
          }
        }
      } catch (error) {
        console.error(`Error retrieving document ${documentId}:`, error);
      }
    }
  } else {
    // Process all customer documents
    try {
      const result = await dynamoClient.send(new QueryCommand({
        TableName: documentsTable,
        IndexName: 'customer-documents-index', // GSI on customerUuid
        KeyConditionExpression: 'customerUuid = :customerUUID',
        FilterExpression: 'tenantId = :tenantId AND processingStatus = :status AND attribute_exists(extractedText)',
        ExpressionAttributeValues: {
          ':customerUUID': customerUUID,
          ':tenantId': tenantId,
          ':status': 'completed'
        }
      }));

      if (result.Items) {
        documents.push(...(result.Items as DocumentRecord[]));
      }
    } catch (error) {
      console.error('Error retrieving customer documents:', error);
    }
  }

  return documents;
}

/**
 * Process embeddings asynchronously
 */
async function processEmbeddingsAsync(
  embeddingService: EmbeddingGenerationService,
  chunkingService: ChunkingConfigurationService,
  documents: DocumentRecord[],
  chunkingMethod: ChunkingMethod,
  customerUUID: string,
  tenantId: string,
  jobId: string,
  force: boolean
): Promise<void> {
  console.log('Starting async embedding generation', {
    jobId,
    documentCount: documents.length,
    chunkingMethod: chunkingMethod.id,
    force
  });

  let successCount = 0;
  let errorCount = 0;
  const errors: string[] = [];

  try {
    // Update customer's chunking method
    await chunkingService.updateCustomerChunkingConfig(customerUUID, tenantId, chunkingMethod);
    
    // Process each document
    for (const document of documents) {
      try {
        console.log(`Processing document ${document.id} with ${chunkingMethod.id}`, { jobId });
        
        const result = await embeddingService.generateDocumentEmbeddings(document, chunkingMethod);
        
        if (result.success) {
          successCount++;
          console.log(`Successfully generated embeddings for document ${document.id}`, {
            jobId,
            embeddingCount: result.embeddingIds.length,
            chunksProcessed: result.chunksProcessed
          });
        } else {
          errorCount++;
          errors.push(`Document ${document.fileName}: ${result.errors.join(', ')}`);
          console.error(`Failed to generate embeddings for document ${document.id}`, {
            jobId,
            errors: result.errors
          });
        }
      } catch (error) {
        errorCount++;
        const errorMsg = `Document ${document.fileName}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        errors.push(errorMsg);
        console.error(`Error processing document ${document.id}:`, error, { jobId });
      }
    }

    console.log('Async embedding generation completed', {
      jobId,
      totalDocuments: documents.length,
      successCount,
      errorCount,
      chunkingMethod: chunkingMethod.id
    });

  } catch (error) {
    console.error('Critical error in async embedding generation:', error, { jobId });
  }
}

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