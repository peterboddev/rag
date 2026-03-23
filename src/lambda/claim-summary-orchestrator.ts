import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { BedrockAgentRuntimeClient, RetrieveCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import {
  ClaimSummaryRequest,
  ClaimSummaryResponse,
  DataAnomaly,
  EvaluationScores,
  SummaryStrategy,
  ChunkingMethod,
} from '../types/claim-summary';
import { buildCacheKey, getCachedSummary, cacheSummary } from '../services/summary-cache';

// Environment variables
const DOCUMENTS_TABLE = process.env.DOCUMENTS_TABLE || 'rag-app-v2-documents-dev';
const EVALUATION_RESULTS_TABLE = process.env.EVALUATION_RESULTS_TABLE || 'evaluation-results-table';
const BEDROCK_REGION = process.env.BEDROCK_REGION || 'us-east-1';
const KNOWLEDGE_BASE_ID = process.env.KNOWLEDGE_BASE_ID || '';
const GRAPH_RAG_KNOWLEDGE_BASE_ID = process.env.GRAPH_RAG_KNOWLEDGE_BASE_ID || '';

// AWS SDK clients
const dynamoClient = new DynamoDBClient({ region: process.env.REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const bedrockClient = new BedrockRuntimeClient({ region: BEDROCK_REGION });
const bedrockAgentClient = new BedrockAgentRuntimeClient({ region: BEDROCK_REGION });

/**
 * Valid summarization strategies
 */
const VALID_STRATEGIES: SummaryStrategy[] = ['full-context', 'rag', 'graph-rag'];

/**
 * Valid chunking methods for RAG strategy
 */
const VALID_CHUNKING_METHODS: ChunkingMethod[] = ['full-document', 'semantic'];

/**
 * CORS headers for all responses
 */
const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'POST,GET,OPTIONS',
};

/**
 * Document record from Documents_Table
 */
interface DocumentRecord {
  documentId: string;
  fileName: string;
  extractedText?: string;
  processingStatus: string;
  claimMetadata?: {
    claimId: string;
    documentType?: string;
    patientId?: string;
  };
  tenantId?: string;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Evaluation result from Evaluation_Results_Table
 */
interface EvaluationResult {
  claimId: string;
  strategyKey: string;
  helpfulness: number;
  faithfulness: number;
  completeness: number;
  anomalyAccuracy?: number;
  evaluatedAt: string;
}

/**
 * Creates an error response with CORS headers
 */
function errorResponse(statusCode: number, message: string): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: message }),
  };
}

/**
 * Creates a success response with CORS headers
 */
function successResponse(statusCode: number, body: object): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body),
  };
}

/**
 * Validates the request body and extracts the ClaimSummaryRequest
 */
