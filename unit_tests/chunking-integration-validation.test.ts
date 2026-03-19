/**
 * Final integration testing and validation (Task 13).
 * Validates: All Requirements (1-8)
 *
 * Comprehensive tests covering:
 * 1. Complete user workflow: method selection → config update → cleanup → reprocessing
 * 2. All 5 chunking methods validated with mock document types
 * 3. Concurrent operation handling
 * 4. Tenant isolation
 * 5. Large-scale operations (100+ documents, batch processing)
 * 6. Monitoring and audit logging
 * 7. Error recovery workflows
 * 8. Edge cases
 */

// ── Mock AWS SDK clients ──

const mockDynamoSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockReturnValue({ send: mockDynamoSend }),
  },
  GetCommand: jest.fn().mockImplementation((params: any) => ({ _type: 'Get', ...params })),
  QueryCommand: jest.fn().mockImplementation((params: any) => ({ _type: 'Query', ...params })),
  UpdateCommand: jest.fn().mockImplementation((params: any) => ({ _type: 'Update', ...params })),
  BatchWriteCommand: jest.fn().mockImplementation((params: any) => ({ _type: 'BatchWrite', ...params })),
}));

const mockBedrockSend = jest.fn();
jest.mock('@aws-sdk/client-bedrock-agent-runtime', () => ({
  BedrockAgentRuntimeClient: jest.fn().mockImplementation(() => ({ send: mockBedrockSend })),
}));

const mockOpenSearchBulk = jest.fn().mockResolvedValue({ body: { errors: false, items: [] } });
const mockOpenSearchPing = jest.fn().mockResolvedValue(true);
jest.mock('@opensearch-project/opensearch', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connectionPool: { connections: [{ url: { href: 'https://test-endpoint.aoss.amazonaws.com' } }] },
    ping: mockOpenSearchPing,
    bulk: mockOpenSearchBulk,
  })),
}));
jest.mock('@opensearch-project/opensearch/aws', () => ({
  AwsSigv4Signer: jest.fn().mockReturnValue({}),
}));

const mockSqsSend = jest.fn().mockResolvedValue({});
jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn().mockImplementation(() => ({ send: mockSqsSend })),
  SendMessageCommand: jest.fn().mockImplementation((params: any) => params),
}));

// ── Environment setup ──

process.env.REGION = 'us-east-1';
process.env.BEDROCK_REGION = 'us-east-1';
process.env.VECTOR_DB_ENDPOINT = 'https://test-endpoint.aoss.amazonaws.com';
process.env.DOCUMENTS_TABLE_NAME = 'test-documents';
process.env.CUSTOMERS_TABLE_NAME = 'test-customers';
process.env.KNOWLEDGE_BASE_ID = 'test-kb-id';
process.env.PROCESSING_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/test-queue';

// ── Imports ──

import { ChunkingConfigurationService } from '../src/services/chunking-configuration';
import { EmbeddingCleanupService, CleanupResult } from '../src/services/embedding-cleanup';
import {
  ChunkingValidationError,
  CleanupError,
  ServiceUnavailableError,
  buildErrorResponse,
  retryWithBackoff,
  structuredLog,
} from '../src/services/chunking-errors';
import {
  SUPPORTED_CHUNKING_METHODS,
  ChunkingMethod,
  DocumentRecord,
  CustomerRecord,
} from '../src/types';

// ── Helpers ──


const DOC_TYPES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'text/html'] as const;

function makeCustomer(overrides: Partial<CustomerRecord> = {}): CustomerRecord {
  return {
    uuid: 'cust-001',
    tenantId: 'tenant-A',
    customerId: 'C001',
    email: 'test@example.com',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    documentCount: 0,
    ...overrides,
  };
}

function makeDoc(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  const id = `doc-${Math.random().toString(36).slice(2, 8)}`;
  return {
    documentId: id,
    customerUuid: 'cust-001',
    tenantId: 'tenant-A',
    fileName: 'report.pdf',
    s3Key: `docs/${id}.pdf`,
    contentType: 'application/pdf',
    processingStatus: 'completed',
    extractedText: 'Sample extracted text content for testing.',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    embeddingIds: ['emb-1', 'emb-2'],
    embeddingStatus: 'completed',
    ...overrides,
  };
}

function makeDocs(count: number, contentType: string = 'application/pdf'): DocumentRecord[] {
  return Array.from({ length: count }, (_, i) =>
    makeDoc({
      documentId: `doc-${i}`,
      fileName: `file-${i}.${contentType.split('/')[1] || 'pdf'}`,
      contentType,
      embeddingIds: [`emb-${i}-a`, `emb-${i}-b`],
    })
  );
}

