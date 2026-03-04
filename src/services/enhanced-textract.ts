import { TextractClient, DetectDocumentTextCommand, AnalyzeDocumentCommand } from '@aws-sdk/client-textract';
import { TextractExtractionParams, TextractResult, RetryConfig, ErrorDetails } from '../types';

export class EnhancedTextractService {
  private textractClient: TextractClient;
  private defaultRetryConfig: RetryConfig = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2
  };

  constructor(region: string) {
    this.textractClient = new TextractClient({ region });
  }

  /**
   * Extracts text from document with automatic retry logic
   */
  async extractTextWithRetry(
    params: TextractExtractionParams, 
    retryConfig?: Partial<RetryConfig>
  ): Promise<TextractResult> {
    const config = { ...this.defaultRetryConfig, ...retryConfig };
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        console.log('Textract extraction attempt', { 
          attempt: attempt + 1, 
          maxRetries: config.maxRetries + 1,
          s3Key: params.s3Key 
        });

        const result = await this.extractText(params);
        
        if (attempt > 0) {
          console.log('Textract extraction succeeded after retry', { 
            attempt: attempt + 1,
            s3Key: params.s3Key 
          });
        }

        return result;

      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown error');
        
        console.error('Textract extraction failed', { 
          attempt: attempt + 1,
          error: lastError.message,
          s3Key: params.s3Key 
        });

        // Don't retry on the last attempt
        if (attempt === config.maxRetries) {
          break;
        }

        // Check if error is retryable
        if (!this.isRetryableError(lastError)) {
          console.log('Error is not retryable, stopping attempts', { 
            error: lastError.message 
          });
          break;
        }

        // Calculate delay with exponential backoff
        const delay = Math.min(
          config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt),
          config.maxDelayMs
        );

        console.log(`Retrying Textract in ${delay}ms...`, { 
          attempt: attempt + 1,
          delay 
        });

        await this.sleep(delay);
      }
    }

    throw new Error(`Textract failed after ${config.maxRetries + 1} attempts: ${lastError?.message || 'Unknown error'}`);
  }

  /**
   * Extracts text from document using appropriate Textract method
   */
  async extractText(params: TextractExtractionParams): Promise<TextractResult> {
    const startTime = Date.now();

    try {
      let response;
      let textBlocks: any[] = [];
      let forms: any[] = [];
      let tables: any[] = [];

      if (params.documentType === 'simple') {
        // Use DetectDocumentText for simple text extraction
        response = await this.textractClient.send(new DetectDocumentTextCommand({
          Document: {
            S3Object: {
              Bucket: params.s3Bucket,
              Name: params.s3Key,
            },
          },
        }));

        textBlocks = response.Blocks || [];

      } else {
        // Use AnalyzeDocument for forms and tables
        const featureTypes: ('FORMS' | 'TABLES')[] = [];
        if (params.documentType === 'forms' || params.documentType === 'tables') {
          featureTypes.push('FORMS', 'TABLES');
        }

        response = await this.textractClient.send(new AnalyzeDocumentCommand({
          Document: {
            S3Object: {
              Bucket: params.s3Bucket,
              Name: params.s3Key,
            },
          },
          FeatureTypes: featureTypes,
        }));

        textBlocks = response.Blocks || [];
        
        // Extract forms and tables if present
        forms = this.extractForms(textBlocks);
        tables = this.extractTables(textBlocks);
      }

      // Extract and order text from blocks
      const extractedText = this.extractTextFromBlocks(textBlocks);
      const confidence = this.calculateAverageConfidence(textBlocks);
      const pageCount = this.getPageCount(textBlocks);
      const processingTime = Date.now() - startTime;

      console.log('Textract extraction completed', {
        s3Key: params.s3Key,
        textLength: extractedText.length,
        blockCount: textBlocks.length,
        pageCount,
        confidence,
        processingTime
      });

      return {
        extractedText,
        confidence,
        pageCount,
        processingTime,
        textBlocks,
        forms,
        tables
      };

    } catch (error) {
      const processingTime = Date.now() - startTime;
      
      console.error('Textract extraction error', {
        s3Key: params.s3Key,
        error: error instanceof Error ? error.message : 'Unknown error',
        processingTime
      });

      throw error;
    }
  }

  /**
   * Determines the appropriate document type based on content analysis
   */
  static determineDocumentType(fileName: string, contentType: string): 'simple' | 'forms' | 'tables' {
    // For now, use simple heuristics based on filename
    const lowerFileName = fileName.toLowerCase();
    
    if (lowerFileName.includes('form') || lowerFileName.includes('application')) {
      return 'forms';
    }
    
    if (lowerFileName.includes('table') || lowerFileName.includes('data') || lowerFileName.includes('report')) {
      return 'tables';
    }
    
    return 'simple';
  }

  /**
   * Determines processing mode based on file size and document complexity
   */
  static determineProcessingMode(fileSizeBytes: number, documentType?: 'simple' | 'forms' | 'tables'): 'sync' | 'async' {
    const SYNC_THRESHOLD = 5 * 1024 * 1024; // 5MB
    const COMPLEX_SYNC_THRESHOLD = 2 * 1024 * 1024; // 2MB for complex documents
    
    // Use smaller threshold for complex documents (forms/tables)
    const threshold = (documentType === 'forms' || documentType === 'tables') 
      ? COMPLEX_SYNC_THRESHOLD 
      : SYNC_THRESHOLD;
    
    return fileSizeBytes < threshold ? 'sync' : 'async';
  }

  /**
   * Determines optimal concurrency level based on document count and sizes
   */
  static determineOptimalConcurrency(documentCount: number, averageFileSizeBytes: number): number {
    const MAX_CONCURRENT_SYNC = 5;
    const MAX_CONCURRENT_ASYNC = 10;
    
    // For small documents, allow more concurrency
    if (averageFileSizeBytes < 1024 * 1024) { // < 1MB
      return Math.min(documentCount, MAX_CONCURRENT_SYNC);
    }
    
    // For larger documents, reduce concurrency
    return Math.min(documentCount, MAX_CONCURRENT_ASYNC);
  }

  /**
   * Extracts and orders text from Textract blocks
   */
  private extractTextFromBlocks(blocks: any[]): string {
    const lineBlocks = blocks
      .filter(block => block.BlockType === 'LINE')
      .sort((a, b) => {
        // Sort by page first, then by vertical position (top to bottom)
        if (a.Page !== b.Page) {
          return (a.Page || 1) - (b.Page || 1);
        }
        
        // Sort by top position (Y coordinate)
        const aTop = a.Geometry?.BoundingBox?.Top || 0;
        const bTop = b.Geometry?.BoundingBox?.Top || 0;
        
        return aTop - bTop;
      });

    return lineBlocks
      .map(block => block.Text || '')
      .filter(text => text.trim().length > 0)
      .join('\n');
  }

  /**
   * Extracts form data from Textract blocks
   */
  private extractForms(blocks: any[]): any[] {
    const forms: any[] = [];
    const keyValueSets = blocks.filter(block => block.BlockType === 'KEY_VALUE_SET');
    
    keyValueSets.forEach(kvSet => {
      if (kvSet.EntityTypes?.includes('KEY')) {
        const key = this.getTextFromRelationships(kvSet, blocks);
        const valueBlock = kvSet.Relationships?.find((rel: any) => rel.Type === 'VALUE');
        
        if (valueBlock) {
          const value = this.getTextFromRelationships(valueBlock, blocks);
          forms.push({ key, value });
        }
      }
    });
    
    return forms;
  }

  /**
   * Extracts table data from Textract blocks
   */
  private extractTables(blocks: any[]): any[] {
    const tables: any[] = [];
    const tableBlocks = blocks.filter(block => block.BlockType === 'TABLE');
    
    tableBlocks.forEach(table => {
      const rows: any[] = [];
      const cellRelationships = table.Relationships?.find((rel: any) => rel.Type === 'CHILD');
      
      if (cellRelationships) {
        // Process table cells and organize into rows
        // This is a simplified implementation
        tables.push({ rows });
      }
    });
    
    return tables;
  }

  /**
   * Gets text from block relationships
   */
  private getTextFromRelationships(block: any, allBlocks: any[]): string {
    const childRelationship = block.Relationships?.find((rel: any) => rel.Type === 'CHILD');
    if (!childRelationship) return '';
    
    return childRelationship.Ids
      .map((id: string) => allBlocks.find(b => b.Id === id))
      .filter((b: any) => b?.BlockType === 'WORD')
      .map((b: any) => b.Text)
      .join(' ');
  }

  /**
   * Calculates average confidence from blocks
   */
  private calculateAverageConfidence(blocks: any[]): number {
    const confidenceBlocks = blocks.filter(block => block.Confidence !== undefined);
    
    if (confidenceBlocks.length === 0) {
      return 0;
    }
    
    const totalConfidence = confidenceBlocks.reduce((sum, block) => sum + (block.Confidence || 0), 0);
    return totalConfidence / confidenceBlocks.length;
  }

  /**
   * Gets page count from blocks
   */
  private getPageCount(blocks: any[]): number {
    const pages = new Set(blocks.map(block => block.Page).filter(page => page !== undefined));
    return Math.max(1, pages.size);
  }

  /**
   * Checks if an error is retryable
   */
  private isRetryableError(error: Error): boolean {
    const retryableErrors = [
      'ThrottlingException',
      'InternalServerError',
      'ServiceUnavailableException',
      'ProvisionedThroughputExceededException',
      'RequestTimeoutException',
      'NetworkingError'
    ];

    return retryableErrors.some(retryableError => 
      error.message.includes(retryableError) || error.name === retryableError
    );
  }

  /**
   * Creates error details from Textract error
   */
  static createErrorDetails(error: Error): ErrorDetails {
    let errorType: 'validation' | 'textract' | 'processing' | 'system' = 'textract';
    let suggestedAction = 'Please try again later';
    let isRetryable = true;

    if (error.message.includes('InvalidParameterException')) {
      errorType = 'validation';
      suggestedAction = 'Please check the document format and try again';
      isRetryable = false;
    } else if (error.message.includes('UnsupportedDocumentException')) {
      errorType = 'validation';
      suggestedAction = 'This document format is not supported. Please try a different format';
      isRetryable = false;
    } else if (error.message.includes('DocumentTooLargeException')) {
      errorType = 'validation';
      suggestedAction = 'Document is too large. Please reduce the file size and try again';
      isRetryable = false;
    } else if (error.message.includes('ThrottlingException')) {
      errorType = 'textract';
      suggestedAction = 'Service is busy. The document will be retried automatically';
      isRetryable = true;
    }

    return {
      errorCode: error.name || 'TextractError',
      errorMessage: error.message,
      errorType,
      suggestedAction,
      isRetryable
    };
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}