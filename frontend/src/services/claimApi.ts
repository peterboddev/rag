// API client for insurance claim portal endpoints
import { fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';

const API_BASE_URL = process.env.REACT_APP_API_GATEWAY_URL || '';
const API_TIMEOUT = 60000; // 60 seconds — API Gateway has 29s limit but we allow extra for network

// Helper to get auth token from Amplify (User Pool JWT only, skip AWS credentials)
const getAuthToken = async (forceRefresh: boolean = false): Promise<string | null> => {
  try {
    // First verify user is authenticated
    await getCurrentUser();
    
    // Fetch session - forceRefresh ensures we get a fresh token when needed
    const session = await fetchAuthSession({ forceRefresh });
    
    // Extract the ID token (JWT) for API Gateway authentication
    const idToken = session.tokens?.idToken?.toString();
    
    if (!idToken) {
      console.error('No ID token found in session');
      return null;
    }
    
    return idToken;
  } catch (error: any) {
    console.error('Error getting auth token:', error);
    return null;
  }
};

// Helper for API requests with authentication (retries once with fresh token on 401)
export async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {},
  _isRetry: boolean = false
): Promise<T> {
  const token = await getAuthToken(_isRetry);
  
  if (!token) {
    throw new Error('Authentication required - please sign in again');
  }
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (options.headers) {
    Object.assign(headers, options.headers);
  }

  headers['Authorization'] = `Bearer ${token}`;

  // Include tenant ID for multi-tenant Lambda handlers
  const tenantId = localStorage.getItem('tenantId');
  if (tenantId) {
    headers['X-Tenant-Id'] = tenantId;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status === 401 && !_isRetry) {
      // Token may be expired — retry once with a forced refresh
      return apiRequest<T>(endpoint, options, true);
    }

    if (!response.ok) {
      const errorData: any = await response.json().catch(() => ({}));
      throw new Error(
        errorData.message || `API request failed: ${response.status} ${response.statusText}`
      );
    }

    return (await response.json()) as T;
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error('Request timeout - please try again');
      }
      throw error;
    }
    throw new Error('An unknown error occurred');
  }
}

// Retry logic for transient failures
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      
      // Don't retry on authentication errors or client errors
      if (lastError.message.includes('401') || lastError.message.includes('403')) {
        throw lastError;
      }
      
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError!;
}

// Types
export interface PatientSummary {
  patientId: string;
  patientName: string;
  tciaCollectionId: string;
  claimCount: number;
}

export interface PatientListResponse {
  patients: PatientSummary[];
  nextToken?: string;
}

export interface ClaimSummary {
  claimId: string;
  documentCount: number;
  filingDate?: string;
  status?: string;
}

export interface PatientDetail {
  patientId: string;
  patientName: string;
  tciaCollectionId: string;
  claims: ClaimSummary[];
}

export interface LoadClaimResponse {
  jobId: string;
  status: string;
  message: string;
}

export interface ClaimDocument {
  documentId: string;
  fileName: string;
  documentType?: string;
  processingStatus: 'completed' | 'processing' | 'queued' | 'failed';
  createdAt: string;
  updatedAt?: string;
}

export interface ClaimStatusResponse {
  status: string;
  documentsProcessed: number;
  totalDocuments: number;
  documents?: ClaimDocument[];
  errors?: string[];
}

export interface DocumentActionState {
  [documentId: string]: {
    isViewLoading: boolean;
    isDownloadLoading: boolean;
  };
}

export interface DocumentRetrievalResponse {
  documentUrl: string;
  contentType: string;
  fileName: string;
}

// API Functions

/**
 * Lists all patients from S3 source bucket
 */
export async function listPatients(
  limit: number = 50,
  nextToken?: string
): Promise<PatientListResponse> {
  const params = new URLSearchParams();
  params.append('limit', limit.toString());
  if (nextToken) {
    params.append('nextToken', nextToken);
  }

  return withRetry(() =>
    apiRequest<PatientListResponse>(`/patients?${params.toString()}`)
  );
}

/**
 * Retrieves patient details and associated claims
 */
