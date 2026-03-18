import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ChunkingMethod, CustomerRecord, SUPPORTED_CHUNKING_METHODS } from '../types';
import {
  ChunkingValidationError,
  ServiceUnavailableError,
  retryWithBackoff,
  structuredLog,
} from './chunking-errors';

export class ChunkingConfigurationService {
  private dynamoClient: DynamoDBDocumentClient;
  private customersTable: string;

  constructor() {
    this.dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.REGION }));
    this.customersTable = process.env.CUSTOMERS_TABLE_NAME!;
  }

  /**
   * Get the current chunking configuration for a customer.
   * Retries DynamoDB reads with exponential backoff (Req 7.2).
   */
  async getCustomerChunkingConfig(customerUUID: string, tenantId: string): Promise<ChunkingMethod> {
    const logCtx = { customerUUID, tenantId, operation: 'getCustomerChunkingConfig' };

    try {
      structuredLog('info', 'Getting chunking config for customer', logCtx);

      const result = await retryWithBackoff(
        () => this.dynamoClient.send(new GetCommand({
          TableName: this.customersTable,
          Key: { uuid: customerUUID }
        })),
        { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 5000 }
      );

      if (!result.Item) {
        throw new Error(`Customer not found: ${customerUUID}`);
      }

      const customer = result.Item as CustomerRecord;

      if (customer.tenantId !== tenantId) {
        throw new Error(`Access denied: Customer belongs to different tenant`);
      }

      const chunkingMethod = customer.chunkingMethod || this.getDefaultChunkingMethod();

      structuredLog('info', 'Retrieved chunking config', { ...logCtx, method: chunkingMethod.id });
      return chunkingMethod;

    } catch (error) {
      structuredLog('error', 'Error getting customer chunking config', {
        ...logCtx,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Update the chunking configuration for a customer.
   * Includes rollback on failure (Req 7.4) and validation (Req 7.3).
   */
  async updateCustomerChunkingConfig(
    customerUUID: string, 
    tenantId: string, 
    method: ChunkingMethod
  ): Promise<void> {
    const logCtx = { customerUUID, tenantId, operation: 'updateCustomerChunkingConfig', newMethod: method.id };

    // Req 7.3: Validate before saving
    if (!this.validateChunkingMethod(method)) {
      throw new ChunkingValidationError(`Invalid chunking method: ${method.id}`, {
        methodId: method.id,
        strategy: method.parameters?.strategy,
      });
    }

    // Capture previous config for rollback
    let previousConfig: ChunkingMethod | undefined;
    try {
      previousConfig = await this.getCustomerChunkingConfig(customerUUID, tenantId);
    } catch (error) {
      // If customer not found, let the update fail naturally
      structuredLog('warn', 'Could not retrieve previous config for rollback', {
        ...logCtx,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    const configChanged = previousConfig.id !== method.id;

    try {
      structuredLog('info', 'Updating chunking config', logCtx);

      const now = new Date().toISOString();
      const updateExpression = [
        'SET chunkingMethod = :method',
        'chunkingConfigVersion = if_not_exists(chunkingConfigVersion, :zero) + :one',
        'lastChunkingUpdate = :now',
        'updatedAt = :now'
      ];

      const expressionAttributeValues: any = {
        ':method': method,
        ':zero': 0,
        ':one': 1,
        ':now': now
      };

      if (configChanged) {
        updateExpression.push('chunkingCleanupStatus = :cleanupStatus');
        expressionAttributeValues[':cleanupStatus'] = 'none';

        structuredLog('info', 'Chunking method changed, cleanup will be required', {
          ...logCtx,
          oldMethod: previousConfig.id,
        });
      }

      await retryWithBackoff(
        () => this.dynamoClient.send(new UpdateCommand({
          TableName: this.customersTable,
          Key: { uuid: customerUUID },
          UpdateExpression: updateExpression.join(', '),
          ExpressionAttributeValues: {
            ...expressionAttributeValues,
            ':tenantId': tenantId
          },
          ExpressionAttributeNames: {
            '#uuid': 'uuid',
            '#tenantId': 'tenantId'
          },
          ConditionExpression: 'attribute_exists(#uuid) AND #tenantId = :tenantId'
        })),
        { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 5000 }
      );

      structuredLog('info', 'Successfully updated chunking config', { ...logCtx, configChanged });

    } catch (error) {
      structuredLog('error', 'Failed to update chunking config, attempting rollback', {
        ...logCtx,
        errorMessage: error instanceof Error ? error.message : String(error),
      });

      // Rollback: restore previous configuration (Req 7.4)
      if (previousConfig) {
        try {
          await this.dynamoClient.send(new UpdateCommand({
            TableName: this.customersTable,
            Key: { uuid: customerUUID },
            UpdateExpression: 'SET chunkingMethod = :method, updatedAt = :now',
            ExpressionAttributeValues: {
              ':method': previousConfig,
              ':now': new Date().toISOString(),
              ':tenantId': tenantId,
            },
            ExpressionAttributeNames: {
              '#uuid': 'uuid',
              '#tenantId': 'tenantId',
            },
            ConditionExpression: 'attribute_exists(#uuid) AND #tenantId = :tenantId',
          }));
          structuredLog('info', 'Rollback successful, restored previous config', {
            ...logCtx,
            restoredMethod: previousConfig.id,
          });
        } catch (rollbackError) {
          structuredLog('error', 'Rollback failed — manual intervention may be required', {
            ...logCtx,
            rollbackError: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
          });
        }
      }

      throw error;
    }
  }

  /**
   * Get all available chunking methods
   */
  async getAvailableChunkingMethods(): Promise<ChunkingMethod[]> {
    return [...SUPPORTED_CHUNKING_METHODS];
  }

  /**
   * Validate a chunking method against supported options
   */
  validateChunkingMethod(method: ChunkingMethod): boolean {
    try {
      // Check if method ID exists in supported methods
      const supportedMethod = SUPPORTED_CHUNKING_METHODS.find(m => m.id === method.id);
      if (!supportedMethod) {
        console.warn('Unsupported chunking method ID', { methodId: method.id });
        return false;
      }

      // Validate method structure
      if (!method.name || !method.description || !method.parameters) {
        console.warn('Invalid chunking method structure', { method });
        return false;
      }

      // Validate parameters based on strategy
      const { parameters } = method;
      switch (parameters.strategy) {
        case 'fixed_size':
          if (!parameters.chunkSize || parameters.chunkSize <= 0) {
            console.warn('Invalid chunk size for fixed_size strategy', { parameters });
            return false;
          }
          if (parameters.chunkOverlap && parameters.chunkOverlap >= parameters.chunkSize) {
            console.warn('Chunk overlap must be less than chunk size', { parameters });
            return false;
          }
          break;

        case 'semantic':
        case 'hierarchical':
          if (parameters.maxTokens && parameters.maxTokens <= 0) {
            console.warn('Invalid max tokens for semantic/hierarchical strategy', { parameters });
            return false;
          }
          break;

        case 'default':
          // Default strategy doesn't require additional validation
          break;

        default:
          console.warn('Unknown chunking strategy', { strategy: parameters.strategy });
          return false;
      }

      return true;

    } catch (error) {
      console.error('Error validating chunking method:', error);
      return false;
    }
  }

  /**
   * Get the default chunking method
   */
  private getDefaultChunkingMethod(): ChunkingMethod {
    return SUPPORTED_CHUNKING_METHODS.find(m => m.id === 'default')!;
  }

  /**
   * Check if a customer needs embedding cleanup
   */
  async needsEmbeddingCleanup(customerUUID: string, tenantId: string): Promise<boolean> {
    try {
      const result = await this.dynamoClient.send(new GetCommand({
        TableName: this.customersTable,
        Key: {
          uuid: customerUUID
        }
      }));

      if (!result.Item) {
        return false;
      }

      const customer = result.Item as CustomerRecord;
      
      // Verify tenant access (ABAC enforcement)
      if (customer.tenantId !== tenantId) {
        return false;
      }
      
      // Check if cleanup status indicates cleanup is needed
      return customer.chunkingCleanupStatus === 'none' && 
             customer.chunkingMethod !== undefined &&
             customer.lastChunkingUpdate !== undefined;

    } catch (error) {
      console.error('Error checking cleanup status:', error);
      return false;
    }
  }

  /**
   * Update cleanup status for a customer
   */
  async updateCleanupStatus(
    customerUUID: string, 
    tenantId: string, 
    status: 'none' | 'in_progress' | 'completed' | 'failed'
  ): Promise<void> {
    try {
      const now = new Date().toISOString();
      const updateExpression = 'SET chunkingCleanupStatus = :status, updatedAt = :now';
      const expressionAttributeValues: any = {
        ':status': status,
        ':now': now,
        ':tenantId': tenantId
      };

      // If cleanup completed, update lastCleanupAt
      if (status === 'completed') {
        updateExpression.replace('SET', 'SET lastCleanupAt = :now,');
      }

      await this.dynamoClient.send(new UpdateCommand({
        TableName: this.customersTable,
        Key: {
          uuid: customerUUID
        },
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ExpressionAttributeNames: {
          '#uuid': 'uuid',
          '#tenantId': 'tenantId'
        },
        ConditionExpression: 'attribute_exists(#uuid) AND #tenantId = :tenantId' // Ensure customer exists and belongs to tenant
      }));

      console.log('Updated cleanup status', { customerUUID, status });

    } catch (error) {
      console.error('Error updating cleanup status:', error);
      throw error;
    }
  }
}