function validateRequest(body: string | null): { valid: false; error: string } | { valid: true; request: ClaimSummaryRequest } {
  if (!body) {
    return { valid: false, error: 'Missing required field: strategy' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { valid: false, error: 'Invalid JSON in request body' };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { valid: false, error: 'Missing required field: strategy' };
  }

  const request = parsed as Record<string, unknown>;

  // Validate strategy is present
  if (!request.strategy) {
    return { valid: false, error: 'Missing required field: strategy' };
  }

  // Validate strategy is a valid value
  if (!VALID_STRATEGIES.includes(request.strategy as SummaryStrategy)) {
    return { valid: false, error: 'Invalid strategy. Must be one of: full-context, rag, graph-rag' };
  }

  const strategy = request.strategy as SummaryStrategy;

  // Validate chunkingMethod when strategy is 'rag'
  if (strategy === 'rag') {
    if (!request.chunkingMethod) {
      return { valid: false, error: 'Missing required field: chunkingMethod (required when strategy is rag)' };
    }
    if (!VALID_CHUNKING_METHODS.includes(request.chunkingMethod as ChunkingMethod)) {
      return { valid: false, error: 'Invalid chunkingMethod. Must be one of: full-document, semantic' };
    }
  }

  return {
    valid: true,
    request: {
      strategy,
      chunkingMethod: request.chunkingMethod as ChunkingMethod | undefined,
      forceRegenerate: request.forceRegenerate === true,
      includeEvaluation: request.includeEvaluation === true,
      useReranker: request.useReranker === true,
    },
  };
}

/**
 * Query documents from Documents_Table by claimId.
 * Uses tenant-documents-index GSI with filter on claimMetadata.claimId.
 */
async function queryClaimDocuments(claimId: string, tenantId: string): Promise<DocumentRecord[]> {
  try {
    // Use tenant-documents-index GSI with filter, matching existing claim-status pattern
    const command = new QueryCommand({
      TableName: DOCUMENTS_TABLE,
      IndexName: 'tenant-documents-index',
      KeyConditionExpression: 'tenantId = :tenantId',
      FilterExpression: 'claimMetadata.claimId = :claimId',
      ExpressionAttributeValues: {
        ':tenantId': tenantId,
        ':claimId': claimId,
      },
    });

    const response = await docClient.send(command);
    return (response.Items || []) as DocumentRecord[];
  } catch (error) {
    console.error('Error querying claim documents via GSI, falling back to scan:', error);

    // Fallback: scan with filter
    try {
      const scanCommand = new ScanCommand({
        TableName: DOCUMENTS_TABLE,
        FilterExpression: 'claimMetadata.claimId = :claimId',
        ExpressionAttributeValues: {
          ':claimId': claimId,
        },
      });

      const scanResponse = await docClient.send(scanCommand);
      return (scanResponse.Items || []) as DocumentRecord[];
    } catch (fallbackError) {
      console.error('Fallback scan also failed:', fallbackError);
      throw new Error('Failed to query claim documents');
    }
  }
}

/**
 * Invoke Bedrock Nova Pro for summary generation.
 * Returns the generated summary text.
 */
async function invokeBedrockNovaPro(prompt: string): Promise<string> {
  const command = new InvokeModelCommand({
    modelId: 'amazon.nova-pro-v1:0',
    body: JSON.stringify({
      messages: [
        {
          role: 'user',
          content: [{ text: prompt }],
        },
      ],
      inferenceConfig: {
        max_new_tokens: 4000,
        temperature: 0.3,
      },
    }),
  });

  const response = await bedrockClient.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));

  // Extract text from Nova Pro response format
  const outputText =
    responseBody?.output?.message?.content?.[0]?.text ||
    responseBody?.completion ||
    '';

  return outputText;
}

/**
 * Build the summarization prompt with anomaly detection instructions.
 */
function buildSummaryPrompt(documentsText: string, strategy: string): string {
  return `You are an insurance claims analyst. Analyze the following claim documents and provide:

1. A comprehensive summary of the claim including patient information, diagnoses, procedures, service dates, provider information, and amounts.

2. Data anomaly detection - identify any inconsistencies including:
   - Chronological impossibilities (service dates before birth dates, payment dates before service dates)
   - Contradictory information across documents
   - Diagnosis codes inconsistent with patient demographics
   - Duplicate or conflicting information
   - Unrealistic data patterns

IMPORTANT: Dates in these documents use MM/DD/YYYY format. When comparing dates, you MUST convert them to YYYY-MM-DD format first to determine chronological order. For example, 10/03/1964 means October 3, 1964 and 08/10/1946 means August 10, 1946. A service date of 10/03/1964 is AFTER a birth date of 08/10/1946 (the patient was 18 years old), so that is NOT an anomaly. Only flag a chronological impossibility when the service date is genuinely earlier than the birth date (i.e., the YYYY year of service is less than the YYYY year of birth, or same year but earlier month/day).

Format your response as JSON with this exact structure:
{
  "summary": "Your comprehensive summary text here",
  "anomalies": [
    {
      "description": "Description of the anomaly",
      "severity": "critical|warning|info",
      "sourceDocument": "document name",
      "dataValues": {"key": "value"}
    }
  ]
}

Strategy used: ${strategy}

Documents:
${documentsText}`;
}

/**
 * Parse the Bedrock response into summary and anomalies.
 */
function parseSummaryResponse(responseText: string): { summary: string; anomalies: DataAnomaly[] } {
  try {
    // Try to extract JSON from the response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        summary: parsed.summary || responseText,
        anomalies: Array.isArray(parsed.anomalies) ? parsed.anomalies.map((a: any) => ({
          description: a.description || '',
          severity: ['critical', 'warning', 'info'].includes(a.severity) ? a.severity : 'info',
          sourceDocument: a.sourceDocument || 'Unknown',
          dataValues: a.dataValues || {},
        })) : [],
      };
    }
  } catch {
    // If JSON parsing fails, return the raw text as summary
  }

  return {
    summary: responseText,
    anomalies: [],
  };
}