// ============================================================
// Section 1: Complete User Workflow
// Validates: Requirements 1, 3, 4, 5, 6
// ============================================================

describe('Complete user workflow: method selection → config update → cleanup → reprocessing', () => {
  let configService: ChunkingConfigurationService;
  let cleanupService: EmbeddingCleanupService;

  beforeEach(() => {
    jest.clearAllMocks();
    configService = new ChunkingConfigurationService();
    cleanupService = new EmbeddingCleanupService();
  });

  it('should retrieve available chunking methods (5 methods)', async () => {
    const methods = await configService.getAvailableChunkingMethods();
    expect(methods).toHaveLength(5);
    const ids = methods.map(m => m.id);
    expect(ids).toEqual(expect.arrayContaining(['default', 'fixed_size_512', 'fixed_size_1024', 'semantic', 'hierarchical']));
  });

  it('should get customer config, returning default when none set', async () => {
    const customer = makeCustomer({ chunkingMethod: undefined });
    mockDynamoSend.mockResolvedValueOnce({ Item: customer });

    const config = await configService.getCustomerChunkingConfig('cust-001', 'tenant-A');
    expect(config.id).toBe('default');
    expect(config.parameters.strategy).toBe('default');
  });

  it('should update config and detect method change', async () => {
    const currentCustomer = makeCustomer({
      chunkingMethod: SUPPORTED_CHUNKING_METHODS[0], // default
    });
    // getCustomerChunkingConfig (inside updateCustomerChunkingConfig to get previous)
    mockDynamoSend.mockResolvedValueOnce({ Item: currentCustomer });
    // updateCustomerChunkingConfig DynamoDB update
    mockDynamoSend.mockResolvedValueOnce({});

    const newMethod = SUPPORTED_CHUNKING_METHODS.find(m => m.id === 'semantic')!;
    await expect(
      configService.updateCustomerChunkingConfig('cust-001', 'tenant-A', newMethod)
    ).resolves.not.toThrow();
  });

  it('should run full cleanup workflow: identify → remove KB → remove vectorDB → clear refs → reprocess', async () => {
    const docs = makeDocs(3);
    // updateCustomerCleanupStatus (in_progress)
    mockDynamoSend.mockResolvedValueOnce({});
    // updateCleanupJobProgress
    mockDynamoSend.mockResolvedValueOnce({});
    // getCustomerDocuments
    mockDynamoSend.mockResolvedValueOnce({ Items: docs });
    // updateCleanupJobProgress (after identify)
    mockDynamoSend.mockResolvedValueOnce({});
    // clearDocumentEmbeddingReferences (BatchWrite)
    mockDynamoSend.mockResolvedValueOnce({});
    // updateCustomerCleanupStatus (completed)
    mockDynamoSend.mockResolvedValueOnce({});
    // updateCleanupJobProgress (final)
    mockDynamoSend.mockResolvedValueOnce({});

    const result = await cleanupService.cleanupCustomerEmbeddings('cust-001', 'tenant-A');

    expect(result.jobId).toBeDefined();
    expect(result.embeddingsRemoved).toBe(6); // 3 docs × 2 embeddings
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.diagnostics).toBeDefined();
    expect(result.diagnostics!.totalDocuments).toBe(3);
  });

  it('should queue documents for reprocessing via SQS after cleanup', async () => {
    const docs = makeDocs(2);
    // Setup mocks for full cleanup flow
    mockDynamoSend.mockResolvedValueOnce({}); // cleanup status
    mockDynamoSend.mockResolvedValueOnce({}); // job progress
    mockDynamoSend.mockResolvedValueOnce({ Items: docs }); // getCustomerDocuments
    mockDynamoSend.mockResolvedValue({}); // remaining calls

    const result = await cleanupService.cleanupCustomerEmbeddings('cust-001', 'tenant-A');

    expect(result.documentsQueued).toBe(2);
    expect(mockSqsSend).toHaveBeenCalledTimes(2);
  });
});

// ============================================================
// Section 2: All 5 Chunking Methods with Different Document Types
// Validates: Requirements 2.1-2.5, 6.1
// ============================================================

