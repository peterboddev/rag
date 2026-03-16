/**
 * Summary Cache Service
 *
 * Implements hybrid caching for claim summaries using DynamoDB for metadata
 * and S3 for content storage. Supports cache lookup, storage, and invalidation.
 *
 * @module summary-cache
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import {
  CachedSummary,
  ClaimSummaryResponse,
  SummaryStrategy,
  ChunkingMethod,
} from '../types/claim-summary';

// Environment variables
const SUMMARY_CACHE_TABLE = process.env.SUMMARY_CACHE_TABLE || 'Summary_Cache_Table';
const SUMMARY_CONTENT_BUCKET = process.env.SUMMARY_CONTENT_BUCKET || 'summary-content-bucket';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

// TTL duration: 24 hours in seconds
const CACHE_TTL_SECONDS = 24 * 60 * 60;

// Initialize clients
const dynamoClient = new DynamoDBClient({ region: AWS_REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const s3Client = new S3Client({ region: AWS_REGION });

/**
 * Builds a cache key from claim ID, strategy, and chunking method.
 * Format: `{claimId}#{strategy}#{chunkingMethod}`
 *
 * @param claimId - The claim identifier
 * @param strategy - The summarization strategy used
 * @param chunkingMethod - The chunking method (use "none" when not applicable)
 * @returns The composite cache key
 *
 * @example
 * ```typescript
 * const key = buildCacheKey("claim-001", "rag", "semantic");
 * // Returns: "claim-001#rag#semantic"
 *
 * const key2 = buildCacheKey("claim-001", "full-context", "none");
 * // Returns: "claim-001#full-context#none"
 * ```
 */
export function buildCacheKey(
  claimId: string,
  strategy: SummaryStrategy | string,
  chunkingMethod: ChunkingMethod | string | undefined
): string {
  const method = chunkingMethod || 'none';
  return `${claimId}#${strategy}#${method}`;
}

/**
 * Builds the S3 path for storing summary content.
 * Format: `summaries/{claimId}/{strategy}/{chunkingMethod}.json`
 *
 * @param claimId - The claim identifier
 * @param strategy - The summarization strategy used
 * @param chunkingMethod - The chunking method (use "none" when not applicable)
 * @returns The S3 object key
 *
 * @example
 * ```typescript
 * const path = buildS3Path("claim-001", "rag", "semantic");
 * // Returns: "summaries/claim-001/rag/semantic.json"
 * ```
 */
export function buildS3Path(
  claimId: string,
  strategy: SummaryStrategy | string,
  chunkingMethod: ChunkingMethod | string | undefined
): string {
  const method = chunkingMethod || 'none';
  return `summaries/${claimId}/${strategy}/${method}.json`;
}

/**
 * Retrieves a cached summary by cache key.
 * First fetches metadata from DynamoDB, then retrieves content from S3.
 *
 * @param cacheKey - The composite cache key
 * @returns The cached summary with content, or null if not found
 *
 * @example
 * ```typescript
 * const cached = await getCachedSummary("claim-001#rag#semantic");
 * if (cached) {
 *   console.log("Cache hit:", cached.summary);
 * }
 * ```
 */