/**
 * Resolve patientId from claimId by querying DynamoDB for claim documents.
 * Returns the patientId from the first document's claimMetadata, or null if not found.
 */
async function resolvePatientId(claimId: string, tenantId: string): Promise<string | null> {
  try {
    const docs = await queryClaimDocuments(claimId, tenantId);
    const patientId = docs.find((d) => d.claimMetadata?.patientId)?.claimMetadata?.patientId;
    if (patientId) {
      console.log(`Resolved patientId=${patientId} for claimId=${claimId}`);
    }
    return patientId || null;
  } catch (error) {
    console.error('Failed to resolve patientId for claimId:', claimId, error);
    return null;
  }
}

/**
 * Full Context strategy: concatenate all document text and invoke Bedrock.
 */
async function executeFullContextStrategy(
  documents: DocumentRecord[]
): Promise<{ summary: string; anomalies: DataAnomaly[] }> {
  const documentsText = documents
    .map((doc) => `--- Document: ${doc.fileName} ---\n${doc.extractedText || ''}`)
    .join('\n\n');

  const prompt = buildSummaryPrompt(documentsText, 'full-context');
  const responseText = await invokeBedrockNovaPro(prompt);
  return parseSummaryResponse(responseText);
}

/**
 * RAG strategy: use Knowledge Base retrieval then invoke Bedrock.
 */
async function executeRagStrategy(
  claimId: string,
  chunkingMethod: string,
  patientId?: string | null
): Promise<{ summary: string; anomalies: DataAnomaly[]; documentCount: number }> {
  // Build retrieval config — prefer patientId filter (scopes to all patient docs), fall back to claimId
  const filterKey = patientId ? 'patientId' : 'claimId';
  const filterValue = patientId || claimId;
  const vectorSearchConfig: any = {
    numberOfResults: 20,
    filter: {
      equals: { key: filterKey, value: filterValue },
    },
  };
  console.log(`RAG KB filter: ${filterKey}=${filterValue}`);

  const retrieveCommand = new RetrieveCommand({
    knowledgeBaseId: KNOWLEDGE_BASE_ID,
    retrievalQuery: {
      text: `Summarize insurance claim ${claimId} including patient information, diagnoses, procedures, service dates, provider details, and amounts. Identify any data anomalies.`,
    },
    retrievalConfiguration: {
      vectorSearchConfiguration: vectorSearchConfig,
    },
  });

  const retrievalResponse = await bedrockAgentClient.send(retrieveCommand);
  const chunks = retrievalResponse.retrievalResults || [];

  if (chunks.length === 0) {
    // No results with metadata filter — do NOT fall back to unfiltered queries
    // as that returns chunks from ALL patients, causing mixed patient data.
    console.warn(`No KB results with ${filterKey} metadata filter for claim ${claimId}. KB may need re-sync to index metadata sidecars.`);
    return { summary: '', anomalies: [], documentCount: 0 };
  }

  // Build context from retrieved chunks
  const chunksText = chunks
    .map((chunk, i) => {
      const source = chunk.location?.s3Location?.uri || `Chunk ${i + 1}`;
      return `--- Chunk from: ${source} ---\n${chunk.content?.text || ''}`;
    })
    .join('\n\n');

  // Count unique source documents
  const uniqueSources = new Set(
    chunks.map((c) => c.location?.s3Location?.uri).filter(Boolean)
  );

  const prompt = buildSummaryPrompt(chunksText, `rag (${chunkingMethod} chunking)`);
  const responseText = await invokeBedrockNovaPro(prompt);
  const parsed = parseSummaryResponse(responseText);

  return {
    ...parsed,
    documentCount: uniqueSources.size || chunks.length,
  };
}

/**
 * Graph RAG strategy: queries GraphRAG Knowledge Base backed by Neptune Analytics.
 * Optionally applies Cohere Rerank 3.5 to retrieval results.
 */
