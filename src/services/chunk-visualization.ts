import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DocumentRecord, ChunkingMethod } from '../types';
import { ChunkingConfigurationService } from './chunking-configuration';

export interface DocumentChunk {
  id: string;
  text: string;
  metadata: ChunkMetadata;
  tokenCount: number;
  characterCount: number;
  sourceDocument: {
    documentId: string;
    fileName: string;
    pageNumber?: number;
    sectionTitle?: string;
  };
}

export interface ChunkMetadata {
  chunkIndex: number;
  totalChunks: number;
  chunkingMethod: string;
  overlapStart?: number;
  overlapEnd?: number;
  confidence?: number;
  semanticBoundary?: boolean;
}

export interface ChunkVisualizationError {
  documentId: string;
  fileName: string;
  errorMessage: string;
  errorType: 'chunking' | 'processing' | 'network' | 'validation' | 'access_denied';
  isRetryable: boolean;
  timestamp: string;
}

export interface ChunkVisualizationResult {
  chunks: DocumentChunk[];
  totalChunks: number;
  processingTime: number;
  errors: ChunkVisualizationError[];
  warnings: string[];
}

export class ChunkVisualizationService {
  private dynamoClient: DynamoDBDocumentClient;
  private documentsTable: string;
  private chunkingService: ChunkingConfigurationService;

  constructor() {
    this.dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.REGION }));
    this.documentsTable = process.env.DOCUMENTS_TABLE_NAME!;
    this.chunkingService = new ChunkingConfigurationService();
  }

  /**
   * Generate chunks for visualization without storing embeddings
   */
  async generateChunksForVisualization(
    documentIds: string[],
    customerUUID: string,
    tenantId: string,
    chunkingMethod?: ChunkingMethod
  ): Promise<ChunkVisualizationResult> {
    const startTime = Date.now();
    const chunks: DocumentChunk[] = [];
    const errors: ChunkVisualizationError[] = [];
    const warnings: string[] = [];

    try {
      console.log('Generating chunks for visualization', {
        documentIds: documentIds.length,
        customerUUID,
        chunkingMethod: chunkingMethod?.id || 'default'
      });

      // Get documents from database
      for (const documentId of documentIds) {
        try {
          const result = await this.dynamoClient.send(new QueryCommand({
            TableName: this.documentsTable,
            KeyConditionExpression: 'id = :documentId',
            ExpressionAttributeValues: {
              ':documentId': documentId
            }
          }));

          if (result.Items && result.Items.length > 0) {
            const document = result.Items[0] as DocumentRecord;
            
            // Verify access and processing status
            if (document.customerUuid === customerUUID && 
                document.tenantId === tenantId && 
                document.processingStatus === 'completed' && 
                document.extractedText) {
              
              // Generate chunks for this document
              const documentChunks = await this.generateDocumentChunks(document, chunkingMethod);
              chunks.push(...documentChunks);
            } else {
              errors.push({
                documentId,
                fileName: document.fileName || 'Unknown',
                errorMessage: 'Document not accessible or not processed',
                errorType: 'access_denied',
                isRetryable: false,
                timestamp: new Date().toISOString()
              });
            }
          } else {
            errors.push({
              documentId,
              fileName: 'Unknown',
              errorMessage: 'Document not found',
              errorType: 'validation',
              isRetryable: false,
              timestamp: new Date().toISOString()
            });
          }
        } catch (error) {
          console.error(`Error processing document ${documentId}:`, error);
          errors.push({
            documentId,
            fileName: 'Unknown',
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
            errorType: 'processing',
            isRetryable: true,
            timestamp: new Date().toISOString()
          });
        }
      }

      const processingTime = Date.now() - startTime;

      return {
        chunks,
        totalChunks: chunks.length,
        processingTime,
        errors,
        warnings
      };

    } catch (error) {
      console.error('Error in chunk visualization service:', error);
      
      return {
        chunks: [],
        totalChunks: 0,
        processingTime: Date.now() - startTime,
        errors: [{
          documentId: 'all',
          fileName: 'Multiple',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          errorType: 'processing',
          isRetryable: true,
          timestamp: new Date().toISOString()
        }],
        warnings: []
      };
    }
  }

  /**
   * Generate chunks for a single document
   */
  private async generateDocumentChunks(
    document: DocumentRecord,
    chunkingMethod?: ChunkingMethod
  ): Promise<DocumentChunk[]> {
    const chunks: DocumentChunk[] = [];
    const text = document.extractedText || '';
    
    if (!text.trim()) {
      return chunks;
    }

    // Use default chunking method if none provided
    const method = chunkingMethod || {
      id: 'fixed_size_512',
      name: 'Fixed Size (512 tokens)',
      description: 'Default chunking for visualization',
      parameters: { strategy: 'fixed_size', chunkSize: 512, chunkOverlap: 50 }
    };

    // Simple fixed-size chunking for visualization
    const chunkSize = method.parameters.chunkSize || 512;
    const overlap = method.parameters.chunkOverlap || 50;
    
    // Estimate tokens (rough approximation: 1 token ≈ 4 characters)
    const estimatedTokens = Math.ceil(text.length / 4);
    const chunkSizeChars = chunkSize * 4;
    const overlapChars = overlap * 4;
    
    let startIndex = 0;
    let chunkIndex = 0;
    
    while (startIndex < text.length) {
      const endIndex = Math.min(startIndex + chunkSizeChars, text.length);
      const chunkText = text.substring(startIndex, endIndex);
      
      if (chunkText.trim()) {
        chunks.push({
          id: `${document.id}-chunk-${chunkIndex}`,
          text: chunkText,
          metadata: {
            chunkIndex,
            totalChunks: Math.ceil(estimatedTokens / chunkSize),
            chunkingMethod: method.id,
            overlapStart: chunkIndex > 0 ? overlap : 0,
            overlapEnd: endIndex < text.length ? overlap : 0,
            confidence: 1.0,
            semanticBoundary: false
          },
          tokenCount: Math.ceil(chunkText.length / 4),
          characterCount: chunkText.length,
          sourceDocument: {
            documentId: document.id,
            fileName: document.fileName || 'Unknown',
            pageNumber: 1
          }
        });
      }
      
      // Move to next chunk with overlap
      startIndex = endIndex - overlapChars;
      chunkIndex++;
      
      // Prevent infinite loop
      if (startIndex >= endIndex) {
        break;
      }
    }

    return chunks;
  }
}