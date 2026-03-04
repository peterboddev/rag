import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBDocumentClient, GetCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DocumentRecord } from '../types';

const s3Client = new S3Client({ region: process.env.REGION });
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.REGION }));

const DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE_NAME!;
const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET!;
const PLATFORM_DOCUMENTS_BUCKET = process.env.PLATFORM_DOCUMENTS_BUCKET!;

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    console.log('Document Delete Lambda invoked', { 
      httpMethod: event.httpMethod,
      path: event.path 
    });

    if (event.httpMethod !== 'DELETE') {
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

    console.log('Deleting document', { 
      documentId, 
      customerUUID, 
      fileName: document.fileName,
      s3Key: document.s3Key
    });

    // Delete from S3 (original document)
    try {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: DOCUMENTS_BUCKET,
        Key: document.s3Key,
      }));
      console.log('Deleted original document from S3', { s3Key: document.s3Key });
    } catch (s3Error) {
      console.warn('Failed to delete original document from S3 (may not exist)', { 
        s3Key: document.s3Key, 
        error: s3Error instanceof Error ? s3Error.message : 'Unknown error'
      });
    }

    // Delete processed document from platform bucket (if it exists)
    const platformKey = `processed/${tenantId}/${customerUUID}/${documentId}.txt`;
    try {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: PLATFORM_DOCUMENTS_BUCKET,
        Key: platformKey,
      }));
      console.log('Deleted processed document from platform bucket', { platformKey });
    } catch (s3Error) {
      console.warn('Failed to delete processed document from platform bucket (may not exist)', { 
        platformKey, 
        error: s3Error instanceof Error ? s3Error.message : 'Unknown error'
      });
    }

    // Delete from DynamoDB
    await dynamoClient.send(new DeleteCommand({
      TableName: DOCUMENTS_TABLE,
      Key: {
        id: documentId,
        customerUuid: customerUUID,
      },
    }));

    console.log('Document deleted successfully', { 
      documentId, 
      fileName: document.fileName
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        message: 'Document deleted successfully',
        documentId,
        fileName: document.fileName
      }),
    };

  } catch (error) {
    console.error('Error deleting document:', error);
    
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