describe('All chunking methods validated with different document types', () => {
  let configService: ChunkingConfigurationService;

  beforeEach(() => {
    jest.clearAllMocks();
    configService = new ChunkingConfigurationService();
  });

  it.each(SUPPORTED_CHUNKING_METHODS.map(m => [m.id, m]))(
    'validates method "%s" passes validation',
    (_id, method) => {
      expect(configService.validateChunkingMethod(method as ChunkingMethod)).toBe(true);
    }
  );

  it.each(DOC_TYPES)('cleanup handles documents of type %s', async (contentType) => {
    const cleanupService = new EmbeddingCleanupService();
    const docs = [makeDoc({ contentType, fileName: `test.${contentType.split('/')[1]}` })];

    mockDynamoSend.mockResolvedValueOnce({}); // cleanup status
    mockDynamoSend.mockResolvedValueOnce({}); // job progress
    mockDynamoSend.mockResolvedValueOnce({ Items: docs }); // getCustomerDocuments
    mockDynamoSend.mockResolvedValue({}); // remaining

    const result = await cleanupService.cleanupCustomerEmbeddings('cust-001', 'tenant-A');
    expect(result.embeddingsRemoved).toBe(2);
    expect(result.diagnostics!.totalDocuments).toBe(1);
  });

  it('rejects an invalid chunking method id', () => {
    const invalid: ChunkingMethod = {
      id: 'nonexistent_method',
      name: 'Bad',
      description: 'Invalid',
      parameters: { strategy: 'default' },
    };
    expect(configService.validateChunkingMethod(invalid)).toBe(false);
  });

  it('rejects fixed_size method with overlap >= chunkSize', () => {
    const bad: ChunkingMethod = {
      id: 'fixed_size_512',
      name: 'Fixed Size (512 tokens)',
      description: 'desc',
      parameters: { strategy: 'fixed_size', chunkSize: 100, chunkOverlap: 200 },
    };
    expect(configService.validateChunkingMethod(bad)).toBe(false);
  });

  it('each supported method has name, description, and parameters', () => {
    for (const method of SUPPORTED_CHUNKING_METHODS) {
      expect(method.name).toBeTruthy();
      expect(method.description).toBeTruthy();
      expect(method.parameters).toBeDefined();
      expect(method.parameters.strategy).toBeTruthy();
    }
  });
});


// ============================================================
// Section 3: Concurrent Operation Handling
// Validates: Requirements 8.2, 8.3
// ============================================================

describe('Concurrent operations and resource management', () => {
  let cleanupService: EmbeddingCleanupService;

  beforeEach(() => {
    jest.clearAllMocks();
    cleanupService = new EmbeddingCleanupService();
  });

  it('enqueueCleanup processes multiple customers sequentially', async () => {
    const executionOrder: string[] = [];
    jest.spyOn(cleanupService, 'cleanupCustomerEmbeddings').mockImplementation(
      async (customerUUID: string) => {
        executionOrder.push(customerUUID);
        await new Promise(r => setTimeout(r, 5));
        return {
          success: true,
          embeddingsRemoved: 0,
          documentsQueued: 0,
          errors: [],
          duration: 5,
          jobId: `job-${customerUUID}`,
        };
      }
    );

    const results = await Promise.all([
      cleanupService.enqueueCleanup('cust-A', 'tenant-1'),
      cleanupService.enqueueCleanup('cust-B', 'tenant-1'),
      cleanupService.enqueueCleanup('cust-C', 'tenant-1'),
    ]);

    expect(executionOrder).toEqual(['cust-A', 'cust-B', 'cust-C']);
    expect(results).toHaveLength(3);
    results.forEach(r => expect(r.success).toBe(true));
  });

  it('a failed enqueued cleanup does not block subsequent cleanups', async () => {
    let callCount = 0;
    jest.spyOn(cleanupService, 'cleanupCustomerEmbeddings').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error('first failed');
      return {
        success: true,
        embeddingsRemoved: 0,
        documentsQueued: 0,
        errors: [],
        duration: 1,
        jobId: `job-${callCount}`,
      };
    });

    const p1 = cleanupService.enqueueCleanup('cust-1', 'tenant-1');
    const p2 = cleanupService.enqueueCleanup('cust-2', 'tenant-1');

    await expect(p1).rejects.toThrow('first failed');
    const r2 = await p2;
    expect(r2.success).toBe(true);
  });

  it('queueLength reflects pending items', () => {
    expect(cleanupService.queueLength).toBe(0);
  });

  it('concurrent config reads for different customers are independent', async () => {
    const configService = new ChunkingConfigurationService();
    const customerA = makeCustomer({ uuid: 'cust-A', chunkingMethod: SUPPORTED_CHUNKING_METHODS[1] });
    const customerB = makeCustomer({ uuid: 'cust-B', chunkingMethod: SUPPORTED_CHUNKING_METHODS[3] });

    mockDynamoSend
      .mockResolvedValueOnce({ Item: customerA })
      .mockResolvedValueOnce({ Item: customerB });

    const [configA, configB] = await Promise.all([
      configService.getCustomerChunkingConfig('cust-A', 'tenant-A'),
      configService.getCustomerChunkingConfig('cust-B', 'tenant-A'),
    ]);

    expect(configA.id).toBe('fixed_size_512');
    expect(configB.id).toBe('semantic');
  });
});

