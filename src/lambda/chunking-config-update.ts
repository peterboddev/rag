import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ChunkingConfigurationService } from '../services/chunking-configuration';
import { EmbeddingCleanupService } from '../services/embedding-cleanup';
import { EmbeddingGenerationService } from '../services/embedding-generation';
import { ChunkingConfigurationRequest } from '../types';

const chunkingService = new ChunkingConfigurationService();
const cleanupService = new EmbeddingCleanupService();
const embeddingService = new EmbeddingGenerationService();

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    console.log('Update Chunking Configuration Lambda invoked', { 
      httpMethod: event.httpMethod,
      path: event.path,
      pathParameters: event.pathParameters
    });

    if (event.httpMethod !== 'PUT') {
      return {
        statusCode: 405,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Method not allowed' }),
      };
    }

    // Extract tenant_id from JWT token or headers
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

    // Extract customerUUID from path parameters
    const customerUUID = event.pathParameters?.customerUUID;
    if (!customerUUID) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Missing customerUUID in path' }),
      };
    }

    // Parse request body
    const request: ChunkingConfigurationRequest = JSON.parse(event.body || '{}');
    if (!request.chunkingMethod) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Missing chunkingMethod in request body' }),
      };
    }

    // Validate the chunking method
    if (!chunkingService.validateChunkingMethod(request.chunkingMethod)) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Invalid chunking method configuration' }),
      };
    }

    // Get current configuration to check if cleanup is needed
    const currentMethod = await chunkingService.getCustomerChunkingConfig(customerUUID, tenantId);
    const methodChanged = currentMethod.id !== request.chunkingMethod.id;

    // Update the chunking configuration
    await chunkingService.updateCustomerChunkingConfig(
      customerUUID, 
      tenantId, 
      request.chunkingMethod
    );

    let cleanupResult = null;
    let regenerationResult = null;
    
    // If method changed, trigger embedding cleanup and regeneration
    if (methodChanged) {
      console.log('Chunking method changed, triggering embedding cleanup and regeneration', {
        customerUUID,
        oldMethod: currentMethod.id,
        newMethod: request.chunkingMethod.id
      });

      try {
        // Step 1: Clean up old embeddings
        cleanupResult = await cleanupService.cleanupCustomerEmbeddings(customerUUID, tenantId);
        console.log('Embedding cleanup completed', { 
          customerUUID, 
          success: cleanupResult.success,
          embeddingsRemoved: cleanupResult.embeddingsRemoved
        });

        // Step 2: Regenerate embeddings with new chunking method
        if (cleanupResult.success) {
          console.log('Starting embedding regeneration with new chunking method', {
            customerUUID,
            newMethod: request.chunkingMethod.id
          });

          regenerationResult = await regenerateCustomerEmbeddings(customerUUID, tenantId, request.chunkingMethod);
          
          console.log('Embedding regeneration completed', {
            customerUUID,
            success: regenerationResult.success,
            documentsProcessed: regenerationResult.documentsProcessed,
            totalEmbeddings: regenerationResult.totalEmbeddings
          });
        }

      } catch (cleanupError) {
        console.error('Embedding cleanup/regeneration failed:', cleanupError);
        // Don't fail the entire request if cleanup fails
        // The configuration update was successful
      }
    }

    const response = {
      customerUUID,
      chunkingMethod: request.chunkingMethod,
      methodChanged,
      cleanupTriggered: methodChanged,
      cleanupResult: cleanupResult ? {
        success: cleanupResult.success,
        embeddingsRemoved: cleanupResult.embeddingsRemoved,
        documentsQueued: cleanupResult.documentsQueued,
        jobId: cleanupResult.jobId,
        errors: cleanupResult.errors
      } : null,
      regenerationResult: regenerationResult ? {
        success: regenerationResult.success,
        documentsProcessed: regenerationResult.documentsProcessed,
        totalEmbeddings: regenerationResult.totalEmbeddings,
        errors: regenerationResult.errors
      } : null,
      updatedAt: new Date().toISOString()
    };

    console.log('Successfully updated chunking configuration', { 
      customerUUID,
      method: request.chunkingMethod.id,
      methodChanged,
      cleanupSuccess: cleanupResult?.success,
      regenerationSuccess: regenerationResult?.success
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
    console.error('Error in update chunking configuration:', error);
    
    const statusCode = error instanceof Error && error.message.includes('not found') ? 404 : 500;
    
    return {
      statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ 
        error: statusCode === 404 ? 'Customer not found' : 'Internal server error',
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

/**
 * Regenerate embeddings for all customer documents with new chunking method
 */
async function regenerateCustomerEmbeddings(
  customerUUID: string, 
  tenantId: string, 
  chunkingMethod: any
): Promise<{
  success: boolean;
  documentsProcessed: number;
  totalEmbeddings: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let documentsProcessed = 0;
  let totalEmbeddings = 0;

  try {
    console.log('Starting embedding regeneration for customer', { customerUUID, chunkingMethod: chunkingMethod.id });

    // Get all customer documents that have extracted text
    const documents = await cleanupService.getCustomerDocuments(customerUUID, tenantId);
    const documentsWithText = documents.filter(doc => 
      doc.extractedText && 
      doc.extractedText.trim().length > 0 &&
      doc.processingStatus === 'completed'
    );

    console.log('Found documents for embedding regeneration', {
      customerUUID,
      totalDocuments: documents.length,
      documentsWithText: documentsWithText.length
    });

    // Process each document
    for (const document of documentsWithText) {
      try {
        console.log('Regenerating embeddings for document', {
          documentId: document.id,
          fileName: document.fileName,
          textLength: document.extractedText?.length
        });

        const embeddingResult = await embeddingService.generateDocumentEmbeddings(
          document,
          chunkingMethod
        );

        if (embeddingResult.success) {
          documentsProcessed++;
          totalEmbeddings += embeddingResult.embeddingIds.length;
          console.log('Successfully regenerated embeddings for document', {
            documentId: document.id,
            embeddingCount: embeddingResult.embeddingIds.length
          });
        } else {
          const errorMsg = `Failed to regenerate embeddings for document ${document.id}: ${embeddingResult.errors.join(', ')}`;
          console.error(errorMsg);
          errors.push(errorMsg);
        }

        // Rate limiting between documents
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (docError) {
        const errorMsg = `Error processing document ${document.id}: ${docError instanceof Error ? docError.message : 'Unknown error'}`;
        console.error(errorMsg);
        errors.push(errorMsg);
      }
    }

    const success = errors.length === 0;
    console.log('Embedding regeneration completed', {
      customerUUID,
      success,
      documentsProcessed,
      totalEmbeddings,
      errorCount: errors.length
    });

    return {
      success,
      documentsProcessed,
      totalEmbeddings,
      errors
    };

  } catch (error) {
    const errorMsg = `Critical error during embedding regeneration: ${error instanceof Error ? error.message : 'Unknown error'}`;
    console.error(errorMsg);
    errors.push(errorMsg);

    return {
      success: false,
      documentsProcessed,
      totalEmbeddings,
      errors
    };
  }
}