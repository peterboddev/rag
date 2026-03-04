import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { DocumentRecord, TokenUsageInfo, TruncationInfo } from '../types';
import { TokenAwareSummarizationService } from '../services/token-aware-summarization';

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.REGION }));
const bedrockClient = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION || process.env.REGION });
const tokenAwareSummarizer = new TokenAwareSummarizationService();

const CUSTOMERS_TABLE = process.env.CUSTOMERS_TABLE_NAME!;
const DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE_NAME!;

interface SelectiveSummaryRequest {
  customerEmail: string;
  documentIds: string[];
}

interface SelectiveSummaryResponse {
  summary: string;
  includedDocuments: DocumentReference[];
  documentCount: number;
  totalTextLength: number;
  processingTime: number;
  generatedAt: string;
  // Token-aware fields
  tokenUsage: TokenUsageInfo;
  truncationInfo: TruncationInfo;
  chunkingMethod: any;
  excludedDocuments?: DocumentReference[];
}

interface DocumentReference {
  documentId: string;
  fileName: string;
  textLength: number;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    console.log('Selective Document Summary Lambda invoked', { 
      httpMethod: event.httpMethod,
      path: event.path 
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

    const request: SelectiveSummaryRequest = JSON.parse(event.body || '{}');
    const { customerEmail, documentIds } = request;

    if (!customerEmail || !documentIds || !Array.isArray(documentIds) || documentIds.length === 0) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ 
          error: 'Missing required fields: customerEmail and documentIds array' 
        }),
      };
    }

    if (documentIds.length > 50) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ 
          error: 'Too many documents selected. Maximum 50 documents allowed.' 
        }),
      };
    }

    // Find customer by email
    const customer = await findCustomerByEmail(tenantId, customerEmail);
    if (!customer) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Customer not found' }),
      };
    }

    const startTime = Date.now();

    // Get selected documents
    const selectedDocuments = await getSelectedDocuments(customer.uuid, documentIds, tenantId);
    
    if (selectedDocuments.length === 0) {
      return {
        statusCode: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ 
          error: 'No valid documents found for the provided document IDs' 
        }),
      };
    }

    // Filter documents that have been processed and have extracted text
    const processedDocuments = selectedDocuments.filter(doc => 
      doc.processingStatus === 'completed' && doc.extractedText && doc.extractedText.trim().length > 0
    );

    if (processedDocuments.length === 0) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          error: 'No processed documents with text content found in selection',
          message: 'Selected documents are either still processing, failed, or contain no extractable text.',
          totalSelected: selectedDocuments.length,
          processedCount: 0
        }),
      };
    }

    // Generate token-aware selective summary
    const tokenAwareResult = await tokenAwareSummarizer.generateSelectiveSummary(
      processedDocuments, 
      customer.uuid, 
      tenantId
    );

    // Generate summary using Bedrock Nova Pro with token-aware content
    const summary = await generateSelectiveDocumentSummary(
      tokenAwareResult.processedContent, 
      customerEmail,
      tokenAwareResult.tokenUsage,
      tokenAwareResult.truncationInfo,
      processedDocuments.length
    );
    
    // Calculate processing time
    const processingTime = Date.now() - startTime;

    // Create document references for included documents
    const includedDocuments: DocumentReference[] = processedDocuments.map(doc => ({
      documentId: doc.id,
      fileName: doc.fileName,
      textLength: doc.textLength || 0
    }));

    // Identify excluded documents (selected but not processed)
    const excludedDocuments: DocumentReference[] = selectedDocuments
      .filter(doc => !processedDocuments.includes(doc))
      .map(doc => ({
        documentId: doc.id,
        fileName: doc.fileName,
        textLength: doc.textLength || 0
      }));

    const totalTextLength = processedDocuments.reduce((sum, doc) => sum + (doc.textLength || 0), 0);

    const response: SelectiveSummaryResponse = {
      summary,
      includedDocuments,
      documentCount: processedDocuments.length,
      totalTextLength,
      processingTime,
      generatedAt: new Date().toISOString(),
      tokenUsage: tokenAwareResult.tokenUsage,
      truncationInfo: tokenAwareResult.truncationInfo,
      chunkingMethod: tokenAwareResult.chunkingMethod,
      excludedDocuments: excludedDocuments.length > 0 ? excludedDocuments : undefined
    };

    console.log('Token-aware selective document summary generated successfully', { 
      customerEmail,
      selectedCount: documentIds.length,
      processedCount: processedDocuments.length,
      excludedCount: excludedDocuments.length,
      totalTextLength,
      processingTime,
      tokenUsage: tokenAwareResult.tokenUsage,
      truncationInfo: {
        documentsTruncated: tokenAwareResult.truncationInfo.documentsTruncated,
        totalOriginalTokens: tokenAwareResult.truncationInfo.totalOriginalTokens,
        totalProcessedTokens: tokenAwareResult.truncationInfo.totalProcessedTokens
      }
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
    console.error('Error in selective document summary:', error);
    
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

async function findCustomerByEmail(tenantId: string, email: string) {
  try {
    const result = await dynamoClient.send(new QueryCommand({
      TableName: CUSTOMERS_TABLE,
      IndexName: 'email-index',
      KeyConditionExpression: 'email = :email',
      FilterExpression: 'tenantId = :tenantId',
      ExpressionAttributeValues: {
        ':email': email,
        ':tenantId': tenantId,
      },
    }));

    return result.Items?.[0] || null;
  } catch (error) {
    console.error('Error finding customer by email:', error);
    throw error;
  }
}

async function getSelectedDocuments(customerUUID: string, documentIds: string[], tenantId: string): Promise<DocumentRecord[]> {
  try {
    const documents: DocumentRecord[] = [];
    
    // Get documents in batches to avoid DynamoDB limits
    for (const documentId of documentIds) {
      try {
        const result = await dynamoClient.send(new GetCommand({
          TableName: DOCUMENTS_TABLE,
          Key: {
            id: documentId,
            customerUuid: customerUUID,
          },
        }));

        if (result.Item) {
          const document = result.Item as DocumentRecord;
          // Verify tenant access
          if (document.tenantId === tenantId) {
            documents.push(document);
          } else {
            console.warn('Tenant access denied for document', { documentId, tenantId });
          }
        } else {
          console.warn('Document not found', { documentId, customerUUID });
        }
      } catch (error) {
        console.error('Error fetching document', { documentId, error });
        // Continue with other documents even if one fails
      }
    }

    return documents;
  } catch (error) {
    console.error('Error getting selected documents:', error);
    throw error;
  }
}

async function generateSelectiveDocumentSummary(
  processedContent: string, 
  customerEmail: string,
  tokenUsage: TokenUsageInfo,
  truncationInfo: TruncationInfo,
  documentCount: number
): Promise<string> {
  try {
    // Create enhanced prompt that includes token awareness information
    let prompt = `Please provide a comprehensive summary of the selected documents for customer ${customerEmail}.`;
    
    // Add truncation context if content was truncated
    if (truncationInfo.documentsTruncated > 0) {
      prompt += `\n\nIMPORTANT: The content has been intelligently truncated to fit within token limits. ${truncationInfo.documentsTruncated} of ${truncationInfo.documentsProcessed} documents were truncated. Original content was ${truncationInfo.totalOriginalTokens} tokens, processed to ${truncationInfo.totalProcessedTokens} tokens.`;
    }
    
    prompt += `\n\nSelected Documents to summarize:\n${processedContent}`;
    
    prompt += `\n\nPlease provide:
1. A brief overview of the selected document types and content
2. Key themes or topics across the selected documents
3. Important information or insights from the selection
4. Any notable patterns or relationships between the selected documents`;
    
    // Determine appropriate summary length and output tokens based on content volume and document count
    let summaryLength = '400-600 words';
    let maxNewTokens = 1000; // Default generous limit for summary output
    
    // Adjust based on chunking configuration limits and document count
    if (tokenUsage.maxTokensAllowed <= 512) {
      summaryLength = '200-350 words';
      maxNewTokens = 600;
    } else if (tokenUsage.maxTokensAllowed <= 800) {
      summaryLength = '300-450 words';
      maxNewTokens = 800;
    } else if (tokenUsage.maxTokensAllowed >= 1024) {
      summaryLength = '500-800 words';
      maxNewTokens = 1400;
    }
    
    // Adjust for document count - more documents may need longer summaries
    if (documentCount > 5) {
      maxNewTokens = Math.floor(maxNewTokens * 1.2);
      summaryLength = summaryLength.replace(/(\d+)-(\d+)/, (match, min, max) => 
        `${Math.floor(parseInt(min) * 1.2)}-${Math.floor(parseInt(max) * 1.2)}`
      );
    } else if (documentCount === 1) {
      maxNewTokens = Math.floor(maxNewTokens * 0.8);
      summaryLength = summaryLength.replace(/(\d+)-(\d+)/, (match, min, max) => 
        `${Math.floor(parseInt(min) * 0.8)}-${Math.floor(parseInt(max) * 0.8)}`
      );
    }
    
    prompt += `\n\nPlease provide a comprehensive summary of approximately ${summaryLength}. Focus specifically on the documents that were selected for analysis. Be thorough and detailed while staying within this length.`;

    console.log('Calling Bedrock Nova Pro for token-aware selective summary generation', {
      documentCount,
      promptLength: prompt.length,
      inputTokensUsed: tokenUsage.tokensUsed,
      maxTokensAllowed: tokenUsage.maxTokensAllowed,
      outputTokensAllowed: maxNewTokens,
      tokenUtilization: tokenUsage.utilizationPercentage,
      documentsTruncated: truncationInfo.documentsTruncated
    });

    const response = await bedrockClient.send(new InvokeModelCommand({
      modelId: "amazon.nova-pro-v1:0",
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content: [{ text: prompt }]
          }
        ],
        inferenceConfig: {
          max_new_tokens: maxNewTokens,
          temperature: 0.3
        }
      })
    }));

    const responseBody = JSON.parse(response.body?.transformToString() || '{}');
    const summary = responseBody.output?.message?.content?.[0]?.text || 'Unable to generate summary';

    console.log('Token-aware selective summary generated successfully', {
      summaryLength: summary.length,
      outputTokensAllowed: maxNewTokens,
      inputTokenUtilization: tokenUsage.utilizationPercentage,
      chunkingLimit: tokenUsage.maxTokensAllowed
    });

    return summary;

  } catch (error) {
    console.error('Error generating token-aware selective summary with Bedrock:', error);
    return `Error generating summary: ${error instanceof Error ? error.message : 'Unknown error'}. Documents analyzed: ${documentCount}. Input token usage: ${tokenUsage.utilizationPercentage}% of ${tokenUsage.maxTokensAllowed} tokens.`;
  }
}

function extractTenantFromToken(event: APIGatewayProxyEvent): string | null {
  // For local development, allow tenant_id in headers
  const tenantIdHeader = event.headers['x-tenant-id'] || event.headers['X-Tenant-Id'];
  if (tenantIdHeader) {
    return tenantIdHeader;
  }

  // TODO: Implement proper JWT parsing when Cognito is integrated
  return 'local-dev-tenant'; // Default for local development
}