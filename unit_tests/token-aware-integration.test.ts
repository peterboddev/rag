/**
 * Integration tests for Token-Aware Summarization end-to-end scenarios
 *
 * Tests the full pipeline: TokenEstimationService → TextTruncationService →
 * ContentPrioritizationService → TokenAwareSummarizationService
 *
 * Validates: Requirements 1.2, 4.1, 5.3
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { TokenEstimationService } from '../src/services/token-estimation';
import { TextTruncationService, TruncationStrategy } from '../src/services/text-truncation';
import { ContentPrioritizationService } from '../src/services/content-prioritization';
import { TokenAwareSummarizationService } from '../src/services/token-aware-summarization';
import { DocumentRecord } from '../src/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDocument(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    documentId: overrides.documentId || `doc-${Math.random().toString(36).slice(2, 8)}`,
    customerUuid: 'cust-001',
    tenantId: 'tenant-001',
    fileName: overrides.fileName || 'test-document.pdf',
    s3Key: 's3://bucket/test-document.pdf',
    contentType: overrides.contentType || 'application/pdf',
    processingStatus: overrides.processingStatus || 'completed',
    extractedText: overrides.extractedText ?? 'This is a test document with some content. It has multiple sentences for testing. The content is relevant to the summarization process.',
    createdAt: overrides.createdAt || new Date().toISOString(),
    updatedAt: overrides.updatedAt || new Date().toISOString(),
    ...overrides,
  };
}

/** Generate text of approximately the given token count (using 4:1 ratio). */
function generateText(approxTokens: number): string {
  const charCount = approxTokens * 4;
  const sentence = 'The quick brown fox jumps over the lazy dog. ';
  const repetitions = Math.ceil(charCount / sentence.length);
  return sentence.repeat(repetitions).substring(0, charCount);
}

function mockChunkingService(maxTokens: number) {
  return {
    getCustomerChunkingConfig: jest.fn<() => Promise<any>>().mockResolvedValue({
      id: `fixed_size_${maxTokens}`,
      name: `Fixed Size (${maxTokens})`,
      description: `Test config with ${maxTokens} token limit`,
      parameters: { strategy: 'fixed_size' as const, maxTokens },
    }),
  };
}

