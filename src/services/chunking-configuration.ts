import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ChunkingMethod, CustomerRecord, SUPPORTED_CHUNKING_METHODS } from '../types';

export class ChunkingConfigurationService {
  private dynamoClient: DynamoDBDocumentClient;
  private customersTable: string;

  constructor() {
    this.dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.REGION }));
    this.customersTable = process.env.CUSTOMERS_TABLE_NAME!;
  }

  /**
   * Get the current chunking configuration for a customer
   */
  async getCustomerChunkingConfig(customerUUID: string, tenantId: string): Promise<ChunkingMethod> {
    try {
      console.log('Getting chunking config for customer', { customerUUID, tenantId });

      const result = await this.dynamoClient.send(new GetCommand({
        TableName: this.customersTable,
        Key: {
          uuid: customerUUID
        }
      }));

      if (!result.Item) {
        throw new Error(`Customer not found: ${customerUUID}`);
      }

      const customer = result.Item as CustomerRecord;
      
      // Verify tenant access (ABAC enforcement)
      if (customer.tenantId !== tenantId) {
        throw new Error(`Access denied: Customer belongs to different tenant`);
      }
      
      // Return configured method or default
      const chunkingMethod = customer.chunkingMethod || this.getDefaultChunkingMethod();
      
      console.log('Retrieved chunking config', { 
        customerUUID, 
        method: chunkingMethod.id,
        lastUpdate: customer.lastChunkingUpdate 
      });

      return chunkingMethod;

    } catch (error) {
      console.error('Error getting customer chunking config:', error);
      throw error;
    }
  }

  /**
   * Update the chunking configuration for a customer
   */
  async updateCustomerChunkingConfig(
    customerUUID: string, 
    tenantId: string, 
    method: ChunkingMethod
  ): Promise<void> {
    try {
      console.log('Updating chunking config for customer', { 
        customerUUID, 
        tenantId, 
        newMethod: method.id 
      });

      // Validate the chunking method
      if (!this.validateChunkingMethod(method)) {
        throw new Error(`Invalid chunking method: ${method.id}`);
      }

      // Get current customer record to check for changes and verify tenant access
      const currentConfig = await this.getCustomerChunkingConfig(customerUUID, tenantId);
      const configChanged = currentConfig.id !== method.id;

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

      // If config changed, set cleanup status to indicate cleanup needed
      if (configChanged) {
        updateExpression.push('chunkingCleanupStatus = :cleanupStatus');
        expressionAttributeValues[':cleanupStatus'] = 'none';
        
        console.log('Chunking method changed, cleanup will be required', {
          customerUUID,
          oldMethod: currentConfig.id,
          newMethod: method.id
        });
      }

      await this.dynamoClient.send(new UpdateCommand({
        TableName: this.customersTable,
        Key: {
          uuid: customerUUID
        },
        UpdateExpression: updateExpression.join(', '),
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

      console.log('Successfully updated chunking config', { 
        customerUUID, 
        method: method.id,
        configChanged 
      });

    } catch (error) {
      console.error('Error updating customer chunking config:', error);
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