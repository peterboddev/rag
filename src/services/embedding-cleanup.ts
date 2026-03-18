import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { BedrockAgentRuntimeClient } from '@aws-sdk/client-bedrock-agent-runtime';
import { Client as OpenSearchClient } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { DocumentRecord, CleanupJobInfo } from '../types';
import { randomUUID } from 'crypto';
import {
  CleanupError,
  ServiceUnavailableError,
  retryWithBackoff,
  structuredLog,
} from './chunking-errors';

export interface CleanupResult {
  success: boolean;
  embeddingsRemoved: number;
  documentsQueued: number;
  errors: string[];
  duration: number;
  jobId: string;
  cancelled?: boolean;
  timedOut?: boolean;
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

export interface CleanupOptions {
  timeoutMs?: number;
  onProgress?: (progress: CleanupProgress) => void;
}

export interface CleanupProgress {
  jobId: string;
  phase: 'identifying' | 'removing_kb' | 'removing_vectordb' | 'clearing_refs' | 'reprocessing' | 'completed' | 'failed';
  percentage: number;
  embeddingsProcessed: number;
  embeddingsTotal: number;
  documentsProcessed: number;
  documentsTotal: number;
  elapsedMs: number;
}

const DEFAULT_CLEANUP_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Tracks progress for a cleanup operation and supports querying current state.
 * Requirement 8.5: real-time progress updates.
 */
export class CleanupProgressTracker {
  private _progress: CleanupProgress;
  private _onProgress?: (progress: CleanupProgress) => void;
  private _startTime: number;

  constructor(jobId: string, onProgress?: (progress: CleanupProgress) => void) {
    this._startTime = Date.now();
    this._onProgress = onProgress;
    this._progress = {
      jobId,
      phase: 'identifying',
      percentage: 0,
      embeddingsProcessed: 0,
      embeddingsTotal: 0,
      documentsProcessed: 0,
      documentsTotal: 0,
      elapsedMs: 0,
    };
  }

  get progress(): CleanupProgress {
    return { ...this._progress, elapsedMs: Date.now() - this._startTime };
  }

  update(partial: Partial<Omit<CleanupProgress, 'jobId' | 'elapsedMs'>>): void {
    Object.assign(this._progress, partial);
    this._progress.elapsedMs = Date.now() - this._startTime;
    this._onProgress?.({ ...this._progress });
  }
}

interface QueuedCleanupItem {
  customerUUID: string;
  tenantId: string;
  options?: CleanupOptions;
  resolve: (result: CleanupResult) => void;
  reject: (error: Error) => void;
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

  // Cleanup queue: 1 concurrent cleanup per service instance (Req 8.2)
  private _cleanupQueue: QueuedCleanupItem[] = [];
  private _isProcessingQueue = false;
  // Cancellation flags keyed by jobId
  private _cancellationFlags: Map<string, boolean> = new Map();

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

  /** Expose queue length for testing / monitoring */
  get queueLength(): number {
    return this._cleanupQueue.length;
  }

  /**
   * Cancel a running cleanup operation by jobId.
   * The operation will stop at the next cancellation checkpoint.
   */
  cancelCleanup(jobId: string): boolean {
    if (this._cancellationFlags.has(jobId)) {
      this._cancellationFlags.set(jobId, true);
      structuredLog('info', 'Cleanup cancellation requested', { operation: 'cancelCleanup', jobId });
      return true;
    }
    return false;
  }

  /** Check whether a job has been cancelled */
  private isCancelled(jobId: string): boolean {
    return this._cancellationFlags.get(jobId) === true;
  }