async function executeGraphRagStrategy(
  claimId: string,
  useReranker: boolean = false,
  patientId?: string | null
): Promise<{ summary: string; anomalies: DataAnomaly[]; documentCount: number }> {
  const filterKey = patientId ? 'patientId' : 'claimId';
  const filterValue = patientId || claimId;
  console.log(`GraphRAG KB filter: ${filterKey}=${filterValue}`);
  const retrieveInput: any = {
    knowledgeBaseId: GRAPH_RAG_KNOWLEDGE_BASE_ID,
    retrievalQuery: {
      text: `Summarize insurance claim ${claimId} including patient information, diagnoses, procedures, service dates, provider details, and amounts. Identify any data anomalies.`,
    },
    retrievalConfiguration: {
      vectorSearchConfiguration: {
        numberOfResults: 20,
        filter: {
          equals: { key: filterKey, value: filterValue },
        },
      },
    },
  };

  if (useReranker) {
    retrieveInput.retrievalConfiguration.rerankingConfiguration = {
      type: 'BEDROCK_RERANKING_MODEL',
      bedrockRerankingConfiguration: {
        modelConfiguration: {
          modelArn: `arn:aws:bedrock:${process.env.AWS_REGION || 'us-east-1'}::foundation-model/cohere.rerank-v3-5:0`,
        },
      },
    };
  }

  const retrieveCommand = new RetrieveCommand(retrieveInput);
  const retrievalResponse = await bedrockAgentClient.send(retrieveCommand);
  const chunks = retrievalResponse.retrievalResults || [];

  if (chunks.length === 0) {
    console.warn(`No GraphRAG KB results with ${filterKey} metadata filter for claim ${claimId}. KB may need re-sync to index metadata sidecars.`);
    return { summary: '', anomalies: [], documentCount: 0 };
  }

  const chunksText = chunks
    .map((chunk, i) => {
      const source = chunk.location?.s3Location?.uri || `Chunk ${i + 1}`;
      return `--- Chunk from: ${source} ---\n${chunk.content?.text || ''}`;
    })
    .join('\n\n');

  const uniqueSources = new Set(
    chunks.map((c) => c.location?.s3Location?.uri).filter(Boolean)
  );

  const prompt = buildSummaryPrompt(chunksText, 'graph-rag (Neptune Analytics GraphRAG)');
  const responseText = await invokeBedrockNovaPro(prompt);
  const parsed = parseSummaryResponse(responseText);

  return {
    ...parsed,
    documentCount: uniqueSources.size || chunks.length,
  };
}

/**
 * Fetch evaluation scores from Evaluation_Results_Table for a given claimId and strategy.
 */
async function getEvaluationScores(
  claimId: string,
  strategyKey: string
): Promise<EvaluationScores | undefined> {
  try {
    const command = new QueryCommand({
      TableName: EVALUATION_RESULTS_TABLE,
      KeyConditionExpression: 'claimId = :claimId AND strategyKey = :strategyKey',
      ExpressionAttributeValues: {
        ':claimId': claimId,
        ':strategyKey': strategyKey,
      },
    });

    const response = await docClient.send(command);
    const item = response.Items?.[0] as EvaluationResult | undefined;

    if (!item) return undefined;

    return {
      helpfulness: item.helpfulness,
      faithfulness: item.faithfulness,
      completeness: item.completeness,
      anomalyAccuracy: item.anomalyAccuracy,
      evaluatedAt: item.evaluatedAt,
    };
  } catch (error) {
    console.error('Error fetching evaluation scores:', error);
    return undefined;
  }
}

/**
 * Handle GET /claims/{claimId}/evaluations
 * Returns all evaluation scores for strategies run on a claim.
 */
async function handleGetEvaluations(claimId: string): Promise<APIGatewayProxyResult> {
  console.log('Handling GET /evaluations for claimId:', claimId);

  try {
    const command = new QueryCommand({
      TableName: EVALUATION_RESULTS_TABLE,
      KeyConditionExpression: 'claimId = :claimId',
      ExpressionAttributeValues: {
        ':claimId': claimId,
      },
    });

    const response = await docClient.send(command);
    const items = (response.Items || []) as EvaluationResult[];

    const evaluations = items.map((item) => {
      const [strategy, chunkingMethod] = item.strategyKey.split('#');
      return {
        strategy,
        chunkingMethod: chunkingMethod !== 'none' ? chunkingMethod : null,
        evaluation: {
          helpfulness: item.helpfulness,
          faithfulness: item.faithfulness,
          completeness: item.completeness,
          anomalyAccuracy: item.anomalyAccuracy,
          evaluatedAt: item.evaluatedAt,
        },
      };
    });

    return successResponse(200, {
      claimId,
      evaluations,
    });
  } catch (error) {
    console.error('Error fetching evaluations:', error);
    return errorResponse(500, 'Failed to retrieve evaluation results');
  }
}

