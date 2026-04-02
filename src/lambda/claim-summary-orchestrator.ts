import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { BedrockAgentRuntimeClient, RetrieveCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from '@aws-sdk/client-bedrock-agentcore';
import {
  ClaimSummaryRequest,
  ClaimSummaryResponse,
  DataAnomaly,
  EvaluationScores,
  SummaryStrategy,
  ChunkingMethod,
  PromptInfo,
  FinancialSummary,
  TimelineData,
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
 * Default timeout for AgentCore Runtime API calls (in milliseconds).
 */
const AGENTCORE_TIMEOUT_MS = parseInt(process.env.AGENTCORE_TIMEOUT_MS || '120000', 10);

// AgentCore client (lazy-initialized)
let agentCoreClient: BedrockAgentCoreClient | null = null;

function getAgentCoreClient(): BedrockAgentCoreClient {
  if (!agentCoreClient) {
    agentCoreClient = new BedrockAgentCoreClient({
      region: process.env.AWS_REGION || BEDROCK_REGION,
      requestHandler: { requestTimeout: AGENTCORE_TIMEOUT_MS } as any,
    });
  }
  return agentCoreClient;
}

/**
 * Invoke an AgentCore Runtime agent using the AWS SDK.
 *
 * @param agentRuntimeArn - The ARN or agent ID of the AgentCore Runtime agent
 * @param payload  - JSON-serializable request payload
 * @returns Parsed JSON response from the agent
 */
async function invokeAgentCoreRuntime(
  agentRuntimeArn: string,
  payload: Record<string, unknown>,
): Promise<any> {
  const body = JSON.stringify(payload);
  console.log(`Invoking AgentCore Runtime: ${agentRuntimeArn}`);

  const command = new InvokeAgentRuntimeCommand({
    agentRuntimeArn,
    payload: new TextEncoder().encode(body),
    contentType: 'application/json',
    accept: 'application/json',
  });

  const response = await getAgentCoreClient().send(command);

  // Collect the streaming response
  const chunks: string[] = [];
  const responseStream = response.response;

  if (responseStream) {
    // Handle ReadableStream / async iterable
    if (Symbol.asyncIterator in Object(responseStream)) {
      for await (const chunk of responseStream as AsyncIterable<Uint8Array>) {
        chunks.push(new TextDecoder().decode(chunk));
      }
    } else if (typeof (responseStream as any).transformToString === 'function') {
      chunks.push(await (responseStream as any).transformToString());
    } else if (typeof (responseStream as any).read === 'function') {
      // Node.js Readable stream
      for await (const chunk of responseStream as any) {
        chunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
      }
    }
  }

  const responseBody = chunks.join('');

  // Handle text/event-stream format (SSE)
  if (response.contentType?.includes('text/event-stream')) {
    const dataLines = responseBody
      .split('\n')
      .filter(line => line.startsWith('data: '))
      .map(line => line.substring(6));
    const fullContent = dataLines.join('');
    try {
      return JSON.parse(fullContent);
    } catch {
      return { summary: fullContent, anomalies: [], documentCount: 0, strategy: 'unknown' };
    }
  }

  // Handle plain JSON response
  try {
    return JSON.parse(responseBody);
  } catch {
    throw new Error(`AgentCore Runtime returned invalid JSON: ${responseBody.substring(0, 200)}`);
  }
}

/**
 * Valid summarization strategies
 */
const VALID_STRATEGIES: SummaryStrategy[] = ['full-context', 'rag', 'graph-rag', 'enriched'];

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
    return { valid: false, error: 'Invalid strategy. Must be one of: full-context, rag, graph-rag, enriched' };
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
      modelId: typeof request.modelId === 'string' ? request.modelId : undefined,
      customPrompt: typeof request.customPrompt === 'string' ? request.customPrompt : undefined,
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
async function invokeBedrockNovaPro(prompt: string, modelId: string = 'amazon.nova-pro-v1:0'): Promise<string> {
  const isClaude = modelId.includes('anthropic');

  const body = isClaude
    ? {
        anthropic_version: 'bedrock-2023-05-31',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 4000,
        temperature: 0.3,
      }
    : {
        messages: [{ role: 'user', content: [{ text: prompt }] }],
        inferenceConfig: { max_new_tokens: 4000, temperature: 0.3 },
      };

  const command = new InvokeModelCommand({
    modelId,
    body: JSON.stringify(body),
  });

  const response = await bedrockClient.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));

  if (isClaude) {
    return responseBody?.content?.[0]?.text || '';
  }

  return responseBody?.output?.message?.content?.[0]?.text || responseBody?.completion || '';
}

