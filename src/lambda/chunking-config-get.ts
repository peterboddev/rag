import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ChunkingConfigurationService } from '../services/chunking-configuration';
import { ChunkingConfigurationResponse } from '../types';
import {
  buildErrorResponse,
  structuredLog,
} from '../services/chunking-errors';

const chunkingService = new ChunkingConfigurationService();

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    console.log('Get Chunking Configuration Lambda invoked', { 
      httpMethod: event.httpMethod,
      path: event.path,
      pathParameters: event.pathParameters
    });

    if (event.httpMethod !== 'GET') {
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

    // Get current chunking configuration
    const currentMethod = await chunkingService.getCustomerChunkingConfig(customerUUID, tenantId);
    
    // Get available methods
    const availableMethods = await chunkingService.getAvailableChunkingMethods();
    
    // Check if cleanup is needed
    const cleanupRequired = await chunkingService.needsEmbeddingCleanup(customerUUID, tenantId);

    const response: ChunkingConfigurationResponse = {
      customerUUID,
      currentMethod,
      availableMethods,
      cleanupRequired,
      lastUpdated: new Date().toISOString()
    };

    console.log('Successfully retrieved chunking configuration', { 
      customerUUID,
      currentMethod: currentMethod.id,
      availableMethodCount: availableMethods.length,
      cleanupRequired
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
    const tenantId = extractTenantFromToken(event);
    const customerUUID = event.pathParameters?.customerUUID;
    structuredLog('error', 'Error in get chunking configuration', {
      operation: 'chunking-config-get',
      customerUUID: customerUUID || 'unknown',
      tenantId: tenantId || 'unknown',
      errorMessage: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : 'Unknown',
    });

    return buildErrorResponse(500, error);
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