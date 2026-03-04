import { TokenEstimationService } from '../src/services/token-estimation';
import { DocumentRecord } from '../src/types';

describe('TokenEstimationService', () => {
  let service: TokenEstimationService;

  beforeEach(() => {
    service = new TokenEstimationService();
  });

  describe('estimateTokens', () => {
    it('should return 0 for empty text', () => {
      expect(service.estimateTokens('')).toBe(0);
      expect(service.estimateTokens('   ')).toBe(0);
    });

    it('should use 4:1 character-to-token ratio', () => {
      const text = 'This is a test text with exactly forty characters.'; // 50 characters
      const expectedTokens = Math.ceil(50 / 4); // 13 tokens
      expect(service.estimateTokens(text)).toBe(expectedTokens);
    });

    it('should handle large text correctly', () => {
      const text = 'a'.repeat(1000); // 1000 characters
      const expectedTokens = Math.ceil(1000 / 4); // 250 tokens
      expect(service.estimateTokens(text)).toBe(expectedTokens);
    });
  });

  describe('calculateAvailableTokens', () => {
    it('should subtract prompt overhead from max tokens', () => {
      const maxTokens = 1000;
      const promptOverhead = 150;
      const expectedAvailable = maxTokens - promptOverhead;
      
      expect(service.calculateAvailableTokens(maxTokens, promptOverhead)).toBe(expectedAvailable);
    });

    it('should use default prompt overhead when not provided', () => {
      const maxTokens = 1000;
      const result = service.calculateAvailableTokens(maxTokens);
      
      expect(result).toBe(850); // 1000 - 150 (default overhead)
    });

    it('should ensure minimum content tokens', () => {
      const maxTokens = 100;
      const promptOverhead = 80;
      const result = service.calculateAvailableTokens(maxTokens, promptOverhead);
      
      expect(result).toBe(50); // Minimum content tokens
    });
  });

  describe('distributeTokens', () => {
    const createMockDocument = (id: string, textLength: number): DocumentRecord => ({
      id,
      customerUuid: 'test-customer',
      tenantId: 'test-tenant',
      fileName: `doc-${id}.pdf`,
      s3Key: `docs/${id}`,
      contentType: 'application/pdf',
      processingStatus: 'completed',
      extractedText: 'a'.repeat(textLength),
      textLength,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    });

    it('should return empty map for empty documents array', () => {
      const result = service.distributeTokens([], 1000);
      expect(result.size).toBe(0);
    });

    it('should distribute tokens proportionally based on document length', () => {
      const docs = [
        createMockDocument('1', 100), // 25% of total
        createMockDocument('2', 300)  // 75% of total
      ];
      
      const totalTokens = 1000;
      const distribution = service.distributeTokens(docs, totalTokens);
      
      expect(distribution.size).toBe(2);
      
      const doc1Tokens = distribution.get('1')!;
      const doc2Tokens = distribution.get('2')!;
      
      // Doc2 should get more tokens than doc1
      expect(doc2Tokens).toBeGreaterThan(doc1Tokens);
      
      // Total should be close to totalTokens (allowing for rounding)
      expect(doc1Tokens + doc2Tokens).toBeLessThanOrEqual(totalTokens);
    });

    it('should distribute equally when documents have no text', () => {
      const docs = [
        createMockDocument('1', 0),
        createMockDocument('2', 0)
      ];
      
      const totalTokens = 1000;
      const distribution = service.distributeTokens(docs, totalTokens);
      
      const tokensPerDoc = Math.floor(totalTokens / docs.length);
      expect(distribution.get('1')).toBe(tokensPerDoc);
      expect(distribution.get('2')).toBe(tokensPerDoc);
    });

    it('should apply custom weights when provided', () => {
      const docs = [
        createMockDocument('1', 100),
        createMockDocument('2', 100) // Same length
      ];
      
      const weights = new Map([
        ['1', 2.0], // Double weight
        ['2', 1.0]
      ]);
      
      const totalTokens = 1000;
      const distribution = service.distributeTokens(docs, totalTokens, weights);
      
      const doc1Tokens = distribution.get('1')!;
      const doc2Tokens = distribution.get('2')!;
      
      // Doc1 should get more tokens due to higher weight
      expect(doc1Tokens).toBeGreaterThan(doc2Tokens);
    });

    it('should ensure minimum tokens per document', () => {
      const docs = [
        createMockDocument('1', 1),
        createMockDocument('2', 10000) // Very large document
      ];
      
      const totalTokens = 100; // Small total
      const distribution = service.distributeTokens(docs, totalTokens);
      
      // Even small document should get minimum tokens
      expect(distribution.get('1')).toBeGreaterThanOrEqual(50); // MIN_CONTENT_TOKENS
    });
  });

  describe('getTokenUsageInfo', () => {
    it('should calculate token usage information correctly', () => {
      const maxTokensAllowed = 1000;
      const tokensUsed = 750;
      const promptOverhead = 150;
      
      const info = service.getTokenUsageInfo(maxTokensAllowed, tokensUsed, promptOverhead);
      
      expect(info.maxTokensAllowed).toBe(maxTokensAllowed);
      expect(info.tokensUsed).toBe(tokensUsed);
      expect(info.promptOverhead).toBe(promptOverhead);
      expect(info.contentTokens).toBe(tokensUsed - promptOverhead);
      expect(info.utilizationPercentage).toBe(75); // 750/1000 * 100
    });

    it('should round utilization percentage to 2 decimal places', () => {
      const info = service.getTokenUsageInfo(1000, 333, 100);
      expect(info.utilizationPercentage).toBe(33.3);
    });
  });

  describe('fitsWithinLimit', () => {
    it('should return true when text fits within limit', () => {
      const text = 'a'.repeat(100); // 100 chars = ~25 tokens
      expect(service.fitsWithinLimit(text, 30)).toBe(true);
    });

    it('should return false when text exceeds limit', () => {
      const text = 'a'.repeat(1000); // 1000 chars = ~250 tokens
      expect(service.fitsWithinLimit(text, 200)).toBe(false);
    });
  });

  describe('getConservativeEstimate', () => {
    it('should use more conservative ratio than standard estimation', () => {
      const text = 'a'.repeat(100);
      const standardEstimate = service.estimateTokens(text);
      const conservativeEstimate = service.getConservativeEstimate(text);
      
      expect(conservativeEstimate).toBeGreaterThanOrEqual(standardEstimate);
    });
  });
});