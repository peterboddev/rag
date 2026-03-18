/**
 * Property-based tests for Chunking Configuration Retrieval
 * Feature: token-aware-summarization, Property 1: Chunking Configuration Retrieval
 *
 * **Validates: Requirements 1.1**
 *
 * Properties tested:
 * - generateSummary always returns a result with a chunkingMethod
 * - When chunking config fails, fallback is used (fallbacksUsed includes 'default_chunking_config')
 * - Second call with same customer uses cache (cacheHits > 0)
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import * as fc from 'fast-check';
import { TokenAwareSummarizationService } from '../src/services/token-aware-summarization';
import { DocumentRecord, ChunkingMethod } from '../src/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const mockChunkingMethod: ChunkingMethod = {
  id: 'fixed_size_1024',
  name: 'Fixed Size (1024 tokens)',
  description: 'Test config',
  parameters: { strategy: 'fixed_size', maxTokens: 1024 }
};

function makeDocument(id: string, text: string): DocumentRecord {
  return {
    documentId: id,
    customerUuid: 'cust-1',
    tenantId: 'tenant-1',
    fileName: `${id}.pdf`,
    s3Key: `docs/${id}.pdf`,
    contentType: 'application/pdf',
    processingStatus: 'completed',
    extractedText: text,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function createServiceWithMock(mockFn: jest.Mock): TokenAwareSummarizationService {
  const service = new TokenAwareSummarizationService();
  (service as any).chunkingService = {
    getCustomerChunkingConfig: mockFn,
  };
  return service;
}

const validTextArb = fc.string({ minLength: 10, maxLength: 500 })
  .filter(s => s.trim().length > 0);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Feature: token-aware-summarization, Property 1: Chunking Configuration Retrieval', () => {

  /**
   * **Validates: Requirements 1.1**
   *
   * For any valid summarization request, the result always contains a chunkingMethod.
   */
  it('generateSummary always returns a result with a chunkingMethod', async () => {
    await fc.assert(
      fc.asyncProperty(validTextArb, async (text) => {
        const mockFn = jest.fn().mockResolvedValue(mockChunkingMethod);
        const service = createServiceWithMock(mockFn);
        const docs = [makeDocument('doc-1', text)];

        const result = await service.generateSummary(docs, 'cust-1', 'tenant-1');

        expect(result.chunkingMethod).toBeDefined();
        expect(result.chunkingMethod.id).toBeDefined();
        expect(result.chunkingMethod.parameters).toBeDefined();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.1**
   *
   * When chunking configuration retrieval fails, the service falls back to
   * default config and records 'default_chunking_config' in fallbacksUsed.
   */
  it('when chunking config fails, fallback is used with default_chunking_config', async () => {
    await fc.assert(
      fc.asyncProperty(validTextArb, async (text) => {
        const mockFn = jest.fn().mockRejectedValue(new Error('DynamoDB connection failed'));
        const service = createServiceWithMock(mockFn);
        const docs = [makeDocument('doc-1', text)];

        const result = await service.generateSummary(docs, 'cust-1', 'tenant-1');

        expect(result.processingMetadata.fallbacksUsed).toContain('default_chunking_config');
        expect(result.chunkingMethod).toBeDefined();
        expect(result.chunkingMethod.id).toBe('default');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.1**
   *
   * Second call with the same customer/tenant uses the config cache,
   * resulting in cacheHits > 0.
   */
  it('second call with same customer uses cache (cacheHits > 0)', async () => {
    await fc.assert(
      fc.asyncProperty(validTextArb, async (text) => {
        const mockFn = jest.fn().mockResolvedValue(mockChunkingMethod);
        const service = createServiceWithMock(mockFn);
        const docs = [makeDocument('doc-1', text)];

        // First call populates cache
        const result1 = await service.generateSummary(docs, 'cust-abc', 'tenant-xyz');
        expect(result1.processingMetadata.cacheHits).toBe(0);

        // Second call should hit cache
        const result2 = await service.generateSummary(docs, 'cust-abc', 'tenant-xyz');
        expect(result2.processingMetadata.cacheHits).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });
});