export async function getPatientDetail(patientId: string): Promise<PatientDetail> {
  return withRetry(() =>
    apiRequest<PatientDetail>(`/patients/${encodeURIComponent(patientId)}`)
  );
}

/**
 * Loads claim documents from S3 source to platform bucket
 */
export async function loadClaim(
  patientId: string,
  claimId: string,
  customerUUID: string
): Promise<LoadClaimResponse> {
  return withRetry(() =>
    apiRequest<LoadClaimResponse>(`/claims/load`, {
      method: 'POST',
      body: JSON.stringify({ patientId, claimId, customerUUID })
    })
  );
}

/**
 * Retrieves claim processing status
 */
export async function getClaimStatus(claimId: string): Promise<ClaimStatusResponse> {
  return withRetry(() =>
    apiRequest<ClaimStatusResponse>(`/claims/${encodeURIComponent(claimId)}/status`)
  );
}

/**
 * Retrieves document presigned URL for viewing
 */
export async function getDocument(documentId: string): Promise<DocumentRetrievalResponse> {
  return withRetry(() =>
    apiRequest<DocumentRetrievalResponse>(`/documents/${encodeURIComponent(documentId)}`)
  );
}

/**
 * Poll for agent-predicted financial/timeline analysis
 */
export interface FinancialAnalysisResponse {
  claimId: string;
  status: 'pending' | 'completed';
  agentFinancialSummary?: FinancialSummary | null;
  agentTimeline?: TimelineData | null;
  agentConfidence?: number | null;
  agentReasoning?: string | null;
  evaluatedAt?: string;
}

export async function getFinancialAnalysis(claimId: string): Promise<FinancialAnalysisResponse> {
  return apiRequest<FinancialAnalysisResponse>(`/claims/${encodeURIComponent(claimId)}/financial-analysis`);
}

/**
 * Clear all cached summaries for a claim.
 */
export async function clearClaimCache(claimId: string): Promise<{ claimId: string; cacheEntriesDeleted: number; message: string }> {
  return apiRequest<{ claimId: string; cacheEntriesDeleted: number; message: string }>(
    `/claims/${encodeURIComponent(claimId)}/cache`,
    { method: 'DELETE' }
  );
}

// Claim Status History Types

export type ClaimStatusValue = 'Submitted' | 'Under Review' | 'Approved' | 'Denied' | 'Pending Information';

export interface ClaimStatusHistoryEntry {
  claimId: string;
  timestamp: string;
  status: ClaimStatusValue;
  changedBy?: string;
  note?: string;
}

export interface ClaimStatusHistoryResponse {
  claimId: string;
  currentStatus: ClaimStatusValue;
  history: ClaimStatusHistoryEntry[];
}

/**
 * Retrieves claim status history (chronological list of status changes).
 */
export async function getClaimHistory(claimId: string): Promise<ClaimStatusHistoryResponse> {
  return withRetry(() =>
    apiRequest<ClaimStatusHistoryResponse>(`/claims/${encodeURIComponent(claimId)}/history`)
  );
}

/**
 * Adds a new status entry to a claim's history.
 */
export async function addClaimStatusEntry(
  claimId: string,
  status: ClaimStatusValue,
  note?: string,
  changedBy?: string
): Promise<ClaimStatusHistoryEntry> {
  return withRetry(() =>
    apiRequest<ClaimStatusHistoryEntry>(`/claims/${encodeURIComponent(claimId)}/history`, {
      method: 'POST',
      body: JSON.stringify({ status, note, changedBy }),
    })
  );
}

// Claim Search Types

export interface ClaimSearchResult {
  documentId: string;
  claimId: string;
  fileName: string;
  excerpt: string;
  score: number;
  documentType?: string;
}

export interface ClaimSearchResponse {
  query: string;
  results: ClaimSearchResult[];
  totalResults: number;
}

/**
 * Performs semantic search across claim documents.
 */
