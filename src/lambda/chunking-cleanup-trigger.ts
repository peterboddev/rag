import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { EmbeddingCleanupService } from '../services/embedding-cleanup';
import { EmbeddingCleanupRequest, EmbeddingCleanupResponse } from '../types';

const cleanupService = new EmbeddingCleanupService();

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    console.log('Trigger Chunking Cleanup Lambda invoked', { 
      httpMethod: event.httpMethod,
      path: event.path,
      pathParameters: event.pathParameters
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

    // Parse request body (optional)
    const request: EmbeddingCleanupRequest = event.body ? JSON.parse(event.body) : { customerUUID };

    console.log('Starting manual embedding cleanup', { 
      customerUUID,
      tenantId,
      force: request.force || false
    });

    // Trigger the cleanup process
    const cleanupResult = await cleanupService.cleanupCustomerEmbeddings(customerUUID, tenantId);

    const response: EmbeddingCleanupResponse = {
      jobId: cleanupResult.jobId,
      status: cleanupResult.success ? 'completed' : 'failed',
      embeddingsToRemove: cleanupResult.embeddingsRemoved,
      estimatedDuration: cleanupResult.duration,
      message: cleanupResult.success 
        ? `Successfully cleaned up ${cleanupResult.embeddingsRemoved} embeddings and queued ${cleanupResult.documentsQueued} documents for reprocessing`
        : `Cleanup failed with ${cleanupResult.errors.length} errors: ${cleanupResult.errors.join(', ')}`,
      diagnostics: cleanupResult.diagnostics
    };

    console.log('Manual embedding cleanup completed', { 
      customerUUID,
      jobId: cleanupResult.jobId,
      success: cleanupResult.success,
      embeddingsRemoved: cleanupResult.embeddingsRemoved,
      documentsQueued: cleanupResult.documentsQueued
    });

    return {
      statusCode: cleanupResult.success ? 200 : 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(response),
    };

  } catch (error) {
    console.error('Error in trigger chunking cleanup:', error);
    
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