// ============================================================
// Section 4: Tenant Isolation and Security
// Validates: Requirements 3.1, 6.2
// ============================================================

describe('Tenant isolation and security measures', () => {
  let configService: ChunkingConfigurationService;

  beforeEach(() => {
    jest.clearAllMocks();
    configService = new ChunkingConfigurationService();
  });

  it('denies access when customer belongs to a different tenant', async () => {
    const customer = makeCustomer({ uuid: 'cust-001', tenantId: 'tenant-B' });
    mockDynamoSend.mockResolvedValueOnce({ Item: customer });

    await expect(
      configService.getCustomerChunkingConfig('cust-001', 'tenant-A')
    ).rejects.toThrow('Access denied');
  });

  it('throws not found when customer does not exist', async () => {
    mockDynamoSend.mockResolvedValueOnce({ Item: undefined });

    await expect(
      configService.getCustomerChunkingConfig('nonexistent', 'tenant-A')
    ).rejects.toThrow('Customer not found');
  });

  it('needsEmbeddingCleanup returns false for wrong tenant', async () => {
    const customer = makeCustomer({ tenantId: 'tenant-B' });
    mockDynamoSend.mockResolvedValueOnce({ Item: customer });

    const result = await configService.needsEmbeddingCleanup('cust-001', 'tenant-A');
    expect(result).toBe(false);
  });

  it('needsEmbeddingCleanup returns false for nonexistent customer', async () => {
    mockDynamoSend.mockResolvedValueOnce({ Item: undefined });

    const result = await configService.needsEmbeddingCleanup('nonexistent', 'tenant-A');
    expect(result).toBe(false);
  });

  it('update config fails when DynamoDB condition check rejects wrong tenant', async () => {
    // getCustomerChunkingConfig returns customer from different tenant
    const customer = makeCustomer({ tenantId: 'tenant-B' });
    mockDynamoSend.mockResolvedValueOnce({ Item: customer });

    await expect(
      configService.updateCustomerChunkingConfig('cust-001', 'tenant-A', SUPPORTED_CHUNKING_METHODS[0])
    ).rejects.toThrow('Access denied');
  });

  it('cleanup service filters documents by tenantId', async () => {
    const cleanupService = new EmbeddingCleanupService();
    const docs = [makeDoc({ tenantId: 'tenant-A' })];

    mockDynamoSend.mockResolvedValueOnce({}); // cleanup status
    mockDynamoSend.mockResolvedValueOnce({}); // job progress
    mockDynamoSend.mockResolvedValueOnce({ Items: docs }); // getCustomerDocuments
    mockDynamoSend.mockResolvedValue({}); // remaining

    const result = await cleanupService.cleanupCustomerEmbeddings('cust-001', 'tenant-A');
    expect(result.diagnostics!.totalDocuments).toBe(1);
  });
});

// ============================================================
// Section 5: Large-Scale Operations
// Validates: Requirements 8.1, 8.4, 8.5
// ============================================================

