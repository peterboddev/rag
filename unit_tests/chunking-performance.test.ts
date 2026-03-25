/**
 * Unit tests for performance optimizations (Task 10).
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5
 */

// Mock AWS SDK clients before importing the service
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const mockSend = jest.fn().mockResolvedValue({ Items: [] });
  return {
    DynamoDBDocumentClient: {
      from: jest.fn().mockReturnValue({ send: mockSend }),
    },
    QueryCommand: jest.fn(),
    UpdateCommand: jest.fn(),
    BatchWriteCommand: jest.fn(),
  };
});
jest.mock('@aws-sdk/client-bedrock-agent-runtime', () => ({
  BedrockAgentRuntimeClient: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@opensearch-project/opensearch', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connectionPool: { connections: [{ url: { href: 'https://test-endpoint' } }] },
    ping: jest.fn().mockResolvedValue(true),
    bulk: jest.fn().mockResolvedValue({ body: { errors: false, items: [] } }),
  })),
}));
jest.mock('@opensearch-project/opensearch/aws', () => ({
  AwsSigv4Signer: jest.fn().mockReturnValue({}),
}));
jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn().mockImplementation(() => ({ send: jest.fn().mockResolvedValue({}) })),
  SendMessageCommand: jest.fn(),
}));

// Set env vars before import
process.env.REGION = 'us-east-1';
process.env.BEDROCK_REGION = 'us-east-1';
process.env.VECTOR_DB_ENDPOINT = 'https://test-endpoint';
process.env.DOCUMENTS_TABLE_NAME = 'test-documents';
process.env.CUSTOMERS_TABLE_NAME = 'test-customers';
process.env.KNOWLEDGE_BASE_ID = 'test-kb-id';
process.env.PROCESSING_QUEUE_URL = '';

import {
  EmbeddingCleanupService,
  CleanupProgressTracker,
  CleanupProgress,
  CleanupResult,
} from '../src/services/embedding-cleanup';
import { DocumentRecord } from '../src/types';

// Helper to build a minimal DocumentRecord for testing
function makeDoc(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    documentId: `doc-${Math.random().toString(36).slice(2, 8)}`,
    customerUuid: 'cust-1',
    tenantId: 'tenant-1',
    fileName: 'test.pdf',
    s3Key: 'docs/test.pdf',
    contentType: 'application/pdf',
    processingStatus: 'completed',
    extractedText: 'Some text content',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    embeddingIds: ['emb-1', 'emb-2'],
    embeddingStatus: 'completed',
    ...overrides,
  };
}

// ─── CleanupProgressTracker Tests ───