export async function searchClaims(
  query: string,
  documentType?: string,
  limit?: number
): Promise<ClaimSearchResponse> {
  return withRetry(() =>
    apiRequest<ClaimSearchResponse>('/claims/search', {
      method: 'POST',
      body: JSON.stringify({ query, documentType, limit }),
    })
  );
}

// Claim Export Types

export interface ClaimExportResponse {
  claimId: string;
  fileName: string;
  contentType: string;
  content: string;
  documentCount: number;
  generatedAt: string;
}

/**
 * Exports claim data as a downloadable text report.
 */
export async function exportClaim(claimId: string): Promise<ClaimExportResponse> {
  return withRetry(() =>
    apiRequest<ClaimExportResponse>(`/claims/${encodeURIComponent(claimId)}/export`, {
      method: 'POST',
    })
  );
}

// Claim Summary Types

export interface DataAnomaly {
  description: string;
  severity: 'critical' | 'warning' | 'info';
  sourceDocument: string;
  dataValues: Record<string, string>;
  source?: 'deterministic' | 'llm';
}

export interface EvaluationScores {
  helpfulness: number;
  faithfulness: number;
  completeness: number;
  anomalyAccuracy?: number;
  evaluatedAt: string;
}

export interface PromptInfo {
  promptTemplate: string;
  strategyLabel: string;
  retrievalQuery?: string;
}

export interface PaymentEntry {
  amount: number;
  sourceDocument: string;
  rawText: string;
}

export interface FinancialSummary {
  minPayment: number;
  maxPayment: number;
  totalValue: number;
  payments: PaymentEntry[];
}

export interface TimelineData {
  startYear: number | null;
  endYear: number | null;
  durationYears: number | null;
}

export interface ClaimSummaryResponse {
  summary: string;
  anomalies: DataAnomaly[];
  strategy: string;
  chunkingMethod?: string;
  documentCount: number;
  processingTime: number;
  generatedAt: string;
  cached: boolean;
  cachedAt?: string;
  evaluation?: EvaluationScores;
  promptInfo?: PromptInfo;
  financialSummary?: FinancialSummary;
  timeline?: TimelineData;
  agentFinancialSummary?: FinancialSummary | null;
  agentTimeline?: TimelineData | null;
  agentConfidence?: number | null;
  agentReasoning?: string | null;
  bdaFinancialSummary?: FinancialSummary | null;
  bdaTimeline?: TimelineData | null;
  toolTrace?: ToolTraceEntry[] | null;
}

/**
 * A single tool invocation record within a Tool Execution Trace.
 */
export interface ToolTraceEntry {
  toolName: string;
  executionOrder: number;
  durationMs: number;
  inputSummary: string;
  outputSummary: string;
  error?: string;
}

export interface ClaimEvaluationsResponse {
  claimId: string;
  evaluations: {
    'agentcore-online': EvaluationEntry[];
    'bedrock-api': EvaluationEntry[];
  };
}

export type EvaluationSource = 'agentcore-online' | 'bedrock-api';

export interface EvaluationEntry {
  strategy: string;
  chunkingMethod?: string;
  evaluationSource: EvaluationSource;
  evaluation: EvaluationScores;
}

/**
 * Parses a raw evaluations API response into a grouped ClaimEvaluationsResponse.
 * Ensures both source keys are always present (empty arrays if missing).
 */
export function parseClaimEvaluationsResponse(data: any): ClaimEvaluationsResponse {
  const claimId = data?.claimId ?? '';
  const rawEvals = data?.evaluations ?? {};
  const agentcoreOnline: EvaluationEntry[] = Array.isArray(rawEvals['agentcore-online'])
    ? rawEvals['agentcore-online']
    : [];
  const bedrockApi: EvaluationEntry[] = Array.isArray(rawEvals['bedrock-api'])
    ? rawEvals['bedrock-api']
    : [];
  return {
    claimId,
    evaluations: {
      'agentcore-online': agentcoreOnline,
      'bedrock-api': bedrockApi,
    },
  };
}

// Pure functions for request construction and response parsing (exported for testing)

/**
 * Builds the request configuration for a claim summary API call.
 */
