import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { ClaimStatusValue, ClaimStatusHistoryEntry, ClaimStatusHistoryResponse } from '../types/index';

const dynamoClient = new DynamoDBClient({ region: process.env.REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const STATUS_HISTORY_TABLE = process.env.STATUS_HISTORY_TABLE || 'rag-app-claim-status-history-dev';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

/**
 * Lambda handler for claim status history.
 * GET  /claims/{claimId}/history  — retrieve status history
 * POST /claims/{claimId}/history  — add a new status entry
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Claim Status History Request:', JSON.stringify({ method: event.httpMethod, path: event.path }));

  const claimId = event.pathParameters?.claimId;
  if (!claimId) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing claimId' }) };
  }

  try {
    if (event.httpMethod === 'GET') {
      return await getHistory(claimId);
    } else if (event.httpMethod === 'POST') {
      return await addStatusEntry(claimId, event);
    }
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  } catch (error) {
    console.error('Error in claim-status-history:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' }),
    };
  }
};


async function getHistory(claimId: string): Promise<APIGatewayProxyResult> {
  const result = await docClient.send(new QueryCommand({
    TableName: STATUS_HISTORY_TABLE,
    KeyConditionExpression: 'claimId = :cid',
    ExpressionAttributeValues: { ':cid': claimId },
    ScanIndexForward: true, // oldest first
  }));

  const history: ClaimStatusHistoryEntry[] = (result.Items || []).map((item) => ({
    claimId: item.claimId,
    timestamp: item.timestamp,
    status: item.status as ClaimStatusValue,
    changedBy: item.changedBy,
    note: item.note,
  }));

  const currentStatus: ClaimStatusValue = history.length > 0
    ? history[history.length - 1].status
    : 'Submitted';

  const response: ClaimStatusHistoryResponse = { claimId, currentStatus, history };
  return { statusCode: 200, headers: CORS_HEADERS, body: JSON.stringify(response) };
}

async function addStatusEntry(claimId: string, event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const body = JSON.parse(event.body || '{}');
  const { status, note, changedBy } = body as { status?: ClaimStatusValue; note?: string; changedBy?: string };

  if (!status) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing status field' }) };
  }

  const validStatuses: ClaimStatusValue[] = ['Submitted', 'Under Review', 'Approved', 'Denied', 'Pending Information'];
  if (!validStatuses.includes(status)) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` }) };
  }

  const entry: ClaimStatusHistoryEntry = {
    claimId,
    timestamp: new Date().toISOString(),
    status,
    changedBy: changedBy || 'system',
    note,
  };

  await docClient.send(new PutCommand({
    TableName: STATUS_HISTORY_TABLE,
    Item: entry,
  }));

  return { statusCode: 201, headers: CORS_HEADERS, body: JSON.stringify(entry) };
}