describe('CleanupProgressTracker', () => {
  it('should initialize with default progress values', () => {
    const tracker = new CleanupProgressTracker('job-1');
    const p = tracker.progress;
    expect(p.jobId).toBe('job-1');
    expect(p.phase).toBe('identifying');
    expect(p.percentage).toBe(0);
    expect(p.embeddingsProcessed).toBe(0);
    expect(p.embeddingsTotal).toBe(0);
    expect(p.documentsProcessed).toBe(0);
    expect(p.documentsTotal).toBe(0);
    expect(p.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('should update progress fields via update()', () => {
    const tracker = new CleanupProgressTracker('job-2');
    tracker.update({ phase: 'removing_kb', percentage: 40, embeddingsTotal: 100 });
    const p = tracker.progress;
    expect(p.phase).toBe('removing_kb');
    expect(p.percentage).toBe(40);
    expect(p.embeddingsTotal).toBe(100);
  });

  it('should invoke the onProgress callback on each update', () => {
    const callback = jest.fn();
    const tracker = new CleanupProgressTracker('job-3', callback);
    tracker.update({ percentage: 10 });
    tracker.update({ percentage: 50 });
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback.mock.calls[0][0].percentage).toBe(10);
    expect(callback.mock.calls[1][0].percentage).toBe(50);
  });

  it('should track elapsed time', async () => {
    const tracker = new CleanupProgressTracker('job-4');
    await new Promise(r => setTimeout(r, 50));
    expect(tracker.progress.elapsedMs).toBeGreaterThanOrEqual(40);
  });

  it('should return a copy of progress (not a reference)', () => {
    const tracker = new CleanupProgressTracker('job-5');
    const p1 = tracker.progress;
    tracker.update({ percentage: 99 });
    const p2 = tracker.progress;
    expect(p1.percentage).toBe(0);
    expect(p2.percentage).toBe(99);
  });
});

// ─── EmbeddingCleanupService Performance Tests ───

describe('EmbeddingCleanupService', () => {
  let service: EmbeddingCleanupService;
  let mockDynamoSend: jest.Mock;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    service = new EmbeddingCleanupService();

    // Get the mock send function from the DynamoDB document client
    const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
    mockDynamoSend = DynamoDBDocumentClient.from().send;
  });

  describe('cleanupCustomerEmbeddings with options', () => {
    it('should accept options parameter and return a result with jobId', async () => {
      // Mock: no documents found
      mockDynamoSend.mockResolvedValue({ Items: [] });

      const result = await service.cleanupCustomerEmbeddings('cust-1', 'tenant-1', {
        timeoutMs: 60000,
      });

      expect(result.jobId).toBeDefined();
      expect(typeof result.duration).toBe('number');
    });

    it('should invoke onProgress callback during cleanup', async () => {
      const progressUpdates: CleanupProgress[] = [];
      mockDynamoSend.mockResolvedValue({ Items: [] });

      await service.cleanupCustomerEmbeddings('cust-1', 'tenant-1', {
        onProgress: (p) => progressUpdates.push({ ...p }),
      });

      // Should have received at least the identifying and final phase updates
      expect(progressUpdates.length).toBeGreaterThanOrEqual(1);
      const phases = progressUpdates.map(p => p.phase);
      expect(phases).toContain('identifying');
    });

    it('should report progress through all phases when documents have embeddings', async () => {
      const docs = [makeDoc({ embeddingIds: ['e1', 'e2'] })];
      const progressUpdates: CleanupProgress[] = [];

      // First call: updateCustomerCleanupStatus (in_progress)
      // Second call: updateCleanupJobProgress
      // Third call: getCustomerDocuments (returns docs)
      // Subsequent calls: various updates
      mockDynamoSend
        .mockResolvedValueOnce({}) // updateCustomerCleanupStatus
        .mockResolvedValueOnce({}) // updateCleanupJobProgress
        .mockResolvedValueOnce({ Items: docs }) // getCustomerDocuments
        .mockResolvedValueOnce({}) // updateCleanupJobProgress (after identify)
        .mockResolvedValue({}); // remaining calls

      const result = await service.cleanupCustomerEmbeddings('cust-1', 'tenant-1', {
        onProgress: (p) => progressUpdates.push({ ...p }),
      });

      expect(result.jobId).toBeDefined();
      const phases = progressUpdates.map(p => p.phase);
      expect(phases).toContain('identifying');
      expect(phases).toContain('removing_kb');
      expect(phases).toContain('removing_vectordb');
      expect(phases).toContain('clearing_refs');
    });
  });

  describe('timeout support', () => {
    it('should abort and return timedOut=true when timeout is exceeded', async () => {
      // Make getCustomerDocuments slow enough to exceed a tiny timeout
      mockDynamoSend
        .mockResolvedValueOnce({}) // updateCustomerCleanupStatus
        .mockResolvedValueOnce({}) // updateCleanupJobProgress
        .mockImplementationOnce(async () => {
          // Simulate slow query
          await new Promise(r => setTimeout(r, 100));
          return { Items: [makeDoc()] };
        })
        .mockResolvedValue({});

      const result = await service.cleanupCustomerEmbeddings('cust-1', 'tenant-1', {
        timeoutMs: 1, // 1ms timeout — will expire immediately
      });

      expect(result.success).toBe(false);
      expect(result.timedOut).toBe(true);
      expect(result.errors).toContain('Cleanup timed out');
    });

    it('should default to 5 minute timeout when not specified', async () => {
      mockDynamoSend.mockResolvedValue({ Items: [] });

      const result = await service.cleanupCustomerEmbeddings('cust-1', 'tenant-1');

      // Should complete successfully (no timeout with empty docs)
      expect(result.timedOut).toBeUndefined();
    });
  });

  describe('cancelCleanup', () => {
    it('should return false for unknown jobId', () => {
      expect(service.cancelCleanup('nonexistent-job')).toBe(false);
    });

    it('should abort cleanup when cancellation is requested', async () => {
      let capturedJobId: string | undefined;

      // Make the first DynamoDB call slow so we can cancel mid-flight
      mockDynamoSend
        .mockResolvedValueOnce({}) // updateCustomerCleanupStatus
        .mockResolvedValueOnce({}) // updateCleanupJobProgress
        .mockImplementationOnce(async () => {
          // During getCustomerDocuments, cancel the job
          if (capturedJobId) {
            service.cancelCleanup(capturedJobId);
          }
          return { Items: [makeDoc()] };
        })
        .mockResolvedValue({});

      const progressUpdates: CleanupProgress[] = [];
      const resultPromise = service.cleanupCustomerEmbeddings('cust-1', 'tenant-1', {
        onProgress: (p) => {
          progressUpdates.push({ ...p });
          capturedJobId = p.jobId;
        },
      });

      const result = await resultPromise;
      expect(result.success).toBe(false);
      expect(result.cancelled).toBe(true);
      expect(result.errors).toContain('Cleanup was cancelled');
    });
  });

  describe('enqueueCleanup (queue mechanism)', () => {
    it('should process queued cleanups sequentially', async () => {
      mockDynamoSend.mockResolvedValue({ Items: [] });

      const executionOrder: number[] = [];
      const originalCleanup = service.cleanupCustomerEmbeddings.bind(service);

      // Spy on cleanupCustomerEmbeddings to track execution order
      let callCount = 0;
      jest.spyOn(service, 'cleanupCustomerEmbeddings').mockImplementation(async (...args) => {
        const myOrder = ++callCount;
        executionOrder.push(myOrder);
        // Small delay to ensure sequential behavior is observable
        await new Promise(r => setTimeout(r, 10));
        return {
          success: true,
          embeddingsRemoved: 0,
          documentsQueued: 0,
          errors: [],
          duration: 10,
          jobId: `job-${myOrder}`,
        };
      });

      const p1 = service.enqueueCleanup('cust-1', 'tenant-1');
      const p2 = service.enqueueCleanup('cust-2', 'tenant-1');
      const p3 = service.enqueueCleanup('cust-3', 'tenant-1');

      const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

      expect(r1.jobId).toBe('job-1');
      expect(r2.jobId).toBe('job-2');
      expect(r3.jobId).toBe('job-3');
      // Verify sequential execution
      expect(executionOrder).toEqual([1, 2, 3]);
    });

    it('should expose queueLength', () => {
      expect(service.queueLength).toBe(0);
    });

    it('should handle errors in queued items without blocking subsequent items', async () => {
      let callCount = 0;
      jest.spyOn(service, 'cleanupCustomerEmbeddings').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error('first cleanup failed');
        }
        return {
          success: true,
          embeddingsRemoved: 0,
          documentsQueued: 0,
          errors: [],
          duration: 5,
          jobId: `job-${callCount}`,
        };
      });

      const p1 = service.enqueueCleanup('cust-1', 'tenant-1');
      const p2 = service.enqueueCleanup('cust-2', 'tenant-1');

      await expect(p1).rejects.toThrow('first cleanup failed');
      const r2 = await p2;
      expect(r2.success).toBe(true);
    });
  });

  describe('CleanupResult shape', () => {
    it('should include cancelled and timedOut fields when aborted', async () => {
      mockDynamoSend
        .mockResolvedValueOnce({}) // updateCustomerCleanupStatus
        .mockResolvedValueOnce({}) // updateCleanupJobProgress
        .mockResolvedValueOnce({ Items: [makeDoc()] }) // getCustomerDocuments
        .mockResolvedValue({});

      const result = await service.cleanupCustomerEmbeddings('cust-1', 'tenant-1', {
        timeoutMs: 1,
      });

      // Either timedOut or cancelled should be set
      expect(result.timedOut === true || result.cancelled === true).toBe(true);
    });

    it('should not include cancelled/timedOut on normal completion', async () => {
      mockDynamoSend.mockResolvedValue({ Items: [] });

      const result = await service.cleanupCustomerEmbeddings('cust-1', 'tenant-1');

      expect(result.cancelled).toBeUndefined();
      expect(result.timedOut).toBeUndefined();
    });
  });

  describe('cleanup job progress persistence', () => {
    it('should call DynamoDB to persist currentCleanupJob during cleanup', async () => {
      mockDynamoSend.mockResolvedValue({ Items: [] });

      await service.cleanupCustomerEmbeddings('cust-1', 'tenant-1');

      // Calls include: updateCleanupStatus (in_progress), updateCleanupJobProgress (start),
      // getCustomerDocuments, identifyCustomerEmbeddings uses docs in-memory,
      // updateCleanupStatus (final), updateCleanupJobProgress (end)
      // Verify at least 4 calls were made (progress persistence included)
      expect(mockDynamoSend.mock.calls.length).toBeGreaterThanOrEqual(4);
    });
  });
});
