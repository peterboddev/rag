// API client for insurance claim portal endpoints

const API_BASE_URL = process.env.REACT_APP_API_GATEWAY_URL || '';
const API_TIMEOUT = 30000; // 30 seconds

// Helper to get auth token from localStorage
const getAuthToken = (): string | null => {
  return localStorage.getItem('authToken');
};

// Helper for API requests with authentication
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getAuthToken();
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
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

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.message || `API request failed: ${response.status} ${response.statusText}`
      );
    }

    return await response.json();
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

export interface ClaimStatusResponse {
  status: string;
  documentsProcessed: number;
  totalDocuments: number;
  errors?: string[];
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
    apiRequest<PatientListResponse>(`/api/patients?${params.toString()}`)
  );
}

/**
 * Retrieves patient details and associated claims
 */
export async function getPatientDetail(patientId: string): Promise<PatientDetail> {
  return withRetry(() =>
    apiRequest<PatientDetail>(`/api/patients/${encodeURIComponent(patientId)}`)
  );
}

/**
 * Loads claim documents from S3 source to platform bucket
 */
export async function loadClaim(claimId: string): Promise<LoadClaimResponse> {
  return withRetry(() =>
    apiRequest<LoadClaimResponse>(`/api/claims/${encodeURIComponent(claimId)}/load`, {
      method: 'POST',
    })
  );
}

/**
 * Retrieves claim processing status
 */
export async function getClaimStatus(claimId: string): Promise<ClaimStatusResponse> {
  return withRetry(() =>
    apiRequest<ClaimStatusResponse>(`/api/claims/${encodeURIComponent(claimId)}/status`)
  );
}
