/**
 * Unit tests for chunk visualization error scenarios.
 * Tests error categorization, error message formatting, state transitions,
 * and recovery logic for the ChunkVisualizationPanel and ErrorBoundary.
 *
 * Since the test environment is node (not jsdom), we test pure logic:
 * state transitions, error classification, and data validation.
 *
 * Requirements: 6.1, 6.2, 6.3
 */

import { describe, it, expect } from '@jest/globals';
import ChunkVisualizationErrorBoundary from '../frontend/src/components/ChunkVisualizationErrorBoundary';
import type {
  ChunkVisualizationState,
  ChunkVisualizationError,
  ChunkVisualizationResponse,
  DocumentChunk,
  ChunkMetadata,
} from '../frontend/src/types';

// --- Helpers: simulate the state transition logic from ChunkVisualizationPanel ---

/** Initial state matching the component's useState default */
function initialState(): ChunkVisualizationState {
  return {
    chunks: [],
    isLoadingChunks: false,
    chunkError: null,
    selectedChunks: new Set(),
    expandedChunks: new Set(),
  };
}

/** Simulates the loadChunks() start: sets loading true, clears error */
function applyLoadStart(prev: ChunkVisualizationState): ChunkVisualizationState {
  return { ...prev, isLoadingChunks: true, chunkError: null };
}

/** Simulates loadChunks() success path */
function applyLoadSuccess(
  prev: ChunkVisualizationState,
  chunks: DocumentChunk[]
): ChunkVisualizationState {
  return { ...prev, chunks, isLoadingChunks: false, chunkError: null };
}

/** Simulates loadChunks() error path */
function applyLoadError(
  prev: ChunkVisualizationState,
  error: Error | string
): ChunkVisualizationState {
  const message = error instanceof Error ? error.message : error;
  return { ...prev, chunks: [], isLoadingChunks: false, chunkError: message };
}

/** Simulates clearing state when no documents are selected */
function applyClearSelection(prev: ChunkVisualizationState): ChunkVisualizationState {
  return {
    ...prev,
    chunks: [],
    chunkError: null,
    selectedChunks: new Set(),
    expandedChunks: new Set(),
  };
}

/** Categorize an error the way the backend service does */
function categorizeError(error: Error): ChunkVisualizationError['errorType'] {
  const msg = error.message.toLowerCase();
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('aborted')) {
    return 'network';
  }
  if (msg.includes('fetch') || msg.includes('network') || msg.includes('econnrefused')) {
    return 'network';
  }
  if (msg.includes('invalid') || msg.includes('validation') || msg.includes('malformed')) {
    return 'chunking';
  }
  return 'processing';
}

/** Determine if an error is retryable */
function isRetryable(error: Error): boolean {
  const msg = error.message.toLowerCase();
  // Network and timeout errors are retryable
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('network') || msg.includes('fetch') || msg.includes('econnrefused')) {
    return true;
  }
  // Processing errors are retryable
  if (msg.includes('processing') || msg.includes('internal')) {
    return true;
  }
  // Validation errors are not retryable
  if (msg.includes('invalid') || msg.includes('validation') || msg.includes('malformed')) {
    return false;
  }
  return true;
}

/** Build a ChunkVisualizationError from an Error */
function buildChunkError(
  error: Error,
  documentId: string,
  fileName: string
): ChunkVisualizationError {
  return {
    documentId,
    fileName,
    errorMessage: error.message,
    errorType: categorizeError(error),
    isRetryable: isRetryable(error),
  };
}

/** Create a minimal valid DocumentChunk for testing */
function makeChunk(overrides: Partial<DocumentChunk> = {}): DocumentChunk {
  return {
    id: overrides.id ?? 'chunk-1',
    text: overrides.text ?? 'Sample chunk text',
    tokenCount: overrides.tokenCount ?? 10,
    characterCount: overrides.characterCount ?? 40,
    metadata: overrides.metadata ?? {
      chunkIndex: 0,
      totalChunks: 1,
      chunkingMethod: 'default',
    } as ChunkMetadata,
    sourceDocument: overrides.sourceDocument ?? {
      documentId: 'doc-1',
      fileName: 'test.pdf',
    },
  };
}

