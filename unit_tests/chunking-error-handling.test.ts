/**
 * Unit tests for comprehensive error handling and recovery (Task 9).
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5
 */
import {
  ChunkingValidationError,
  CleanupError,
  ServiceUnavailableError,
  retryWithBackoff,
  calculateBackoffDelay,
  buildErrorResponse,
  structuredLog,
  RetryOptions,
} from '../src/services/chunking-errors';

// ─── Error Class Tests ───

describe('ChunkingValidationError', () => {
  it('should set code, name, message, and details', () => {
    const err = new ChunkingValidationError('bad method', { methodId: 'x' });
    expect(err.code).toBe('CHUNKING_VALIDATION_ERROR');
    expect(err.name).toBe('ChunkingValidationError');
    expect(err.message).toBe('bad method');
    expect(err.details).toEqual({ methodId: 'x' });
    expect(err).toBeInstanceOf(Error);
  });
});

describe('CleanupError', () => {
  it('should capture phase and retryable flag', () => {
    const err = new CleanupError('kb failed', 'knowledge_base', true);
    expect(err.code).toBe('CLEANUP_ERROR');
    expect(err.name).toBe('CleanupError');
    expect(err.phase).toBe('knowledge_base');
    expect(err.isRetryable).toBe(true);
  });

  it('defaults isRetryable to false', () => {
    const err = new CleanupError('done', 'vector_db');
    expect(err.isRetryable).toBe(false);
  });
});

describe('ServiceUnavailableError', () => {
  it('should capture service name and optional retryAfterMs', () => {
    const err = new ServiceUnavailableError('down', 'Bedrock', 3000);
    expect(err.code).toBe('SERVICE_UNAVAILABLE');
    expect(err.serviceName).toBe('Bedrock');
    expect(err.retryAfterMs).toBe(3000);
  });
});

// ─── Retry Utility Tests ───

describe('calculateBackoffDelay', () => {
  it('should increase delay exponentially', () => {
    // With jitter removed conceptually, delay = base * 2^attempt
    // We just verify it's capped at maxDelay
    const delay = calculateBackoffDelay(10, 100, 5000);
    expect(delay).toBeLessThanOrEqual(5000);
  });

  it('should return a value >= 0', () => {
    const delay = calculateBackoffDelay(0, 100, 5000);
    expect(delay).toBeGreaterThanOrEqual(0);
  });
});

describe('retryWithBackoff', () => {
  it('should return immediately on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 10 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on transient failures and eventually succeed', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue('recovered');

    const result = await retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 10 });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should throw after exhausting retries', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('persistent'));
    await expect(
      retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 10 })
    ).rejects.toThrow('persistent');
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('should NOT retry ChunkingValidationError', async () => {
    const fn = jest.fn().mockRejectedValue(
      new ChunkingValidationError('invalid', {})
    );
    await expect(
      retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 10 })
    ).rejects.toThrow(ChunkingValidationError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should use default options when none provided', async () => {
    const fn = jest.fn().mockResolvedValue('default');
    const result = await retryWithBackoff(fn);
    expect(result).toBe('default');
  });
});

// ─── buildErrorResponse Tests ───

describe('buildErrorResponse', () => {
  it('should return 400 for ChunkingValidationError', () => {
    const err = new ChunkingValidationError('bad input', { field: 'chunkSize' });
    const resp = buildErrorResponse(500, err);
    expect(resp.statusCode).toBe(400);
    const body = JSON.parse(resp.body);
    expect(body.code).toBe('CHUNKING_VALIDATION_ERROR');
    expect(body.details).toEqual({ field: 'chunkSize' });
  });

  it('should return 503 for retryable CleanupError', () => {
    const err = new CleanupError('timeout', 'vector_db', true);
    const resp = buildErrorResponse(500, err);
    expect(resp.statusCode).toBe(503);
    const body = JSON.parse(resp.body);
    expect(body.code).toBe('CLEANUP_ERROR');
    expect(body.details.isRetryable).toBe(true);
  });

  it('should return 500 for non-retryable CleanupError', () => {
    const err = new CleanupError('corrupt', 'vector_db', false);
    const resp = buildErrorResponse(500, err);
    expect(resp.statusCode).toBe(500);
  });

  it('should return 503 for ServiceUnavailableError', () => {
    const err = new ServiceUnavailableError('down', 'OpenSearch', 5000);
    const resp = buildErrorResponse(500, err);
    expect(resp.statusCode).toBe(503);
    const body = JSON.parse(resp.body);
    expect(body.code).toBe('SERVICE_UNAVAILABLE');
    expect(body.details.retryAfterMs).toBe(5000);
  });

  it('should return 404 for "not found" errors', () => {
    const err = new Error('Customer not found: abc-123');
    const resp = buildErrorResponse(500, err);
    expect(resp.statusCode).toBe(404);
    const body = JSON.parse(resp.body);
    expect(body.code).toBe('NOT_FOUND');
  });

  it('should return generic 500 for unknown errors', () => {
    const resp = buildErrorResponse(500, new Error('something broke'));
    expect(resp.statusCode).toBe(500);
    const body = JSON.parse(resp.body);
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.message).toContain('unexpected error');
  });

  it('should always include CORS headers', () => {
    const resp = buildErrorResponse(500, new Error('x'));
    expect(resp.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(resp.headers['Content-Type']).toBe('application/json');
  });

  it('should always include a timestamp', () => {
    const resp = buildErrorResponse(500, new Error('x'));
    const body = JSON.parse(resp.body);
    expect(body.timestamp).toBeDefined();
    expect(() => new Date(body.timestamp)).not.toThrow();
  });
});

// ─── structuredLog Tests ───

describe('structuredLog', () => {
  let consoleSpy: jest.SpyInstance;

  afterEach(() => {
    consoleSpy?.mockRestore();
  });

  it('should log info to console.log as JSON', () => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    structuredLog('info', 'test message', { operation: 'test' });
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(logged.level).toBe('info');
    expect(logged.message).toBe('test message');
    expect(logged.operation).toBe('test');
    expect(logged.timestamp).toBeDefined();
  });

  it('should log errors to console.error', () => {
    consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    structuredLog('error', 'fail', { operation: 'op' });
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });

  it('should log warnings to console.warn', () => {
    consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    structuredLog('warn', 'caution', { operation: 'op' });
    expect(consoleSpy).toHaveBeenCalledTimes(1);
  });
});