export async function getCachedSummary(
  cacheKey: string
): Promise<(CachedSummary & { content: ClaimSummaryResponse }) | null> {
  try {
    // 1. Get metadata from DynamoDB
    const getResult = await docClient.send(
      new GetCommand({
        TableName: SUMMARY_CACHE_TABLE,
        Key: { cacheKey },
      })
    );

    if (!getResult.Item) {
      return null;
    }

    const metadata = getResult.Item as CachedSummary;

    // 2. Get content from S3
    const s3Result = await s3Client.send(
      new GetObjectCommand({
        Bucket: SUMMARY_CONTENT_BUCKET,
        Key: metadata.s3Key,
      })
    );

    const contentString = await s3Result.Body?.transformToString();
    if (!contentString) {
      console.log('Cache content not found in S3', { cacheKey, s3Key: metadata.s3Key });
      return null;
    }

    const content: ClaimSummaryResponse = JSON.parse(contentString);

    return {
      ...metadata,
      content,
    };
  } catch (error) {
    // Handle specific errors
    if ((error as any).name === 'NoSuchKey' || (error as any).name === 'ResourceNotFoundException') {
      return null;
    }

    console.log('Error retrieving cached summary', {
      cacheKey,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Stores a summary in the cache.
 * Stores metadata in DynamoDB and content in S3.
 *
 * @param cacheKey - The composite cache key
 * @param summary - The summary response to cache
 * @param documentIds - Array of document IDs included in the summary
 *
 * @example
 * ```typescript
 * await cacheSummary(
 *   "claim-001#rag#semantic",
 *   summaryResponse,
 *   ["doc-1", "doc-2", "doc-3"]
 * );
 * ```
 */
export async function cacheSummary(
  cacheKey: string,
  summary: ClaimSummaryResponse,
  documentIds: string[] = []
): Promise<void> {
  try {
    // Parse cache key to extract components
    const [claimId, strategy, chunkingMethod] = cacheKey.split('#');

    // Build S3 path
    const s3Key = buildS3Path(claimId, strategy, chunkingMethod);

    // Calculate TTL (24 hours from now)
    const ttl = Math.floor(Date.now() / 1000) + CACHE_TTL_SECONDS;

    // 1. Store content in S3
    await s3Client.send(
      new PutObjectCommand({
        Bucket: SUMMARY_CONTENT_BUCKET,
        Key: s3Key,
        Body: JSON.stringify(summary),
        ContentType: 'application/json',
      })
    );

    // 2. Store metadata in DynamoDB
    const cacheMetadata: CachedSummary = {
      cacheKey,
      s3Key,
      strategy,
      chunkingMethod: chunkingMethod !== 'none' ? chunkingMethod : undefined,
      documentCount: summary.documentCount,
      documentIds,
      processingTime: summary.processingTime,
      generatedAt: summary.generatedAt,
      evaluation: summary.evaluation,
      ttl,
    };

    await docClient.send(
      new PutCommand({
        TableName: SUMMARY_CACHE_TABLE,
        Item: cacheMetadata,
      })
    );

    console.log('Summary cached successfully', {
      cacheKey,
      s3Key,
      documentCount: summary.documentCount,
      ttl: new Date(ttl * 1000).toISOString(),
    });
  } catch (error) {
    console.log('Error caching summary', {
      cacheKey,
      error: error instanceof Error ? error.message : String(error),
    });
    // Re-throw to let caller handle the error
    throw error;
  }
}

/**
 * Invalidates all cached summaries for a claim.
 * Queries the claimId-index GSI to find all cache entries, then batch deletes them.
 *
 * @param claimId - The claim identifier
 * @returns The number of cache entries invalidated
 *
 * @example
 * ```typescript
 * const count = await invalidateCache("claim-001");
 * console.log(`Invalidated ${count} cache entries`);
 * ```
 */
export async function invalidateCache(claimId: string): Promise<number> {
  try {
    // Query all cache entries for this claim using the GSI
    const queryResult = await docClient.send(
      new QueryCommand({
        TableName: SUMMARY_CACHE_TABLE,
        IndexName: 'claimId-index',
        KeyConditionExpression: 'claimId = :claimId',
        ExpressionAttributeValues: {
          ':claimId': claimId,
        },
      })
    );

    const items = queryResult.Items || [];

    if (items.length === 0) {
      console.log('No cache entries found for claim', { claimId });
      return 0;
    }

    // Delete S3 objects and DynamoDB items
    const deletePromises: Promise<void>[] = [];

    for (const item of items) {
      const cacheEntry = item as CachedSummary;

      // Delete from S3
      deletePromises.push(
        s3Client
          .send(
            new DeleteObjectCommand({
              Bucket: SUMMARY_CONTENT_BUCKET,
              Key: cacheEntry.s3Key,
            })
          )
          .then(() => {})
          .catch((error) => {
            console.log('Error deleting S3 object', {
              s3Key: cacheEntry.s3Key,
              error: error instanceof Error ? error.message : String(error),
            });
          })
      );
    }

    // Batch delete from DynamoDB (max 25 items per batch)
    const batchSize = 25;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const deleteRequests = batch.map((item) => ({
        DeleteRequest: {
          Key: { cacheKey: (item as CachedSummary).cacheKey },
        },
      }));

      deletePromises.push(
        docClient
          .send(
            new BatchWriteCommand({
              RequestItems: {
                [SUMMARY_CACHE_TABLE]: deleteRequests,
              },
            })
          )
          .then(() => {})
          .catch((error) => {
            console.log('Error batch deleting from DynamoDB', {
              error: error instanceof Error ? error.message : String(error),
            });
          })
      );
    }

    await Promise.all(deletePromises);

    console.log('Cache invalidated for claim', {
      claimId,
      entriesDeleted: items.length,
    });

    return items.length;
  } catch (error) {
    console.log('Error invalidating cache', {
      claimId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