/**
 * Handle POST /claims/{claimId}/summary
 * Orchestrates claim summarization with cache check, agent routing, and response handling.
 */
async function handlePostSummary(
  claimId: string,
  request: ClaimSummaryRequest,
  tenantId: string
): Promise<APIGatewayProxyResult> {
  const startTime = Date.now();

  // Task 4.2: Cache check logic
  if (!request.forceRegenerate) {
    const cacheKey = buildCacheKey(claimId, request.strategy, request.chunkingMethod, request.useReranker);
    console.log('Checking cache for key:', cacheKey);

    try {
      const cached = await getCachedSummary(cacheKey);
      if (cached) {
        console.log('Cache hit for key:', cacheKey);

        const cachedResponse: ClaimSummaryResponse = {
          ...cached.content,
          cached: true,
          cachedAt: new Date().toISOString(),
          generatedAt: cached.generatedAt,
        };

        // Include evaluation scores if requested
        if (request.includeEvaluation) {
          const strategyKey = `${request.strategy}#${request.chunkingMethod || 'none'}`;
          const evaluation = await getEvaluationScores(claimId, strategyKey);
          if (evaluation) {
            cachedResponse.evaluation = evaluation;
          }
        }

        return successResponse(200, cachedResponse);
      }
    } catch (error) {
      // Cache read failure: log and proceed with generation (graceful degradation)
      console.error('Cache read failed, proceeding with generation:', error);
    }
  }

  // Task 4.3: Agent routing logic
  let summary: string;
  let anomalies: DataAnomaly[];
  let documentCount: number;
  let documentIds: string[] = [];

  try {
    // Resolve patientId from claimId for KB metadata filtering
    const patientId = await resolvePatientId(claimId, tenantId);

    if (request.strategy === 'rag') {
      // RAG strategy: use Knowledge Base retrieval
      console.log('Executing RAG strategy with chunkingMethod:', request.chunkingMethod);
      const ragResult = await executeRagStrategy(
        claimId,
        request.chunkingMethod || 'semantic',
        patientId
      );

      if (ragResult.documentCount === 0) {
        return errorResponse(404, `No documents found for claim ${claimId}`);
      }

      summary = ragResult.summary;
      anomalies = ragResult.anomalies;
      documentCount = ragResult.documentCount;
    } else if (request.strategy === 'graph-rag') {
      // Graph RAG strategy: query GraphRAG KB (Neptune Analytics)
      const useReranker = request.useReranker ?? false;
      console.log('Executing graph-rag strategy for claimId:', claimId, 'useReranker:', useReranker);
      try {
        const graphRagResult = await executeGraphRagStrategy(claimId, useReranker, patientId);
        if (graphRagResult.documentCount === 0) {
          return errorResponse(404, `No documents found for claim ${claimId}`);
        }
        summary = graphRagResult.summary;
        anomalies = graphRagResult.anomalies;
        documentCount = graphRagResult.documentCount;
      } catch (error) {
        // Fallback to full-context on GraphRAG failure
        console.error('Graph RAG failed, falling back to full-context:', error);
        const documents = await queryClaimDocuments(claimId, tenantId);
        if (documents.length === 0) {
          return errorResponse(404, `No documents found for claim ${claimId}`);
        }
        const summarizable = documents.filter((d) => d.extractedText?.trim());
        if (summarizable.length === 0) {
          return errorResponse(400, 'No summarizable content available.');
        }
        documentIds = summarizable.map((d) => d.documentId);
        documentCount = summarizable.length;
        const result = await executeFullContextStrategy(summarizable);
        summary = result.summary;
        anomalies = result.anomalies;
      }
    } else {
      // Full-context strategy: query documents directly
      console.log('Querying documents for claimId:', claimId);
      const documents = await queryClaimDocuments(claimId, tenantId);

      if (documents.length === 0) {
        return errorResponse(404, `No documents found for claim ${claimId}`);
      }

      const summarizableDocuments = documents.filter(
        (doc) => doc.extractedText && doc.extractedText.trim().length > 0
      );

      if (summarizableDocuments.length === 0) {
        return errorResponse(
          400,
          'No summarizable content available. Documents are still processing or have no extracted text.'
        );
      }

      documentIds = summarizableDocuments.map((doc) => doc.documentId);
      documentCount = summarizableDocuments.length;

      console.log('Executing full-context strategy with', documentCount, 'documents');
      const result = await executeFullContextStrategy(summarizableDocuments);
      summary = result.summary;
      anomalies = result.anomalies;
    }
  } catch (error) {
    // Task 4.4: Return 502 when Bedrock/AgentCore invocation fails
    console.error('Agent invocation failed:', error);
    return errorResponse(502, 'Summary generation failed. Please try again later.');
  }

  const processingTime = Date.now() - startTime;
  const generatedAt = new Date().toISOString();

  // Build response
  const response: ClaimSummaryResponse = {
    summary,
    anomalies,
    strategy: request.strategy,
    chunkingMethod: request.chunkingMethod,
    documentCount,
    processingTime,
    generatedAt,
    cached: false,
    useReranker: request.strategy === 'graph-rag' ? request.useReranker : undefined,
  };

  // Include evaluation scores if requested
  if (request.includeEvaluation) {
    const strategyKey = `${request.strategy}#${request.chunkingMethod || 'none'}`;
    const evaluation = await getEvaluationScores(claimId, strategyKey);
    if (evaluation) {
      response.evaluation = evaluation;
    }
  }

  // Task 4.4: Store successful summary in cache
  try {
    const cacheKey = buildCacheKey(claimId, request.strategy, request.chunkingMethod, request.useReranker);
    await cacheSummary(cacheKey, response, documentIds);
    console.log('Summary cached successfully for key:', cacheKey);
  } catch (error) {
    // Cache write failure: log error but return successful response (graceful degradation)
    console.error('Failed to cache summary:', error);
  }

  return successResponse(200, response);
}

