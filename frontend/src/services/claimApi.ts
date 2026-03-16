// API client for insurance claim portal endpoints
import { fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';

const API_BASE_URL = process.env.REACT_APP_API_GATEWAY_URL || '';
const API_TIMEOUT = 30000; // 30 seconds

// Helper to get auth token from Amplify (User Pool JWT only, skip AWS credentials)
const getAuthToken = async (): Promise<string | null> => {
  try {
    // First verify user is authenticated
    await getCurrentUser();
    
    // Fetch session - even if Identity Pool credentials fail, tokens should be available
    const session = await fetchAuthSession({ forceRefresh: false });
    
    // Extract the ID token (JWT) for API Gateway authentication
    const idToken = session.tokens?.idToken?.toString();
    
    if (!idToken) {
      console.error('No ID token found in session');
      return null;
    }
    
    console.log('Successfully retrieved auth token');
    return idToken;
  } catch (error: any) {
    // Log all errors for debugging
    console.error('Error getting auth token:', error);
    return null;
  }
};

// Helper for API requests with authentication
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getAuthToken();
  
  if (!token) {
    console.error('No auth token available - user may not be authenticated');
    throw new Error('Authentication required - please sign in again');
  }
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (options.headers) {
    Object.assign(headers, options.headers);
  }

  headers['Authorization'] = `Bearer ${token}`;
  console.log('Making API request with Authorization header to:', endpoint);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);

  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

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

// Claim Summary Types

export interface DataAnomaly {
  description: string;
  severity: 'critical' | 'warning' | 'info';
  sourceDocument: string;
  dataValues: Record<string, string>;
}

export interface EvaluationScores {
  helpfulness: number;
  faithfulness: number;
  completeness: number;
  anomalyAccuracy?: number;
  evaluatedAt: string;
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
}

export interface ClaimEvaluationsResponse {
  claimId: string;
  evaluations: Array<{
    strategy: string;
    chunkingMethod?: string;
    evaluation: EvaluationScores;
  }>;
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
  includeEvaluation?: boolean
) {
  return {
    endpoint: `/claims/${encodeURIComponent(claimId)}/summary`,
    method: 'POST' as const,
    body: {
      strategy,
      ...(chunkingMethod && { chunkingMethod }),
      ...(forceRegenerate !== undefined && { forceRegenerate }),
      ...(includeEvaluation !== undefined && { includeEvaluation }),
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
  return { valid: errors.length === 0, errors };
}

/**
 * Fetches evaluation scores for all strategies that have been run on a claim.
 */
export async function getClaimEvaluations(claimId: string): Promise<ClaimEvaluationsResponse> {
  return apiRequest<ClaimEvaluationsResponse>(`/claims/${encodeURIComponent(claimId)}/evaluations`);
}

/**
 * Generates an AI-powered claim summary using the specified strategy.
 */
export async function getClaimSummary(
  claimId: string,
  strategy: string,
  chunkingMethod?: string,
  forceRegenerate?: boolean,
  includeEvaluation?: boolean
): Promise<ClaimSummaryResponse> {
  const req = buildSummaryRequest(claimId, strategy, chunkingMethod, forceRegenerate, includeEvaluation);
  return apiRequest<ClaimSummaryResponse>(req.endpoint, {
    method: req.method,
    body: JSON.stringify(req.body),
  });
}
