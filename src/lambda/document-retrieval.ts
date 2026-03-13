import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const s3Client = new S3Client({ region: process.env.REGION });
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.REGION }));

const DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE_NAME!;
const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET!;
const PRESIGNED_URL_EXPIRATION = 3600; // 1 hour in seconds

interface DocumentRetrievalResponse {
  documentUrl: string;
  contentType: string;
  fileName: string;
}

/**
 * Structured logging helper
 */
function logStructured(level: 'INFO' | 'WARN' | 'ERROR', message: string, metadata: Record<string, any> = {}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    service: 'document-retrieval',
    ...metadata
  };
  console.log(JSON.stringify(logEntry));
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    logStructured('INFO', 'Document Retrieval Lambda invoked', {
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

    // Extract documentId from path parameters
    const documentId = event.pathParameters?.documentId;
    
    if (!documentId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Missing documentId parameter' }),
      };
    }

    logStructured('INFO', 'Retrieving document', { documentId });

    // Query DynamoDB to get document metadata
    const documentRecord = await dynamoClient.send(new GetCommand({
      TableName: DOCUMENTS_TABLE,
      Key: { id: documentId }
    }));

    if (!documentRecord.Item) {
      logStructured('WARN', 'Document not found', { documentId });
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Document not found' }),
      };
    }

    const { s3Key, contentType, fileName } = documentRecord.Item;

    // Generate presigned URL for document access
    const command = new GetObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: s3Key
    });

    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: PRESIGNED_URL_EXPIRATION
    });

    logStructured('INFO', 'Generated presigned URL', {
      documentId,
      fileName,
      expiresIn: PRESIGNED_URL_EXPIRATION
    });

    const response: DocumentRetrievalResponse = {
      documentUrl: presignedUrl,
      contentType: contentType || 'application/octet-stream',
      fileName: fileName || 'document'
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(response),
    };

  } catch (error) {
    logStructured('ERROR', 'Error in document retrieval', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });

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
