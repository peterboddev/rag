/**
 * Property-based tests for Fallback Behavior
 * Feature: token-aware-summarization, Property 12: Fallback Behavior
 *
 * **Validates: Requirements 5.1, 5.2, 5.4**
 *
 * Properties tested:
 * - When generateSummary encounters an error, it returns a fallback result
 * - Fallback result has fallbacksUsed containing 'default_summarization'
 * - Fallback result still contains document content (truncated to 2000 chars)
 * - Empty documents list returns result with processedDocumentCount = 0
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import { TokenAwareSummarizationService } from '../src/services/token-aware-summarization';
import { DocumentRecord, ChunkingMethod } from '../src/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const goodChunkingMethod: ChunkingMethod = {
  id: 'fixed_size_1024',
  name: 'Fixed Size (1024 tokens)',
  description: 'Test config',
  parameters: { strategy: 'fixed_size', maxTokens: 1024 }
};

function makeDocument(id: string, text: string, status: string = 'completed'): DocumentRecord {
  return {
    documentId: id,
    customerUuid: 'cust-1',
    tenantId: 'tenant-1',
    fileName: `${id}.pdf`,
    s3Key: `docs/${id}.pdf`,
    contentType: 'application/pdf',
    processingStatus: status as any,
    extractedText: text,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** Create a service whose chunking config returns a broken config to trigger errors */
function createBrokenService(): TokenAwareSummarizationService {
  const service = new TokenAwareSummarizationService();
  (service as any).chunkingService = {
    getCustomerChunkingConfig: jest.fn().mockResolvedValue({
      id: 'broken',
      name: 'Broken Config',
      description: 'This will cause an error',
      parameters: null, // Causes TypeError when accessing .maxTokens
    }),
  };
  return service;
}

/** Create a service with a working mock */
function createWorkingService(): TokenAwareSummarizationService {
  const service = new TokenAwareSummarizationService();
  (service as any).chunkingService = {
    getCustomerChunkingConfig: jest.fn().mockResolvedValue(goodChunkingMethod),
  };
  return service;
}

function generateText(length: number): string {
  const sentence = 'This is a test sentence for fallback behavior testing. ';
  let result = '';
  while (result.length < length) {
    result += sentence;
  }
  return result.substring(0, length);
}

const validTextArb = fc.string({ minLength: 10, maxLength: 500 })
  .filter(s => s.trim().length > 0);

const longTextArb = fc.integer({ min: 2500, max: 5000 }).map(len => generateText(len));

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Feature: token-aware-summarization, Property 12: Fallback Behavior', () => {

  /**
   * **Validates: Requirements 5.1, 5.2, 5.4**
   *
   * When the main processing pipeline throws an error, the service catches it
   * and returns a fallback result instead of throwing.
   */
  it('when generateSummary encounters an error, it returns a fallback result', async () => {
    await fc.assert(
      fc.asyncProperty(validTextArb, async (text) => {
        const service = createBrokenService();
        const docs = [makeDocument('doc-1', text)];

        // Should NOT throw - should return fallback
        const result = await service.generateSummary(docs, 'cust-1', 'tenant-1');

        expect(result).toBeDefined();
        expect(result.documentCount).toBe(1);
        expect(result.chunkingMethod).toBeDefined();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.1, 5.2**
   *
   * When an error triggers fallback, the result's fallbacksUsed array
   * contains 'default_summarization'.
   */
  it('fallback result has fallbacksUsed containing default_summarization', async () => {
    await fc.assert(
      fc.asyncProperty(validTextArb, async (text) => {
        const service = createBrokenService();
        const docs = [makeDocument('doc-1', text)];

        const result = await service.generateSummary(docs, 'cust-1', 'tenant-1');

        expect(result.processingMetadata.fallbacksUsed).toContain('default_summarization');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.2, 5.4**
   *
   * Fallback result still contains document content, truncated to 2000 chars
   * per document.
   */
  it('fallback result still contains document content truncated to 2000 chars', async () => {
    await fc.assert(
      fc.asyncProperty(longTextArb, async (text) => {
        const service = createBrokenService();
        const docs = [makeDocument('doc-1', text)];

        const result = await service.generateSummary(docs, 'cust-1', 'tenant-1');

        // Fallback content should exist
        expect(result.processedContent.length).toBeGreaterThan(0);

        // The document content portion should be truncated to 2000 chars.
        // The processedContent includes "Document: <filename>\nContent: " prefix,
        // so we check the raw content portion doesn't exceed 2000 chars.
        const contentMatch = result.processedContent.match(/Content: ([\s\S]*)/);
        if (contentMatch) {
          expect(contentMatch[1].length).toBeLessThanOrEqual(2000);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.1, 5.4**
   *
   * When an empty documents list is provided, the result has
   * processedDocumentCount = 0.
   */
  it('empty documents list returns result with processedDocumentCount = 0', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant(null), async () => {
        const service = createWorkingService();
        const result = await service.generateSummary([], 'cust-1', 'tenant-1');

        expect(result.processedDocumentCount).toBe(0);
        expect(result.documentCount).toBe(0);
      }),
      { numRuns: 100 }
    );
  });
});
