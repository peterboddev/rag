import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DocumentRecord, ChunkingMethod } from '../types';
import { randomUUID } from 'crypto';

export interface EmbeddingResult {
  success: boolean;
  embeddingIds: string[];
  chunksProcessed: number;
  errors: string[];
  duration: number;
}

export interface TextChunk {
  id: string;
  text: string;
  metadata: {
    documentId: string;
    customerUUID: string;
    tenantId: string;
    chunkIndex: number;
    totalChunks: number;
    chunkingMethod: string;
  };
}

export class EmbeddingGenerationService {
  private bedrockClient: BedrockRuntimeClient;
  private opensearchClient: OpenSearchClient;
  private dynamoClient: DynamoDBDocumentClient;
  private documentsTable: string;

  constructor() {
    const region = process.env.BEDROCK_REGION || process.env.REGION || 'us-east-1';
    const vectorDbEndpoint = process.env.VECTOR_DB_ENDPOINT;
    
    if (!region) {
      throw new Error('AWS region is required but not provided in environment variables');
    }
    
    if (!vectorDbEndpoint) {
      throw new Error('VECTOR_DB_ENDPOINT is required but not provided in environment variables');
    }

    console.log('Initializing EmbeddingGenerationService', { 
      region, 
      vectorDbEndpoint: vectorDbEndpoint.substring(0, 50) + '...' 
    });

    this.bedrockClient = new BedrockRuntimeClient({ 
      region: region
    });
    
    try {
      this.opensearchClient = new OpenSearchClient({
        ...AwsSigv4Signer({
          region: region,
          service: 'aoss',
        }),
        node: vectorDbEndpoint,
      });
    } catch (opensearchError) {
      console.error('Failed to initialize OpenSearch client:', opensearchError);
      throw new Error(`Failed to initialize OpenSearch client: ${opensearchError instanceof Error ? opensearchError.message : 'Unknown error'}`);
    }

    this.dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ 
      region: region
    }));
    
    this.documentsTable = process.env.DOCUMENTS_TABLE_NAME!;
    
    if (!this.documentsTable) {
      throw new Error('DOCUMENTS_TABLE_NAME is required but not provided in environment variables');
    }

    console.log('EmbeddingGenerationService initialized successfully');
  }

  /**
   * Generate embeddings for a document using the specified chunking method
   */
  async generateDocumentEmbeddings(
    document: DocumentRecord,
    chunkingMethod: ChunkingMethod
  ): Promise<EmbeddingResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let embeddingIds: string[] = [];
    let chunksProcessed = 0;

    try {
      console.log('Starting embedding generation', {
        documentId: document.id,
        customerUUID: document.customerUuid,
        chunkingMethod: chunkingMethod.id,
        textLength: document.extractedText?.length || 0
      });

      // Update document status to indicate embedding generation in progress
      await this.updateDocumentEmbeddingStatus(
        document.id, 
        document.customerUuid, 
        'pending'
      );

      if (!document.extractedText) {
        throw new Error('Document has no extracted text');
      }

      // Step 1: Chunk the document text
      const chunks = await this.chunkText(document.extractedText, document, chunkingMethod);
      console.log(`Created ${chunks.length} chunks for document`, {
        documentId: document.id,
        chunkingMethod: chunkingMethod.id
      });

      // Step 2: Generate embeddings for each chunk
      const embeddingResults = await this.generateEmbeddingsForChunks(chunks);
      embeddingIds = embeddingResults.embeddingIds;
      chunksProcessed = embeddingResults.chunksProcessed;
      errors.push(...embeddingResults.errors);

      // Step 3: Store embeddings in vector database
      if (embeddingIds.length > 0) {
        await this.storeEmbeddingsInVectorDB(chunks, embeddingResults.embeddings);
        console.log('Successfully stored embeddings in vector database', {
          documentId: document.id,
          embeddingCount: embeddingIds.length
        });
      }

      // Step 4: Update document record with embedding IDs
      const finalStatus = errors.length === 0 ? 'completed' : 'failed';
      await this.updateDocumentWithEmbeddings(
        document.id,
        document.customerUuid,
        embeddingIds,
        finalStatus,
        chunkingMethod
      );

      const duration = Date.now() - startTime;
      const result: EmbeddingResult = {
        success: errors.length === 0,
        embeddingIds,
        chunksProcessed,
        errors,
        duration
      };

      console.log('Embedding generation completed', {
        documentId: document.id,
        success: result.success,
        embeddingCount: result.embeddingIds.length,
        chunksProcessed: result.chunksProcessed,
        errorCount: result.errors.length,
        duration: `${result.duration}ms`
      });

      return result;

    } catch (error) {
      console.error('Critical error during embedding generation:', error);
      
      // Update status to failed
      try {
        await this.updateDocumentEmbeddingStatus(
          document.id, 
          document.customerUuid, 
          'failed'
        );
      } catch (statusError) {
        console.error('Failed to update embedding status after error:', statusError);
      }

      const duration = Date.now() - startTime;
      return {
        success: false,
        embeddingIds,
        chunksProcessed,
        errors: [error instanceof Error ? error.message : 'Unknown critical error'],
        duration
      };
    }
  }

  /**
   * Chunk text based on the specified chunking method
   */
  private async chunkText(
    text: string, 
    document: DocumentRecord, 
    chunkingMethod: ChunkingMethod
  ): Promise<TextChunk[]> {
    const chunks: TextChunk[] = [];
    const { parameters } = chunkingMethod;

    switch (parameters.strategy) {
      case 'fixed_size':
        return this.chunkByFixedSize(text, document, chunkingMethod);
      
      case 'semantic':
        return this.chunkBySemantic(text, document, chunkingMethod);
      
      case 'hierarchical':
        return this.chunkByHierarchical(text, document, chunkingMethod);
      
      case 'default':
      default:
        return this.chunkByDefault(text, document, chunkingMethod);
    }
  }

  /**
   * Fixed size chunking strategy
   */
  private chunkByFixedSize(
    text: string, 
    document: DocumentRecord, 
    chunkingMethod: ChunkingMethod
  ): TextChunk[] {
    const chunks: TextChunk[] = [];
    const { chunkSize = 1024, chunkOverlap = 0 } = chunkingMethod.parameters;
    
    let startIndex = 0;
    let chunkIndex = 0;

    while (startIndex < text.length) {
      const endIndex = Math.min(startIndex + chunkSize, text.length);
      const chunkText = text.slice(startIndex, endIndex);
      
      if (chunkText.trim().length > 0) {
        chunks.push({
          id: randomUUID(),
          text: chunkText.trim(),
          metadata: {
            documentId: document.id,
            customerUUID: document.customerUuid,
            tenantId: document.tenantId,
            chunkIndex,
            totalChunks: 0, // Will be updated after all chunks are created
            chunkingMethod: chunkingMethod.id
          }
        });
        chunkIndex++;
      }

      startIndex = endIndex - chunkOverlap;
    }

    // Update total chunks count
    chunks.forEach(chunk => {
      chunk.metadata.totalChunks = chunks.length;
    });

    return chunks;
  }

  /**
   * Default chunking strategy (simple paragraph-based)
   */
  private chunkByDefault(
    text: string, 
    document: DocumentRecord, 
    chunkingMethod: ChunkingMethod
  ): TextChunk[] {
    const chunks: TextChunk[] = [];
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    
    paragraphs.forEach((paragraph, index) => {
      if (paragraph.trim().length > 0) {
        chunks.push({
          id: randomUUID(),
          text: paragraph.trim(),
          metadata: {
            documentId: document.id,
            customerUUID: document.customerUuid,
            tenantId: document.tenantId,
            chunkIndex: index,
            totalChunks: paragraphs.length,
            chunkingMethod: chunkingMethod.id
          }
        });
      }
    });

    return chunks;
  }

  /**
   * Semantic chunking strategy (simplified implementation)
   */
  private chunkBySemantic(
    text: string, 
    document: DocumentRecord, 
    chunkingMethod: ChunkingMethod
  ): TextChunk[] {
    // For now, use sentence-based chunking as a semantic approximation
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const chunks: TextChunk[] = [];
    const { maxTokens = 500 } = chunkingMethod.parameters;
    
    let currentChunk = '';
    let chunkIndex = 0;

    for (const sentence of sentences) {
      const trimmedSentence = sentence.trim();
      if (trimmedSentence.length === 0) continue;

      // Rough token estimation (4 characters per token)
      const estimatedTokens = (currentChunk + trimmedSentence).length / 4;
      
      if (estimatedTokens > maxTokens && currentChunk.length > 0) {
        // Save current chunk and start new one
        chunks.push({
          id: randomUUID(),
          text: currentChunk.trim(),
          metadata: {
            documentId: document.id,
            customerUUID: document.customerUuid,
            tenantId: document.tenantId,
            chunkIndex,
            totalChunks: 0, // Will be updated later
            chunkingMethod: chunkingMethod.id
          }
        });
        chunkIndex++;
        currentChunk = trimmedSentence;
      } else {
        currentChunk += (currentChunk ? ' ' : '') + trimmedSentence;
      }
    }

    // Add final chunk
    if (currentChunk.trim().length > 0) {
      chunks.push({
        id: randomUUID(),
        text: currentChunk.trim(),
        metadata: {
          documentId: document.id,
          customerUUID: document.customerUuid,
          tenantId: document.tenantId,
          chunkIndex,
          totalChunks: 0,
          chunkingMethod: chunkingMethod.id
        }
      });
    }

    // Update total chunks count
    chunks.forEach(chunk => {
      chunk.metadata.totalChunks = chunks.length;
    });

    return chunks;
  }

  /**
   * Hierarchical chunking strategy (simplified implementation)
   */
  private chunkByHierarchical(
    text: string, 
    document: DocumentRecord, 
    chunkingMethod: ChunkingMethod
  ): TextChunk[] {
    // For now, use paragraph-based chunking with size limits
    return this.chunkBySemantic(text, document, chunkingMethod);
  }

  /**
   * Generate embeddings for text chunks using Bedrock
   */
  private async generateEmbeddingsForChunks(chunks: TextChunk[]): Promise<{
    embeddingIds: string[];
    embeddings: number[][];
    chunksProcessed: number;
    errors: string[];
  }> {
    const embeddingIds: string[] = [];
    const embeddings: number[][] = [];
    const errors: string[] = [];
    let chunksProcessed = 0;

    console.log(`Generating embeddings for ${chunks.length} chunks`);

    for (const chunk of chunks) {
      try {
        const embedding = await this.generateSingleEmbedding(chunk.text);
        embeddingIds.push(chunk.id);
        embeddings.push(embedding);
        chunksProcessed++;

        // Rate limiting - small delay between requests
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        const errorMsg = `Failed to generate embedding for chunk ${chunk.id}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error(errorMsg);
        errors.push(errorMsg);
      }
    }

    console.log(`Generated ${embeddingIds.length} embeddings successfully, ${errors.length} errors`);

    return {
      embeddingIds,
      embeddings,
      chunksProcessed,
      errors
    };
  }

  /**
   * Generate a single embedding using Bedrock Titan Embed model
   */
  private async generateSingleEmbedding(text: string): Promise<number[]> {
    try {
      // Limit text length for embedding model (Titan Embed has limits)
      const truncatedText = text.length > 8000 ? text.substring(0, 8000) : text;

      const response = await this.bedrockClient.send(new InvokeModelCommand({
        modelId: 'amazon.titan-embed-text-v1',
        body: JSON.stringify({
          inputText: truncatedText
        })
      }));

      const responseBody = JSON.parse(response.body?.transformToString() || '{}');
      
      if (!responseBody.embedding || !Array.isArray(responseBody.embedding)) {
        throw new Error('Invalid embedding response from Bedrock');
      }

      return responseBody.embedding;

    } catch (error) {
      console.error('Error generating single embedding:', error);
      throw error;
    }
  }

  /**
   * Store embeddings in OpenSearch vector database
   */
  private async storeEmbeddingsInVectorDB(chunks: TextChunk[], embeddings: number[][]): Promise<void> {
    try {
      console.log(`Storing ${chunks.length} embeddings in vector database`);

      // Process in batches to avoid overwhelming the vector DB
      const batchSize = 10;
      for (let i = 0; i < chunks.length; i += batchSize) {
        const chunkBatch = chunks.slice(i, i + batchSize);
        const embeddingBatch = embeddings.slice(i, i + batchSize);

        const bulkBody = chunkBatch.flatMap((chunk, index) => [
          { index: { _index: 'documents', _id: chunk.id } },
          {
            text: chunk.text,
            embedding: embeddingBatch[index],
            metadata: chunk.metadata,
            timestamp: new Date().toISOString()
          }
        ]);

        if (bulkBody.length > 0) {
          const response = await this.opensearchClient.bulk({
            body: bulkBody
          });

          if (response.body.errors) {
            console.warn('Some embeddings failed to store in vector DB', {
              batchNumber: Math.floor(i / batchSize) + 1,
              errors: response.body.items.filter((item: any) => item.index?.error)
            });
          }
        }

        // Rate limiting between batches
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      console.log('Successfully stored all embeddings in vector database');

    } catch (error) {
      console.error('Error storing embeddings in vector database:', error);
      throw error;
    }
  }

  /**
   * Update document record with embedding information
   */
  private async updateDocumentWithEmbeddings(
    documentId: string,
    customerUUID: string,
    embeddingIds: string[],
    status: 'completed' | 'failed',
    chunkingMethod: ChunkingMethod
  ): Promise<void> {
    try {
      const timestamp = new Date().toISOString();

      await this.dynamoClient.send(new UpdateCommand({
        TableName: this.documentsTable,
        Key: {
          id: documentId,
          customerUuid: customerUUID,
        },
        UpdateExpression: 'SET embeddingIds = :embeddingIds, embeddingStatus = :status, lastEmbeddingUpdate = :timestamp, chunkingMethod = :chunkingMethod, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':embeddingIds': embeddingIds,
          ':status': status,
          ':timestamp': timestamp,
          ':chunkingMethod': chunkingMethod,
          ':updatedAt': timestamp,
        },
      }));

      console.log('Updated document with embedding information', {
        documentId,
        embeddingCount: embeddingIds.length,
        status,
        chunkingMethod: chunkingMethod.id
      });

    } catch (error) {
      console.error('Error updating document with embeddings:', error);
      throw error;
    }
  }

  /**
   * Update document embedding status
   */
  private async updateDocumentEmbeddingStatus(
    documentId: string,
    customerUUID: string,
    status: 'none' | 'pending' | 'completed' | 'failed'
  ): Promise<void> {
    try {
      const timestamp = new Date().toISOString();

      await this.dynamoClient.send(new UpdateCommand({
        TableName: this.documentsTable,
        Key: {
          id: documentId,
          customerUuid: customerUUID,
        },
        UpdateExpression: 'SET embeddingStatus = :status, updatedAt = :updatedAt',
        ExpressionAttributeValues: {
          ':status': status,
          ':updatedAt': timestamp,
        },
      }));

      console.log('Updated document embedding status', { documentId, status });

    } catch (error) {
      console.error('Error updating document embedding status:', error);
      throw error;
    }
  }
}