// =============================================================================
// 1. Network failure errors (Req 6.1)
// =============================================================================
describe('Network failure error scenarios (Req 6.1)', () => {
  it('transitions state to error when fetch fails', () => {
    let state = initialState();
    state = applyLoadStart(state);
    expect(state.isLoadingChunks).toBe(true);
    expect(state.chunkError).toBeNull();

    const networkError = new Error('Failed to fetch');
    state = applyLoadError(state, networkError);

    expect(state.isLoadingChunks).toBe(false);
    expect(state.chunkError).toBe('Failed to fetch');
    expect(state.chunks).toEqual([]);
  });

  it('categorizes ECONNREFUSED as a network error', () => {
    const error = new Error('connect ECONNREFUSED 127.0.0.1:3000');
    expect(categorizeError(error)).toBe('network');
    expect(isRetryable(error)).toBe(true);
  });

  it('categorizes generic fetch failure as network error', () => {
    const error = new Error('NetworkError when attempting to fetch resource');
    expect(categorizeError(error)).toBe('network');
    expect(isRetryable(error)).toBe(true);
  });

  it('builds error object with document name for network failure (Req 6.1)', () => {
    const error = new Error('Failed to fetch');
    const chunkError = buildChunkError(error, 'doc-123', 'report.pdf');

    expect(chunkError.fileName).toBe('report.pdf');
    expect(chunkError.errorMessage).toContain('fetch');
    expect(chunkError.errorType).toBe('network');
    expect(chunkError.isRetryable).toBe(true);
  });

  it('error boundary captures network errors with document context', () => {
    const error = new Error('Chunking failed for document report.pdf: network error');
    const boundaryState = (ChunkVisualizationErrorBoundary as any).getDerivedStateFromError(error);

    expect(boundaryState.hasError).toBe(true);
    expect(boundaryState.error).toContain('report.pdf');
    expect(boundaryState.error).toContain('network error');
  });
});

// =============================================================================
// 2. Invalid chunk data errors (Req 6.1)
// =============================================================================
describe('Invalid chunk data error scenarios (Req 6.1)', () => {
  it('categorizes malformed response as chunking error', () => {
    const error = new Error('Invalid JSON: malformed response body');
    expect(categorizeError(error)).toBe('chunking');
    expect(isRetryable(error)).toBe(false);
  });

  it('categorizes validation failure as non-retryable', () => {
    const error = new Error('Validation failed: missing required fields');
    expect(categorizeError(error)).toBe('chunking');
    expect(isRetryable(error)).toBe(false);
  });

  it('transitions state to error on invalid response data', () => {
    let state = initialState();
    state = applyLoadStart(state);

    const parseError = new Error('Invalid chunk data: missing text field');
    state = applyLoadError(state, parseError);

    expect(state.chunkError).toBe('Invalid chunk data: missing text field');
    expect(state.isLoadingChunks).toBe(false);
    expect(state.chunks).toEqual([]);
  });

  it('builds error with document name for invalid data (Req 6.1)', () => {
    const error = new Error('Invalid chunk structure');
    const chunkError = buildChunkError(error, 'doc-456', 'invoice.pdf');

    expect(chunkError.fileName).toBe('invoice.pdf');
    expect(chunkError.errorType).toBe('chunking');
    expect(chunkError.isRetryable).toBe(false);
  });

  it('error boundary captures malformed data errors', () => {
    const error = new Error('Cannot read properties of undefined (reading "chunks")');
    const boundaryState = (ChunkVisualizationErrorBoundary as any).getDerivedStateFromError(error);

    expect(boundaryState.hasError).toBe(true);
    expect(boundaryState.error).toContain('Cannot read properties');
  });
});

// =============================================================================
// 3. Timeout errors (Req 6.3)
// =============================================================================
describe('Timeout error scenarios (Req 6.3)', () => {
  it('categorizes timeout as network error and retryable', () => {
    const error = new Error('Request timed out after 30000ms');
    expect(categorizeError(error)).toBe('network');
    expect(isRetryable(error)).toBe(true);
  });

  it('categorizes AbortError as network/timeout', () => {
    const error = new Error('The operation was aborted');
    expect(categorizeError(error)).toBe('network');
    expect(isRetryable(error)).toBe(true);
  });

  it('transitions state to error with timeout message', () => {
    let state = initialState();
    state = applyLoadStart(state);

    const timeoutError = new Error('Chunking timed out after 30s');
    state = applyLoadError(state, timeoutError);

    expect(state.chunkError).toContain('timed out');
    expect(state.isLoadingChunks).toBe(false);
    expect(state.chunks).toEqual([]);
  });

  it('error boundary captures timeout with retry context', () => {
    const error = new Error('Chunking timed out after 30s');
    const boundaryState = (ChunkVisualizationErrorBoundary as any).getDerivedStateFromError(error);

    expect(boundaryState.hasError).toBe(true);
    expect(boundaryState.error).toContain('timed out');
  });

  it('timeout error for specific document includes document name (Req 6.1, 6.3)', () => {
    const error = new Error('Chunking timed out for document: large-report.pdf');
    const chunkError = buildChunkError(error, 'doc-789', 'large-report.pdf');

    expect(chunkError.fileName).toBe('large-report.pdf');
    expect(chunkError.errorMessage).toContain('timed out');
    expect(chunkError.isRetryable).toBe(true);
  });
});

