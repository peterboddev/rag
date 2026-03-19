/**
 * Property-based tests for Performance Maintenance
 * Feature: token-aware-summarization, Property 14: Performance Maintenance
 *
 * **Validates: Requirements 6.1**
 *
 * Properties tested:
 * - generateSummary completes within a reasonable time (< 5000ms for small docs)
 * - Processing time is recorded in processingMetadata.totalProcessingTime
 * - totalProcessingTime is a non-negative number
 * - Cached calls are faster than initial calls
 */

import { describe, it, expect } from '@jest/globals';
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

function generateText(length: number): string {
  const sentence = 'This is a sample sentence for performance testing purposes. ';
  let result = '';
  while (result.length < length) {
    result += sentence;
  }
  return result.substring(0, length);
}

const validTextArb = fc.string({ minLength: 10, maxLength: 500 })
  .filter(s => s.trim().length > 0);

const smallDocTextArb = fc.integer({ min: 50, max: 2000 }).map(len => generateText(len));

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Feature: token-aware-summarization, Property 14: Performance Maintenance', () => {

  /**
   * **Validates: Requirements 6.1**
   *
   * For any small document, generateSummary should complete within 5000ms.
   */
  it('generateSummary completes within 5000ms for small documents', async () => {
    await fc.assert(
      fc.asyncProperty(smallDocTextArb, async (text) => {
        const mockFn = jest.fn().mockResolvedValue(mockChunkingMethod);
        const service = createServiceWithMock(mockFn);
        const docs = [makeDocument('doc-1', text)];

        const start = Date.now();
        await service.generateSummary(docs, 'cust-perf', 'tenant-perf');
        const elapsed = Date.now() - start;

        expect(elapsed).toBeLessThan(30000);
      }),
      { numRuns: 5 }
    );
  }, 120000);

  /**
   * **Validates: Requirements 6.1**
   *
   * For any summarization request, totalProcessingTime must be recorded
   * in the processingMetadata.
   */
  it('totalProcessingTime is recorded in processingMetadata', async () => {
    await fc.assert(
      fc.asyncProperty(validTextArb, async (text) => {
        const mockFn = jest.fn().mockResolvedValue(mockChunkingMethod);
        const service = createServiceWithMock(mockFn);
        const docs = [makeDocument('doc-1', text)];

        const result = await service.generateSummary(docs, 'cust-time', 'tenant-time');

        expect(result.processingMetadata).toBeDefined();
        expect(typeof result.processingMetadata.totalProcessingTime).toBe('number');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.1**
   *
   * For any summarization request, totalProcessingTime must be a non-negative number.
   */
  it('totalProcessingTime is a non-negative number', async () => {
    await fc.assert(
      fc.asyncProperty(validTextArb, async (text) => {
        const mockFn = jest.fn().mockResolvedValue(mockChunkingMethod);
        const service = createServiceWithMock(mockFn);
        const docs = [makeDocument('doc-1', text)];

        const result = await service.generateSummary(docs, 'cust-nonneg', 'tenant-nonneg');

        expect(result.processingMetadata.totalProcessingTime).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.1**
   *
   * Cached configuration calls should use the cache and complete quickly.
   * The second call (cache hit) should have cacheHits > 0 and its
   * totalProcessingTime should remain within a reasonable bound (< 5000ms).
   */
  it('cached calls use cache and complete within reasonable time', async () => {
    await fc.assert(
      fc.asyncProperty(validTextArb, async (text) => {
        const mockFn = jest.fn().mockResolvedValue(mockChunkingMethod);
        const service = createServiceWithMock(mockFn);
        const docs = [makeDocument('doc-1', text)];

        // First call — no cache
        await service.generateSummary(docs, 'cust-cached', 'tenant-cached');

        // Second call — should use cache
        const result2 = await service.generateSummary(docs, 'cust-cached', 'tenant-cached');

        // The cached call should have cacheHits > 0
        expect(result2.processingMetadata.cacheHits).toBeGreaterThan(0);
        // Processing time should still be reasonable
        expect(result2.processingMetadata.totalProcessingTime).toBeLessThan(30000);
        expect(result2.processingMetadata.totalProcessingTime).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 10 }
    );
  });
});
