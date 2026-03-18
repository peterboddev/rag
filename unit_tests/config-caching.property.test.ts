/**
 * Property-based tests for Configuration Caching
 * Feature: token-aware-summarization, Property 15: Configuration Caching
 *
 * **Validates: Requirements 6.2**
 *
 * Properties tested:
 * - First call to generateSummary has cacheHits = 0
 * - Second call with same customer/tenant has cacheHits > 0
 * - Different customer/tenant combinations don't share cache
 * - Mock getCustomerChunkingConfig is called only once for repeated same-customer calls
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

const validTextArb = fc.string({ minLength: 10, maxLength: 300 })
  .filter(s => s.trim().length > 0);

const customerIdArb = fc.stringMatching(/^[a-z]{3,8}-[0-9]{1,4}$/);
const tenantIdArb = fc.stringMatching(/^tenant-[a-z]{2,6}$/);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Feature: token-aware-summarization, Property 15: Configuration Caching', () => {

  /**
   * **Validates: Requirements 6.2**
   *
   * For any first summarization request, the cache should not be hit,
   * resulting in cacheHits = 0.
   */
  it('first call to generateSummary has cacheHits = 0', async () => {
    await fc.assert(
      fc.asyncProperty(validTextArb, async (text) => {
        const mockFn = jest.fn().mockResolvedValue(mockChunkingMethod);
        const service = createServiceWithMock(mockFn);
        const docs = [makeDocument('doc-1', text)];

        const result = await service.generateSummary(docs, 'cust-fresh', 'tenant-fresh');

        expect(result.processingMetadata.cacheHits).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.2**
   *
   * For any repeated request with the same customer/tenant within the cache TTL,
   * the configuration should be served from cache (cacheHits > 0).
   */
  it('second call with same customer/tenant has cacheHits > 0', async () => {
    await fc.assert(
      fc.asyncProperty(validTextArb, async (text) => {
        const mockFn = jest.fn().mockResolvedValue(mockChunkingMethod);
        const service = createServiceWithMock(mockFn);
        const docs = [makeDocument('doc-1', text)];

        // First call populates cache
        await service.generateSummary(docs, 'cust-repeat', 'tenant-repeat');

        // Second call should hit cache
        const result2 = await service.generateSummary(docs, 'cust-repeat', 'tenant-repeat');

        expect(result2.processingMetadata.cacheHits).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.2**
   *
   * Different customer/tenant combinations must not share cached configurations.
   * Each unique pair should independently miss the cache on first access.
   */
  it('different customer/tenant combinations do not share cache', async () => {
    await fc.assert(
      fc.asyncProperty(
        validTextArb,
        customerIdArb,
        customerIdArb,
        tenantIdArb,
        async (text, custA, custB, tenant) => {
          // Ensure the two customers are actually different
          fc.pre(custA !== custB);

          const mockFn = jest.fn().mockResolvedValue(mockChunkingMethod);
          const service = createServiceWithMock(mockFn);
          const docs = [makeDocument('doc-1', text)];

          // Call with customer A — populates cache for A
          await service.generateSummary(docs, custA, tenant);

          // Call with customer B — should NOT hit A's cache
          const resultB = await service.generateSummary(docs, custB, tenant);

          expect(resultB.processingMetadata.cacheHits).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.2**
   *
   * For repeated calls with the same customer/tenant, the underlying
   * getCustomerChunkingConfig should only be invoked once (the rest served from cache).
   */
  it('getCustomerChunkingConfig is called only once for repeated same-customer calls', async () => {
    await fc.assert(
      fc.asyncProperty(validTextArb, async (text) => {
        const mockFn = jest.fn().mockResolvedValue(mockChunkingMethod);
        const service = createServiceWithMock(mockFn);
        const docs = [makeDocument('doc-1', text)];

        // Three calls with the same customer/tenant
        await service.generateSummary(docs, 'cust-once', 'tenant-once');
        await service.generateSummary(docs, 'cust-once', 'tenant-once');
        await service.generateSummary(docs, 'cust-once', 'tenant-once');

        // The mock should have been called exactly once
        expect(mockFn).toHaveBeenCalledTimes(1);
      }),
      { numRuns: 100 }
    );
  });
});