/**
 * Lambda handler for the Claim Summary Orchestrator.
 *
 * Routes requests to:
 * - POST /claims/{claimId}/summary → handlePostSummary
 * - GET /claims/{claimId}/evaluations → handleGetEvaluations
 *
 * @param event - API Gateway proxy event
 * @returns API Gateway proxy result with summary, evaluations, or error
 */
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  console.log('Claim Summary Orchestrator Request:', JSON.stringify({
    path: event.path,
    httpMethod: event.httpMethod,
    pathParameters: event.pathParameters,
    body: event.body ? '(present)' : '(empty)',
  }));

  try {
    // Extract claimId from path parameters
    const claimId = event.pathParameters?.claimId;

    if (!claimId) {
      console.log('Validation failed: Missing claimId parameter');
      return errorResponse(400, 'Missing claimId parameter');
    }

    // Task 4.5: Route GET /evaluations requests
    if (event.httpMethod === 'GET' && (event.path?.endsWith('/evaluations') || event.resource?.endsWith('/evaluations'))) {
      return handleGetEvaluations(claimId);
    }

    // POST /summary - validate request body
    const validation = validateRequest(event.body);

    if (!validation.valid) {
      console.log('Validation failed:', validation.error);
      return errorResponse(400, validation.error);
    }

    const request = validation.request;
    console.log('Validated request:', JSON.stringify({
      claimId,
      strategy: request.strategy,
      chunkingMethod: request.chunkingMethod,
      forceRegenerate: request.forceRegenerate,
      includeEvaluation: request.includeEvaluation,
    }));

    return handlePostSummary(claimId, request, extractTenantId(event));

  } catch (error) {
    console.error('Unexpected error in claim summary orchestrator:', error);
    return errorResponse(500, 'Internal server error');
  }
};

/**
 * Extract tenant ID from request headers, falling back to 'local-dev-tenant'.
 */
function extractTenantId(event: APIGatewayProxyEvent): string {
  const headers = event.headers || {};
  return headers['x-tenant-id'] || headers['X-Tenant-Id'] || 'local-dev-tenant';
}
