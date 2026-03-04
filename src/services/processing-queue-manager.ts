import { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

export interface ProcessingJob {
  documentId: string;
  customerUUID: string;
  tenantId: string;
  s3Bucket: string;
  s3Key: string;
  contentType: string;
  processingMode: 'sync' | 'async';
  priority: 'high' | 'normal' | 'low';
  retryCount: number;
  maxRetries: number;
  createdAt: string;
  scheduledAt?: string;
}

export interface ProcessingQueueStats {
  queuedJobs: number;
  processingJobs: number;
  completedJobs: number;
  failedJobs: number;
  averageProcessingTime: number;
}

export class ProcessingQueueManager {
  private sqsClient: SQSClient;
  private dynamoClient: DynamoDBDocumentClient;
  private queueUrl: string;
  private documentsTable: string;

  constructor(region: string, queueUrl: string, documentsTable: string) {
    this.sqsClient = new SQSClient({ region });
    this.dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
    this.queueUrl = queueUrl;
    this.documentsTable = documentsTable;
  }

  /**
   * Adds a processing job to the queue
   */
  async enqueueProcessingJob(job: ProcessingJob): Promise<void> {
    try {
      const messageBody = JSON.stringify(job);
      
      // Calculate delay for retry jobs
      let delaySeconds = 0;
      if (job.retryCount > 0) {
        // Exponential backoff: 30s, 2m, 5m, 15m
        const delays = [30, 120, 300, 900];
        delaySeconds = delays[Math.min(job.retryCount - 1, delays.length - 1)];
      }

      await this.sqsClient.send(new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: messageBody,
        DelaySeconds: delaySeconds,
        MessageAttributes: {
          documentId: {
            DataType: 'String',
            StringValue: job.documentId
          },
          processingMode: {
            DataType: 'String',
            StringValue: job.processingMode
          },
          priority: {
            DataType: 'String',
            StringValue: job.priority
          },
          retryCount: {
            DataType: 'Number',
            StringValue: job.retryCount.toString()
          }
        }
      }));

      console.log('Processing job enqueued', {
        documentId: job.documentId,
        processingMode: job.processingMode,
        priority: job.priority,
        retryCount: job.retryCount,
        delaySeconds
      });

    } catch (error) {
      console.error('Error enqueuing processing job:', error);
      throw error;
    }
  }

  /**
   * Processes jobs from the queue with concurrency control
   */
  async processQueuedJobs(maxConcurrency: number = 5): Promise<void> {
    const activeJobs: Promise<void>[] = [];

    while (activeJobs.length < maxConcurrency) {
      try {
        const messages = await this.sqsClient.send(new ReceiveMessageCommand({
          QueueUrl: this.queueUrl,
          MaxNumberOfMessages: Math.min(10, maxConcurrency - activeJobs.length),
          WaitTimeSeconds: 5, // Long polling
          MessageAttributeNames: ['All']
        }));

        if (!messages.Messages || messages.Messages.length === 0) {
          break; // No more messages
        }

        for (const message of messages.Messages) {
          const jobPromise = this.processQueueMessage(message);
          activeJobs.push(jobPromise);

          // Remove completed jobs from active list
          jobPromise.finally(() => {
            const index = activeJobs.indexOf(jobPromise);
            if (index > -1) {
              activeJobs.splice(index, 1);
            }
          });
        }

      } catch (error) {
        console.error('Error processing queue:', error);
        break;
      }
    }

    // Wait for all active jobs to complete
    await Promise.allSettled(activeJobs);
  }

  /**
   * Processes a single queue message
   */
  private async processQueueMessage(message: any): Promise<void> {
    try {
      const job: ProcessingJob = JSON.parse(message.Body);
      
      console.log('Processing queued job', {
        documentId: job.documentId,
        processingMode: job.processingMode,
        retryCount: job.retryCount
      });

      // Update document status to processing
      await this.updateDocumentStatus(job.documentId, job.customerUUID, 'processing');

      // Process the document (this would call the actual processing logic)
      // For now, we'll simulate processing
      await this.simulateDocumentProcessing(job);

      // Delete message from queue on success
      await this.sqsClient.send(new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: message.ReceiptHandle
      }));

      console.log('Queued job completed successfully', {
        documentId: job.documentId
      });

    } catch (error) {
      console.error('Error processing queued job:', error);
      
      // Handle retry logic
      const job: ProcessingJob = JSON.parse(message.Body);
      if (job.retryCount < job.maxRetries) {
        // Re-queue with increased retry count
        const retryJob = {
          ...job,
          retryCount: job.retryCount + 1,
          scheduledAt: new Date(Date.now() + this.calculateRetryDelay(job.retryCount + 1)).toISOString()
        };

        await this.enqueueProcessingJob(retryJob);
        
        // Delete original message
        await this.sqsClient.send(new DeleteMessageCommand({
          QueueUrl: this.queueUrl,
          ReceiptHandle: message.ReceiptHandle
        }));

      } else {
        // Max retries exceeded, mark as failed
        await this.updateDocumentStatus(job.documentId, job.customerUUID, 'failed');
        
        // Delete message from queue
        await this.sqsClient.send(new DeleteMessageCommand({
          QueueUrl: this.queueUrl,
          ReceiptHandle: message.ReceiptHandle
        }));
      }
    }
  }

  /**
   * Simulates document processing (placeholder for actual processing logic)
   */
  private async simulateDocumentProcessing(job: ProcessingJob): Promise<void> {
    // This would be replaced with actual document processing logic
    // For now, simulate processing time based on document size
    const processingTime = job.processingMode === 'sync' ? 1000 : 5000;
    await new Promise(resolve => setTimeout(resolve, processingTime));
    
    // Update document status to completed
    await this.updateDocumentStatus(job.documentId, job.customerUUID, 'completed');
  }

  /**
   * Updates document status in DynamoDB
   */
  private async updateDocumentStatus(
    documentId: string,
    customerUUID: string,
    status: 'processing' | 'completed' | 'failed'
  ): Promise<void> {
    try {
      const timestamp = new Date().toISOString();
      let updateExpression = 'SET processingStatus = :status, updatedAt = :updatedAt';
      const expressionAttributeValues: any = {
        ':status': status,
        ':updatedAt': timestamp,
      };

      if (status === 'processing') {
        updateExpression += ', processingStartedAt = :startedAt';
        expressionAttributeValues[':startedAt'] = timestamp;
      } else if (status === 'completed') {
        updateExpression += ', processingCompletedAt = :completedAt';
        expressionAttributeValues[':completedAt'] = timestamp;
      }

      await this.dynamoClient.send(new UpdateCommand({
        TableName: this.documentsTable,
        Key: {
          id: documentId,
          customerUuid: customerUUID,
        },
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: expressionAttributeValues,
      }));

    } catch (error) {
      console.error('Error updating document status:', error);
      throw error;
    }
  }

  /**
   * Calculates retry delay in milliseconds
   */
  private calculateRetryDelay(retryCount: number): number {
    // Exponential backoff: 30s, 2m, 5m, 15m
    const delays = [30000, 120000, 300000, 900000];
    return delays[Math.min(retryCount - 1, delays.length - 1)];
  }

  /**
   * Gets queue statistics
   */
  async getQueueStats(): Promise<ProcessingQueueStats> {
    // This would query CloudWatch metrics or maintain internal counters
    // For now, return placeholder stats
    return {
      queuedJobs: 0,
      processingJobs: 0,
      completedJobs: 0,
      failedJobs: 0,
      averageProcessingTime: 0
    };
  }

  /**
   * Determines job priority based on document characteristics
   */
  static determineJobPriority(
    fileSizeBytes: number,
    documentType: 'simple' | 'forms' | 'tables',
    customerTier?: 'premium' | 'standard'
  ): 'high' | 'normal' | 'low' {
    // Premium customers get high priority
    if (customerTier === 'premium') {
      return 'high';
    }

    // Small, simple documents get normal priority
    if (fileSizeBytes < 1024 * 1024 && documentType === 'simple') {
      return 'normal';
    }

    // Large or complex documents get low priority
    if (fileSizeBytes > 10 * 1024 * 1024 || documentType !== 'simple') {
      return 'low';
    }

    return 'normal';
  }
}