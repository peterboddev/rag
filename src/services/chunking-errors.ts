/**
 * Typed error classes and retry utility for chunking configuration.
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5
 */

// --- Typed Error Classes ---

export class ChunkingValidationError extends Error {
  public readonly code = 'CHUNKING_VALIDATION_ERROR';
  public readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ChunkingValidationError';
    this.details = details;
  }
}

export class CleanupError extends Error {
  public readonly code = 'CLEANUP_ERROR';
  public readonly phase: string;
  public readonly isRetryable: boolean;

  constructor(message: string, phase: string, isRetryable = false) {
    super(message);
    this.name = 'CleanupError';
    this.phase = phase;
    this.isRetryable = isRetryable;
  }
}

export class ServiceUnavailableError extends Error {
  public readonly code = 'SERVICE_UNAVAILABLE';
  public readonly serviceName: string;
  public readonly retryAfterMs?: number;

  constructor(message: string, serviceName: string, retryAfterMs?: number) {
    super(message);
    this.name = 'ServiceUnavailableError';
    this.serviceName = serviceName;
    this.retryAfterMs = retryAfterMs;
  }
}

// --- Retry Utility ---

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 5000,
};

/**
 * Calculates delay with exponential backoff and jitter.
 * Exported for testing.
 */
export function calculateBackoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.random() * baseDelayMs;
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

/**
 * Retries an async operation with exponential backoff.
 * Requirement 7.2: retry AWS operations with exponential backoff.
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: Partial<RetryOptions> = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === opts.maxRetries) break;

      // Don't retry validation errors — they won't succeed on retry
      if (error instanceof ChunkingValidationError) throw error;

      const delay = calculateBackoffDelay(attempt, opts.baseDelayMs, opts.maxDelayMs);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}

// --- Structured Logging ---

export interface LogContext {
  customerUUID?: string;
  tenantId?: string;
  operation: string;
  [key: string]: unknown;
}

export function structuredLog(level: 'info' | 'warn' | 'error', message: string, context: LogContext): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  };
  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else if (level === 'warn') {
    console.warn(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

// --- Lambda Error Response Helper ---

export interface ErrorResponseBody {
  error: string;
  code: string;
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

export function buildErrorResponse(statusCode: number, error: unknown): { statusCode: number; headers: Record<string, string>; body: string } {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  let body: ErrorResponseBody;

  if (error instanceof ChunkingValidationError) {
    body = {
      error: 'Validation Error',
      code: error.code,
      message: error.message,
      details: error.details,
      timestamp: new Date().toISOString(),
    };
    return { statusCode: 400, headers, body: JSON.stringify(body) };
  }

  if (error instanceof CleanupError) {
    body = {
      error: 'Cleanup Error',
      code: error.code,
      message: error.message,
      details: { phase: error.phase, isRetryable: error.isRetryable },
      timestamp: new Date().toISOString(),
    };
    return { statusCode: error.isRetryable ? 503 : 500, headers, body: JSON.stringify(body) };
  }

  if (error instanceof ServiceUnavailableError) {
    body = {
      error: 'Service Unavailable',
      code: error.code,
      message: `${error.serviceName} is currently unavailable. Please try again later.`,
      details: { serviceName: error.serviceName, retryAfterMs: error.retryAfterMs },
      timestamp: new Date().toISOString(),
    };
    return { statusCode: 503, headers, body: JSON.stringify(body) };
  }

  // Generic / unknown errors
  const isNotFound = error instanceof Error && error.message.includes('not found');
  const msg = error instanceof Error ? error.message : 'Unknown error';

  body = {
    error: isNotFound ? 'Not Found' : 'Internal Server Error',
    code: isNotFound ? 'NOT_FOUND' : 'INTERNAL_ERROR',
    message: isNotFound ? msg : 'An unexpected error occurred. Please try again or contact support.',
    timestamp: new Date().toISOString(),
  };

  return { statusCode: isNotFound ? 404 : statusCode, headers, body: JSON.stringify(body) };
}