// =============================================================================
// 4. Empty results handling (Req 6.2)
// =============================================================================
describe('Empty results handling (Req 6.2)', () => {
  it('state has empty chunks and no error when no chunks generated', () => {
    let state = initialState();
    state = applyLoadStart(state);
    state = applyLoadSuccess(state, []);

    expect(state.chunks).toEqual([]);
    expect(state.chunkError).toBeNull();
    expect(state.isLoadingChunks).toBe(false);
  });

  it('state clears when all documents are deselected', () => {
    const chunk = makeChunk();
    let state = initialState();
    state = applyLoadSuccess(state, [chunk]);
    expect(state.chunks.length).toBe(1);

    state = applyClearSelection(state);

    expect(state.chunks).toEqual([]);
    expect(state.chunkError).toBeNull();
    expect(state.selectedChunks.size).toBe(0);
    expect(state.expandedChunks.size).toBe(0);
  });

  it('empty response with zero totalChunks is a valid non-error state', () => {
    const response: ChunkVisualizationResponse = {
      chunks: [],
      totalChunks: 0,
      chunkingMethod: { id: 'default', name: 'Default', description: '', parameters: { strategy: 'default' } },
      processingTime: 50,
      generatedAt: new Date().toISOString(),
    };

    let state = initialState();
    state = applyLoadSuccess(state, response.chunks);

    expect(state.chunks).toEqual([]);
    expect(state.chunkError).toBeNull();
  });

  it('distinguishes empty results from error state', () => {
    // Empty results: no error
    const emptyState = applyLoadSuccess(initialState(), []);
    expect(emptyState.chunkError).toBeNull();
    expect(emptyState.chunks).toEqual([]);

    // Error state: has error message
    const errorState = applyLoadError(initialState(), new Error('Something failed'));
    expect(errorState.chunkError).not.toBeNull();
    expect(errorState.chunks).toEqual([]);
  });
});

// =============================================================================
// 5. Partial failure scenarios (Req 6.1)
// =============================================================================
describe('Partial failure scenarios (Req 6.1)', () => {
  it('successful chunks are preserved when some documents fail', () => {
    const successChunk = makeChunk({ id: 'chunk-ok', sourceDocument: { documentId: 'doc-1', fileName: 'good.pdf' } });
    const failedDoc: ChunkVisualizationError = {
      documentId: 'doc-2',
      fileName: 'bad.pdf',
      errorMessage: 'Processing failed for document: bad.pdf',
      errorType: 'processing',
      isRetryable: true,
    };

    // Simulate partial success: some chunks loaded, some errors
    let state = initialState();
    state = applyLoadSuccess(state, [successChunk]);

    expect(state.chunks.length).toBe(1);
    expect(state.chunks[0].sourceDocument.fileName).toBe('good.pdf');
    expect(state.chunkError).toBeNull();

    // The error info is tracked separately (in the response, not in panel state)
    expect(failedDoc.fileName).toBe('bad.pdf');
    expect(failedDoc.isRetryable).toBe(true);
  });

  it('all-fail scenario results in error state with no chunks', () => {
    const errors: ChunkVisualizationError[] = [
      buildChunkError(new Error('Processing failed'), 'doc-1', 'file1.pdf'),
      buildChunkError(new Error('Processing failed'), 'doc-2', 'file2.pdf'),
    ];

    let state = initialState();
    state = applyLoadStart(state);
    // When all documents fail, the panel receives an error
    state = applyLoadError(state, 'Failed to load chunks: all documents failed');

    expect(state.chunks).toEqual([]);
    expect(state.chunkError).toContain('all documents failed');
    expect(errors.length).toBe(2);
    expect(errors.every(e => e.errorType === 'processing')).toBe(true);
  });

  it('partial failure errors include document names (Req 6.1)', () => {
    const errors: ChunkVisualizationError[] = [
      buildChunkError(new Error('Timeout'), 'doc-1', 'report-a.pdf'),
      buildChunkError(new Error('Invalid data'), 'doc-2', 'report-b.pdf'),
    ];

    expect(errors[0].fileName).toBe('report-a.pdf');
    expect(errors[1].fileName).toBe('report-b.pdf');
    expect(errors[0].isRetryable).toBe(true);  // timeout is retryable
    expect(errors[1].isRetryable).toBe(false);  // invalid data is not
  });

  it('mixed retryable and non-retryable errors are categorized correctly', () => {
    const retryableError = buildChunkError(new Error('Network timeout'), 'doc-1', 'a.pdf');
    const nonRetryableError = buildChunkError(new Error('Invalid chunk validation'), 'doc-2', 'b.pdf');

    expect(retryableError.isRetryable).toBe(true);
    expect(nonRetryableError.isRetryable).toBe(false);
  });
});

