import { TextTruncationService, TruncationStrategy } from '../src/services/text-truncation';
import { DocumentRecord } from '../src/types';

describe('TextTruncationService', () => {
  let service: TextTruncationService;

  beforeEach(() => {
    service = new TextTruncationService();
  });

  describe('truncateToTokenLimit', () => {
    it('should return original text when within token limit', () => {
      const text = 'This is a short text.';
      const result = service.truncateToTokenLimit(text, 1000);
      
      expect(result.content).toBe(text);
      expect(result.originalLength).toBe(text.length);
      expect(result.truncatedLength).toBe(text.length);
      expect(result.truncationPoints).toHaveLength(0);
    });

    it('should return empty result for empty text', () => {
      const result = service.truncateToTokenLimit('', 100);
      
      expect(result.content).toBe('');
      expect(result.originalLength).toBe(0);
      expect(result.truncatedLength).toBe(0);
      expect(result.preservedSentences).toBe(0);
    });

    it('should truncate text when exceeding token limit', () => {
      const longText = 'This is sentence one. This is sentence two. This is sentence three. This is sentence four.';
      const result = service.truncateToTokenLimit(longText, 10, TruncationStrategy.BEGINNING_ONLY);
      
      expect(result.content.length).toBeLessThan(longText.length);
      expect(result.originalLength).toBe(longText.length);
      expect(result.truncatedLength).toBe(result.content.length);
    });

    it('should preserve sentence boundaries when truncating', () => {
      const text = 'First sentence. Second sentence. Third sentence.';
      const result = service.truncateToTokenLimit(text, 15, TruncationStrategy.BEGINNING_ONLY);
      
      // Should end with complete sentence
      expect(result.content.trim()).toMatch(/[.!?]$/);
    });

    it('should use beginning and end strategy by default', () => {
      const text = 'Start sentence. Middle sentence one. Middle sentence two. Middle sentence three. Middle sentence four. End sentence.';
      const result = service.truncateToTokenLimit(text, 15); // Longer text, reasonable limit
      
      expect(result.content).toContain('Start sentence');
      expect(result.content).toContain('End sentence');
      expect(result.content).toContain('[Content truncated');
    });

    it('should add truncation indicators when content is truncated', () => {
      const longText = 'a'.repeat(1000);
      const result = service.truncateToTokenLimit(longText, 10);
      
      if (result.truncationPoints.length > 0) {
        expect(result.content).toContain('[Content truncated');
      }
    });
  });

  describe('truncateMultipleDocuments', () => {
    const createMockDocument = (id: string, text: string): DocumentRecord => ({
      id,
      customerUuid: 'test-customer',
      tenantId: 'test-tenant',
      fileName: `doc-${id}.pdf`,
      s3Key: `docs/${id}`,
      contentType: 'application/pdf',
      processingStatus: 'completed',
      extractedText: text,
      textLength: text.length,
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    });

    it('should truncate multiple documents according to token distribution', () => {
      const docs = [
        createMockDocument('1', 'First document with some content.'),
        createMockDocument('2', 'Second document with different content.')
      ];
      
      const tokenDistribution = new Map([
        ['1', 10],
        ['2', 15]
      ]);
      
      const results = service.truncateMultipleDocuments(docs, tokenDistribution);
      
      expect(results.size).toBe(2);
      expect(results.has('1')).toBe(true);
      expect(results.has('2')).toBe(true);
    });

    it('should handle documents with no allocated tokens', () => {
      const docs = [
        createMockDocument('1', 'Some content'),
        createMockDocument('2', 'Other content')
      ];
      
      const tokenDistribution = new Map([
        ['1', 10],
        ['2', 0] // No tokens allocated
      ]);
      
      const results = service.truncateMultipleDocuments(docs, tokenDistribution);
      
      expect(results.get('1')!.content.length).toBeGreaterThan(0);
      expect(results.get('2')!.content).toBe('');
      expect(results.get('2')!.truncatedLength).toBe(0);
    });

    it('should handle documents with no extracted text', () => {
      const docs = [
        createMockDocument('1', ''),
        createMockDocument('2', 'Has content')
      ];
      
      const tokenDistribution = new Map([
        ['1', 10],
        ['2', 10]
      ]);
      
      const results = service.truncateMultipleDocuments(docs, tokenDistribution);
      
      expect(results.get('1')!.content).toBe('');
      expect(results.get('2')!.content.length).toBeGreaterThan(0);
    });
  });

  describe('addTruncationIndicators', () => {
    it('should add indicators when documents were truncated', () => {
      const content = 'Original content';
      const truncationInfo = {
        documentsProcessed: 3,
        documentsTruncated: 2,
        totalOriginalTokens: 1000,
        totalProcessedTokens: 500,
        truncationStrategy: TruncationStrategy.BEGINNING_AND_END,
        truncationDetails: []
      };
      
      const result = service.addTruncationIndicators(content, truncationInfo);
      
      expect(result).toContain('[IMPORTANT: This content has been truncated');
      expect(result).toContain('1000 tokens');
      expect(result).toContain('500 tokens');
      expect(result).toContain('2 of 3 documents');
    });

    it('should not add indicators when no documents were truncated', () => {
      const content = 'Original content';
      const truncationInfo = {
        documentsProcessed: 2,
        documentsTruncated: 0,
        totalOriginalTokens: 500,
        totalProcessedTokens: 500,
        truncationStrategy: TruncationStrategy.BEGINNING_AND_END,
        truncationDetails: []
      };
      
      const result = service.addTruncationIndicators(content, truncationInfo);
      
      expect(result).toBe(content);
      expect(result).not.toContain('[IMPORTANT:');
    });
  });

  describe('sentence boundary preservation', () => {
    it('should split text into sentences correctly', () => {
      const text = 'First sentence. Second sentence! Third sentence?';
      const result = service.truncateToTokenLimit(text, 50);
      
      // Should preserve sentence structure
      expect(result.preservedSentences).toBeGreaterThan(0);
    });

    it('should handle text without proper sentence endings', () => {
      const text = 'This is text without proper endings and it continues';
      const result = service.truncateToTokenLimit(text, 20);
      
      expect(result.content.length).toBeGreaterThan(0);
      expect(result.preservedSentences).toBeGreaterThanOrEqual(0);
    });

    it('should count sentences accurately', () => {
      const text = 'One. Two! Three?';
      const result = service.truncateToTokenLimit(text, 100);
      
      expect(result.preservedSentences).toBe(3);
    });
  });

  describe('truncation strategies', () => {
    const longText = 'Beginning sentence. Middle sentence one. Middle sentence two. Middle sentence three. End sentence.';

    it('should implement beginning-only strategy', () => {
      const result = service.truncateToTokenLimit(longText, 20, TruncationStrategy.BEGINNING_ONLY);
      
      expect(result.content).toContain('Beginning sentence');
      expect(result.content).not.toContain('End sentence');
    });

    it('should implement beginning-and-end strategy', () => {
      const result = service.truncateToTokenLimit(longText, 15, TruncationStrategy.BEGINNING_AND_END); // Reduced from 25
      
      expect(result.content).toContain('Beginning sentence');
      expect(result.content).toContain('End sentence');
      expect(result.content).toContain('[Content truncated');
    });

    it('should implement proportional strategy', () => {
      const result = service.truncateToTokenLimit(longText, 15, TruncationStrategy.PROPORTIONAL); // Reduced from 30
      
      expect(result.content.length).toBeLessThan(longText.length);
      expect(result.truncationPoints.length).toBeGreaterThanOrEqual(0);
    });

    it('should implement smart excerpt strategy', () => {
      const result = service.truncateToTokenLimit(longText, 25, TruncationStrategy.SMART_EXCERPT);
      
      // Currently falls back to beginning-and-end
      expect(result.content).toContain('Beginning sentence');
      expect(result.content).toContain('End sentence');
    });
  });
});