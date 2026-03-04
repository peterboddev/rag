import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { CustomerRecord, CleanupStatusResponse } from '../types';

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.REGION }));
const CUSTOMERS_TABLE = process.env.CUSTOMERS_TABLE_NAME!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    console.log('Get Chunking Cleanup Status Lambda invoked', { 
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

    // Extract customerUUID and jobId from path parameters
    const customerUUID = event.pathParameters?.customerUUID;
    const jobId = event.pathParameters?.jobId;
    
    if (!customerUUID || !jobId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Missing customerUUID or jobId in path' }),
      };
    }

    // Get customer record to check cleanup status
    const result = await dynamoClient.send(new GetCommand({
      TableName: CUSTOMERS_TABLE,
      Key: {
        uuid: customerUUID,
        tenantId: tenantId
      }
    }));

    if (!result.Item) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Customer not found' }),
      };
    }

    const customer = result.Item as CustomerRecord;

    // Create cleanup status response
    const response: CleanupStatusResponse = {
      jobId,
      status: customer.chunkingCleanupStatus === 'none' ? 'pending' : customer.chunkingCleanupStatus || 'pending',
      progress: customer.chunkingCleanupStatus === 'completed' ? 100 : 
                customer.chunkingCleanupStatus === 'in_progress' ? 50 : 0,
      embeddingsRemoved: 0, // This would need to be tracked separately for detailed reporting
      embeddingsToRemove: 0, // This would need to be calculated
      documentsReprocessed: 0, // This would need to be tracked separately
      errors: [],
      startedAt: customer.lastChunkingUpdate || new Date().toISOString(),
      completedAt: customer.chunkingCleanupStatus === 'completed' ? customer.lastCleanupAt : undefined
    };

    console.log('Successfully retrieved cleanup status', { 
      customerUUID,
      jobId,
      status: response.status,
      progress: response.progress
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
    console.error('Error in get chunking cleanup status:', error);
    
    const statusCode = error instanceof Error && error.message.includes('not found') ? 404 : 500;
    
    return {
      statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ 
        error: statusCode === 404 ? 'Customer or job not found' : 'Internal server error',
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