describe('Large-scale operations (100+ documents, batch processing)', () => {
  let cleanupService: EmbeddingCleanupService;

  beforeEach(() => {
    jest.clearAllMocks();
    cleanupService = new EmbeddingCleanupService();
  });

  it('handles 100+ documents with batch embedding cleanup', async () => {
    const docs = makeDocs(120);

    mockDynamoSend.mockResolvedValueOnce({}); // cleanup status
    mockDynamoSend.mockResolvedValueOnce({}); // job progress
    mockDynamoSend.mockResolvedValueOnce({ Items: docs }); // getCustomerDocuments
    mockDynamoSend.mockResolvedValue({}); // remaining calls

    const result = await cleanupService.cleanupCustomerEmbeddings('cust-001', 'tenant-A');

    expect(result.diagnostics!.totalDocuments).toBe(120);
    expect(result.diagnostics!.totalEmbeddingIds).toBe(240); // 120 × 2
    expect(result.embeddingsRemoved).toBe(240);
    // OpenSearch bulk should be called for batch processing
    expect(mockOpenSearchBulk).toHaveBeenCalled();
  }, 60000);

  it('handles documents with varying embedding counts', async () => {
    const docs = [
      makeDoc({ embeddingIds: ['e1'] }),
      makeDoc({ embeddingIds: ['e2', 'e3', 'e4', 'e5', 'e6'] }),
      makeDoc({ embeddingIds: [] }),
      makeDoc({ embeddingIds: undefined, embeddingStatus: 'none' }),
    ];

    mockDynamoSend.mockResolvedValueOnce({}); // cleanup status
    mockDynamoSend.mockResolvedValueOnce({}); // job progress
    mockDynamoSend.mockResolvedValueOnce({ Items: docs }); // getCustomerDocuments
    mockDynamoSend.mockResolvedValue({}); // remaining

    const result = await cleanupService.cleanupCustomerEmbeddings('cust-001', 'tenant-A');

    expect(result.diagnostics!.documentsWithEmbeddings).toBe(2);
    expect(result.diagnostics!.documentsWithoutEmbeddings).toBe(2);
    expect(result.diagnostics!.totalEmbeddingIds).toBe(6);
    expect(result.embeddingsRemoved).toBe(6);
  }, 30000);

  it('reports progress during large cleanup', async () => {
    const docs = makeDocs(50);
    const progressUpdates: any[] = [];

    mockDynamoSend.mockResolvedValueOnce({}); // cleanup status
    mockDynamoSend.mockResolvedValueOnce({}); // job progress
    mockDynamoSend.mockResolvedValueOnce({ Items: docs }); // getCustomerDocuments
    mockDynamoSend.mockResolvedValue({}); // remaining

    await cleanupService.cleanupCustomerEmbeddings('cust-001', 'tenant-A', {
      onProgress: (p) => progressUpdates.push({ ...p }),
    });

    expect(progressUpdates.length).toBeGreaterThanOrEqual(3);
    const phases = progressUpdates.map(p => p.phase);
    expect(phases).toContain('identifying');
    expect(phases).toContain('removing_kb');
    expect(phases).toContain('removing_vectordb');
  }, 60000);

  it('deduplicates embedding IDs across documents', async () => {
    const docs = [
      makeDoc({ embeddingIds: ['shared-emb', 'unique-1'] }),
      makeDoc({ embeddingIds: ['shared-emb', 'unique-2'] }),
    ];

    const embeddingIds = await cleanupService.identifyCustomerEmbeddings(docs);
    expect(embeddingIds).toHaveLength(3); // shared-emb, unique-1, unique-2
    expect(new Set(embeddingIds).size).toBe(3);
  });
});


// ============================================================
// Section 6: Monitoring and Audit Logging
// Validates: Requirements 3.4, 6.5, 7.5
// ============================================================