/**
 * Build the summarization prompt with anomaly detection instructions.
 */
function buildSummaryPrompt(documentsText: string, strategy: string): string {
  return `You are an insurance claims analyst. Analyze the following claim documents and provide:

1. A comprehensive summary of the claim including patient information, diagnoses, procedures, service dates, provider information, and amounts.

2. Data anomaly detection - carefully check for ALL of the following inconsistencies:

   A. DATE ANOMALIES:
   - Service/encounter dates that fall BEFORE the patient's birth date (year of service < year of birth)
   - Payment dates that fall BEFORE the service date (year of payment < year of service)
   - Dates that are in the future relative to other dates in the claim

   B. AGE-PLAUSIBILITY ANOMALIES (IMPORTANT - calculate patient age at time of service):
   - Calculate the patient's age at each service/encounter date: age = service_year - birth_year
   - Flag if medical history is implausible for the patient's age (e.g., a child with decades of substance use history, a 5-year-old with 30 pack-years of smoking, a teenager with age-related conditions like dementia)
   - Flag if procedures are inappropriate for the patient's age (e.g., pediatric procedures on elderly patients, geriatric procedures on children)
   - Flag if prescribed medications are contraindicated for the patient's age group

   C. CROSS-DOCUMENT CONTRADICTIONS:
   - Different patient names, birth dates, or genders across documents for the same claim
   - Conflicting diagnoses or procedures across documents
   - Inconsistent provider information
   - Duplicate charges or conflicting amounts

   D. BILLING ANOMALIES:
   - Charges that seem unreasonable for the procedures listed
   - Duplicate billing for the same service
   - Services billed that don't match the diagnosis

   E. CLINICAL AND LOGICAL PLAUSIBILITY:
   - Any claim detail that contradicts established medical knowledge (e.g., treatments inappropriate for the stated diagnosis, impossible lab values, contradictory clinical findings)
   - Treatments, procedures, or referrals that don't match the documented diagnosis or symptoms
   - Lab results, imaging findings, or vital signs inconsistent with the stated condition or patient demographics
   - Medication prescriptions that conflict with the diagnosis, patient age, or other prescribed medications
   - Any data point that a trained insurance claims reviewer would flag for further investigation
   - Use your medical and insurance domain knowledge to identify anything that simply doesn't make sense

CRITICAL DATE COMPARISON RULES:
- To compare two dates, first extract the YEAR. A higher year number means a later date.
- A service date is AFTER a birth date if the service year > birth year. This is NOT an anomaly.
- Only flag "date before" anomalies if the year is strictly less.
- When reporting dates in dataValues, use YYYY-MM-DD format.

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
 * Build prompt metadata for transparency.
 * Uses the same buildSummaryPrompt with a placeholder to capture the template.
 */
function buildPromptInfo(strategyLabel: string, retrievalQuery?: string): PromptInfo {
  const promptTemplate = buildSummaryPrompt('[DOCUMENTS]', strategyLabel);
  return {
    promptTemplate,
    strategyLabel,
    ...(retrievalQuery !== undefined && { retrievalQuery }),
  };
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
      const rawAnomalies: DataAnomaly[] = Array.isArray(parsed.anomalies) ? parsed.anomalies.map((a: any) => ({
        description: a.description || '',
        severity: ['critical', 'warning', 'info'].includes(a.severity) ? a.severity : 'info',
        sourceDocument: a.sourceDocument || 'Unknown',
        dataValues: a.dataValues || {},
      })) : [];
      return {
        summary: parsed.summary || responseText,
        anomalies: filterFalsePositiveDateAnomalies(rawAnomalies),
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
 * Validates date-based anomalies programmatically to filter out LLM false positives.
 * LLMs frequently miscompare dates even when instructed to convert formats first.
 * This function checks anomalies that claim "service date before birth date" and
 * removes them if the dates actually show the service date is AFTER the birth date.
 */
function filterFalsePositiveDateAnomalies(anomalies: DataAnomaly[]): DataAnomaly[] {
  return anomalies.filter((anomaly) => {
    const desc = anomaly.description.toLowerCase();
    const dv = anomaly.dataValues;

    // Filter "service date in the future relative to birth date" — a service date
    // AFTER birth is normal, not an anomaly. The LLM sometimes flags this incorrectly.
    if (desc.includes('future') && desc.includes('birth')) {
      const dateEntries: { key: string; date: Date }[] = [];
      for (const [key, val] of Object.entries(dv)) {
        if (typeof val === 'string') {
          const parsed = parseFlexibleDate(val);
          if (parsed) dateEntries.push({ key, date: parsed });
        }
      }
      if (dateEntries.length === 2) {
        const birthKeys = ['birthdate', 'birth_date', 'dob', 'dateofbirth', 'patientbirthdate'];
        const birthEntry = dateEntries.find(e => birthKeys.includes(e.key.toLowerCase().replace(/[_\s]+/g, '')));
        const otherEntry = dateEntries.find(e => !birthKeys.includes(e.key.toLowerCase().replace(/[_\s]+/g, '')));
        if (birthEntry && otherEntry && otherEntry.date > birthEntry.date) {
          return false; // Service after birth is normal
        }
      }
    }

    // Generic "X date before Y date" false positive filter.
    // The LLM often claims date A is before date B when it's actually after.
    // We check all "before" anomalies by finding two parseable dates in dataValues
    // and verifying the claimed ordering is actually correct.
    if (desc.includes('before')) {
      // Collect all date values from dataValues
      const dateEntries: { key: string; date: Date }[] = [];
      for (const [key, val] of Object.entries(dv)) {
        if (typeof val === 'string') {
          const parsed = parseFlexibleDate(val);
          if (parsed) dateEntries.push({ key, date: parsed });
        }
      }

      // If we have exactly 2 dates, check if the "before" claim is correct
      if (dateEntries.length === 2) {
        // Determine which date the description claims comes first
        // Pattern: "X before Y" means X < Y is the claim
        // The first date key mentioned in desc is the one claimed to be earlier
        const birthKeys = ['birthdate', 'birth_date', 'dob', 'dateofbirth'];
        const isBirthComparison = dateEntries.some(e => birthKeys.includes(e.key.toLowerCase()));

        if (isBirthComparison) {
          // For birth date comparisons: the non-birth date should be BEFORE birth
          const birthEntry = dateEntries.find(e => birthKeys.includes(e.key.toLowerCase()));
          const otherEntry = dateEntries.find(e => !birthKeys.includes(e.key.toLowerCase()));
          if (birthEntry && otherEntry && otherEntry.date >= birthEntry.date) {
            return false; // False positive — the other date is actually after birth
          }
        } else {
          // For other comparisons (payment before service, etc):
          // The description says "X before Y" — X should be chronologically before Y.
          // If X is actually after Y, it's a false positive.
          // We identify X as the first date mentioned in the description.
          const descNorm = desc.replace(/[_\s]+/g, ''); // normalize spaces/underscores
          const [first, second] = dateEntries;
          const firstKeyNorm = first.key.toLowerCase().replace(/[_\s]+/g, '');
          const secondKeyNorm = second.key.toLowerCase().replace(/[_\s]+/g, '');
          const firstIdx = descNorm.indexOf(firstKeyNorm);
          const secondIdx = descNorm.indexOf(secondKeyNorm);

          if (firstIdx >= 0 && secondIdx >= 0 && firstIdx < secondIdx) {
            // desc claims first < second, verify
            if (first.date >= second.date) return false;
          } else if (firstIdx >= 0 && secondIdx >= 0 && secondIdx < firstIdx) {
            if (second.date >= first.date) return false;
          } else {
            // Can't determine order from desc, check if chronologically valid
            // If the earlier date in dataValues is actually later, it's a false positive
            if (first.date >= second.date) return false;
          }
        }
      }
    }

    return true;
  });
}

/**
 * Parses a date string in either MM/DD/YYYY or YYYY-MM-DD format.
 * Returns a Date object or null if parsing fails.
 */
function parseFlexibleDate(dateStr: string): Date | null {
  const trimmed = dateStr.trim();

  // Try YYYY-MM-DD
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]));
  }

  // Try MM/DD/YYYY
  const usMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (usMatch) {
    return new Date(parseInt(usMatch[3]), parseInt(usMatch[1]) - 1, parseInt(usMatch[2]));
  }

  return null;
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
 * Full Context strategy: invoke the enhanced Full Context agent Lambda.
 * The agent uses tools to extract financial and timeline data, then generates
 * a comprehensive summary with structured financial and timeline analysis.
 */
async function executeFullContextStrategy(
  claimId: string,
  tenantId: string,
  modelId?: string,
  customPrompt?: string
): Promise<{
  summary: string;
  anomalies: DataAnomaly[];
  documentCount: number;
  promptInfo: PromptInfo;
  financialSummary?: FinancialSummary;
  timeline?: TimelineData;
  agentFinancialSummary?: FinancialSummary | null;
  agentTimeline?: TimelineData | null;
  agentConfidence?: number | null;
  agentReasoning?: string | null;
}> {
  const fullContextAgentEndpoint = process.env.FULL_CONTEXT_AGENT_ENDPOINT;
  const financialTimelineAgentEndpoint = process.env.FINANCIAL_TIMELINE_AGENT_ENDPOINT;

  if (!fullContextAgentEndpoint) {
    // Fallback to legacy direct Bedrock invocation if agent endpoint not configured
    console.warn('FULL_CONTEXT_AGENT_ENDPOINT not configured, using legacy direct Bedrock approach');
    const documents = await queryClaimDocuments(claimId, tenantId);
    if (documents.length === 0) {
      throw new Error(`No documents found for claim ${claimId}`);
    }
    const summarizable = documents.filter((d) => d.extractedText?.trim());
    if (summarizable.length === 0) {
      throw new Error('No summarizable content available.');
    }

    const documentsText = summarizable
      .map((doc) => `--- Document: ${doc.fileName} ---\n${doc.extractedText || ''}`)
      .join('\n\n');

    const prompt = customPrompt
      ? customPrompt.replace('{documentsText}', documentsText).replace('[DOCUMENTS]', documentsText)
      : buildSummaryPrompt(documentsText, 'full-context');
    const responseText = await invokeBedrockNovaPro(prompt, modelId);
    const promptInfo = customPrompt
      ? { promptTemplate: customPrompt, strategyLabel: 'full-context (custom prompt)' }
      : buildPromptInfo('full-context');

    return {
      ...parseSummaryResponse(responseText),
      documentCount: summarizable.length,
      promptInfo,
      agentFinancialSummary: null,
      agentTimeline: null,
      agentConfidence: null,
      agentReasoning: null,
    };
  }

  // Build the Full Context agent invocation promise
  const fullContextPromise = invokeAgentCoreRuntime(fullContextAgentEndpoint, {
    claim_id: claimId,
    tenant_id: tenantId,
    model_id: modelId || undefined,
    custom_prompt: customPrompt || undefined,
  });

  // Fire-and-forget the Financial Timeline Agent (if endpoint is configured)
  // Don't block the response — the financial agent result is non-critical
  // and the API Gateway 29s timeout can't accommodate two sequential agent calls
  if (financialTimelineAgentEndpoint) {
    invokeAgentCoreRuntime(financialTimelineAgentEndpoint, {
      claim_id: claimId,
      tenant_id: tenantId,
      model_id: modelId || undefined,
    }).then((financialResult) => {
      if (!financialResult.error && !(financialResult.statusCode >= 400)) {
        console.log('Financial Timeline Agent completed successfully (fire-and-forget)', {
          claimId,
          confidence: financialResult.confidence,
          paymentsFound: financialResult.financialSummary?.payments?.length ?? 0,
        });
      } else {
        console.warn('Financial Timeline Agent returned error (fire-and-forget):', financialResult.error);
      }
    }).catch((err) => {
      console.warn('Financial Timeline Agent failed (fire-and-forget, non-fatal):', err.message || err);
    });
  }

  // Await only the Full Context agent
  const agentResult = await fullContextPromise;

  // Handle error responses from the Full Context agent
  if (agentResult.error || agentResult.statusCode >= 400) {
    const errorMessage = agentResult.error || 'Full Context agent invocation failed';
    console.error('Full Context agent error:', errorMessage);
    throw new Error(errorMessage);
  }

  // Financial Timeline Agent runs fire-and-forget — no results to process here
  // The agent-predicted fields are null for this request; future enhancement
  // could store results in DynamoDB/cache for retrieval on next request

  // Return the enhanced agent response with both deterministic and agent-predicted data
  return {
    summary: agentResult.summary || '',
    anomalies: agentResult.anomalies || [],
    documentCount: agentResult.documentCount || 0,
    promptInfo: agentResult.promptInfo || {
      promptTemplate: 'Enhanced Full Context Agent',
      strategyLabel: 'full-context (enhanced agent)'
    },
    financialSummary: agentResult.financialSummary,
    timeline: agentResult.timeline,
    agentFinancialSummary: null,
    agentTimeline: null,
    agentConfidence: null,
    agentReasoning: null,
  };
}

/**
 * RAG strategy: use Knowledge Base retrieval then invoke Bedrock.
 */
async function executeRagStrategy(
  claimId: string,
  chunkingMethod: string,
  useReranker: boolean = false,
  patientId?: string | null,
  modelId?: string
): Promise<{ summary: string; anomalies: DataAnomaly[]; documentCount: number; promptInfo: PromptInfo }> {
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

  const retrievalQueryText = `Summarize insurance claim ${claimId} including patient information, diagnoses, procedures, service dates, provider details, and amounts. Identify any data anomalies.`;

  const retrieveInput: any = {
    knowledgeBaseId: KNOWLEDGE_BASE_ID,
    retrievalQuery: {
      text: retrievalQueryText,
    },
    retrievalConfiguration: {
      vectorSearchConfiguration: vectorSearchConfig,
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
    // No results with metadata filter — do NOT fall back to unfiltered queries
    // as that returns chunks from ALL patients, causing mixed patient data.
    console.warn(`No KB results with ${filterKey} metadata filter for claim ${claimId}. KB may need re-sync to index metadata sidecars.`);
    const promptInfo = buildPromptInfo(`rag (${chunkingMethod} chunking)`, retrievalQueryText);
    return { summary: '', anomalies: [], documentCount: 0, promptInfo };
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
  const responseText = await invokeBedrockNovaPro(prompt, modelId);
  const parsed = parseSummaryResponse(responseText);
  const promptInfo = buildPromptInfo(`rag (${chunkingMethod} chunking)`, retrievalQueryText);

  return {
    ...parsed,
    documentCount: uniqueSources.size || chunks.length,
    promptInfo,
  };
}

/**
 * Graph RAG strategy: queries GraphRAG Knowledge Base backed by Neptune Analytics.
 * Optionally applies Cohere Rerank 3.5 to retrieval results.
 */
async function executeGraphRagStrategy(
  claimId: string,
  useReranker: boolean = false,
  patientId?: string | null,
  modelId?: string
): Promise<{ summary: string; anomalies: DataAnomaly[]; documentCount: number; promptInfo: PromptInfo }> {
  const filterKey = patientId ? 'patientId' : 'claimId';
  const filterValue = patientId || claimId;
  console.log(`GraphRAG KB filter: ${filterKey}=${filterValue}`);
  const retrievalQueryText = `Summarize insurance claim ${claimId} including patient information, diagnoses, procedures, service dates, provider details, and amounts. Identify any data anomalies.`;
  const retrieveInput: any = {
    knowledgeBaseId: GRAPH_RAG_KNOWLEDGE_BASE_ID,
    retrievalQuery: {
      text: retrievalQueryText,
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
    const promptInfo = buildPromptInfo('graph-rag (Neptune Analytics GraphRAG)', retrievalQueryText);
    return { summary: '', anomalies: [], documentCount: 0, promptInfo };
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
  const responseText = await invokeBedrockNovaPro(prompt, modelId);
  const parsed = parseSummaryResponse(responseText);
  const promptInfo = buildPromptInfo('graph-rag (Neptune Analytics GraphRAG)', retrievalQueryText);

  return {
    ...parsed,
    documentCount: uniqueSources.size || chunks.length,
    promptInfo,
  };
}

/**
 * Enriched strategy: invokes the enriched agent Lambda which combines
 * Full Context, RAG, and Graph RAG sources into a single deduplicated context.
 */
async function executeEnrichedStrategy(
  claimId: string,
  tenantId: string,
  patientId?: string | null,
  modelId?: string
): Promise<{ summary: string; anomalies: DataAnomaly[]; documentCount: number; promptInfo: PromptInfo }> {
  const enrichedAgentEndpoint = process.env.ENRICHED_AGENT_ENDPOINT;
  if (!enrichedAgentEndpoint) {
    throw new Error('ENRICHED_AGENT_ENDPOINT environment variable is not configured');
  }

  console.log('Invoking enriched agent via AgentCore Runtime for claimId:', claimId);
  const responsePayload = await invokeAgentCoreRuntime(enrichedAgentEndpoint, {
    claim_id: claimId,
    tenant_id: tenantId,
    patient_id: patientId || undefined,
    model_id: modelId || undefined,
  });

  if (responsePayload.error) {
    throw new Error(`Enriched agent error: ${responsePayload.error}`);
  }

  const agentAnomalies: DataAnomaly[] = Array.isArray(responsePayload.anomalies)
    ? responsePayload.anomalies.map((a: any) => ({
        description: a.description || '',
        severity: ['critical', 'warning', 'info'].includes(a.severity) ? a.severity : 'info',
        sourceDocument: a.sourceDocument || 'Unknown',
        dataValues: a.dataValues || {},
      }))
    : [];

  return {
    summary: responsePayload.summary || '',
    anomalies: filterFalsePositiveDateAnomalies(agentAnomalies),
    documentCount: responsePayload.documentCount || 0,
    promptInfo: responsePayload.promptInfo || buildPromptInfo('Enriched (Full Context + RAG + Graph RAG)'),
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

  // Task 4.2: Cache check logic — skip cache when custom prompt is provided
  if (!request.forceRegenerate && !request.customPrompt) {
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
  let promptInfo: PromptInfo | undefined;
  let sourceDocumentsText = '';
  let financialSummary: FinancialSummary | undefined;
  let timeline: TimelineData | undefined;
  let agentFinancialSummary: FinancialSummary | null | undefined;
  let agentTimeline: TimelineData | null | undefined;
  let agentConfidence: number | null | undefined;
  let agentReasoning: string | null | undefined;

  try {
    // Resolve patientId from claimId for KB metadata filtering
    const patientId = await resolvePatientId(claimId, tenantId);

    if (request.strategy === 'rag') {
      // RAG strategy: use Knowledge Base retrieval
      const useReranker = request.useReranker ?? false;
      console.log('Executing RAG strategy with chunkingMethod:', request.chunkingMethod, 'useReranker:', useReranker);
      const ragResult = await executeRagStrategy(
        claimId,
        request.chunkingMethod || 'semantic',
        useReranker,
        patientId,
        request.modelId
      );

      if (ragResult.documentCount === 0) {
        return errorResponse(404, `No documents found for claim ${claimId}`);
      }

      summary = ragResult.summary;
      anomalies = ragResult.anomalies;
      documentCount = ragResult.documentCount;
      promptInfo = ragResult.promptInfo;
    } else if (request.strategy === 'graph-rag') {
      // Graph RAG strategy: query GraphRAG KB (Neptune Analytics)
      const useReranker = request.useReranker ?? false;
      console.log('Executing graph-rag strategy for claimId:', claimId, 'useReranker:', useReranker);
      try {
        const graphRagResult = await executeGraphRagStrategy(claimId, useReranker, patientId, request.modelId);
        if (graphRagResult.documentCount === 0) {
          return errorResponse(404, `No documents found for claim ${claimId}`);
        }
        summary = graphRagResult.summary;
        anomalies = graphRagResult.anomalies;
        documentCount = graphRagResult.documentCount;
        promptInfo = graphRagResult.promptInfo;
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
        sourceDocumentsText = summarizable
          .map((d) => `--- ${d.fileName} ---\n${d.extractedText || ''}`)
          .join('\n\n');
        const result = await executeFullContextStrategy(claimId, tenantId, request.modelId);
        summary = result.summary;
        anomalies = result.anomalies;
        documentCount = result.documentCount;
        promptInfo = result.promptInfo;
      }
    } else if (request.strategy === 'enriched') {
      // Enriched strategy: invoke enriched agent Lambda
      console.log('Executing enriched strategy for claimId:', claimId);
      const enrichedResult = await executeEnrichedStrategy(claimId, tenantId, patientId, request.modelId);
      summary = enrichedResult.summary;
      anomalies = enrichedResult.anomalies;
      documentCount = enrichedResult.documentCount;
      promptInfo = enrichedResult.promptInfo;

      // Fetch source documents for evaluation pipeline
      try {
        const docs = await queryClaimDocuments(claimId, tenantId);
        sourceDocumentsText = docs
          .filter((d) => d.extractedText?.trim())
          .map((d) => `--- ${d.fileName} ---\n${d.extractedText || ''}`)
          .join('\n\n');
      } catch (e) {
        console.warn('Failed to fetch source documents for enriched evaluation:', e);
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

      console.log('Executing full-context strategy');
      const result = await executeFullContextStrategy(claimId, tenantId, request.modelId, request.customPrompt);
      summary = result.summary;
      anomalies = result.anomalies;
      documentCount = result.documentCount;
      promptInfo = result.promptInfo;
      financialSummary = result.financialSummary;
      timeline = result.timeline;
      agentFinancialSummary = result.agentFinancialSummary;
      agentTimeline = result.agentTimeline;
      agentConfidence = result.agentConfidence;
      agentReasoning = result.agentReasoning;

      // Fetch source documents for evaluation pipeline
      try {
        const docs = await queryClaimDocuments(claimId, tenantId);
        sourceDocumentsText = docs
          .filter((d) => d.extractedText?.trim())
          .map((d) => `--- ${d.fileName} ---\n${d.extractedText || ''}`)
          .join('\n\n');
      } catch (e) {
        console.warn('Failed to fetch source documents for evaluation:', e);
      }
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
    useReranker: (request.strategy === 'graph-rag' || request.strategy === 'rag') ? request.useReranker : undefined,
    promptInfo,
    financialSummary: financialSummary,
    timeline: timeline,
    agentFinancialSummary: agentFinancialSummary ?? undefined,
    agentTimeline: agentTimeline ?? undefined,
    agentConfidence: agentConfidence ?? undefined,
    agentReasoning: agentReasoning ?? undefined,
  };

  // Include evaluation scores if requested
  if (request.includeEvaluation) {
    const strategyKey = `${request.strategy}#${request.chunkingMethod || 'none'}`;
    const evaluation = await getEvaluationScores(claimId, strategyKey);
    if (evaluation) {
      response.evaluation = evaluation;
    }
  }

  // Trigger async evaluation (fire-and-forget)
  const evalTriggerFunction = process.env.EVALUATION_TRIGGER_FUNCTION;
  if (evalTriggerFunction) {
    // For RAG/GraphRAG strategies, fetch source documents if not already captured
    if (!sourceDocumentsText) {
      try {
        const docs = await queryClaimDocuments(claimId, tenantId);
        sourceDocumentsText = docs
          .filter((d) => d.extractedText?.trim())
          .map((d) => `--- ${d.fileName} ---\n${d.extractedText || ''}`)
          .join('\n\n');
      } catch (e) {
        console.warn('Failed to fetch source documents for evaluation:', e);
      }
    }
    try {
      const lambdaClient = new LambdaClient({ region: BEDROCK_REGION });
      await lambdaClient.send(new InvokeCommand({
        FunctionName: evalTriggerFunction,
        InvocationType: 'Event',
        Payload: JSON.stringify({
          claimId,
          strategy: request.strategy,
          chunkingMethod: request.chunkingMethod || 'none',
          summary,
          sourceDocuments: sourceDocumentsText.substring(0, 50000),
          anomalies,
        }),
      }));
      console.log('Evaluation trigger invoked for claim:', claimId);
    } catch (evalError) {
      console.error('Failed to trigger evaluation (non-blocking):', evalError);
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