  /**
   * Enqueue a cleanup operation. Only one cleanup runs at a time per service
   * instance to prevent resource conflicts (Req 8.2).
   * Returns a promise that resolves when the cleanup completes.
   */
  enqueueCleanup(customerUUID: string, tenantId: string, options?: CleanupOptions): Promise<CleanupResult> {
    return new Promise<CleanupResult>((resolve, reject) => {
      this._cleanupQueue.push({ customerUUID, tenantId, options, resolve, reject });
      structuredLog('info', 'Cleanup enqueued', {
        operation: 'enqueueCleanup',
        customerUUID,
        queueLength: this._cleanupQueue.length,
      });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this._isProcessingQueue) return;
    this._isProcessingQueue = true;

    while (this._cleanupQueue.length > 0) {
      const item = this._cleanupQueue.shift()!;
      try {
        const result = await this.cleanupCustomerEmbeddings(item.customerUUID, item.tenantId, item.options);
        item.resolve(result);
      } catch (error) {
        item.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }

    this._isProcessingQueue = false;
  }

  /**
   * Clean up all embeddings for a customer.
   * Supports timeout (default 5 min), cancellation, and progress callbacks.
   * Req 8.1: batch processing, Req 8.3: non-blocking, Req 8.5: progress updates.
   */
  async cleanupCustomerEmbeddings(
    customerUUID: string,
    tenantId: string,
    options?: CleanupOptions,
  ): Promise<CleanupResult> {
    const startTime = Date.now();
    const jobId = randomUUID();
    const errors: string[] = [];
    let embeddingsRemoved = 0;
    let documentsQueued = 0;
    const timeoutMs = options?.timeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS;

    // Register cancellation flag
    this._cancellationFlags.set(jobId, false);

    const tracker = new CleanupProgressTracker(jobId, options?.onProgress);

    const checkTimeout = (): boolean => Date.now() - startTime > timeoutMs;
    const checkCancelOrTimeout = (): { cancelled: boolean; timedOut: boolean } => ({
      cancelled: this.isCancelled(jobId),
      timedOut: checkTimeout(),
    });

    try {
      structuredLog('info', 'Starting embedding cleanup for customer', {
        operation: 'cleanupCustomerEmbeddings',
        customerUUID,
        tenantId,
        jobId,
        timeoutMs,
      });

      // Update cleanup status to in_progress
      await this.updateCustomerCleanupStatus(customerUUID, tenantId, 'in_progress', jobId);
      await this.updateCleanupJobProgress(customerUUID, tenantId, {
        jobId,
        status: 'in_progress',
        startedAt: new Date(startTime).toISOString(),
        progress: 0,
        embeddingsToRemove: 0,
        embeddingsRemoved: 0,
        errors: [],
      });

      // Check vector database configuration
      const vectorDbStatus = await this.checkVectorDatabaseStatus();
      if (!vectorDbStatus.isConfigured) {
        errors.push(`Vector database not configured: ${vectorDbStatus.issue}`);
      }

      // --- Cancellation / timeout checkpoint ---
      const c1 = checkCancelOrTimeout();
      if (c1.cancelled || c1.timedOut) {
        return this.buildAbortedResult({ jobId, startTime, embeddingsRemoved, documentsQueued, errors, ...c1 });
      }

      // Get all documents for the customer
      tracker.update({ phase: 'identifying', percentage: 5 });
      const customerDocuments = await this.getCustomerDocuments(customerUUID, tenantId);

      // Analyze document embedding status
      const embeddingAnalysis = this.analyzeDocumentEmbeddings(customerDocuments);
      tracker.update({ documentsTotal: customerDocuments.length });

      // Identify embeddings to remove
      const embeddingIds = await this.identifyCustomerEmbeddings(customerDocuments);
      tracker.update({ embeddingsTotal: embeddingIds.length, percentage: 10 });

      await this.updateCleanupJobProgress(customerUUID, tenantId, {
        jobId,
        status: 'in_progress',
        startedAt: new Date(startTime).toISOString(),
        progress: 10,
        embeddingsToRemove: embeddingIds.length,
        embeddingsRemoved: 0,
        errors: [],
      });

      if (embeddingIds.length > 0) {
        // --- Remove from Knowledge Base ---
        const c2 = checkCancelOrTimeout();
        if (c2.cancelled || c2.timedOut) {
          return this.buildAbortedResult({ jobId, startTime, embeddingsRemoved, documentsQueued, errors, ...c2 });
        }

        tracker.update({ phase: 'removing_kb', percentage: 15 });
        try {
          await retryWithBackoff(
            () => this.removeEmbeddingsFromKnowledgeBase(embeddingIds),
            { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 5000 },
          );
        } catch (error) {
          errors.push(`Failed to remove embeddings from Knowledge Base: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        // --- Remove from Vector DB ---
        const c3 = checkCancelOrTimeout();
        if (c3.cancelled || c3.timedOut) {
          return this.buildAbortedResult({ jobId, startTime, embeddingsRemoved, documentsQueued, errors, ...c3 });
        }

        tracker.update({ phase: 'removing_vectordb', percentage: 40 });
        try {
          await retryWithBackoff(
            () => this.removeEmbeddingsFromVectorDB(embeddingIds),
            { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 5000 },
          );
          embeddingsRemoved = embeddingIds.length;
          tracker.update({ embeddingsProcessed: embeddingsRemoved, percentage: 60 });
        } catch (error) {
          errors.push(`Failed to remove embeddings from Vector DB: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }

        // --- Clear document embedding references ---
        const c4 = checkCancelOrTimeout();
        if (c4.cancelled || c4.timedOut) {
          return this.buildAbortedResult({ jobId, startTime, embeddingsRemoved, documentsQueued, errors, ...c4 });
        }

        tracker.update({ phase: 'clearing_refs', percentage: 70 });
        await this.clearDocumentEmbeddingReferences(customerDocuments);
      }

      // --- Trigger document re-processing ---
      const c5 = checkCancelOrTimeout();
      if (c5.cancelled || c5.timedOut) {
        return this.buildAbortedResult({ jobId, startTime, embeddingsRemoved, documentsQueued, errors, ...c5 });
      }

      tracker.update({ phase: 'reprocessing', percentage: 80 });
      try {
        documentsQueued = await this.triggerDocumentReprocessing(customerUUID, tenantId, customerDocuments);
        tracker.update({ documentsProcessed: documentsQueued, percentage: 95 });
      } catch (error) {
        errors.push(`Failed to queue documents for reprocessing: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }

      // Update cleanup status
      const finalStatus = errors.length === 0 ? 'completed' : 'failed';
      await this.updateCustomerCleanupStatus(customerUUID, tenantId, finalStatus, jobId);
      tracker.update({ phase: errors.length === 0 ? 'completed' : 'failed', percentage: 100 });

      await this.updateCleanupJobProgress(customerUUID, tenantId, {
        jobId,
        status: finalStatus,
        startedAt: new Date(startTime).toISOString(),
        progress: 100,
        embeddingsToRemove: embeddingIds?.length ?? 0,
        embeddingsRemoved,
        errors,
      });

      const duration = Date.now() - startTime;
      this._cancellationFlags.delete(jobId);

      return {
        success: errors.length === 0,
        embeddingsRemoved,
        documentsQueued,
        errors,
        duration,
        jobId,
        diagnostics: {
          vectorDbConfigured: vectorDbStatus.isConfigured,
          vectorDbIssue: vectorDbStatus.issue,
          ...embeddingAnalysis,
        },
      };
    } catch (error) {
      console.error('Critical error during embedding cleanup:', error);

      try {
        await this.updateCustomerCleanupStatus(customerUUID, tenantId, 'failed', jobId);
      } catch (_) { /* best-effort */ }

      this._cancellationFlags.delete(jobId);
      tracker.update({ phase: 'failed', percentage: 100 });

      return {
        success: false,
        embeddingsRemoved,
        documentsQueued,
        errors: [error instanceof Error ? error.message : 'Unknown critical error'],
        duration: Date.now() - startTime,
        jobId,
        diagnostics: {
          vectorDbConfigured: false,
          vectorDbIssue: 'Critical error occurred before diagnostics could run',
          totalDocuments: 0,
          documentsWithEmbeddings: 0,
          documentsWithFailedEmbeddings: 0,
          documentsWithoutEmbeddings: 0,
          totalEmbeddingIds: 0,
        },
      };
    }
  }

  /**
   * Build a result for an aborted (cancelled / timed-out) cleanup.
   */
  private buildAbortedResult(ctx: {
    jobId: string;
    startTime: number;
    embeddingsRemoved: number;
    documentsQueued: number;
    errors: string[];
    cancelled: boolean;
    timedOut: boolean;
  }): CleanupResult {
    const reason = ctx.cancelled ? 'Cleanup was cancelled' : 'Cleanup timed out';
    this._cancellationFlags.delete(ctx.jobId);
    return {
      success: false,
      embeddingsRemoved: ctx.embeddingsRemoved,
      documentsQueued: ctx.documentsQueued,
      errors: [...ctx.errors, reason],
      duration: Date.now() - ctx.startTime,
      jobId: ctx.jobId,
      cancelled: ctx.cancelled,
      timedOut: ctx.timedOut,
    };
  }

  /**
   * Persist cleanup job progress to the customer record's currentCleanupJob field.
   * Requirement 8.5: real-time progress updates.
   */
  private async updateCleanupJobProgress(
    customerUUID: string,
    tenantId: string,
    job: CleanupJobInfo,
  ): Promise<void> {
    try {
      await this.dynamoClient.send(new UpdateCommand({
        TableName: this.customersTable,
        Key: { uuid: customerUUID },
        UpdateExpression: 'SET currentCleanupJob = :job, updatedAt = :now',
        ExpressionAttributeValues: {
          ':job': job,
          ':now': new Date().toISOString(),
          ':tenantId': tenantId,
        },
        ExpressionAttributeNames: {
          '#uuid': 'uuid',
          '#tenantId': 'tenantId',
        },
        ConditionExpression: 'attribute_exists(#uuid) AND #tenantId = :tenantId',
      }));
    } catch (error) {
      // Best-effort — don't fail the cleanup because of a progress write failure
      structuredLog('warn', 'Failed to update cleanup job progress', {
        operation: 'updateCleanupJobProgress',
        customerUUID,
        jobId: job.jobId,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
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
        id: doc.documentId,
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
        console.log(`Document ${document.documentId} has ${document.embeddingIds.length} embeddings:`, document.embeddingIds);
        embeddingIds.push(...document.embeddingIds);
      } else {
        console.log(`Document ${document.documentId} has no embeddings - embeddingIds:`, document.embeddingIds);
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
            documentId: document.documentId,
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

  /**
   * Resume a previously failed or interrupted cleanup operation.
   * Requirement 7.4: provide options to resume or rollback.
   */
  async resumeCleanup(customerUUID: string, tenantId: string): Promise<CleanupResult> {
    const logCtx = { customerUUID, tenantId, operation: 'resumeCleanup' };
    structuredLog('info', 'Resuming cleanup for customer', logCtx);

    // Find documents that still have embedding references (incomplete cleanup)
    const documents = await this.getCustomerDocuments(customerUUID, tenantId);
    const documentsWithEmbeddings = documents.filter(
      d => d.embeddingIds && d.embeddingIds.length > 0
    );

    if (documentsWithEmbeddings.length === 0) {
      structuredLog('info', 'No remaining embeddings to clean up — cleanup already complete', logCtx);
      return {
        success: true,
        embeddingsRemoved: 0,
        documentsQueued: 0,
        errors: [],
        duration: 0,
        jobId: randomUUID(),
      };
    }

    structuredLog('info', 'Found documents with remaining embeddings', {
      ...logCtx,
      count: documentsWithEmbeddings.length,
    });

    // Re-run the full cleanup which will pick up remaining embeddings
    return this.cleanupCustomerEmbeddings(customerUUID, tenantId);
  }
}