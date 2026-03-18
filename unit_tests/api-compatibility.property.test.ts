/**
 * Property-based tests for API Compatibility
 * Feature: token-aware-summarization, Property 13: API Compatibility
 *
 * **Validates: Requirements 5.3**
 *
 * Properties tested:
 * - TokenAwareSummaryResult always contains all required fields
 * - tokenUsage contains all required numeric fields
 * - truncationInfo contains all required fields
 * - processingMetadata contains all required fields
 * - documentCount and processedDocumentCount are non-negative integers
 * - The result shape is consistent across different document inputs
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import * as fc from 'fast-check';
import { TokenAwareSummarizationService, TokenAwareSummaryResult } from '../src/services/token-aware-summarization';
import { DocumentRecord } from '../src/types';

// ─── Mock ChunkingConfigurationService ───────────────────────────────────────

// The TokenAwareSummarizationService constructor creates a ChunkingConfigurationService
// that requires DynamoDB. We mock the module to avoid AWS calls.
jest.mock('../src/services/chunking-configuration', () => {
  return {
    ChunkingConfigurationService: jest.fn().mockImplementation(() => ({
      getCustomerChunkingConfig: jest.fn().mockResolvedValue({
        id: 'fixed_size_1024',
        name: 'Fixed Size (1024 tokens)',
        description: 'Fixed-size chunks with 1024 token limit',
        parameters: { strategy: 'fixed_size', chunkSize: 1024, chunkOverlap: 100, maxTokens: 1024 },
      }),
    })),
  };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDocRecord(id: string, text: string): DocumentRecord {
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

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Non-empty text for documents */
const docTextArb = fc.lorem({ maxCount: 10, mode: 'sentences' })
  .filter(s => s.trim().length > 0);

/** A list of 1-5 documents with unique IDs and non-empty text */
const documentsArb = fc.array(
  fc.tuple(fc.uuid(), docTextArb),
  { minLength: 1, maxLength: 5 }
).map(pairs => {
  const seen = new Set<string>();
  return pairs
    .filter(([id]) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map(([id, text]) => makeDocRecord(id, text));
}).filter(docs => docs.length > 0);

// ─── Service Instance ────────────────────────────────────────────────────────

let service: TokenAwareSummarizationService;

beforeEach(() => {
  service = new TokenAwareSummarizationService();
});

// ─── Validation Helpers ──────────────────────────────────────────────────────

function assertTokenUsageShape(tokenUsage: any): void {
  expect(tokenUsage).toBeDefined();
  expect(typeof tokenUsage.maxTokensAllowed).toBe('number');
  expect(typeof tokenUsage.tokensUsed).toBe('number');
  expect(typeof tokenUsage.promptOverhead).toBe('number');
  expect(typeof tokenUsage.contentTokens).toBe('number');
  expect(typeof tokenUsage.utilizationPercentage).toBe('number');
}

function assertTruncationInfoShape(truncationInfo: any): void {
  expect(truncationInfo).toBeDefined();
  expect(typeof truncationInfo.documentsProcessed).toBe('number');
  expect(typeof truncationInfo.documentsTruncated).toBe('number');
  expect(typeof truncationInfo.totalOriginalTokens).toBe('number');
  expect(typeof truncationInfo.totalProcessedTokens).toBe('number');
  expect(truncationInfo.truncationStrategy).toBeDefined();
  expect(Array.isArray(truncationInfo.truncationDetails)).toBe(true);
}

function assertProcessingMetadataShape(metadata: any): void {
  expect(metadata).toBeDefined();
  expect(typeof metadata.chunkingConfigRetrievalTime).toBe('number');
  expect(typeof metadata.tokenEstimationTime).toBe('number');
  expect(typeof metadata.textProcessingTime).toBe('number');
  expect(typeof metadata.summaryGenerationTime).toBe('number');
  expect(typeof metadata.totalProcessingTime).toBe('number');
  expect(Array.isArray(metadata.fallbacksUsed)).toBe(true);
  expect(typeof metadata.cacheHits).toBe('number');
}

function assertFullResultShape(result: TokenAwareSummaryResult): void {
  // Top-level required fields
  expect(typeof result.processedContent).toBe('string');
  expect(typeof result.documentCount).toBe('number');
  expect(typeof result.processedDocumentCount).toBe('number');
  expect(result.chunkingMethod).toBeDefined();

  assertTokenUsageShape(result.tokenUsage);
  assertTruncationInfoShape(result.truncationInfo);
  assertProcessingMetadataShape(result.processingMetadata);
}

// ─── Property 13: API Compatibility ──────────────────────────────────────────

describe('Feature: token-aware-summarization, Property 13: API Compatibility', () => {
  /**
   * **Validates: Requirements 5.3**
   *
   * For any set of completed documents, generateSummary should return a result
   * containing all required fields for the TokenAwareSummaryResponse API.
   */
  it('generateSummary result contains all required API response fields', async () => {
    await fc.assert(
      fc.asyncProperty(documentsArb, async (docs) => {
        const result = await service.generateSummary(docs, 'cust-1', 'tenant-1');
        assertFullResultShape(result);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.3**
   *
   * documentCount and processedDocumentCount should be non-negative integers,
   * and processedDocumentCount should never exceed documentCount.
   */
  it('document counts are non-negative and processedDocumentCount <= documentCount', async () => {
    await fc.assert(
      fc.asyncProperty(documentsArb, async (docs) => {
        const result = await service.generateSummary(docs, 'cust-1', 'tenant-1');
        expect(result.documentCount).toBeGreaterThanOrEqual(0);
        expect(result.processedDocumentCount).toBeGreaterThanOrEqual(0);
        expect(result.processedDocumentCount).toBeLessThanOrEqual(result.documentCount);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.3**
   *
   * chunkingMethod should always have id, name, description, and parameters fields.
   */
  it('chunkingMethod has required structure', async () => {
    await fc.assert(
      fc.asyncProperty(documentsArb, async (docs) => {
        const result = await service.generateSummary(docs, 'cust-1', 'tenant-1');
        const cm = result.chunkingMethod;
        expect(typeof cm.id).toBe('string');
        expect(typeof cm.name).toBe('string');
        expect(typeof cm.description).toBe('string');
        expect(cm.parameters).toBeDefined();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 5.3**
   *
   * When given an empty document list, the result should still have the full
   * API-compatible shape (graceful handling).
   */
  it('empty document list returns a valid API-compatible result', async () => {
    const result = await service.generateSummary([], 'cust-1', 'tenant-1');
    assertFullResultShape(result);
    expect(result.documentCount).toBe(0);
    expect(result.processedDocumentCount).toBe(0);
  });
});
