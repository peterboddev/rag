import { ContentPrioritizationService, PrioritizationCriteria } from '../src/services/content-prioritization';
import { DocumentRecord } from '../src/types';

describe('ContentPrioritizationService', () => {
  let service: ContentPrioritizationService;

  beforeEach(() => {
    service = new ContentPrioritizationService();
  });

  const createMockDocument = (
    id: string, 
    fileName: string = `doc-${id}.pdf`,
    contentType: string = 'application/pdf',
    createdAt: string = '2024-01-01T00:00:00Z',
    extractedText: string = 'Sample document content',
    processingStatus: 'completed' | 'failed' | 'processing' = 'completed',
    confidence?: number
  ): DocumentRecord => ({
    id,
    customerUuid: 'test-customer',
    tenantId: 'test-tenant',
    fileName,
    s3Key: `docs/${id}`,
    contentType,
    processingStatus,
    extractedText,
    textLength: extractedText.length,
    createdAt,
    updatedAt: createdAt,
    processingMetadata: confidence ? { 
      confidence, 
      isEncrypted: false, 
      hasTextContent: true, 
      processingMode: 'sync' as const,
      retryHistory: []
    } : undefined
  });

  describe('prioritizeDocuments', () => {
    const defaultCriteria: PrioritizationCriteria = {
      recencyWeight: 0.3,
      sizeWeight: 0.3,
      contentTypeWeight: 0.2,
      processingQualityWeight: 0.2
    };

    it('should prioritize recent documents higher', () => {
      const recentDoc = createMockDocument('1', 'recent.pdf', 'application/pdf', '2024-01-10T00:00:00Z');
      const oldDoc = createMockDocument('2', 'old.pdf', 'application/pdf', '2023-01-01T00:00:00Z');
      
      const priorities = service.prioritizeDocuments([recentDoc, oldDoc], defaultCriteria);
      
      expect(priorities).toHaveLength(2);
      expect(priorities[0].documentId).toBe('1'); // Recent doc should be first
      expect(priorities[0].priority).toBeGreaterThan(priorities[1].priority);
    });

    it('should prioritize documents with optimal content length', () => {
      const optimalDoc = createMockDocument('1', 'optimal.pdf', 'application/pdf', '2024-01-01T00:00:00Z', 'a'.repeat(2000));
      const tinyDoc = createMockDocument('2', 'tiny.pdf', 'application/pdf', '2024-01-01T00:00:00Z', 'tiny');
      const hugeDoc = createMockDocument('3', 'huge.pdf', 'application/pdf', '2024-01-01T00:00:00Z', 'a'.repeat(50000));
      
      const priorities = service.prioritizeDocuments([tinyDoc, hugeDoc, optimalDoc], defaultCriteria);
      
      const optimalPriority = priorities.find(p => p.documentId === '1')!;
      const tinyPriority = priorities.find(p => p.documentId === '2')!;
      const hugePriority = priorities.find(p => p.documentId === '3')!;
      
      expect(optimalPriority.priority).toBeGreaterThan(tinyPriority.priority);
      expect(optimalPriority.priority).toBeGreaterThan(hugePriority.priority);
    });

    it('should prioritize PDFs over other content types', () => {
      const pdfDoc = createMockDocument('1', 'doc.pdf', 'application/pdf');
      const imageDoc = createMockDocument('2', 'image.jpg', 'image/jpeg');
      
      const priorities = service.prioritizeDocuments([imageDoc, pdfDoc], defaultCriteria);
      
      const pdfPriority = priorities.find(p => p.documentId === '1')!;
      const imagePriority = priorities.find(p => p.documentId === '2')!;
      
      expect(pdfPriority.priority).toBeGreaterThan(imagePriority.priority);
    });

    it('should prioritize documents with higher processing quality', () => {
      const highQualityDoc = createMockDocument('1', 'high.pdf', 'application/pdf', '2024-01-01T00:00:00Z', 'content', 'completed', 95);
      const lowQualityDoc = createMockDocument('2', 'low.pdf', 'application/pdf', '2024-01-01T00:00:00Z', 'content', 'completed', 60);
      
      const priorities = service.prioritizeDocuments([lowQualityDoc, highQualityDoc], defaultCriteria);
      
      const highPriority = priorities.find(p => p.documentId === '1')!;
      const lowPriority = priorities.find(p => p.documentId === '2')!;
      
      expect(highPriority.priority).toBeGreaterThan(lowPriority.priority);
    });

    it('should return documents sorted by priority descending', () => {
      const doc1 = createMockDocument('1', 'doc1.pdf', 'application/pdf', '2024-01-01T00:00:00Z');
      const doc2 = createMockDocument('2', 'doc2.pdf', 'application/pdf', '2024-01-10T00:00:00Z'); // More recent
      const doc3 = createMockDocument('3', 'doc3.pdf', 'application/pdf', '2023-01-01T00:00:00Z'); // Older
      
      const priorities = service.prioritizeDocuments([doc1, doc2, doc3], defaultCriteria);
      
      expect(priorities[0].priority).toBeGreaterThanOrEqual(priorities[1].priority);
      expect(priorities[1].priority).toBeGreaterThanOrEqual(priorities[2].priority);
    });

    it('should include reasoning for prioritization', () => {
      const recentDoc = createMockDocument('1', 'recent.pdf', 'application/pdf', new Date().toISOString());
      
      const priorities = service.prioritizeDocuments([recentDoc], defaultCriteria);
      
      expect(priorities[0].reasoning).toBeTruthy();
      expect(priorities[0].reasoning.length).toBeGreaterThan(0);
    });

    it('should calculate recommended tokens based on priority', () => {
      const highPriorityDoc = createMockDocument('1', 'high.pdf', 'application/pdf', new Date().toISOString(), 'a'.repeat(3000));
      const lowPriorityDoc = createMockDocument('2', 'low.pdf', 'application/pdf', '2020-01-01T00:00:00Z', 'tiny');
      
      const priorities = service.prioritizeDocuments([highPriorityDoc, lowPriorityDoc], defaultCriteria);
      
      const highPriority = priorities.find(p => p.documentId === '1')!;
      const lowPriority = priorities.find(p => p.documentId === '2')!;
      
      expect(highPriority.recommendedTokens).toBeGreaterThan(lowPriority.recommendedTokens);
      expect(highPriority.recommendedTokens).toBeGreaterThan(0);
    });
  });

  describe('extractKeyContent', () => {
    it('should return full content when within token limit', () => {
      const doc = createMockDocument('1', 'test.pdf', 'application/pdf', '2024-01-01T00:00:00Z', 'Short content');
      
      const result = service.extractKeyContent(doc, 1000);
      
      expect(result.keyContent).toBe('Short content');
      expect(result.documentId).toBe('1');
      expect(result.fileName).toBe('test.pdf');
      expect(result.tokenUsage).toBeGreaterThan(0);
    });

    it('should return metadata-only for very restrictive token limits', () => {
      const doc = createMockDocument('1', 'test.pdf', 'application/pdf', '2024-01-01T00:00:00Z', 'a'.repeat(1000));
      
      const result = service.extractKeyContent(doc, 50); // Very low limit
      
      expect(result.keyContent).toContain('Document: test.pdf');
      expect(result.keyContent).toContain('Type: application/pdf');
      expect(result.contentSummary).toBe('Metadata only due to token constraints');
    });

    it('should extract key excerpts for moderate token limits', () => {
      const longText = 'Beginning content. ' + 'Middle content. '.repeat(50) + 'End content.';
      const doc = createMockDocument('1', 'test.pdf', 'application/pdf', '2024-01-01T00:00:00Z', longText);
      
      const result = service.extractKeyContent(doc, 300);
      
      expect(result.keyContent.length).toBeLessThan(longText.length);
      expect(result.keyContent).toContain('Beginning content');
      expect(result.tokenUsage).toBeLessThanOrEqual(300);
    });

    it('should handle documents with no extracted text', () => {
      const doc = createMockDocument('1', 'empty.pdf', 'application/pdf', '2024-01-01T00:00:00Z', '');
      
      const result = service.extractKeyContent(doc, 100);
      
      expect(result.keyContent).toBe('');
      expect(result.contentSummary).toBe('No text content available');
      expect(result.tokenUsage).toBe(0);
    });

    it('should include document metadata', () => {
      const doc = createMockDocument('1', 'test.pdf', 'application/pdf', '2024-01-01T00:00:00Z', 'content', 'completed', 85);
      
      const result = service.extractKeyContent(doc, 100);
      
      expect(result.metadata.fileName).toBe('test.pdf');
      expect(result.metadata.contentType).toBe('application/pdf');
      expect(result.metadata.confidence).toBe(85);
      expect(result.metadata.processingStatus).toBe('completed');
    });

    it('should generate appropriate content summary', () => {
      const text = 'This is a test document with multiple words and sentences.';
      const doc = createMockDocument('1', 'test.pdf', 'application/pdf', '2024-01-01T00:00:00Z', text);
      
      const result = service.extractKeyContent(doc, 1000);
      
      expect(result.contentSummary).toContain('words');
      expect(result.contentSummary).toContain('sentences');
    });
  });

  describe('edge cases', () => {
    it('should handle documents with failed processing status', () => {
      const failedDoc = createMockDocument('1', 'failed.pdf', 'application/pdf', '2024-01-01T00:00:00Z', '', 'failed');
      
      const priorities = service.prioritizeDocuments([failedDoc], {
        recencyWeight: 0.25,
        sizeWeight: 0.25,
        contentTypeWeight: 0.25,
        processingQualityWeight: 0.25
      });
      
      expect(priorities).toHaveLength(1);
      expect(priorities[0].priority).toBeLessThan(1.0); // Should have low priority
    });

    it('should handle documents with undefined metadata', () => {
      const doc: DocumentRecord = {
        id: '1',
        customerUuid: 'test-customer',
        tenantId: 'test-tenant',
        fileName: 'test.pdf',
        s3Key: 'docs/1',
        contentType: 'application/pdf',
        processingStatus: 'completed',
        extractedText: 'content',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z'
        // No processingMetadata
      };
      
      const priorities = service.prioritizeDocuments([doc], {
        recencyWeight: 0.25,
        sizeWeight: 0.25,
        contentTypeWeight: 0.25,
        processingQualityWeight: 0.25
      });
      
      expect(priorities).toHaveLength(1);
      expect(priorities[0].priority).toBeGreaterThan(0);
    });

    it('should handle empty document arrays', () => {
      const priorities = service.prioritizeDocuments([], {
        recencyWeight: 0.25,
        sizeWeight: 0.25,
        contentTypeWeight: 0.25,
        processingQualityWeight: 0.25
      });
      
      expect(priorities).toHaveLength(0);
    });
  });
});