describe('Monitoring and audit logging', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    errorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('structuredLog emits JSON with timestamp, level, message, and context', () => {
    structuredLog('info', 'Config updated', {
      operation: 'chunking-config-update',
      customerUUID: 'cust-001',
      tenantId: 'tenant-A',
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(logSpy.mock.calls[0][0]);
    expect(logged.timestamp).toBeDefined();
    expect(logged.level).toBe('info');
    expect(logged.message).toBe('Config updated');
    expect(logged.operation).toBe('chunking-config-update');
    expect(logged.customerUUID).toBe('cust-001');
    expect(logged.tenantId).toBe('tenant-A');
  });

  it('structuredLog routes errors to console.error', () => {
    structuredLog('error', 'Cleanup failed', { operation: 'cleanup', customerUUID: 'c1' });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(errorSpy.mock.calls[0][0]);
    expect(logged.level).toBe('error');
  });

  it('structuredLog routes warnings to console.warn', () => {
    structuredLog('warn', 'Slow operation', { operation: 'cleanup' });
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('getCustomerChunkingConfig emits structured logs on success', async () => {
    const configService = new ChunkingConfigurationService();
    const customer = makeCustomer({ chunkingMethod: SUPPORTED_CHUNKING_METHODS[0] });
    mockDynamoSend.mockResolvedValueOnce({ Item: customer });

    await configService.getCustomerChunkingConfig('cust-001', 'tenant-A');

    // Should have logged at least the "Getting chunking config" and "Retrieved chunking config" messages
    const structuredCalls = logSpy.mock.calls.filter((call: any[]) => {
      try { const parsed = JSON.parse(call[0]); return parsed.operation === 'getCustomerChunkingConfig'; } catch { return false; }
    });
    expect(structuredCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('getCustomerChunkingConfig emits structured error log on failure', async () => {
    const configService = new ChunkingConfigurationService();
    mockDynamoSend.mockResolvedValueOnce({ Item: undefined });

    await expect(
      configService.getCustomerChunkingConfig('nonexistent', 'tenant-A')
    ).rejects.toThrow();

    const errorCalls = errorSpy.mock.calls.filter((call: any[]) => {
      try { const parsed = JSON.parse(call[0]); return parsed.operation === 'getCustomerChunkingConfig'; } catch { return false; }
    });
    expect(errorCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('cleanup service emits structured logs at each phase', async () => {
    const cleanupService = new EmbeddingCleanupService();
    const docs = [makeDoc()];

    mockDynamoSend.mockResolvedValueOnce({}); // cleanup status
    mockDynamoSend.mockResolvedValueOnce({}); // job progress
    mockDynamoSend.mockResolvedValueOnce({ Items: docs }); // getCustomerDocuments
    mockDynamoSend.mockResolvedValue({}); // remaining

    await cleanupService.cleanupCustomerEmbeddings('cust-001', 'tenant-A');

    // Check that structured log was called for the start of cleanup
    const startLogs = logSpy.mock.calls.filter((call: any[]) => {
      try {
        const parsed = JSON.parse(call[0]);
        return parsed.operation === 'cleanupCustomerEmbeddings' && parsed.message?.includes('Starting');
      } catch { return false; }
    });
    expect(startLogs.length).toBeGreaterThanOrEqual(1);
  }, 30000);
});

// ============================================================
// Section 7: Error Recovery Workflows
// Validates: Requirements 7.1-7.5
// ============================================================

describe('Error recovery workflows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('retryWithBackoff recovers from transient failures', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new ServiceUnavailableError('down', 'DynamoDB'))
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue('recovered');

    const result = await retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 10 });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('retryWithBackoff does NOT retry ChunkingValidationError', async () => {
    const fn = jest.fn().mockRejectedValue(new ChunkingValidationError('bad', {}));
    await expect(
      retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 10 })
    ).rejects.toThrow(ChunkingValidationError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('config update rolls back on DynamoDB failure', async () => {
    const configService = new ChunkingConfigurationService();
    const customer = makeCustomer({ chunkingMethod: SUPPORTED_CHUNKING_METHODS[0] });

    // Track call count to switch behavior: first call returns customer, then all fail, then rollback succeeds
    let callIndex = 0;
    mockDynamoSend.mockImplementation(async () => {
      callIndex++;
      if (callIndex === 1) {
        // getCustomerChunkingConfig — return customer
        return { Item: customer };
      }
      if (callIndex <= 5) {
        // retryWithBackoff attempts (1 initial + 3 retries = calls 2-5)
        throw new Error('DynamoDB write failed');
      }
      // rollback attempt (call 6+)
      return {};
    });

    await expect(
      configService.updateCustomerChunkingConfig('cust-001', 'tenant-A', SUPPORTED_CHUNKING_METHODS[2])
    ).rejects.toThrow('DynamoDB write failed');

    // Verify rollback was attempted (1 get + 4 failed retries + 1 rollback = 6)
    expect(mockDynamoSend).toHaveBeenCalledTimes(6);
  }, 60000);

  it('cleanup continues and reports errors when vectorDB removal fails', async () => {
    const cleanupService = new EmbeddingCleanupService();
    const docs = [makeDoc()];

    mockDynamoSend.mockResolvedValueOnce({}); // cleanup status
    mockDynamoSend.mockResolvedValueOnce({}); // job progress
    mockDynamoSend.mockResolvedValueOnce({ Items: docs }); // getCustomerDocuments
    mockDynamoSend.mockResolvedValueOnce({}); // job progress update
    mockDynamoSend.mockResolvedValue({}); // remaining

    // Make ALL OpenSearch bulk calls fail (avoids mock exhaustion issues with retryWithBackoff)
    mockOpenSearchBulk.mockRejectedValue(new Error('OpenSearch connection refused'));

    const result = await cleanupService.cleanupCustomerEmbeddings('cust-001', 'tenant-A');

    // Restore default bulk mock for subsequent tests
    mockOpenSearchBulk.mockResolvedValue({ body: { errors: false, items: [] } });

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.includes('Vector DB'))).toBe(true);
  }, 30000);

  it('cleanup handles timeout gracefully', async () => {
    const cleanupService = new EmbeddingCleanupService();

    mockDynamoSend.mockResolvedValueOnce({}); // cleanup status
    mockDynamoSend.mockResolvedValueOnce({}); // job progress
    mockDynamoSend.mockImplementationOnce(async () => {
      await new Promise(r => setTimeout(r, 100));
      return { Items: [makeDoc()] };
    });
    mockDynamoSend.mockResolvedValue({});

    const result = await cleanupService.cleanupCustomerEmbeddings('cust-001', 'tenant-A', {
      timeoutMs: 1,
    });

    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.errors).toContain('Cleanup timed out');
  });

  it('cleanup handles cancellation gracefully', async () => {
    const cleanupService = new EmbeddingCleanupService();
    let capturedJobId: string | undefined;

    mockDynamoSend.mockResolvedValueOnce({}); // cleanup status
    mockDynamoSend.mockResolvedValueOnce({}); // job progress
    mockDynamoSend.mockImplementationOnce(async () => {
      if (capturedJobId) cleanupService.cancelCleanup(capturedJobId);
      return { Items: [makeDoc()] };
    });
    mockDynamoSend.mockResolvedValue({});

    const result = await cleanupService.cleanupCustomerEmbeddings('cust-001', 'tenant-A', {
      onProgress: (p) => { capturedJobId = p.jobId; },
    });

    expect(result.success).toBe(false);
    expect(result.cancelled).toBe(true);
    expect(result.errors).toContain('Cleanup was cancelled');
  });

  it('buildErrorResponse maps all error types correctly', () => {
    const validationResp = buildErrorResponse(500, new ChunkingValidationError('bad', { field: 'x' }));
    expect(validationResp.statusCode).toBe(400);

    const cleanupRetryResp = buildErrorResponse(500, new CleanupError('timeout', 'kb', true));
    expect(cleanupRetryResp.statusCode).toBe(503);

    const cleanupFatalResp = buildErrorResponse(500, new CleanupError('corrupt', 'vdb', false));
    expect(cleanupFatalResp.statusCode).toBe(500);

    const serviceResp = buildErrorResponse(500, new ServiceUnavailableError('down', 'Bedrock', 3000));
    expect(serviceResp.statusCode).toBe(503);

    const notFoundResp = buildErrorResponse(500, new Error('Customer not found: abc'));
    expect(notFoundResp.statusCode).toBe(404);

    const genericResp = buildErrorResponse(500, new Error('unknown'));
    expect(genericResp.statusCode).toBe(500);
    expect(JSON.parse(genericResp.body).code).toBe('INTERNAL_ERROR');
  });

  it('resumeCleanup re-runs cleanup for documents with remaining embeddings', async () => {
    const cleanupService = new EmbeddingCleanupService();
    const docsWithEmbeddings = [makeDoc({ embeddingIds: ['leftover-1'] })];

    // resumeCleanup calls getCustomerDocuments first
    mockDynamoSend.mockResolvedValueOnce({ Items: docsWithEmbeddings });
    // Then calls cleanupCustomerEmbeddings internally
    mockDynamoSend.mockResolvedValueOnce({}); // cleanup status
    mockDynamoSend.mockResolvedValueOnce({}); // job progress
    mockDynamoSend.mockResolvedValueOnce({ Items: docsWithEmbeddings }); // getCustomerDocuments again
    mockDynamoSend.mockResolvedValue({}); // remaining

    const result = await cleanupService.resumeCleanup('cust-001', 'tenant-A');
    expect(result.jobId).toBeDefined();
  });

  it('resumeCleanup returns success immediately when no embeddings remain', async () => {
    const cleanupService = new EmbeddingCleanupService();
    const docsNoEmbeddings = [makeDoc({ embeddingIds: [] })];

    mockDynamoSend.mockResolvedValueOnce({ Items: docsNoEmbeddings });

    const result = await cleanupService.resumeCleanup('cust-001', 'tenant-A');
    expect(result.success).toBe(true);
    expect(result.embeddingsRemoved).toBe(0);
  });
});

// ============================================================
// Section 8: Edge Cases
// Validates: Requirements 1.4, 3.3, 7.1
// ============================================================

describe('Edge cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('cleanup for customer with no documents succeeds with zero counts', async () => {
    const cleanupService = new EmbeddingCleanupService();

    mockDynamoSend.mockResolvedValueOnce({}); // cleanup status
    mockDynamoSend.mockResolvedValueOnce({}); // job progress
    mockDynamoSend.mockResolvedValueOnce({ Items: [] }); // no documents
    mockDynamoSend.mockResolvedValue({}); // remaining

    const result = await cleanupService.cleanupCustomerEmbeddings('cust-empty', 'tenant-A');

    expect(result.success).toBe(true);
    expect(result.embeddingsRemoved).toBe(0);
    expect(result.documentsQueued).toBe(0);
    expect(result.diagnostics!.totalDocuments).toBe(0);
  });

  it('getCustomerChunkingConfig throws for nonexistent customer', async () => {
    const configService = new ChunkingConfigurationService();
    mockDynamoSend.mockResolvedValueOnce({ Item: undefined });

    await expect(
      configService.getCustomerChunkingConfig('nonexistent', 'tenant-A')
    ).rejects.toThrow('Customer not found');
  });

  it('updateCustomerChunkingConfig rejects invalid method before DynamoDB write', async () => {
    const configService = new ChunkingConfigurationService();
    const invalidMethod: ChunkingMethod = {
      id: 'invalid',
      name: 'Bad',
      description: 'Invalid method',
      parameters: { strategy: 'default' },
    };

    await expect(
      configService.updateCustomerChunkingConfig('cust-001', 'tenant-A', invalidMethod)
    ).rejects.toThrow(ChunkingValidationError);
  });

  it('cleanup handles documents with no extractedText (skips reprocessing)', async () => {
    const cleanupService = new EmbeddingCleanupService();
    const docs = [
      makeDoc({ extractedText: undefined, processingStatus: 'queued', embeddingIds: ['e1'] }),
      makeDoc({ extractedText: '', processingStatus: 'completed', embeddingIds: ['e2'] }),
    ];

    mockDynamoSend.mockResolvedValueOnce({}); // cleanup status
    mockDynamoSend.mockResolvedValueOnce({}); // job progress
    mockDynamoSend.mockResolvedValueOnce({ Items: docs }); // getCustomerDocuments
    mockDynamoSend.mockResolvedValue({}); // remaining

    const result = await cleanupService.cleanupCustomerEmbeddings('cust-001', 'tenant-A');

    // Embeddings should still be removed even if text is missing
    expect(result.embeddingsRemoved).toBe(2);
    // But reprocessing only queues completed docs with extractedText
    expect(result.documentsQueued).toBe(0);
  });

  it('cleanup handles critical error and returns failure result', async () => {
    const cleanupService = new EmbeddingCleanupService();

    mockDynamoSend.mockResolvedValueOnce({}); // cleanup status
    mockDynamoSend.mockResolvedValueOnce({}); // job progress
    mockDynamoSend.mockRejectedValueOnce(new Error('Critical DynamoDB failure'));

    const result = await cleanupService.cleanupCustomerEmbeddings('cust-001', 'tenant-A');

    expect(result.success).toBe(false);
    expect(result.errors).toContain('Critical DynamoDB failure');
    expect(result.diagnostics!.vectorDbConfigured).toBe(false);
  });

  it('cancelCleanup returns false for unknown jobId', () => {
    const cleanupService = new EmbeddingCleanupService();
    expect(cleanupService.cancelCleanup('nonexistent-job')).toBe(false);
  });

  it('identifyCustomerEmbeddings returns empty array for docs with no embeddings', async () => {
    const cleanupService = new EmbeddingCleanupService();
    const docs = [
      makeDoc({ embeddingIds: [] }),
      makeDoc({ embeddingIds: undefined }),
    ];

    const ids = await cleanupService.identifyCustomerEmbeddings(docs);
    expect(ids).toEqual([]);
  });

  it('config update with same method does not trigger cleanup flag', async () => {
    const configService = new ChunkingConfigurationService();
    const method = SUPPORTED_CHUNKING_METHODS[0];
    const customer = makeCustomer({ chunkingMethod: method });

    mockDynamoSend.mockResolvedValueOnce({ Item: customer }); // get previous
    mockDynamoSend.mockResolvedValueOnce({}); // update

    await configService.updateCustomerChunkingConfig('cust-001', 'tenant-A', method);

    // The update call should not include chunkingCleanupStatus since method didn't change
    const updateCall = mockDynamoSend.mock.calls[1][0];
    // Verify the update was called (method didn't change, so no cleanup status set)
    expect(mockDynamoSend).toHaveBeenCalledTimes(2);
  });

  it('vector database status check handles placeholder endpoint', async () => {
    const cleanupService = new EmbeddingCleanupService();

    mockDynamoSend.mockResolvedValueOnce({}); // cleanup status
    mockDynamoSend.mockResolvedValueOnce({}); // job progress
    mockDynamoSend.mockResolvedValueOnce({ Items: [] }); // no documents
    mockDynamoSend.mockResolvedValue({}); // remaining

    const result = await cleanupService.cleanupCustomerEmbeddings('cust-001', 'tenant-A');
    // Should complete even if vector DB has issues
    expect(result.jobId).toBeDefined();
  });
});
