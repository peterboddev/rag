import { DocumentRecord } from '../types';
import { ChunkingConfigurationService } from './chunking-configuration';
import { TokenEstimationService, TokenUsageInfo } from './token-estimation';
import { TextTruncationService, TruncationStrategy, TruncationInfo } from './text-truncation';
import { ContentPrioritizationService, PrioritizationCriteria } from './content-prioritization';

/**
 * Main orchestration service for token-aware document summarization
 * Integrates chunking configuration, token estimation, text truncation, and content prioritization
 */
export class TokenAwareSummarizationService {
  private chunkingService: ChunkingConfigurationService;
  private tokenEstimator: TokenEstimationService;
  private textTruncator: TextTruncationService;
  private contentPrioritizer: ContentPrioritizationService;
  private configCache: Map<string, { config: any; timestamp: number }>;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor() {
    this.chunkingService = new ChunkingConfigurationService();
    this.tokenEstimator = new TokenEstimationService();
    this.textTruncator = new TextTruncationService();
    this.contentPrioritizer = new ContentPrioritizationService();
    this.configCache = new Map();
  }

  /**
   * Generate token-aware summary for documents
   */
  async generateSummary(
    documents: DocumentRecord[], 
    customerUUID: string, 
    tenantId: string,
    options?: SummarizationOptions
  ): Promise<TokenAwareSummaryResult> {
    const startTime = Date.now();
    const processingMetadata: SummaryProcessingMetadata = {
      chunkingConfigRetrievalTime: 0,
      tokenEstimationTime: 0,
      textProcessingTime: 0,
      summaryGenerationTime: 0,
      totalProcessingTime: 0,
      fallbacksUsed: [],
      cacheHits: 0
    };

    try {
      console.log('Starting token-aware summarization', {
        customerUUID,
        tenantId,
        documentCount: documents.length,
        options
      });

      // 1. Retrieve chunking configuration
      const configStartTime = Date.now();
      const chunkingConfig = await this.getChunkingConfiguration(customerUUID, tenantId, processingMetadata);
      processingMetadata.chunkingConfigRetrievalTime = Date.now() - configStartTime;

      // 2. Determine token limits
      const maxTokens = options?.maxTokensOverride || chunkingConfig.parameters.maxTokens || 1000;
      const availableTokens = this.tokenEstimator.calculateAvailableTokens(maxTokens);

      console.log('Token limits determined', {
        maxTokens,
        availableTokens,
        chunkingMethod: chunkingConfig.id
      });

      // 3. Filter and prioritize documents
      const processedDocuments = documents.filter(doc => 
        doc.processingStatus === 'completed' && doc.extractedText && doc.extractedText.trim().length > 0
      );

      if (processedDocuments.length === 0) {
        return this.createEmptyResult(documents, maxTokens, processingMetadata, startTime);
      }

      // 4. Prioritize documents
      const textProcessingStartTime = Date.now();
      const prioritizationCriteria: PrioritizationCriteria = {
        recencyWeight: options?.prioritizeRecent ? 0.4 : 0.2,
        sizeWeight: 0.3,
        contentTypeWeight: 0.3,
        processingQualityWeight: 0.2
      };

      const documentPriorities = this.contentPrioritizer.prioritizeDocuments(
        processedDocuments, 
        prioritizationCriteria
      );

      // 5. Distribute tokens based on priority
      const tokenEstimationStartTime = Date.now();
      const tokenDistribution = this.distributeTokensByPriority(
        processedDocuments, 
        documentPriorities, 
        availableTokens
      );
      processingMetadata.tokenEstimationTime = Date.now() - tokenEstimationStartTime;

      // 6. Truncate documents to fit token limits
      const truncatedTexts = this.textTruncator.truncateMultipleDocuments(
        processedDocuments,
        tokenDistribution
      );
      processingMetadata.textProcessingTime = Date.now() - textProcessingStartTime;

      // 7. Build truncation info
      const truncationInfo = this.buildTruncationInfo(
        processedDocuments,
        truncatedTexts,
        TruncationStrategy.BEGINNING_AND_END
      );

      // 8. Calculate token usage
      const totalProcessedTokens = Array.from(truncatedTexts.values())
        .reduce((sum, text) => sum + this.tokenEstimator.estimateTokens(text.content), 0);

      const tokenUsage: TokenUsageInfo = this.tokenEstimator.getTokenUsageInfo(
        maxTokens,
        totalProcessedTokens + 150, // Add prompt overhead
        150
      );

      // 9. Prepare content for summarization
      const combinedContent = this.combineDocumentContent(processedDocuments, truncatedTexts);
      const contentWithIndicators = this.textTruncator.addTruncationIndicators(combinedContent, truncationInfo);

      processingMetadata.totalProcessingTime = Date.now() - startTime;

      return {
        processedContent: contentWithIndicators,
        tokenUsage,
        truncationInfo,
        chunkingMethod: chunkingConfig,
        processingMetadata,
        documentCount: documents.length,
        processedDocumentCount: processedDocuments.length
      };

    } catch (error) {
      console.error('Error in token-aware summarization:', error);
      
      // Fallback to default behavior
      processingMetadata.fallbacksUsed.push('default_summarization');
      processingMetadata.totalProcessingTime = Date.now() - startTime;
      
      return this.createFallbackResult(documents, error, processingMetadata, startTime);
    }
  }

