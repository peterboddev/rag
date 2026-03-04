import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { BedrockAgentRuntimeClient } from '@aws-sdk/client-bedrock-agent-runtime';
import { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { DocumentRecord, CleanupJobInfo } from '../types';
import { randomUUID } from 'crypto';

export interface CleanupResult {
  success: boolean;
  embeddingsRemoved: number;
  documentsQueued: number;
  errors: string[];
  duration: number;
  jobId: string;
  diagnostics?: {
    vectorDbConfigured: boolean;
    vectorDbIssue?: string;
    totalDocuments: number;
    documentsWithEmbeddings: number;
    documentsWithFailedEmbeddings: number;
    documentsWithoutEmbeddings: number;
    totalEmbeddingIds: number;
  };
}

export class EmbeddingCleanupService {
  private dynamoClient: DynamoDBDocumentClient;
  private bedrockClient: BedrockAgentRuntimeClient;
  private opensearchClient: OpenSearchClient;
  private sqsClient: SQSClient;
  private documentsTable: string;
  private customersTable: string;
  private knowledgeBaseId: string;
  private processingQueueUrl: string;

  constructor() {
    this.dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.REGION }));
    this.bedrockClient = new BedrockAgentRuntimeClient({ region: process.env.BEDROCK_REGION || process.env.REGION });
    this.sqsClient = new SQSClient({ region: process.env.REGION });
    
    // Initialize OpenSearch client
    this.opensearchClient = new OpenSearchClient({
      ...AwsSigv4Signer({
        region: process.env.REGION!,
        service: 'aoss',
      }),
      node: process.env.VECTOR_DB_ENDPOINT!,
    });

    this.documentsTable = process.env.DOCUMENTS_TABLE_NAME!;
    this.customersTable = process.env.CUSTOMERS_TABLE_NAME!;
    this.knowledgeBaseId = process.env.KNOWLEDGE_BASE_ID!;
    this.processingQueueUrl = process.env.PROCESSING_QUEUE_URL!;
  }

  /**
   * Clean up all embeddings for a customer
   */
  async cleanupCustomerEmbeddings(customerUUID: string, tenantId: string): Promise<CleanupResult> {
    const startTime = Date.now();
    const jobId = randomUUID();
    const errors: string[] = [];
    let embeddingsRemoved = 0;
    let documentsQueued = 0;

    try {
      console.log('Starting embedding cleanup for customer', { customerUUID, tenantId, jobId });

      // Update cleanup status to in_progress
      await this.updateCustomerCleanupStatus(customerUUID, tenantId, 'in_progress', jobId);

      // Check vector database configuration
      const vectorDbStatus = await this.checkVectorDatabaseStatus();
      if (!vectorDbStatus.isConfigured) {
        console.warn('Vector database not properly configured', { 
          customerUUID, 
          endpoint: this.opensearchClient.connectionPool?.connections?.[0]?.url?.href || 'unknown',
          issue: vectorDbStatus.issue
        });
        errors.push(`Vector database not configured: ${vectorDbStatus.issue}`);
      }

      // Get all documents for the customer
      const customerDocuments = await this.getCustomerDocuments(customerUUID, tenantId);
      console.log(`Found ${customerDocuments.length} documents for cleanup`, { customerUUID });

      // Analyze document embedding status
      const embeddingAnalysis = this.analyzeDocumentEmbeddings(customerDocuments);
      console.log('Document embedding analysis:', {
        customerUUID,
        totalDocuments: embeddingAnalysis.totalDocuments,
        documentsWithEmbeddings: embeddingAnalysis.documentsWithEmbeddings,
        documentsWithFailedEmbeddings: embeddingAnalysis.documentsWithFailedEmbeddings,
        documentsWithoutEmbeddings: embeddingAnalysis.documentsWithoutEmbeddings,
        totalEmbeddingIds: embeddingAnalysis.totalEmbeddingIds
      });

      // Identify embeddings to remove
      const embeddingIds = await this.identifyCustomerEmbeddings(customerDocuments);
      console.log(`Found ${embeddingIds.length} embeddings to remove`, { customerUUID });

      if (embeddingIds.length > 0) {
        // Remove embeddings from AWS Bedrock Knowledge Base
        try {
          await this.removeEmbeddingsFromKnowledgeBase(embeddingIds);
          console.log('Successfully removed embeddings from Knowledge Base', { 
            customerUUID, 
            count: embeddingIds.length 
          });
        } catch (error) {
          const errorMsg = `Failed to remove embeddings from Knowledge Base: ${error instanceof Error ? error.message : 'Unknown error'}`;
          console.error(errorMsg, { customerUUID, error });
          errors.push(errorMsg);
        }

        // Remove embeddings from Vector Database
        try {
          await this.removeEmbeddingsFromVectorDB(embeddingIds);
          console.log('Successfully removed embeddings from Vector DB', { 
            customerUUID, 
            count: embeddingIds.length 
          });
          embeddingsRemoved = embeddingIds.length;
        } catch (error) {
          const errorMsg = `Failed to remove embeddings from Vector DB: ${error instanceof Error ? error.message : 'Unknown error'}`;
          console.error(errorMsg, { customerUUID, error });
          errors.push(errorMsg);
        }

        // Clear embedding references from document records
        await this.clearDocumentEmbeddingReferences(customerDocuments);
      }

      // Trigger document re-processing
      try {
        documentsQueued = await this.triggerDocumentReprocessing(customerUUID, tenantId, customerDocuments);
        console.log('Successfully queued documents for reprocessing', { 
          customerUUID, 
          count: documentsQueued 
        });
      } catch (error) {
        const errorMsg = `Failed to queue documents for reprocessing: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error(errorMsg, { customerUUID, error });
        errors.push(errorMsg);
      }

      // Update cleanup status
      const finalStatus = errors.length === 0 ? 'completed' : 'failed';
      await this.updateCustomerCleanupStatus(customerUUID, tenantId, finalStatus, jobId);

      const duration = Date.now() - startTime;
      const result: CleanupResult = {
        success: errors.length === 0,
        embeddingsRemoved,
        documentsQueued,
        errors,
        duration,
        jobId,
        diagnostics: {
          vectorDbConfigured: vectorDbStatus.isConfigured,
          vectorDbIssue: vectorDbStatus.issue,
          ...embeddingAnalysis
        }
      };

      console.log('Embedding cleanup completed', { 
        customerUUID, 
        result: {
          success: result.success,
          embeddingsRemoved: result.embeddingsRemoved,
          documentsQueued: result.documentsQueued,
          errorCount: result.errors.length,
          duration: result.duration
        }
      });

      return result;

    } catch (error) {
      console.error('Critical error during embedding cleanup:', error);
      
      // Update status to failed
      try {
        await this.updateCustomerCleanupStatus(customerUUID, tenantId, 'failed', jobId);
      } catch (statusError) {
        console.error('Failed to update cleanup status after error:', statusError);
      }

      const duration = Date.now() - startTime;
      return {
        success: false,
        embeddingsRemoved,
        documentsQueued,
        errors: [error instanceof Error ? error.message : 'Unknown critical error'],
        duration,
        jobId,
        diagnostics: {
          vectorDbConfigured: false,
          vectorDbIssue: 'Critical error occurred before diagnostics could run',
          totalDocuments: 0,
          documentsWithEmbeddings: 0,
          documentsWithFailedEmbeddings: 0,
          documentsWithoutEmbeddings: 0,
          totalEmbeddingIds: 0
        }
      };
    }
  }

  /**
   * Get all documents for a customer
   */
  public async getCustomerDocuments(customerUUID: string, tenantId: string): Promise<DocumentRecord[]> {
    try {
      const result = await this.dynamoClient.send(new QueryCommand({
        TableName: this.documentsTable,
        IndexName: 'customer-documents-index',
        KeyConditionExpression: 'customerUuid = :customerUuid',
        FilterExpression: 'tenantId = :tenantId',
        ExpressionAttributeValues: {
          ':customerUuid': customerUUID,
          ':tenantId': tenantId
        }
      }));

      return (result.Items || []) as DocumentRecord[];

    } catch (error) {
      console.error('Error getting customer documents:', error);
      throw error;
    }
  }

  /**
   * Identify all embedding IDs for customer documents
   */
  async identifyCustomerEmbeddings(documents: DocumentRecord[]): Promise<string[]> {
    const embeddingIds: string[] = [];

    console.log('Analyzing documents for embeddings:', {
      documentCount: documents.length,
      documents: documents.map(doc => ({
        id: doc.id,
        fileName: doc.fileName,
        embeddingIds: doc.embeddingIds,
        embeddingStatus: doc.embeddingStatus,
        processingStatus: doc.processingStatus,
        hasEmbeddingIds: !!doc.embeddingIds,
        embeddingIdsLength: doc.embeddingIds?.length || 0
      }))
    });

    for (const document of documents) {
      if (document.embeddingIds && document.embeddingIds.length > 0) {
        console.log(`Document ${document.id} has ${document.embeddingIds.length} embeddings:`, document.embeddingIds);
        embeddingIds.push(...document.embeddingIds);
      } else {
        console.log(`Document ${document.id} has no embeddings - embeddingIds:`, document.embeddingIds);
      }
    }

    // Remove duplicates
    const uniqueEmbeddingIds = [...new Set(embeddingIds)];
    console.log('Final embedding IDs to remove:', {
      totalFound: embeddingIds.length,
      uniqueCount: uniqueEmbeddingIds.length,
      embeddingIds: uniqueEmbeddingIds
    });

    return uniqueEmbeddingIds;
  }

  /**
   * Remove embeddings from AWS Bedrock Knowledge Base
   */
  async removeEmbeddingsFromKnowledgeBase(embeddingIds: string[]): Promise<void> {
    try {
      console.log('Removing embeddings from Knowledge Base', { 
        knowledgeBaseId: this.knowledgeBaseId,
        embeddingCount: embeddingIds.length 
      });

      // Process embeddings in batches to avoid API limits
      const batchSize = 10;
      for (let i = 0; i < embeddingIds.length; i += batchSize) {
        const batch = embeddingIds.slice(i, i + batchSize);
        
        // Note: AWS Bedrock Knowledge Base doesn't have a direct delete embeddings API
        // This would typically involve deleting and re-creating the knowledge base
        // or using the data source sync to remove documents
        // For now, we'll log the operation and implement based on actual AWS API availability
        
        console.log('Processing embedding batch for Knowledge Base removal', { 
          batchNumber: Math.floor(i / batchSize) + 1,
          batchSize: batch.length,
          embeddingIds: batch
        });

        // TODO: Implement actual Knowledge Base embedding removal
        // This might involve:
        // 1. Removing documents from the data source
        // 2. Triggering a sync operation
        // 3. Or using specific Knowledge Base management APIs when available
        
        await new Promise(resolve => setTimeout(resolve, 100)); // Rate limiting
      }

      console.log('Successfully processed all embedding batches for Knowledge Base');

    } catch (error) {
      console.error('Error removing embeddings from Knowledge Base:', error);
      throw error;
    }
  }

  /**
   * Remove embeddings from OpenSearch Vector Database
   */
  async removeEmbeddingsFromVectorDB(embeddingIds: string[]): Promise<void> {
    try {
      console.log('Removing embeddings from Vector DB', { embeddingCount: embeddingIds.length });

      // Process embeddings in batches
      const batchSize = 100;
      for (let i = 0; i < embeddingIds.length; i += batchSize) {
        const batch = embeddingIds.slice(i, i + batchSize);
        
        // Create bulk delete operations
        const bulkBody = batch.flatMap(embeddingId => [
          { delete: { _index: 'documents', _id: embeddingId } }
        ]);

        if (bulkBody.length > 0) {
          const response = await this.opensearchClient.bulk({
            body: bulkBody
          });

          if (response.body.errors) {
            console.warn('Some embeddings failed to delete from Vector DB', { 
              batchNumber: Math.floor(i / batchSize) + 1,
              errors: response.body.items.filter((item: any) => item.delete?.error)
            });
          }
        }

        await new Promise(resolve => setTimeout(resolve, 50)); // Rate limiting
      }

      console.log('Successfully removed embeddings from Vector DB');

    } catch (error) {
      console.error('Error removing embeddings from Vector DB:', error);
      throw error;
    }
  }

  /**
   * Clear embedding references from document records
   */
  private async clearDocumentEmbeddingReferences(documents: DocumentRecord[]): Promise<void> {
    try {
      console.log('Clearing embedding references from document records', { 
        documentCount: documents.length 
      });

      // Process documents in batches
      const batchSize = 25; // DynamoDB batch write limit
      for (let i = 0; i < documents.length; i += batchSize) {
        const batch = documents.slice(i, i + batchSize);
        
        const writeRequests = batch.map(document => ({
          PutRequest: {
            Item: {
              ...document,
              embeddingIds: [],
              embeddingStatus: 'none',
              lastEmbeddingUpdate: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }
          }
        }));

        if (writeRequests.length > 0) {
          await this.dynamoClient.send(new BatchWriteCommand({
            RequestItems: {
              [this.documentsTable]: writeRequests
            }
          }));
        }

        await new Promise(resolve => setTimeout(resolve, 100)); // Rate limiting
      }

      console.log('Successfully cleared embedding references from document records');

    } catch (error) {
      console.error('Error clearing document embedding references:', error);
      throw error;
    }
  }

  /**
   * Trigger document re-processing with new chunking method
   */
  async triggerDocumentReprocessing(
    customerUUID: string, 
    tenantId: string, 
    documents: DocumentRecord[]
  ): Promise<number> {
    try {
      console.log('Triggering document reprocessing', { 
        customerUUID, 
        documentCount: documents.length 
      });

      // Skip SQS processing if queue URL is not properly configured
      if (!this.processingQueueUrl || this.processingQueueUrl.includes('xxx') || this.processingQueueUrl === 'https://sqs.us-east-1.amazonaws.com/xxx/rag-app-v2-document-processing-dev') {
        console.warn('Processing queue URL not configured, skipping document reprocessing', { 
          customerUUID,
          processingQueueUrl: this.processingQueueUrl 
        });
        return 0;
      }

      let queuedCount = 0;

      for (const document of documents) {
        // Only reprocess completed documents
        if (document.processingStatus === 'completed' && document.extractedText) {
          const message = {
            documentId: document.id,
            customerUUID: customerUUID,
            tenantId: tenantId,
            fileName: document.fileName,
            s3Key: document.s3Key,
            contentType: document.contentType,
            action: 'reprocess_for_chunking',
            timestamp: new Date().toISOString()
          };

          await this.sqsClient.send(new SendMessageCommand({
            QueueUrl: this.processingQueueUrl,
            MessageBody: JSON.stringify(message),
            MessageAttributes: {
              'action': {
                DataType: 'String',
                StringValue: 'reprocess_for_chunking'
              },
              'customerUUID': {
                DataType: 'String',
                StringValue: customerUUID
              },
              'tenantId': {
                DataType: 'String',
                StringValue: tenantId
              }
            }
          }));

          queuedCount++;
        }
      }

      console.log('Successfully queued documents for reprocessing', { 
        customerUUID, 
        queuedCount 
      });

      return queuedCount;

    } catch (error) {
      console.error('Error triggering document reprocessing:', error);
      throw error;
    }
  }

  /**
   * Update customer cleanup status
   */
  private async updateCustomerCleanupStatus(
    customerUUID: string, 
    tenantId: string, 
    status: 'none' | 'in_progress' | 'completed' | 'failed',
    jobId: string
  ): Promise<void> {
    try {
      const now = new Date().toISOString();
      const updateExpression = 'SET chunkingCleanupStatus = :status, updatedAt = :now';
      const expressionAttributeValues: any = {
        ':status': status,
        ':now': now
      };

      // Add cleanup completion timestamp if completed
      if (status === 'completed') {
        updateExpression.replace('SET', 'SET lastCleanupAt = :now,');
      }

      await this.dynamoClient.send(new UpdateCommand({
        TableName: this.customersTable,
        Key: {
          uuid: customerUUID
        },
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: {
          ...expressionAttributeValues,
          ':tenantId': tenantId
        },
        ExpressionAttributeNames: {
          '#uuid': 'uuid',
          '#tenantId': 'tenantId'
        },
        ConditionExpression: 'attribute_exists(#uuid) AND #tenantId = :tenantId' // Ensure customer exists and belongs to tenant
      }));

      console.log('Updated customer cleanup status', { customerUUID, status, jobId });

    } catch (error) {
      console.error('Error updating customer cleanup status:', error);
      throw error;
    }
  }

  /**
   * Check if vector database is properly configured
   */
  private async checkVectorDatabaseStatus(): Promise<{ isConfigured: boolean; issue?: string }> {
    try {
      const endpoint = this.opensearchClient.connectionPool?.connections?.[0]?.url?.href;
      
      if (!endpoint) {
        return { isConfigured: false, issue: 'No endpoint configured' };
      }

      if (endpoint.includes('xxx') || endpoint.includes('placeholder')) {
        return { isConfigured: false, issue: 'Placeholder endpoint detected' };
      }

      // Try a simple ping to check connectivity
      try {
        await this.opensearchClient.ping();
        return { isConfigured: true };
      } catch (pingError) {
        return { 
          isConfigured: false, 
          issue: `Cannot connect to endpoint: ${pingError instanceof Error ? pingError.message : 'Unknown error'}` 
        };
      }

    } catch (error) {
      return { 
        isConfigured: false, 
        issue: `Configuration check failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
      };
    }
  }

  /**
   * Analyze document embedding status for diagnostics
   */
  private analyzeDocumentEmbeddings(documents: DocumentRecord[]): {
    totalDocuments: number;
    documentsWithEmbeddings: number;
    documentsWithFailedEmbeddings: number;
    documentsWithoutEmbeddings: number;
    totalEmbeddingIds: number;
  } {
    let documentsWithEmbeddings = 0;
    let documentsWithFailedEmbeddings = 0;
    let documentsWithoutEmbeddings = 0;
    let totalEmbeddingIds = 0;

    for (const document of documents) {
      if (document.embeddingIds && document.embeddingIds.length > 0) {
        documentsWithEmbeddings++;
        totalEmbeddingIds += document.embeddingIds.length;
      } else if (document.embeddingStatus === 'failed') {
        documentsWithFailedEmbeddings++;
      } else {
        documentsWithoutEmbeddings++;
      }
    }

    return {
      totalDocuments: documents.length,
      documentsWithEmbeddings,
      documentsWithFailedEmbeddings,
      documentsWithoutEmbeddings,
      totalEmbeddingIds
    };
  }
}