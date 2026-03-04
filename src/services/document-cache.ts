import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { createHash } from 'crypto';

export interface CachedDocument {
  documentHash: string;
  extractedText: string;
  confidence: number;
  pageCount: number;
  processingTime: number;
  cachedAt: string;
  contentType: string;
  fileSizeBytes: number;
}

export interface CacheStats {
  hitCount: number;
  missCount: number;
  hitRate: number;
  totalCachedDocuments: number;
}

export class DocumentCacheService {
  private s3Client: S3Client;
  private cacheBucket: string;
  private cachePrefix: string = 'document-cache/';
  private cacheStats: CacheStats = {
    hitCount: 0,
    missCount: 0,
    hitRate: 0,
    totalCachedDocuments: 0
  };

  constructor(region: string, cacheBucket: string) {
    this.s3Client = new S3Client({ region });
    this.cacheBucket = cacheBucket;
  }

  /**
   * Generates a hash for document content to use as cache key
   */
  private generateDocumentHash(fileBuffer: Buffer, contentType: string): string {
    const hash = createHash('sha256');
    hash.update(fileBuffer);
    hash.update(contentType);
    return hash.digest('hex');
  }

  /**
   * Checks if a document is already cached
   */
  async getCachedDocument(fileBuffer: Buffer, contentType: string): Promise<CachedDocument | null> {
    try {
      const documentHash = this.generateDocumentHash(fileBuffer, contentType);
      const cacheKey = `${this.cachePrefix}${documentHash}.json`;

      console.log('Checking document cache', { documentHash, cacheKey });

      const response = await this.s3Client.send(new GetObjectCommand({
        Bucket: this.cacheBucket,
        Key: cacheKey
      }));

      const cacheData = await response.Body?.transformToString();
      if (cacheData) {
        const cachedDocument: CachedDocument = JSON.parse(cacheData);
        
        // Check if cache is still valid (e.g., not older than 30 days)
        const cacheAge = Date.now() - new Date(cachedDocument.cachedAt).getTime();
        const maxCacheAge = 30 * 24 * 60 * 60 * 1000; // 30 days
        
        if (cacheAge < maxCacheAge) {
          this.cacheStats.hitCount++;
          this.updateHitRate();
          
          console.log('Document cache hit', { 
            documentHash, 
            cacheAge: Math.round(cacheAge / (1000 * 60 * 60)) + ' hours'
          });
          
          return cachedDocument;
        } else {
          console.log('Document cache expired', { documentHash, cacheAge });
        }
      }

    } catch (error) {
      if ((error as any).name !== 'NoSuchKey') {
        console.error('Error checking document cache:', error);
      }
    }

    this.cacheStats.missCount++;
    this.updateHitRate();
    
    console.log('Document cache miss', { 
      hitRate: this.cacheStats.hitRate.toFixed(2) + '%'
    });
    
    return null;
  }

  /**
   * Caches a processed document
   */
  async cacheDocument(
    fileBuffer: Buffer,
    contentType: string,
    extractedText: string,
    confidence: number,
    pageCount: number,
    processingTime: number
  ): Promise<void> {
    try {
      const documentHash = this.generateDocumentHash(fileBuffer, contentType);
      const cacheKey = `${this.cachePrefix}${documentHash}.json`;

      const cachedDocument: CachedDocument = {
        documentHash,
        extractedText,
        confidence,
        pageCount,
        processingTime,
        cachedAt: new Date().toISOString(),
        contentType,
        fileSizeBytes: fileBuffer.length
      };

      await this.s3Client.send(new PutObjectCommand({
        Bucket: this.cacheBucket,
        Key: cacheKey,
        Body: JSON.stringify(cachedDocument),
        ContentType: 'application/json',
        Metadata: {
          documentHash,
          contentType,
          fileSizeBytes: fileBuffer.length.toString(),
          cachedAt: cachedDocument.cachedAt
        }
      }));

      this.cacheStats.totalCachedDocuments++;
      
      console.log('Document cached successfully', { 
        documentHash, 
        textLength: extractedText.length,
        processingTime: `${processingTime}ms`
      });

    } catch (error) {
      console.error('Error caching document:', error);
      // Don't throw error - caching failure shouldn't break processing
    }
  }

  /**
   * Checks if caching is beneficial for a document
   */
  static shouldCacheDocument(
    contentType: string,
    fileSizeBytes: number,
    processingTime: number
  ): boolean {
    // Don't cache very small documents (< 1KB) or very large ones (> 50MB)
    if (fileSizeBytes < 1024 || fileSizeBytes > 50 * 1024 * 1024) {
      return false;
    }

    // Don't cache documents that process very quickly (< 1 second)
    if (processingTime < 1000) {
      return false;
    }

    // Cache PDFs and images that take time to process
    const cachableTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/tiff',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];

    return cachableTypes.includes(contentType);
  }

  /**
   * Gets cache statistics
   */
  getCacheStats(): CacheStats {
    return { ...this.cacheStats };
  }

  /**
   * Updates hit rate calculation
   */
  private updateHitRate(): void {
    const totalRequests = this.cacheStats.hitCount + this.cacheStats.missCount;
    this.cacheStats.hitRate = totalRequests > 0 
      ? (this.cacheStats.hitCount / totalRequests) * 100 
      : 0;
  }

  /**
   * Clears expired cache entries (should be run periodically)
   */
  async clearExpiredCache(): Promise<number> {
    // This would be implemented as a separate Lambda function
    // that runs periodically to clean up old cache entries
    console.log('Cache cleanup not implemented yet');
    return 0;
  }

  /**
   * Estimates cache storage usage
   */
  async estimateCacheSize(): Promise<{ totalObjects: number; estimatedSizeBytes: number }> {
    // This would query S3 to get cache bucket statistics
    // For now, return placeholder values
    return {
      totalObjects: this.cacheStats.totalCachedDocuments,
      estimatedSizeBytes: 0
    };
  }
}