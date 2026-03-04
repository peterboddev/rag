import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { ChunkingConfigurationService } from '../services/chunking-configuration';

const chunkingService = new ChunkingConfigurationService();

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    console.log('List Chunking Methods Lambda invoked', { 
      httpMethod: event.httpMethod,
      path: event.path
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

    // Get all available chunking methods
    const availableMethods = await chunkingService.getAvailableChunkingMethods();

    const response = {
      methods: availableMethods,
      count: availableMethods.length,
      retrievedAt: new Date().toISOString()
    };

    console.log('Successfully retrieved available chunking methods', { 
      methodCount: availableMethods.length,
      methods: availableMethods.map(m => m.id)
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
    console.error('Error in list chunking methods:', error);
    
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