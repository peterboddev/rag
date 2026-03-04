import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({ region: process.env.REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const DOCUMENTS_TABLE_NAME = process.env.DOCUMENTS_TABLE_NAME || 'rag-app-v2-documents-dev';

interface ClaimStatus {
  claimId: string;
  status: 'not_loaded' | 'loading' | 'processing' | 'completed' | 'failed';
  documentsProcessed: number;
  totalDocuments: number;
  documents: DocumentStatus[];
}

interface DocumentStatus {
  documentId: string;
  fileName: string;
  processingStatus: string;
  documentType?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Lambda handler for GET /claims/{claimId}/status
 * Retrieves claim processing status from DynamoDB
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Claim Status Request:', JSON.stringify(event, null, 2));

  try {
    // Extract claim ID from path parameters
    const claimId = event.pathParameters?.claimId;
    
    if (!claimId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'Missing claimId',
          message: 'Claim ID is required in the path'
        }),
      };
    }

    // Query documents table for all documents with this claim ID
    const documents = await queryClaimDocuments(claimId);

    if (documents.length === 0) {
      // Claim not loaded yet
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          claimId,
          status: 'not_loaded',
          documentsProcessed: 0,
          totalDocuments: 0,
          documents: [],
        } as ClaimStatus),
      };
    }

    // Calculate overall status
    const totalDocuments = documents.length;
    const completedDocuments = documents.filter(d => d.processingStatus === 'completed').length;
    const failedDocuments = documents.filter(d => d.processingStatus === 'failed').length;
    const processingDocuments = documents.filter(d => 
      d.processingStatus === 'processing' || d.processingStatus === 'queued'
    ).length;

    let overallStatus: ClaimStatus['status'];
    if (failedDocuments === totalDocuments) {
      overallStatus = 'failed';
    } else if (completedDocuments === totalDocuments) {
      overallStatus = 'completed';
    } else if (processingDocuments > 0) {
      overallStatus = 'processing';
    } else {
      overallStatus = 'loading';
    }

    const claimStatus: ClaimStatus = {
      claimId,
      status: overallStatus,
      documentsProcessed: completedDocuments,
      totalDocuments,
      documents: documents.map(doc => ({
        documentId: doc.id,
        fileName: doc.fileName,
        processingStatus: doc.processingStatus,
        documentType: doc.claimMetadata?.documentType,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      })),
    };

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify(claimStatus),
    };
  } catch (error) {
    console.error('Error retrieving claim status:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      }),
    };
  }
};

/**
 * Query documents table for all documents with a specific claim ID
 */
async function queryClaimDocuments(claimId: string): Promise<any[]> {
  try {
    // Use Scan with filter since we don't have a GSI on claimId yet
    // In production, consider adding a GSI for better performance
    const command = new QueryCommand({
      TableName: DOCUMENTS_TABLE_NAME,
      IndexName: 'tenant-documents-index', // Use existing GSI
      KeyConditionExpression: 'tenantId = :tenantId',
      FilterExpression: 'claimMetadata.claimId = :claimId',
      ExpressionAttributeValues: {
        ':tenantId': 'default', // For now, use default tenant
        ':claimId': claimId,
      },
    });

    const response = await docClient.send(command);
    return response.Items || [];
  } catch (error) {
    console.error('Error querying claim documents:', error);
    
    // Fallback: try without tenant filter if the above fails
    try {
      // This is less efficient but will work if tenant structure is different
      const scanCommand = new QueryCommand({
        TableName: DOCUMENTS_TABLE_NAME,
        IndexName: 'tenant-documents-index',
        KeyConditionExpression: 'tenantId = :tenantId',
        ExpressionAttributeValues: {
          ':tenantId': 'default',
        },
      });

      const scanResponse = await docClient.send(scanCommand);
      const allDocs = scanResponse.Items || [];
      
      // Filter in memory for claim ID
      return allDocs.filter(doc => 
        doc.claimMetadata && doc.claimMetadata.claimId === claimId
      );
    } catch (fallbackError) {
      console.error('Fallback query also failed:', fallbackError);
      throw new Error('Failed to query claim documents');
    }
  }
}
