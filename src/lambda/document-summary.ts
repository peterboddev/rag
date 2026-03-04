import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { DocumentSummaryRequest, TokenAwareSummaryResponse, DocumentSummaryItem, CustomerRecord, DocumentRecord } from '../types';
import { TokenAwareSummarizationService } from '../services/token-aware-summarization';

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.REGION }));
const bedrockClient = new BedrockRuntimeClient({ region: process.env.BEDROCK_REGION || process.env.REGION });
const tokenAwareSummarizer = new TokenAwareSummarizationService();

const CUSTOMERS_TABLE = process.env.CUSTOMERS_TABLE_NAME!;
const DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE_NAME!;
const SUMMARY_CACHE_TABLE = process.env.SUMMARY_CACHE_TABLE_NAME || 'rag-app-v2-summary-cache-dev';
const SUMMARY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SUMMARY_CACHE_TTL_SECONDS = 300; // 5 minutes in seconds for DynamoDB TTL

// In-memory cache for summaries (Lambda warm start)
interface CachedSummary {
  summary: string;
  timestamp: number;
  response: TokenAwareSummaryResponse;
}

const summaryCache = new Map<string, CachedSummary>();

// DynamoDB cache item structure
interface SummaryCacheItem {
  cacheKey: string; // PK: customerUUID-documentCount
  tenantId: string; // For filtering
  summary: string;
  response: string; // JSON stringified TokenAwareSummaryResponse
  createdAt: string;
  expiresAt: number; // TTL timestamp
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    console.log('Document Summary Lambda invoked', { 
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

    const request: DocumentSummaryRequest = JSON.parse(event.body || '{}');
    const { customerEmail } = request;

    if (!customerEmail) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({ error: 'Missing customerEmail' }),
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

    // Get all documents for this customer
    const documents = await getCustomerDocuments(customer.uuid);
    
    if (documents.length === 0) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          customerUUID: customer.uuid,
          customerEmail: customer.email,
          documentCount: 0,
          summary: 'No documents found for this customer.',
          documents: []
        }),
      };
    }

    // Filter documents that have been processed and have extracted text
    const processedDocuments = documents.filter(doc => 
      doc.processingStatus === 'completed' && doc.extractedText
    );

    if (processedDocuments.length === 0) {
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          customerUUID: customer.uuid,
          customerEmail: customer.email,
          documentCount: documents.length,
          summary: 'Documents are still being processed or no text content available.',
          documents: documents.map(mapToSummaryItem)
        }),
      };
    }

    // Check cache first
    const cacheKey = `${customer.uuid}-${processedDocuments.length}`;
    const cachedSummary = summaryCache.get(cacheKey);
    
    if (cachedSummary && (Date.now() - cachedSummary.timestamp) < SUMMARY_CACHE_TTL_MS) {
      console.log('Returning cached summary from memory', { 
        customerUUID: customer.uuid,
        cacheAge: Date.now() - cachedSummary.timestamp 
      });
      
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'X-Cache': 'HIT-MEMORY'
        },
        body: JSON.stringify(cachedSummary.response),
      };
    }

    // Check DynamoDB cache if not in memory
    const dbCachedSummary = await getCachedSummaryFromDB(cacheKey, tenantId);
    if (dbCachedSummary) {
      console.log('Returning cached summary from DynamoDB', { 
        customerUUID: customer.uuid,
        cacheAge: Date.now() - new Date(dbCachedSummary.createdAt).getTime()
      });

      // Also store in memory cache for faster subsequent access
      const response = JSON.parse(dbCachedSummary.response) as TokenAwareSummaryResponse;
      summaryCache.set(cacheKey, {
        summary: dbCachedSummary.summary,
        timestamp: new Date(dbCachedSummary.createdAt).getTime(),
        response
      });
      
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'X-Cache': 'HIT-DB'
        },
        body: JSON.stringify(response),
      };
    }

    // Try to generate AI summary with fallback mechanisms
    let summary: string;
    let tokenAwareResult: any;
    let usedFallback = false;

    try {
      // Generate token-aware summary using the new service
      tokenAwareResult = await tokenAwareSummarizer.generateSummary(
        processedDocuments, 
        customer.uuid, 
        tenantId
      );

      // Generate summary using Bedrock Nova Pro with token-aware content
      summary = await generateDocumentSummary(
        tokenAwareResult.processedContent, 
        customer.email,
        tokenAwareResult.tokenUsage,
        tokenAwareResult.truncationInfo
      );

    } catch (error) {
      console.error('Error generating AI summary, using fallback:', error);
      usedFallback = true;

      // Fallback 1: Try to use cached summary if available (even if expired)
      if (cachedSummary) {
        console.log('Using expired cached summary as fallback', { 
          customerUUID: customer.uuid,
          cacheAge: Date.now() - cachedSummary.timestamp 
        });
        
        return {
          statusCode: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'X-Cache': 'STALE',
            'X-Fallback': 'cached-summary'
          },
          body: JSON.stringify({
            ...cachedSummary.response,
            fallbackUsed: true,
            fallbackReason: 'AI summary generation failed, using cached summary'
          }),
        };
      }

      // Fallback 2: Generate basic metadata summary
      summary = generateBasicMetadataSummary(processedDocuments, customer.email);
      
      // Create minimal token-aware result for fallback
      tokenAwareResult = {
        processedContent: '',
        tokenUsage: { tokensUsed: 0, maxTokensAllowed: 0, utilizationPercentage: 0 },
        truncationInfo: { documentsTruncated: 0, documentsProcessed: processedDocuments.length, totalOriginalTokens: 0, totalProcessedTokens: 0 },
        chunkingMethod: 'none',
        processingMetadata: { totalProcessingTime: 0 }
      };
    }

    const response: TokenAwareSummaryResponse = {
      customerUUID: customer.uuid,
      customerEmail: customer.email,
      documentCount: documents.length,
      summary,
      documents: documents.map(mapToSummaryItem),
      tokenUsage: tokenAwareResult.tokenUsage,
      truncationInfo: tokenAwareResult.truncationInfo,
      chunkingMethod: tokenAwareResult.chunkingMethod,
      processingMetadata: tokenAwareResult.processingMetadata,
      ...(usedFallback && { 
        fallbackUsed: true,
        fallbackReason: 'AI summary generation failed, using basic metadata summary'
      })
    };

    // Cache the successful response
    if (!usedFallback) {
      // Store in memory cache
      summaryCache.set(cacheKey, {
        summary,
        timestamp: Date.now(),
        response
      });
      
      // Store in DynamoDB cache for persistence across Lambda invocations
      await cacheSummaryInDB(cacheKey, tenantId, summary, response);
      
      console.log('Summary cached in memory and DynamoDB', { customerUUID: customer.uuid, cacheKey });
    }

    console.log('Token-aware document summary generated successfully', { 
      customerUUID: customer.uuid,
      documentCount: documents.length,
      processedCount: processedDocuments.length,
      usedFallback,
      tokenUsage: tokenAwareResult.tokenUsage,
      truncationInfo: {
        documentsTruncated: tokenAwareResult.truncationInfo.documentsTruncated,
        totalOriginalTokens: tokenAwareResult.truncationInfo.totalOriginalTokens,
        totalProcessedTokens: tokenAwareResult.truncationInfo.totalProcessedTokens
      },
      processingTime: tokenAwareResult.processingMetadata.totalProcessingTime
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
    console.error('Error in document summary:', error);
    
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

async function findCustomerByEmail(tenantId: string, email: string): Promise<CustomerRecord | null> {
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

    return result.Items?.[0] as CustomerRecord || null;
  } catch (error) {
    console.error('Error finding customer by email:', error);
    throw error;
  }
}

async function getCustomerDocuments(customerUUID: string): Promise<DocumentRecord[]> {
  try {
    const result = await dynamoClient.send(new QueryCommand({
      TableName: DOCUMENTS_TABLE,
      IndexName: 'customer-documents-index',
      KeyConditionExpression: 'customerUuid = :customerUuid',
      ExpressionAttributeValues: {
        ':customerUuid': customerUUID,
      },
      ScanIndexForward: false, // Sort by createdAt descending (newest first)
    }));

    return result.Items as DocumentRecord[] || [];
  } catch (error) {
    console.error('Error getting customer documents:', error);
    throw error;
  }
}

async function generateDocumentSummary(
  processedContent: string, 
  customerEmail: string,
  tokenUsage: any,
  truncationInfo: any
): Promise<string> {
  try {
    // Create enhanced prompt that includes token awareness information
    let prompt = `Please provide a comprehensive summary of all documents for customer ${customerEmail}.`;
    
    // Add truncation context if content was truncated
    if (truncationInfo.documentsTruncated > 0) {
      prompt += `\n\nIMPORTANT: The content has been intelligently truncated to fit within token limits. ${truncationInfo.documentsTruncated} of ${truncationInfo.documentsProcessed} documents were truncated. Original content was ${truncationInfo.totalOriginalTokens} tokens, processed to ${truncationInfo.totalProcessedTokens} tokens.`;
    }
    
    prompt += `\n\nDocuments to summarize:\n${processedContent}`;
    
    prompt += `\n\nPlease provide:
1. A brief overview of the document types and content
2. Key themes or topics across all documents
3. Important information or insights
4. Any notable patterns or relationships between documents`;
    
    // Determine appropriate summary length based on content volume and chunking configuration
    let summaryLength = '400-600 words';
    let maxNewTokens = 1000; // Default generous limit for summary output
    
    // Adjust based on chunking configuration limits
    if (tokenUsage.maxTokensAllowed <= 512) {
      summaryLength = '200-300 words';
      maxNewTokens = 500;
    } else if (tokenUsage.maxTokensAllowed <= 800) {
      summaryLength = '300-400 words';
      maxNewTokens = 700;
    } else if (tokenUsage.maxTokensAllowed >= 1024) {
      summaryLength = '500-700 words';
      maxNewTokens = 1200;
    }
    
    prompt += `\n\nPlease provide a comprehensive summary of approximately ${summaryLength}. Be thorough and detailed while staying within this length.`;

    console.log('Calling Bedrock Nova Pro for token-aware summary generation', {
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

    console.log('Token-aware summary generated successfully', {
      summaryLength: summary.length,
      outputTokensAllowed: maxNewTokens,
      inputTokenUtilization: tokenUsage.utilizationPercentage,
      chunkingLimit: tokenUsage.maxTokensAllowed
    });

    return summary;

  } catch (error) {
    console.error('Error generating token-aware summary with Bedrock:', error);
    return `Error generating summary: ${error instanceof Error ? error.message : 'Unknown error'}. Input token usage: ${tokenUsage.utilizationPercentage}% of ${tokenUsage.maxTokensAllowed} tokens.`;
  }
}

function mapToSummaryItem(doc: DocumentRecord): DocumentSummaryItem {
  // Create enhanced text preview
  let textPreview = '';
  if (doc.extractedText && doc.extractedText.trim().length > 0) {
    textPreview = doc.extractedText.length > 100 
      ? doc.extractedText.substring(0, 100) + '...' 
      : doc.extractedText;
  }

  // Get error details from processing metadata or direct error message
  let errorDetails = '';
  if (doc.processingStatus === 'failed') {
    if (doc.processingMetadata?.errorDetails?.errorMessage) {
      errorDetails = doc.processingMetadata.errorDetails.errorMessage;
    } else if (doc.errorMessage) {
      errorDetails = doc.errorMessage;
    }
  }

  return {
    documentId: doc.id,
    fileName: doc.fileName,
    contentType: doc.contentType,
    createdAt: doc.createdAt,
    processingStatus: doc.processingStatus,
    extractedText: doc.extractedText?.substring(0, 200) + (doc.extractedText && doc.extractedText.length > 200 ? '...' : ''),
    textLength: doc.textLength,
    confidence: doc.processingMetadata?.confidence,
    pageCount: doc.processingMetadata?.pageCount || 1,
    textPreview,
    errorMessage: doc.errorMessage,
    errorDetails: errorDetails || undefined,
    retryCount: doc.retryCount || 0,
    maxRetries: doc.maxRetries || 3,
    processingDurationMs: doc.processingMetadata?.processingDurationMs
  };
}

/**
 * Generate basic metadata summary as fallback when AI summary fails
 * Provides useful information from document metadata without AI processing
 */
function generateBasicMetadataSummary(documents: DocumentRecord[], customerEmail: string): string {
  const totalDocs = documents.length;
  const totalPages = documents.reduce((sum, doc) => sum + (doc.processingMetadata?.pageCount || 1), 0);
  const totalTextLength = documents.reduce((sum, doc) => sum + (doc.textLength || 0), 0);
  
  // Group documents by type
  const docsByType: Record<string, number> = {};
  documents.forEach(doc => {
    const type = doc.contentType || 'unknown';
    docsByType[type] = (docsByType[type] || 0) + 1;
  });

  // Get date range
  const dates = documents.map(doc => new Date(doc.createdAt).getTime()).sort();
  const oldestDate = new Date(dates[0]).toLocaleDateString();
  const newestDate = new Date(dates[dates.length - 1]).toLocaleDateString();

  // Check for claim-specific metadata
  const claimDocs = documents.filter(doc => doc.claimMetadata);
  const hasClaimData = claimDocs.length > 0;

  let summary = `Document Summary for ${customerEmail}\n\n`;
  summary += `Total Documents: ${totalDocs}\n`;
  summary += `Total Pages: ${totalPages}\n`;
  summary += `Total Text Content: ${(totalTextLength / 1000).toFixed(1)}K characters\n`;
  summary += `Date Range: ${oldestDate} to ${newestDate}\n\n`;

  summary += `Document Types:\n`;
  Object.entries(docsByType).forEach(([type, count]) => {
    summary += `- ${type}: ${count} document${count > 1 ? 's' : ''}\n`;
  });

  if (hasClaimData) {
    summary += `\nClaim Information:\n`;
    
    // Get unique patients and claims
    const patients = new Set(claimDocs.map(doc => doc.claimMetadata?.patientId).filter(Boolean));
    const claims = new Set(claimDocs.map(doc => doc.claimMetadata?.claimId).filter(Boolean));
    
    summary += `- Patients: ${patients.size}\n`;
    summary += `- Claims: ${claims.size}\n`;

    // Get claim document types
    const claimDocTypes: Record<string, number> = {};
    claimDocs.forEach(doc => {
      const type = doc.claimMetadata?.documentType || 'Unknown';
      claimDocTypes[type] = (claimDocTypes[type] || 0) + 1;
    });

    summary += `\nClaim Document Types:\n`;
    Object.entries(claimDocTypes).forEach(([type, count]) => {
      summary += `- ${type}: ${count}\n`;
    });

    // Get diagnosis codes and amounts if available
    const diagnosisCodes = claimDocs
      .map(doc => doc.claimMetadata?.primaryDiagnosis)
      .filter(Boolean);
    
    if (diagnosisCodes.length > 0) {
      const uniqueDiagnoses = [...new Set(diagnosisCodes)];
      summary += `\nDiagnosis Codes: ${uniqueDiagnoses.join(', ')}\n`;
    }

    const claimedAmounts = claimDocs
      .map(doc => doc.claimMetadata?.claimedAmount)
      .filter(Boolean) as number[];
    
    if (claimedAmounts.length > 0) {
      const totalClaimed = claimedAmounts.reduce((sum, amt) => sum + amt, 0);
      summary += `Total Claimed Amount: $${totalClaimed.toFixed(2)}\n`;
    }

    const approvedAmounts = claimDocs
      .map(doc => doc.claimMetadata?.approvedAmount)
      .filter(Boolean) as number[];
    
    if (approvedAmounts.length > 0) {
      const totalApproved = approvedAmounts.reduce((sum, amt) => sum + amt, 0);
      summary += `Total Approved Amount: $${totalApproved.toFixed(2)}\n`;
    }
  }

  summary += `\nNote: This is a basic metadata summary. AI-powered analysis is temporarily unavailable.`;

  return summary;
}

/**
 * Get cached summary from DynamoDB
 */
async function getCachedSummaryFromDB(cacheKey: string, tenantId: string): Promise<SummaryCacheItem | null> {
  try {
    const result = await dynamoClient.send(new QueryCommand({
      TableName: SUMMARY_CACHE_TABLE,
      KeyConditionExpression: 'cacheKey = :cacheKey',
      FilterExpression: 'tenantId = :tenantId AND expiresAt > :now',
      ExpressionAttributeValues: {
        ':cacheKey': cacheKey,
        ':tenantId': tenantId,
        ':now': Math.floor(Date.now() / 1000)
      },
      Limit: 1
    }));

    if (result.Items && result.Items.length > 0) {
      return result.Items[0] as SummaryCacheItem;
    }

    return null;
  } catch (error) {
    console.error('Error getting cached summary from DynamoDB:', error);
    return null; // Don't fail if cache read fails
  }
}

/**
 * Cache summary in DynamoDB with TTL
 */
async function cacheSummaryInDB(
  cacheKey: string,
  tenantId: string,
  summary: string,
  response: TokenAwareSummaryResponse
): Promise<void> {
  try {
    const now = new Date().toISOString();
    const expiresAt = Math.floor(Date.now() / 1000) + SUMMARY_CACHE_TTL_SECONDS;

    const cacheItem: SummaryCacheItem = {
      cacheKey,
      tenantId,
      summary,
      response: JSON.stringify(response),
      createdAt: now,
      expiresAt
    };

    await dynamoClient.send(new PutCommand({
      TableName: SUMMARY_CACHE_TABLE,
      Item: cacheItem
    }));

    console.log('Summary cached in DynamoDB', { cacheKey, expiresAt });
  } catch (error) {
    console.error('Error caching summary in DynamoDB:', error);
    // Don't fail if cache write fails - just log the error
  }
}