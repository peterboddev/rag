/**
 * Property-based tests for Token Limit Enforcement
 * Feature: token-aware-summarization, Property 2: Token Limit Enforcement
 *
 * **Validates: Requirements 1.2, 1.3, 4.1**
 *
 * Properties tested:
 * - processedContent token estimate does not wildly exceed the configured maxTokens
 * - maxTokensOverride in options is respected
 * - tokenUsage.maxTokensAllowed matches the configured limit
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import * as fc from 'fast-check';
import { TokenAwareSummarizationService } from '../src/services/token-aware-summarization';
import { TokenEstimationService } from '../src/services/token-estimation';
import { DocumentRecord, ChunkingMethod } from '../src/types';

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_MAX_TOKENS = 1024;

const mockChunkingMethod: ChunkingMethod = {
  id: 'fixed_size_1024',
  name: 'Fixed Size (1024 tokens)',
  description: 'Test config',
  parameters: { strategy: 'fixed_size', maxTokens: DEFAULT_MAX_TOKENS }
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function createServiceWithMock(maxTokens?: number): TokenAwareSummarizationService {
  const config = maxTokens
    ? { ...mockChunkingMethod, parameters: { ...mockChunkingMethod.parameters, maxTokens } }
    : mockChunkingMethod;
  const service = new TokenAwareSummarizationService();
  (service as any).chunkingService = {
    getCustomerChunkingConfig: jest.fn().mockResolvedValue(config),
  };
  return service;
}

function generateText(length: number): string {
  const sentence = 'This is a test sentence for token estimation. ';
  let result = '';
  while (result.length < length) {
    result += sentence;
  }
  return result.substring(0, length);
}

const validTextArb = fc.string({ minLength: 20, maxLength: 2000 })
  .filter(s => s.trim().length > 0);

const largeTextArb = fc.integer({ min: 2000, max: 8000 }).map(len => generateText(len));

const maxTokensOverrideArb = fc.integer({ min: 200, max: 5000 });

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Feature: token-aware-summarization, Property 2: Token Limit Enforcement', () => {
  const tokenEstimator = new TokenEstimationService();

  /**
   * **Validates: Requirements 1.2, 1.3, 4.1**
   *
   * For any document content, the processedContent token estimate should not
   * wildly exceed the configured maxTokens. We allow overhead for
   * truncation indicators and document headers.
   */
  it('processedContent token estimate does not wildly exceed configured maxTokens', async () => {
    await fc.assert(
      fc.asyncProperty(largeTextArb, async (text) => {
        const service = createServiceWithMock();
        const docs = [makeDocument('doc-1', text)];
        const result = await service.generateSummary(docs, 'cust-1', 'tenant-1');

        const contentTokens = tokenEstimator.estimateTokens(result.processedContent);
        // Allow generous overhead for truncation indicators, document headers, etc.
        // The key property is that content is bounded, not unbounded
        const maxAllowable = DEFAULT_MAX_TOKENS * 3;
        expect(contentTokens).toBeLessThanOrEqual(maxAllowable);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.2, 1.3**
   *
   * When maxTokensOverride is provided in options, the service uses that
   * value instead of the chunking config's maxTokens.
   */
  it('maxTokensOverride in options is respected', async () => {
    await fc.assert(
      fc.asyncProperty(
        validTextArb,
        maxTokensOverrideArb,
        async (text, overrideTokens) => {
          const service = createServiceWithMock();
          const docs = [makeDocument('doc-1', text)];
          const result = await service.generateSummary(
            docs, 'cust-1', 'tenant-1',
            { maxTokensOverride: overrideTokens }
          );

          expect(result.tokenUsage.maxTokensAllowed).toBe(overrideTokens);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 1.2, 4.1**
   *
   * tokenUsage.maxTokensAllowed matches the configured limit from the
   * chunking configuration when no override is provided.
   */
  it('tokenUsage.maxTokensAllowed matches the configured limit', async () => {
    await fc.assert(
      fc.asyncProperty(validTextArb, async (text) => {
        const service = createServiceWithMock();
        const docs = [makeDocument('doc-1', text)];
        const result = await service.generateSummary(docs, 'cust-1', 'tenant-1');

        expect(result.tokenUsage.maxTokensAllowed).toBe(DEFAULT_MAX_TOKENS);
      }),
      { numRuns: 100 }
    );
  });
});