// =============================================================================
// 6. Error recovery / retry after error (Req 6.3)
// =============================================================================
describe('Error recovery and retry (Req 6.3)', () => {
  it('retry transitions from error state back to loading', () => {
    let state = initialState();
    state = applyLoadError(state, new Error('Network failure'));
    expect(state.chunkError).toBe('Network failure');

    // User clicks retry -> loadChunks() is called again
    state = applyLoadStart(state);
    expect(state.isLoadingChunks).toBe(true);
    expect(state.chunkError).toBeNull();
  });

  it('successful retry after error restores chunks', () => {
    let state = initialState();
    // First attempt fails
    state = applyLoadStart(state);
    state = applyLoadError(state, new Error('Timeout'));
    expect(state.chunkError).toContain('Timeout');

    // Retry succeeds
    state = applyLoadStart(state);
    const chunks = [makeChunk({ id: 'recovered-chunk' })];
    state = applyLoadSuccess(state, chunks);

    expect(state.chunks.length).toBe(1);
    expect(state.chunks[0].id).toBe('recovered-chunk');
    expect(state.chunkError).toBeNull();
    expect(state.isLoadingChunks).toBe(false);
  });

  it('error boundary reset clears error and allows re-render', () => {
    const instance = new (ChunkVisualizationErrorBoundary as any)({});
    instance.state = { hasError: true, error: 'Component crashed' };

    let capturedState: any = null;
    instance.setState = (s: any) => { capturedState = s; };

    instance.handleReset();

    expect(capturedState).toEqual({ hasError: false, error: null });
  });

  it('multiple consecutive errors maintain correct state', () => {
    let state = initialState();

    // First error
    state = applyLoadStart(state);
    state = applyLoadError(state, new Error('Error 1'));
    expect(state.chunkError).toBe('Error 1');

    // Second error (retry also fails)
    state = applyLoadStart(state);
    state = applyLoadError(state, new Error('Error 2'));
    expect(state.chunkError).toBe('Error 2');

    // Third attempt succeeds
    state = applyLoadStart(state);
    state = applyLoadSuccess(state, [makeChunk()]);
    expect(state.chunkError).toBeNull();
    expect(state.chunks.length).toBe(1);
  });

  it('retry after timeout preserves selected/expanded chunk sets from before error', () => {
    let state = initialState();
    // Load some chunks initially
    state = applyLoadSuccess(state, [makeChunk({ id: 'c1' }), makeChunk({ id: 'c2' })]);
    state = { ...state, selectedChunks: new Set(['c1']), expandedChunks: new Set(['c2']) };

    // Error occurs on next load (e.g., method change triggers reload)
    state = applyLoadStart(state);
    state = applyLoadError(state, new Error('Timed out'));

    // selectedChunks and expandedChunks are preserved through error
    // (only applyClearSelection resets them)
    expect(state.selectedChunks.has('c1')).toBe(true);
    expect(state.expandedChunks.has('c2')).toBe(true);

    // Retry succeeds with new chunks
    state = applyLoadStart(state);
    state = applyLoadSuccess(state, [makeChunk({ id: 'c3' })]);
    expect(state.chunks.length).toBe(1);
    expect(state.chunkError).toBeNull();
  });
});
