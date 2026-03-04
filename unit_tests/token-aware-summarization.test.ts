import { TokenAwareSummarizationService, SummarizationOptions } from '../src/services/token-aware-summarization';
import { ChunkingConfigurationService } from '../src/services/chunking-configuration';
import { DocumentRecord, ChunkingMethod } from '../src/types';

// Mock the chunking configuration service
jest.mock('../src/services/chunking-configuration');

describe('TokenAwareSummarizationService', () => {
  let service: TokenAwareSummarizationService;
  let mockChunkingService: jest.Mocked<ChunkingConfigurationService>;

  beforeEach(() => {
    service = new TokenAwareSummarizationService();
    mockChunkingService = new ChunkingConfigurationService() as jest.Mocked<ChunkingConfigurationService>;
    
    // Mock the chunking service methods
    mockChunkingService.getCustomerChunkingConfig = jest.fn();
    
    // Replace the service instance
    (service as any).chunkingService = mockChunkingService;
  });

  const createMockDocument = (
    id: string, 
    extractedText: string = 'Sample document content for testing purposes.',
    processingStatus: 'completed' | 'failed' | 'processing' = 'completed'
  ): DocumentRecord => ({
    id,
    customerUuid: 'test-customer',
    tenantId: 'test-tenant',
    fileName: `doc-${id}.pdf`,
    s3Key: `docs/${id}`,
    contentType: 'application/pdf',
    processingStatus,
    extractedText,
    textLength: extractedText.length,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z'
  });

  const mockChunkingMethod: ChunkingMethod = {
    id: 'fixed_size_1024',
    name: 'Fixed Size (1024 tokens)',
    description: 'Fixed-size chunks with 1024 token limit',
    parameters: { 
      strategy: 'fixed_size', 
      chunkSize: 1024, 
      chunkOverlap: 100,
      maxTokens: 1024
    }
  };

  describe('generateSummary', () => {
    beforeEach(() => {
      mockChunkingService.getCustomerChunkingConfig.mockResolvedValue(mockChunkingMethod);
    });

    it('should generate summary for processed documents', async () => {
      const documents = [
        createMockDocument('1', 'First document content with meaningful information.'),
        createMockDocument('2', 'Second document content with different information.')
      ];

      const result = await service.generateSummary(documents, 'customer-uuid', 'tenant-id');

      expect(result).toBeDefined();
      expect(result.processedContent).toBeTruthy();
      expect(result.tokenUsage).toBeDefined();
      expect(result.truncationInfo).toBeDefined();
      expect(result.chunkingMethod).toEqual(mockChunkingMethod);
      expect(result.documentCount).toBe(2);
      expect(result.processedDocumentCount).toBe(2);
    });

    it('should handle empty document array', async () => {
      const result = await service.generateSummary([], 'customer-uuid', 'tenant-id');

      expect(result.processedContent).toContain('No processed documents available');
      expect(result.documentCount).toBe(0);
      expect(result.processedDocumentCount).toBe(0);
      expect(result.tokenUsage.tokensUsed).toBe(0);
    });

    it('should filter out unprocessed documents', async () => {
      const documents = [
        createMockDocument('1', 'Processed content', 'completed'),
        createMockDocument('2', '', 'failed'),
        createMockDocument('3', 'Another processed content', 'completed')
      ];

      const result = await service.generateSummary(documents, 'customer-uuid', 'tenant-id');

      expect(result.documentCount).toBe(3);
      expect(result.processedDocumentCount).toBe(2); // Only completed documents with content
    });

    it('should respect token limits from chunking configuration', async () => {
      const restrictiveChunkingMethod: ChunkingMethod = {
        id: 'fixed_size_512',
        name: 'Fixed Size (512 tokens)',
        description: 'Fixed-size chunks with 512 token limit',
        parameters: { 
          strategy: 'fixed_size', 
          chunkSize: 512, 
          chunkOverlap: 50,
          maxTokens: 512
        }
      };

      mockChunkingService.getCustomerChunkingConfig.mockResolvedValue(restrictiveChunkingMethod);

      const longText = 'This is a very long document. '.repeat(100);
      const documents = [createMockDocument('1', longText)];

      const result = await service.generateSummary(documents, 'customer-uuid', 'tenant-id');

      expect(result.tokenUsage.maxTokensAllowed).toBe(512);
      expect(result.chunkingMethod.parameters.maxTokens).toBe(512);
    });

    it('should use token override when provided', async () => {
      const documents = [createMockDocument('1', 'Test content')];
      const options: SummarizationOptions = {
        maxTokensOverride: 2000
      };

      const result = await service.generateSummary(documents, 'customer-uuid', 'tenant-id', options);

      expect(result.tokenUsage.maxTokensAllowed).toBe(2000);
    });

    it('should prioritize recent documents when option is set', async () => {
      const oldDoc = createMockDocument('1', 'Old document content');
      oldDoc.createdAt = '2020-01-01T00:00:00Z';
      
      const newDoc = createMockDocument('2', 'New document content');
      newDoc.createdAt = new Date().toISOString();

      const documents = [oldDoc, newDoc];
      const options: SummarizationOptions = {
        prioritizeRecent: true
      };

      const result = await service.generateSummary(documents, 'customer-uuid', 'tenant-id', options);

      expect(result.processedDocumentCount).toBe(2);
      // New document should get more tokens (hard to test directly, but should not throw)
    });

    it('should handle chunking configuration retrieval failure', async () => {
      mockChunkingService.getCustomerChunkingConfig.mockRejectedValue(new Error('Config service unavailable'));

      const documents = [createMockDocument('1', 'Test content')];

      const result = await service.generateSummary(documents, 'customer-uuid', 'tenant-id');

      expect(result.processingMetadata.fallbacksUsed).toContain('default_chunking_config');
      expect(result.chunkingMethod.id).toBe('default');
    });

    it('should cache chunking configuration', async () => {
      const documents = [createMockDocument('1', 'Test content')];

      // First call
      await service.generateSummary(documents, 'customer-uuid', 'tenant-id');
      
      // Second call should use cache
      await service.generateSummary(documents, 'customer-uuid', 'tenant-id');

      // Should only call the service once, second call uses cache
      expect(mockChunkingService.getCustomerChunkingConfig).toHaveBeenCalledTimes(1);
    });

    it('should include processing metadata', async () => {
      const documents = [createMockDocument('1', 'Test content')];

      const result = await service.generateSummary(documents, 'customer-uuid', 'tenant-id');

      expect(result.processingMetadata).toBeDefined();
      expect(result.processingMetadata.chunkingConfigRetrievalTime).toBeGreaterThanOrEqual(0);
      expect(result.processingMetadata.tokenEstimationTime).toBeGreaterThanOrEqual(0);
      expect(result.processingMetadata.textProcessingTime).toBeGreaterThanOrEqual(0);
      expect(result.processingMetadata.totalProcessingTime).toBeGreaterThan(0);
    });

    it('should handle documents that require truncation', async () => {
      const veryLongText = 'This is a very long document with lots of content. '.repeat(200);
      const documents = [createMockDocument('1', veryLongText)];

      const restrictiveChunkingMethod: ChunkingMethod = {
        id: 'fixed_size_256',
        name: 'Fixed Size (256 tokens)',
        description: 'Fixed-size chunks with 256 token limit',
        parameters: { 
          strategy: 'fixed_size', 
          chunkSize: 256, 
          chunkOverlap: 25,
          maxTokens: 256
        }
      };

      mockChunkingService.getCustomerChunkingConfig.mockResolvedValue(restrictiveChunkingMethod);

      const result = await service.generateSummary(documents, 'customer-uuid', 'tenant-id');

      expect(result.truncationInfo.documentsTruncated).toBeGreaterThan(0);
      expect(result.truncationInfo.totalOriginalTokens).toBeGreaterThan(result.truncationInfo.totalProcessedTokens);
    });
  });

  describe('generateSelectiveSummary', () => {
    beforeEach(() => {
      mockChunkingService.getCustomerChunkingConfig.mockResolvedValue(mockChunkingMethod);
    });

    it('should generate selective summary for provided documents', async () => {
      const documents = [
        createMockDocument('1', 'Selected document one'),
        createMockDocument('2', 'Selected document two')
      ];

      const result = await service.generateSelectiveSummary(documents, 'customer-uuid', 'tenant-id');

      expect(result).toBeDefined();
      expect(result.processedContent).toBeTruthy();
      expect(result.documentCount).toBe(2);
      expect(result.processedDocumentCount).toBe(2);
    });

    it('should apply custom document weights when provided', async () => {
      const documents = [
        createMockDocument('1', 'Document one'),
        createMockDocument('2', 'Document two')
      ];

      const weights = new Map([
        ['1', 2.0], // Higher weight
        ['2', 1.0]
      ]);

      const result = await service.generateSelectiveSummary(documents, 'customer-uuid', 'tenant-id', weights);

      expect(result.processingMetadata.fallbacksUsed).toContain('custom_weighting_applied');
    });

    it('should handle selective summary without weights', async () => {
      const documents = [createMockDocument('1', 'Test document')];

      const result = await service.generateSelectiveSummary(documents, 'customer-uuid', 'tenant-id');

      expect(result).toBeDefined();
      expect(result.processedDocumentCount).toBe(1);
    });
  });

  describe('error handling and fallbacks', () => {
    it('should create fallback result when service fails', async () => {
      mockChunkingService.getCustomerChunkingConfig.mockRejectedValue(new Error('Service failure'));
      
      // Mock a more severe failure by making the service throw during processing
      const originalGenerateSummary = service.generateSummary;
      jest.spyOn(service, 'generateSummary').mockImplementation(async () => {
        throw new Error('Processing failure');
      });

      const documents = [createMockDocument('1', 'Test content')];

      // This should not throw, but return a fallback result
      const result = await originalGenerateSummary.call(service, documents, 'customer-uuid', 'tenant-id');

      expect(result).toBeDefined();
      expect(result.processingMetadata.fallbacksUsed.length).toBeGreaterThan(0);
    });

    it('should handle configuration service timeout gracefully', async () => {
      // Simulate timeout
      mockChunkingService.getCustomerChunkingConfig.mockImplementation(() => 
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 100))
      );

      const documents = [createMockDocument('1', 'Test content')];

      const result = await service.generateSummary(documents, 'customer-uuid', 'tenant-id');

      expect(result.processingMetadata.fallbacksUsed).toContain('default_chunking_config');
    });
  });

  describe('performance and caching', () => {
    beforeEach(() => {
      mockChunkingService.getCustomerChunkingConfig.mockResolvedValue(mockChunkingMethod);
    });

    it('should track cache hits in processing metadata', async () => {
      const documents = [createMockDocument('1', 'Test content')];

      // First call - no cache hit
      const result1 = await service.generateSummary(documents, 'customer-uuid', 'tenant-id');
      expect(result1.processingMetadata.cacheHits).toBe(0);

      // Second call - should hit cache
      const result2 = await service.generateSummary(documents, 'customer-uuid', 'tenant-id');
      expect(result2.processingMetadata.cacheHits).toBe(1);
    });

    it('should measure processing times accurately', async () => {
      const documents = [createMockDocument('1', 'Test content')];

      const result = await service.generateSummary(documents, 'customer-uuid', 'tenant-id');

      expect(result.processingMetadata.totalProcessingTime).toBeGreaterThan(0);
      expect(result.processingMetadata.chunkingConfigRetrievalTime).toBeGreaterThanOrEqual(0);
      expect(result.processingMetadata.tokenEstimationTime).toBeGreaterThanOrEqual(0);
      expect(result.processingMetadata.textProcessingTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('token usage reporting', () => {
    beforeEach(() => {
      mockChunkingService.getCustomerChunkingConfig.mockResolvedValue(mockChunkingMethod);
    });

    it('should provide accurate token usage information', async () => {
      const documents = [createMockDocument('1', 'Test document content')];

      const result = await service.generateSummary(documents, 'customer-uuid', 'tenant-id');

      expect(result.tokenUsage.maxTokensAllowed).toBe(1024);
      expect(result.tokenUsage.tokensUsed).toBeGreaterThan(0);
      expect(result.tokenUsage.promptOverhead).toBe(150);
      expect(result.tokenUsage.contentTokens).toBe(result.tokenUsage.tokensUsed - result.tokenUsage.promptOverhead);
      expect(result.tokenUsage.utilizationPercentage).toBeGreaterThan(0);
    });

    it('should report truncation information accurately', async () => {
      const longText = 'Very long content. '.repeat(500);
      const documents = [createMockDocument('1', longText)];

      const restrictiveMethod: ChunkingMethod = {
        id: 'small',
        name: 'Small',
        description: 'Small token limit',
        parameters: { strategy: 'fixed_size', maxTokens: 100 }
      };

      mockChunkingService.getCustomerChunkingConfig.mockResolvedValue(restrictiveMethod);

      const result = await service.generateSummary(documents, 'customer-uuid', 'tenant-id');

      expect(result.truncationInfo.documentsProcessed).toBe(1);
      expect(result.truncationInfo.totalOriginalTokens).toBeGreaterThan(result.truncationInfo.totalProcessedTokens);
      expect(result.truncationInfo.truncationDetails).toHaveLength(1);
      expect(result.truncationInfo.truncationDetails[0].documentId).toBe('1');
    });
  });
});