function mockFailingChunkingService() {
  return {
    getCustomerChunkingConfig: jest.fn<() => Promise<any>>().mockRejectedValue(
      new Error('DynamoDB connection failed')
    ),
  };
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('Token-Aware Summarization Integration Tests', () => {
  let tokenEstimator: TokenEstimationService;
  let textTruncator: TextTruncationService;
  let contentPrioritizer: ContentPrioritizationService;

  beforeEach(() => {
    tokenEstimator = new TokenEstimationService();
    textTruncator = new TextTruncationService();
    contentPrioritizer = new ContentPrioritizationService();
  });


  // ─── Test 1: Full pipeline – estimation → truncation → prioritization ──────

  describe('Full pipeline: TokenEstimation → TextTruncation → ContentPrioritization', () => {
    /**
     * Validates: Requirements 1.2, 4.1
     * Verifies that the three core services work together to process documents
     * within token limits.
     */
    it('should process documents through the full pipeline respecting token limits', () => {
      const tokenLimit = 200;
      const longText = generateText(500); // ~500 tokens, exceeds limit

      const doc = makeDocument({ extractedText: longText });

      // Step 1: Estimate tokens
      const estimatedTokens = tokenEstimator.estimateTokens(longText);
      expect(estimatedTokens).toBeGreaterThan(tokenLimit);

      // Step 2: Calculate available tokens (subtract prompt overhead)
      const availableTokens = tokenEstimator.calculateAvailableTokens(tokenLimit);
      expect(availableTokens).toBeLessThan(tokenLimit);
      expect(availableTokens).toBeGreaterThan(0);

      // Step 3: Truncate text to fit
      const truncated = textTruncator.truncateToTokenLimit(
        longText,
        availableTokens,
        TruncationStrategy.BEGINNING_AND_END
      );

      // Verify truncation happened
      expect(truncated.truncatedLength).toBeLessThan(truncated.originalLength);
      expect(truncated.truncationPoints.length).toBeGreaterThan(0);

      // Step 4: Verify truncated content fits within token limit
      const truncatedTokens = tokenEstimator.estimateTokens(truncated.content);
      expect(truncatedTokens).toBeLessThanOrEqual(tokenLimit);

      // Step 5: Prioritize the document
      const priorities = contentPrioritizer.prioritizeDocuments([doc], {
        recencyWeight: 0.3,
        sizeWeight: 0.3,
        contentTypeWeight: 0.2,
        processingQualityWeight: 0.2,
      });

      expect(priorities).toHaveLength(1);
      expect(priorities[0].documentId).toBe(doc.documentId);
      expect(priorities[0].priority).toBeGreaterThan(0);
    });
  });

  // ─── Test 2: generateSummary with 512-token chunking config ────────────────

  describe('TokenAwareSummarizationService.generateSummary with 512-token config', () => {
    /**
     * Validates: Requirements 1.2, 4.1
     * End-to-end test with a 512-token chunking configuration.
     */
    it('should respect 512-token limit across the full summarization pipeline', async () => {
      const service = new TokenAwareSummarizationService();
      (service as any).chunkingService = mockChunkingService(512);

      const docs = [
        makeDocument({
          documentId: 'doc-1',
          fileName: 'report.pdf',
          extractedText: generateText(800),
          processingStatus: 'completed',
        }),
      ];

      const result = await service.generateSummary(docs, 'cust-001', 'tenant-001');

      // Token usage should respect the 512 limit
      expect(result.tokenUsage.maxTokensAllowed).toBe(512);
      expect(result.tokenUsage.tokensUsed).toBeLessThanOrEqual(512);
      expect(result.processedDocumentCount).toBe(1);
      expect(result.processedContent.length).toBeGreaterThan(0);

      // Truncation should have occurred since doc exceeds limit
      expect(result.truncationInfo.documentsTruncated).toBe(1);
    });
  });

  // ─── Test 3: generateSummary with 1024-token chunking config ───────────────

  describe('TokenAwareSummarizationService.generateSummary with 1024-token config', () => {
    /**
     * Validates: Requirements 1.2, 4.1
     * End-to-end test with a 1024-token chunking configuration and multiple docs.
     */
    it('should distribute tokens across multiple documents within 1024-token limit', async () => {
      const service = new TokenAwareSummarizationService();
      (service as any).chunkingService = mockChunkingService(1024);

      const docs = [
        makeDocument({
          documentId: 'doc-a',
          fileName: 'alpha.pdf',
          extractedText: generateText(600),
          processingStatus: 'completed',
        }),
        makeDocument({
          documentId: 'doc-b',
          fileName: 'beta.pdf',
          extractedText: generateText(400),
          processingStatus: 'completed',
        }),
      ];

      const result = await service.generateSummary(docs, 'cust-001', 'tenant-001');

      expect(result.tokenUsage.maxTokensAllowed).toBe(1024);
      expect(result.tokenUsage.tokensUsed).toBeLessThanOrEqual(1024);
      expect(result.processedDocumentCount).toBe(2);
      expect(result.truncationInfo.documentsProcessed).toBe(2);

      // Both documents should appear in the processed content
      expect(result.processedContent).toContain('alpha.pdf');
      expect(result.processedContent).toContain('beta.pdf');
    });
  });

  // ─── Test 4: Fallback when chunking config retrieval fails ─────────────────

  describe('Fallback behavior when chunking configuration fails', () => {
    /**
     * Validates: Requirements 5.3
     * When the chunking service throws, the system should fall back to defaults
     * and still produce a result without throwing.
     */
    it('should fall back to default limits when config retrieval fails', async () => {
      const service = new TokenAwareSummarizationService();
      (service as any).chunkingService = mockFailingChunkingService();

      const docs = [
        makeDocument({
          documentId: 'doc-fallback',
          fileName: 'fallback-test.pdf',
          extractedText: generateText(300),
          processingStatus: 'completed',
        }),
      ];

      const result = await service.generateSummary(docs, 'cust-001', 'tenant-001');

      // Should not throw — should produce a valid result
      expect(result).toBeDefined();
      expect(result.processedContent.length).toBeGreaterThan(0);

      // Fallback should use default 1000-token limit
      expect(result.chunkingMethod.id).toBe('default');
      expect(result.chunkingMethod.parameters.maxTokens).toBe(1000);

      // Metadata should record the fallback
      expect(result.processingMetadata.fallbacksUsed).toContain('default_chunking_config');
    });
  });

  // ─── Test 5: Multi-document with mixed sizes ──────────────────────────────

  describe('Multi-document scenarios with different document sizes', () => {
    /**
     * Validates: Requirements 1.2, 4.1, 5.3
     * Tests that a mix of small, medium, and large documents are handled
     * correctly, with token limits respected and all valid docs included.
     */
    it('should handle a mix of small, medium, and large documents', async () => {
      const service = new TokenAwareSummarizationService();
      (service as any).chunkingService = mockChunkingService(1024);

      const docs = [
        makeDocument({
          documentId: 'doc-small',
          fileName: 'small.txt',
          contentType: 'text/plain',
          extractedText: generateText(50), // small
          processingStatus: 'completed',
        }),
        makeDocument({
          documentId: 'doc-medium',
          fileName: 'medium.pdf',
          extractedText: generateText(400), // medium
          processingStatus: 'completed',
        }),
        makeDocument({
          documentId: 'doc-large',
          fileName: 'large.pdf',
          extractedText: generateText(2000), // large, exceeds limit alone
          processingStatus: 'completed',
        }),
      ];

      const result = await service.generateSummary(docs, 'cust-001', 'tenant-001');

      expect(result.tokenUsage.maxTokensAllowed).toBe(1024);
      expect(result.tokenUsage.tokensUsed).toBeLessThanOrEqual(1024);
      expect(result.processedDocumentCount).toBe(3);

      // All three documents should appear in the output
      expect(result.processedContent).toContain('small.txt');
      expect(result.processedContent).toContain('medium.pdf');
      expect(result.processedContent).toContain('large.pdf');

      // The large document should have been truncated
      const largeTruncation = result.truncationInfo.truncationDetails.find(
        d => d.documentId === 'doc-large'
      );
      expect(largeTruncation).toBeDefined();
      expect(largeTruncation!.truncationPercentage).toBeGreaterThan(0);
    });

    /**
     * Validates: Requirements 5.3
     * Documents without extracted text or not completed should be excluded
     * from processing but the API should still return a valid response.
     */
    it('should gracefully handle documents with missing text or incomplete processing', async () => {
      const service = new TokenAwareSummarizationService();
      (service as any).chunkingService = mockChunkingService(1024);

      const docs = [
        makeDocument({
          documentId: 'doc-good',
          fileName: 'good.pdf',
          extractedText: generateText(200),
          processingStatus: 'completed',
        }),
        makeDocument({
          documentId: 'doc-no-text',
          fileName: 'no-text.pdf',
          extractedText: undefined,
          processingStatus: 'completed',
        }),
        makeDocument({
          documentId: 'doc-failed',
          fileName: 'failed.pdf',
          extractedText: 'Some text here.',
          processingStatus: 'failed',
        }),
      ];

      const result = await service.generateSummary(docs, 'cust-001', 'tenant-001');

      // Only the good document should be processed
      expect(result.processedDocumentCount).toBe(1);
      expect(result.documentCount).toBe(3);
      expect(result.processedContent).toContain('good.pdf');
    });
  });

  // ─── Test 6: Default token limit when maxTokens is absent ──────────────────

  describe('Default token limit when maxTokens is not in config', () => {
    /**
     * Validates: Requirements 1.2, 5.3
     * When the chunking config has no maxTokens, the system should default to 1000.
     */
    it('should use default 1000-token limit when config has no maxTokens', async () => {
      const service = new TokenAwareSummarizationService();
      (service as any).chunkingService = {
        getCustomerChunkingConfig: jest.fn<() => Promise<any>>().mockResolvedValue({
          id: 'default',
          name: 'Default Chunking',
          description: 'Default config without maxTokens',
          parameters: { strategy: 'default' as const },
        }),
      };

      const docs = [
        makeDocument({
          documentId: 'doc-default',
          fileName: 'default-test.pdf',
          extractedText: generateText(1500),
          processingStatus: 'completed',
        }),
      ];

      const result = await service.generateSummary(docs, 'cust-001', 'tenant-001');

      // Should use default 1000 token limit
      expect(result.tokenUsage.maxTokensAllowed).toBe(1000);
      expect(result.tokenUsage.tokensUsed).toBeLessThanOrEqual(1000);
    });
  });

  // ─── Test 7: Token limit override via options ──────────────────────────────

  describe('Token limit override via SummarizationOptions', () => {
    /**
     * Validates: Requirements 4.1
     * The maxTokensOverride option should take precedence over the config value.
     */
    it('should use maxTokensOverride when provided', async () => {
      const service = new TokenAwareSummarizationService();
      (service as any).chunkingService = mockChunkingService(1024);

      const docs = [
        makeDocument({
          documentId: 'doc-override',
          fileName: 'override.pdf',
          extractedText: generateText(800),
          processingStatus: 'completed',
        }),
      ];

      const result = await service.generateSummary(docs, 'cust-001', 'tenant-001', {
        maxTokensOverride: 256,
      });

      // Override should take effect
      expect(result.tokenUsage.maxTokensAllowed).toBe(256);
      expect(result.tokenUsage.tokensUsed).toBeLessThanOrEqual(256);
    });
  });
});