  /**
   * Generate token-aware summary for selected documents with optional weighting
   */
  async generateSelectiveSummary(
    documents: DocumentRecord[], 
    customerUUID: string, 
    tenantId: string,
    documentWeights?: Map<string, number>
  ): Promise<TokenAwareSummaryResult> {
    const options: SummarizationOptions = {
      prioritizeRecent: false, // Use explicit weighting instead
      includeMetadata: true
    };

    const result = await this.generateSummary(documents, customerUUID, tenantId, options);
    
    // If weights provided, redistribute tokens accordingly
    if (documentWeights && documentWeights.size > 0) {
      result.processingMetadata.fallbacksUsed.push('custom_weighting_applied');
      console.log('Applied custom document weighting', {
        weightCount: documentWeights.size,
        weights: Array.from(documentWeights.entries())
      });
    }

    return result;
  }

  /**
   * Get chunking configuration with caching
   */
  private async getChunkingConfiguration(
    customerUUID: string, 
    tenantId: string, 
    processingMetadata: SummaryProcessingMetadata
  ) {
    const cacheKey = `${customerUUID}:${tenantId}`;
    const cached = this.configCache.get(cacheKey);
    
    // Check cache first
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL_MS) {
      processingMetadata.cacheHits++;
      console.log('Using cached chunking configuration', { customerUUID });
      return cached.config;
    }

