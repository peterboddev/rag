/**
 * Execution Lock Service
 *
 * Provides DynamoDB-based deduplication for Step Functions workflow executions.
 * Uses conditional writes on the existing summary-cache table with a `lock#` key prefix
 * to prevent duplicate workflow executions for the same claim+strategy combination.
 *
 * @module execution-lock
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';

// Environment variables
const SUMMARY_CACHE_TABLE = process.env.SUMMARY_CACHE_TABLE || 'Summary_Cache_Table';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

// Lock TTL: 6 minutes (longer than the 5-minute workflow timeout)
const LOCK_TTL_SECONDS = 360;

// Initialize clients
const dynamoClient = new DynamoDBClient({ region: AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: { removeUndefinedValues: true },
});

/**
 * Attempts to acquire an execution lock for a given lock key.
 * Uses a DynamoDB conditional put to ensure only one execution proceeds.
 *
 * Lock items are stored in the existing summary-cache table with key format:
 * `lock#{claimId}#{strategy}`
 *
 * @param lockKey - The lock key (e.g., `lock#claim-001#full-context`)
 * @returns `true` if lock was acquired, `false` if lock already held
 *
 * @example
 * ```typescript
 * const acquired = await acquireExecutionLock('lock#claim-001#full-context');
 * if (!acquired) {
 *   console.log('Another execution is already in progress');
 *   return;
 * }
 * ```
 */
export async function acquireExecutionLock(lockKey: string): Promise<boolean> {
  const ttl = Math.floor(Date.now() / 1000) + LOCK_TTL_SECONDS;
  try {
    await docClient.send(
      new PutCommand({
        TableName: SUMMARY_CACHE_TABLE,
        Item: {
          cacheKey: lockKey,
          lockedAt: new Date().toISOString(),
          ttl,
        },
        ConditionExpression: 'attribute_not_exists(cacheKey)',
      })
    );
    return true;
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      return false; // Lock already held
    }
    // DynamoDB error (not condition failure) — log and allow workflow to proceed (fail-open)
    console.error('Lock acquisition DynamoDB error, allowing workflow:', error);
    return true;
  }
}

/**
 * Releases an execution lock by deleting the lock item from DynamoDB.
 * If deletion fails, the TTL will clean up the lock in 6 minutes.
 *
 * @param lockKey - The lock key to release (e.g., `lock#claim-001#full-context`)
 *
 * @example
 * ```typescript
 * await releaseExecutionLock('lock#claim-001#full-context');
 * ```
 */
export async function releaseExecutionLock(lockKey: string): Promise<void> {
  try {
    await docClient.send(
      new DeleteCommand({
        TableName: SUMMARY_CACHE_TABLE,
        Key: { cacheKey: lockKey },
      })
    );
  } catch (error) {
    console.warn('Failed to release execution lock (TTL will clean up):', error);
  }
}
