import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

const dynamoClient = new DynamoDBClient({ region: process.env.REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

const DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE_NAME || 'rag-app-v2-documents-dev';
const STATUS_HISTORY_TABLE = process.env.STATUS_HISTORY_TABLE || 'rag-app-claim-status-history-dev';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

/**
 * Lambda handler for POST /claims/{claimId}/export
 * Generates a plain-text PDF-like export of claim data.
 * Returns a structured JSON payload that the frontend can render as a downloadable file.
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Claim Export Request:', JSON.stringify({ method: event.httpMethod, path: event.path }));

  const claimId = event.pathParameters?.claimId;
  if (!claimId) {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Missing claimId' }) };
  }

  try {
    // Gather claim documents
    const docsResult = await docClient.send(new QueryCommand({
      TableName: DOCUMENTS_TABLE,
      IndexName: 'tenant-documents-index',
      KeyConditionExpression: 'tenantId = :tid',
      FilterExpression: 'attribute_exists(claimMetadata) AND claimMetadata.claimId = :cid',
      ExpressionAttributeValues: { ':tid': 'local-dev-tenant', ':cid': claimId },
    }));
    const documents = docsResult.Items || [];

    // Gather status history
    let history: any[] = [];
    try {
      const histResult = await docClient.send(new QueryCommand({
        TableName: STATUS_HISTORY_TABLE,
        KeyConditionExpression: 'claimId = :cid',
        ExpressionAttributeValues: { ':cid': claimId },
        ScanIndexForward: true,
      }));
      history = histResult.Items || [];
    } catch {
      // Status history table may not exist yet — continue without it
    }

    // Build export content
    const claimMeta = documents[0]?.claimMetadata || {};
    const lines: string[] = [];

    lines.push('='.repeat(60));
    lines.push(`CLAIM EXPORT REPORT`);
    lines.push(`Claim ID: ${claimId}`);
    lines.push(`Patient: ${claimMeta.patientName || 'N/A'} (${claimMeta.patientId || 'N/A'})`);
    lines.push(`TCIA Collection: ${claimMeta.tciaCollectionId || 'N/A'}`);
    lines.push(`Primary Diagnosis: ${claimMeta.primaryDiagnosis || 'N/A'}`);
    lines.push(`Filing Date: ${claimMeta.filingDate || 'N/A'}`);
    lines.push(`Generated: ${new Date().toISOString()}`);
    lines.push('='.repeat(60));
    lines.push('');

    // Status History section
    lines.push('--- STATUS HISTORY ---');
    if (history.length === 0) {
      lines.push('No status history recorded.');
    } else {
      for (const h of history) {
        lines.push(`  ${h.timestamp} | ${h.status} | ${h.changedBy || 'system'}${h.note ? ` | ${h.note}` : ''}`);
      }
    }
    lines.push('');

    // Documents section
    lines.push('--- DOCUMENTS ---');
    lines.push(`Total: ${documents.length}`);
    for (const doc of documents) {
      lines.push(`  - ${doc.fileName} (${doc.claimMetadata?.documentType || 'Unknown'}) [${doc.processingStatus}]`);
      if (doc.extractedText) {
        const preview = doc.extractedText.substring(0, 200).replace(/\n/g, ' ');
        lines.push(`    Preview: ${preview}...`);
      }
    }
    lines.push('');
    lines.push('='.repeat(60));
    lines.push('END OF REPORT');

    const exportContent = lines.join('\n');

    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        claimId,
        fileName: `claim-${claimId}-export.txt`,
        contentType: 'text/plain',
        content: exportContent,
        documentCount: documents.length,
        generatedAt: new Date().toISOString(),
      }),
    };
  } catch (error) {
    console.error('Error in claim-export-pdf:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Internal server error', message: error instanceof Error ? error.message : 'Unknown error' }),
    };
  }
};