export function buildSummaryRequest(
  claimId: string,
  strategy: string,
  chunkingMethod?: string,
  forceRegenerate?: boolean,
  includeEvaluation?: boolean,
  useReranker?: boolean,
  modelId?: string,
  customPrompt?: string
) {
  return {
    endpoint: `/claims/${encodeURIComponent(claimId)}/summary`,
    method: 'POST' as const,
    body: {
      strategy,
      ...(chunkingMethod && { chunkingMethod }),
      ...(forceRegenerate !== undefined && { forceRegenerate }),
      ...(includeEvaluation !== undefined && { includeEvaluation }),
      ...(useReranker !== undefined && { useReranker }),
      ...(modelId && { modelId }),
      ...(customPrompt && { customPrompt }),
    },
  };
}

/**
 * Validates and parses a claim summary API response, returning errors for any missing/invalid fields.
 */
export function parseClaimSummaryResponse(data: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof data.summary !== 'string') errors.push('summary must be string');
  if (!Array.isArray(data.anomalies)) errors.push('anomalies must be array');
  if (typeof data.strategy !== 'string') errors.push('strategy must be string');
  if (typeof data.documentCount !== 'number') errors.push('documentCount must be number');
  if (typeof data.processingTime !== 'number') errors.push('processingTime must be number');
  if (typeof data.generatedAt !== 'string') errors.push('generatedAt must be string');
  if (typeof data.cached !== 'boolean') errors.push('cached must be boolean');
  if (data.promptInfo !== undefined) {
    if (typeof data.promptInfo !== 'object' || data.promptInfo === null) {
      errors.push('promptInfo must be object');
    } else {
      if (typeof data.promptInfo.promptTemplate !== 'string')
        errors.push('promptInfo.promptTemplate must be string');
      if (typeof data.promptInfo.strategyLabel !== 'string')
        errors.push('promptInfo.strategyLabel must be string');
      if (data.promptInfo.retrievalQuery !== undefined &&
          typeof data.promptInfo.retrievalQuery !== 'string')
        errors.push('promptInfo.retrievalQuery must be string');
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Fetches evaluation scores for all strategies that have been run on a claim.
 * Returns empty evaluations on error/timeout without throwing.
 */
export async function getClaimEvaluations(claimId: string): Promise<ClaimEvaluationsResponse> {
  try {
    const raw = await apiRequest<any>(`/claims/${encodeURIComponent(claimId)}/evaluations`);
    return parseClaimEvaluationsResponse(raw);
  } catch {
    return {
      claimId,
      evaluations: {
        'agentcore-online': [],
        'bedrock-api': [],
      },
    };
  }
}

/**
 * Generates an AI-powered claim summary using the specified strategy.
 */
export async function getClaimSummary(
  claimId: string,
  strategy: string,
  chunkingMethod?: string,
  forceRegenerate?: boolean,
  includeEvaluation?: boolean,
  useReranker?: boolean,
  modelId?: string,
  customPrompt?: string
): Promise<ClaimSummaryResponse> {
  const req = buildSummaryRequest(claimId, strategy, chunkingMethod, forceRegenerate, includeEvaluation, useReranker, modelId, customPrompt);
  const result = await apiRequest<ClaimSummaryResponse & { status?: string }>(req.endpoint, {
    method: req.method,
    body: JSON.stringify(req.body),
  });

  // Handle async regeneration: backend returns 202 with status=processing
  if ((result as any).status === 'processing') {
    // Poll for the result (without forceRegenerate) until it's ready
    const pollReq = buildSummaryRequest(claimId, strategy, chunkingMethod, false, includeEvaluation, useReranker, modelId);
    const maxAttempts = 12; // 60s max (5s intervals)
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(r => setTimeout(r, 5000));
      try {
        const pollResult = await apiRequest<ClaimSummaryResponse>(pollReq.endpoint, {
          method: pollReq.method,
          body: JSON.stringify(pollReq.body),
        });
        if (pollResult.summary) {
          return pollResult;
        }
      } catch {
        // Keep polling on errors
      }
    }
    throw new Error('Regeneration timed out. Please try again.');
  }

  return result;
}