    try {
      const config = await this.chunkingService.getCustomerChunkingConfig(customerUUID, tenantId);
      
      // Cache the configuration
      this.configCache.set(cacheKey, {
        config,
        timestamp: Date.now()
      });
      
      return config;
    } catch (error) {
      console.warn('Failed to retrieve chunking configuration, using default', { error });
      processingMetadata.fallbacksUsed.push('default_chunking_config');
      
      // Return default configuration
      return {
        id: 'default',
        name: 'Default Chunking',
        description: 'Default chunking with 1000 token limit',
        parameters: { strategy: 'default', maxTokens: 1000 }
      };
    }
  }

  /**
   * Distribute tokens based on document priorities
   */
  private distributeTokensByPriority(
    documents: DocumentRecord[],
    priorities: any[],
    totalTokens: number
  ): Map<string, number> {
    // Create weight map from priorities
    const weights = new Map<string, number>();
    for (const priority of priorities) {
      weights.set(priority.documentId, priority.priority);
    }

    return this.tokenEstimator.distributeTokens(documents, totalTokens, weights);
  }

  /**
   * Build truncation information for reporting
   */
  private buildTruncationInfo(
    documents: DocumentRecord[],
    truncatedTexts: Map<string, any>,
    strategy: TruncationStrategy
  ): TruncationInfo {
    const truncationDetails = [];
    let totalOriginalTokens = 0;
    let totalProcessedTokens = 0;
    let documentsTruncated = 0;

    for (const doc of documents) {
      const truncated = truncatedTexts.get(doc.id);
      if (truncated) {
        const originalTokens = this.tokenEstimator.estimateTokens(doc.extractedText || '');
        const processedTokens = this.tokenEstimator.estimateTokens(truncated.content);
        
        totalOriginalTokens += originalTokens;
        totalProcessedTokens += processedTokens;
        
        if (originalTokens > processedTokens) {
          documentsTruncated++;
        }

        truncationDetails.push({
          documentId: doc.id,
          fileName: doc.fileName,
          originalTokens,
          processedTokens,
          truncationPercentage: originalTokens > 0 ? ((originalTokens - processedTokens) / originalTokens) * 100 : 0,
          contentPreserved: truncated.truncationPoints.length > 0 ? ['beginning', 'end'] : ['full']
        });
      }
    }

    return {
      documentsProcessed: documents.length,
      documentsTruncated,
      totalOriginalTokens,
      totalProcessedTokens,
      truncationStrategy: strategy,
      truncationDetails
    };
  }

  /**
   * Combine document content for summarization
   */
  private combineDocumentContent(
    documents: DocumentRecord[],
    truncatedTexts: Map<string, any>
  ): string {
    const contentParts = [];
    
    for (const doc of documents) {
      const truncated = truncatedTexts.get(doc.id);
      if (truncated && truncated.content.trim().length > 0) {
        contentParts.push(`Document: ${doc.fileName}\nContent: ${truncated.content}`);
      }
    }
    
    return contentParts.join('\n\n---\n\n');
  }

  /**
   * Create empty result when no documents are available
   */
  private createEmptyResult(
    documents: DocumentRecord[],
    maxTokens: number,
    processingMetadata: SummaryProcessingMetadata,
    startTime: number
  ): TokenAwareSummaryResult {
    processingMetadata.totalProcessingTime = Date.now() - startTime;
    
    return {
      processedContent: 'No processed documents available for summarization.',
      tokenUsage: this.tokenEstimator.getTokenUsageInfo(maxTokens, 0, 0),
      truncationInfo: {
        documentsProcessed: documents.length,
        documentsTruncated: 0,
        totalOriginalTokens: 0,
        totalProcessedTokens: 0,
        truncationStrategy: TruncationStrategy.BEGINNING_AND_END,
        truncationDetails: []
      },
      chunkingMethod: {
        id: 'default',
        name: 'Default',
        description: 'Default configuration',
        parameters: { strategy: 'default', maxTokens }
      },
      processingMetadata,
      documentCount: documents.length,
      processedDocumentCount: 0
    };
  }

  /**
   * Create fallback result when errors occur
   */
  private createFallbackResult(
    documents: DocumentRecord[],
    error: any,
    processingMetadata: SummaryProcessingMetadata,
    startTime: number
  ): TokenAwareSummaryResult {
    processingMetadata.totalProcessingTime = Date.now() - startTime;
    
    const fallbackContent = documents
      .filter(doc => doc.extractedText)
      .map(doc => `Document: ${doc.fileName}\nContent: ${doc.extractedText?.substring(0, 2000) || 'No content'}`)
      .join('\n\n---\n\n');

    return {
      processedContent: fallbackContent,
      tokenUsage: this.tokenEstimator.getTokenUsageInfo(1000, 0, 0),
      truncationInfo: {
        documentsProcessed: documents.length,
        documentsTruncated: 0,
        totalOriginalTokens: 0,
        totalProcessedTokens: 0,
        truncationStrategy: TruncationStrategy.BEGINNING_AND_END,
        truncationDetails: []
      },
      chunkingMethod: {
        id: 'fallback',
        name: 'Fallback',
        description: 'Fallback configuration due to error',
        parameters: { strategy: 'default', maxTokens: 1000 }
      },
      processingMetadata,
      documentCount: documents.length,
      processedDocumentCount: documents.filter(doc => doc.extractedText).length
    };
  }
}

export interface SummarizationOptions {
  maxTokensOverride?: number;
  prioritizeRecent?: boolean;
  includeMetadata?: boolean;
}

export interface TokenAwareSummaryResult {
  processedContent: string;
  tokenUsage: TokenUsageInfo;
  truncationInfo: TruncationInfo;
  chunkingMethod: any;
  processingMetadata: SummaryProcessingMetadata;
  documentCount: number;
  processedDocumentCount: number;
}

export interface SummaryProcessingMetadata {
  chunkingConfigRetrievalTime: number;
  tokenEstimationTime: number;
  textProcessingTime: number;
  summaryGenerationTime: number;
  totalProcessingTime: number;
  fallbacksUsed: string[];
  cacheHits: number;
}