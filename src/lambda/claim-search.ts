import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { BedrockAgentRuntimeClient, RetrieveCommand } from '@aws-sdk/client-bedrock-agent-runtime';

const dynamoClient = new DynamoDBClient({ region: process.env.REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const bedrockAgent = new BedrockAgentRuntimeClient({ region: process.env.BEDROCK_REGION || 'us-east-1' });

const DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE_NAME || 'rag-app-v2-documents-dev';
const KNOWLEDGE_BASE_ID = process.env.KNOWLEDGE_BASE_ID || '';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

export interface SearchResult {
  documentId: string;
  claimId: string;
  fileName: string;
  excerpt: string;
  score: number;
  documentType?: string;
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  totalResults: number;
}

/**
 * Lambda handler for POST /claims/search
 * Performs semantic search across claim documents using the Knowledge Base.
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Claim Search Request:', JSON.stringify({ method: event.httpMethod, path: event.path }));

  try {
    const body = JSON.parse(event.body || '{}');
    const { query, documentType, limit } = body as { query?: string; documentType?: string; limit?: number };

    if (!query || query.trim().length === 0) {
      return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing or empty query' }) };
    }

    const maxResults = Math.min(limit || 10, 20);

    // Use Bedrock Knowledge Base for semantic retrieval
    let results: SearchResult[] = [];

    if (KNOWLEDGE_BASE_ID) {
      const retrieveResponse = await bedrockAgent.send(new RetrieveCommand({
        knowledgeBaseId: KNOWLEDGE_BASE_ID,
        retrievalQuery: { text: query },
        retrievalConfiguration: {
          vectorSearchConfiguration: { numberOfResults: maxResults },
        },
      }));

      const kbResults = retrieveResponse.retrievalResults || [];

      // Enrich results with document metadata from DynamoDB
      for (const r of kbResults) {
        const uri = r.location?.s3Location?.uri || '';
        const score = r.score ?? 0;
        const excerpt = r.content?.text || '';

        // Try to find matching document in DynamoDB by s3Key
        const docMeta = await findDocumentByS3Key(uri);

        results.push({
          documentId: docMeta?.documentId || uri,
          claimId: docMeta?.claimMetadata?.claimId || 'unknown',
          fileName: docMeta?.fileName || uri.split('/').pop() || 'unknown',
          excerpt: excerpt.substring(0, 500),
          score,
          documentType: docMeta?.claimMetadata?.documentType,
        });
      }
    } else {
      // Fallback: text search in DynamoDB (basic substring match)
      results = await fallbackTextSearch(query, maxResults);
    }

    // Filter by document type if specified
    if (documentType) {
      results = results.filter((r) => r.documentType === documentType);
    }

    const response: SearchResponse = {
      query,
      results,
      totalResults: results.length,
    };

    return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(response) };
  } catch (error) {
    console.error('Error in claim-search:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' }),
    };
  }
};

async function findDocumentByS3Key(s3Uri: string): Promise<any | null> {
  try {
    // Extract the s3Key from the URI (s3://bucket/key -> key)
    const key = s3Uri.replace(/^s3:\/\/[^/]+\//, '');
    if (!key) return null;

    const result = await docClient.send(new QueryCommand({
      TableName: DOCUMENTS_TABLE,
      IndexName: 'tenant-documents-index',
      KeyConditionExpression: 'tenantId = :tid',
      FilterExpression: 's3Key = :s3k',
      ExpressionAttributeValues: { ':tid': 'local-dev-tenant', ':s3k': key },
      Limit: 1,
    }));

    return result.Items?.[0] || null;
  } catch {
    return null;
  }
}

async function fallbackTextSearch(query: string, limit: number): Promise<SearchResult[]> {
  try {
    const result = await docClient.send(new QueryCommand({
      TableName: DOCUMENTS_TABLE,
      IndexName: 'tenant-documents-index',
      KeyConditionExpression: 'tenantId = :tid',
      ExpressionAttributeValues: { ':tid': 'local-dev-tenant' },
    }));

    const lowerQuery = query.toLowerCase();
    const matches = (result.Items || [])
      .filter((item) => {
        const text = (item.extractedText || '').toLowerCase();
        const name = (item.fileName || '').toLowerCase();
        return text.includes(lowerQuery) || name.includes(lowerQuery);
      })
      .slice(0, limit)
      .map((item) => ({
        documentId: item.documentId || item.id,
        claimId: item.claimMetadata?.claimId || 'unknown',
        fileName: item.fileName,
        excerpt: (item.extractedText || '').substring(0, 500),
        score: 1.0,
        documentType: item.claimMetadata?.documentType,
      }));

    return matches;
  } catch {
    return [];
  }
}
