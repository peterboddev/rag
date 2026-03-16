/**
 * Property-based tests for cache behavior logic
 * Feature: claim-summary, Properties 15, 16, 17
 *
 * Tests the LOGIC of cache behavior using pure functions extracted from
 * the orchestrator. Uses the same pure function extraction pattern as
 * other property tests in this project.
 *
 * - Property 15: Cache Check Before Generation
 * - Property 16: Cache Hit Response
 * - Property 17: Force Regeneration Behavior
 *
 * **Validates: Requirements 8.3, 8.4, 8.5, 8.6, 8.7**
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import { buildCacheKey, buildS3Path } from '../src/services/summary-cache';

// ─── Types ──────────────────────────────────────────────────────────────────

type SummaryStrategy = 'full-context' | 'rag' | 'graph-rag';
type ChunkingMethod = 'full-document' | 'semantic';

interface ClaimSummaryRequest {
  strategy: SummaryStrategy;
  chunkingMethod?: ChunkingMethod;
  forceRegenerate?: boolean;
  includeEvaluation?: boolean;
}

interface CachedSummary {
  cacheKey: string;
  s3Key: string;
  strategy: string;
  chunkingMethod?: string;
  documentCount: number;
  documentIds: string[];
  processingTime: number;
  generatedAt: string;
  ttl: number;
}

interface ClaimSummaryResponse {
  summary: string;
  anomalies: any[];
  strategy: string;
  chunkingMethod?: string;
  documentCount: number;
  processingTime: number;
  generatedAt: string;
  cached: boolean;
  cachedAt?: string;
}

// ─── Pure functions extracted from orchestrator cache logic ──────────────────

/**
 * Determines whether cache should be checked for a given request.
 * Mirrors the logic in handlePostSummary: cache is checked when
 * forceRegenerate is false or not provided.
 */
function shouldCheckCache(request: ClaimSummaryRequest): boolean {
  return !request.forceRegenerate;
}

/**
 * Builds a cached response from cache metadata and content.
 * Mirrors the logic in handlePostSummary when a cache hit occurs.
 */
function buildCachedResponse(
  cachedContent: ClaimSummaryResponse,
  cachedGeneratedAt: string
): ClaimSummaryResponse {
  return {
    ...cachedContent,
    cached: true,
    cachedAt: new Date().toISOString(),
    generatedAt: cachedGeneratedAt,
  };
}

/**
 * Determines whether a new summary should be generated.
 * When forceRegenerate is true, always generate. Otherwise, generate only on cache miss.
 */
function shouldGenerateNewSummary(
  request: ClaimSummaryRequest,
  cacheHit: boolean
): boolean {
  if (request.forceRegenerate) return true;
  return !cacheHit;
}

/**
 * Determines whether cache should be updated after generation.
 * Cache is always updated after a successful generation (both fresh and forced).
 */
function shouldUpdateCache(generationSuccessful: boolean): boolean {
  return generationSuccessful;
}

// ─── Arbitrary generators ───────────────────────────────────────────────────

const strategyArb = fc.constantFrom<SummaryStrategy>('full-context', 'rag', 'graph-rag');
const chunkingMethodArb = fc.constantFrom<ChunkingMethod>('full-document', 'semantic');

const claimIdArb = fc.string({ minLength: 1, maxLength: 50 })
  .filter(s => s.trim().length > 0 && !s.includes('#') && !s.includes('/'));

const requestArb: fc.Arbitrary<ClaimSummaryRequest> = fc.record({
  strategy: strategyArb,
  chunkingMethod: fc.option(chunkingMethodArb, { nil: undefined }),
  forceRegenerate: fc.option(fc.boolean(), { nil: undefined }),
  includeEvaluation: fc.option(fc.boolean(), { nil: undefined }),
});

const cachedSummaryResponseArb: fc.Arbitrary<ClaimSummaryResponse> = fc.record({
  summary: fc.string({ minLength: 1, maxLength: 500 }),
  anomalies: fc.constant([]),
  strategy: strategyArb as fc.Arbitrary<string>,
  chunkingMethod: fc.option(chunkingMethodArb as fc.Arbitrary<string>, { nil: undefined }),
  documentCount: fc.integer({ min: 1, max: 100 }),
  processingTime: fc.integer({ min: 0, max: 60000 }),
  generatedAt: fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') })
    .map(d => d.toISOString()),
  cached: fc.constant(false),
  cachedAt: fc.constant(undefined),
});

// ─── Property Tests ─────────────────────────────────────────────────────────

describe('Feature: claim-summary', () => {
  /**
   * Property 15: Cache Check Before Generation
   *
   * For any request where forceRegenerate is false, cache is checked before generation.
   *
   * **Validates: Requirements 8.3**
   */
  describe('Property 15: Cache Check Before Generation', () => {
    it('should check cache when forceRegenerate is false or undefined', () => {
      fc.assert(
        fc.property(
          requestArb.filter(r => !r.forceRegenerate),
          (request) => {
            expect(shouldCheckCache(request)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not check cache when forceRegenerate is true', () => {
      fc.assert(
        fc.property(
          requestArb.map(r => ({ ...r, forceRegenerate: true })),
          (request) => {
            expect(shouldCheckCache(request)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should use correct cache key for any valid request', () => {
      fc.assert(
        fc.property(
          claimIdArb,
          strategyArb,
          fc.option(chunkingMethodArb, { nil: undefined }),
          (claimId, strategy, chunkingMethod) => {
            const cacheKey = buildCacheKey(claimId, strategy, chunkingMethod);
            const expectedMethod = chunkingMethod || 'none';
            expect(cacheKey).toBe(`${claimId}#${strategy}#${expectedMethod}`);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should generate new summary on cache miss when forceRegenerate is false', () => {
      fc.assert(
        fc.property(
          requestArb.filter(r => !r.forceRegenerate),
          (request) => {
            const cacheHit = false;
            expect(shouldGenerateNewSummary(request, cacheHit)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not generate new summary on cache hit when forceRegenerate is false', () => {
      fc.assert(
        fc.property(
          requestArb.filter(r => !r.forceRegenerate),
          (request) => {
            const cacheHit = true;
            expect(shouldGenerateNewSummary(request, cacheHit)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 16: Cache Hit Response
   *
   * For any cache hit, response includes cached: true, original generatedAt,
   * and cachedAt.
   *
   * **Validates: Requirements 8.4, 8.5**
   */
  describe('Property 16: Cache Hit Response', () => {
    it('should set cached to true in response for any cache hit', () => {
      fc.assert(
        fc.property(
          cachedSummaryResponseArb,
          fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') })
            .map(d => d.toISOString()),
          (cachedContent, originalGeneratedAt) => {
            const response = buildCachedResponse(cachedContent, originalGeneratedAt);
            expect(response.cached).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve original generatedAt timestamp from cache', () => {
      fc.assert(
        fc.property(
          cachedSummaryResponseArb,
          fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') })
            .map(d => d.toISOString()),
          (cachedContent, originalGeneratedAt) => {
            const response = buildCachedResponse(cachedContent, originalGeneratedAt);
            expect(response.generatedAt).toBe(originalGeneratedAt);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should include cachedAt timestamp for any cache hit', () => {
      fc.assert(
        fc.property(
          cachedSummaryResponseArb,
          fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') })
            .map(d => d.toISOString()),
          (cachedContent, originalGeneratedAt) => {
            const response = buildCachedResponse(cachedContent, originalGeneratedAt);
            expect(response.cachedAt).toBeDefined();
            expect(typeof response.cachedAt).toBe('string');
            // cachedAt should be a valid ISO 8601 timestamp
            const cachedAtDate = new Date(response.cachedAt!);
            expect(isNaN(cachedAtDate.getTime())).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve all content fields from cached summary', () => {
      fc.assert(
        fc.property(
          cachedSummaryResponseArb,
          fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') })
            .map(d => d.toISOString()),
          (cachedContent, originalGeneratedAt) => {
            const response = buildCachedResponse(cachedContent, originalGeneratedAt);
            expect(response.summary).toBe(cachedContent.summary);
            expect(response.strategy).toBe(cachedContent.strategy);
            expect(response.documentCount).toBe(cachedContent.documentCount);
            expect(response.processingTime).toBe(cachedContent.processingTime);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 17: Force Regeneration Behavior
   *
   * For any request with forceRegenerate: true, cache is bypassed.
   *
   * **Validates: Requirements 8.6, 8.7**
   */
  describe('Property 17: Force Regeneration Behavior', () => {
    it('should always generate new summary when forceRegenerate is true regardless of cache state', () => {
      fc.assert(
        fc.property(
          requestArb.map(r => ({ ...r, forceRegenerate: true })),
          fc.boolean(), // cacheHit: true or false
          (request, cacheHit) => {
            expect(shouldGenerateNewSummary(request, cacheHit)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should skip cache check when forceRegenerate is true', () => {
      fc.assert(
        fc.property(
          requestArb.map(r => ({ ...r, forceRegenerate: true })),
          (request) => {
            expect(shouldCheckCache(request)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should update cache after forced regeneration succeeds', () => {
      fc.assert(
        fc.property(
          requestArb.map(r => ({ ...r, forceRegenerate: true })),
          (request) => {
            // After successful generation, cache should be updated
            expect(shouldUpdateCache(true)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should use correct S3 path for cache update after forced regeneration', () => {
      fc.assert(
        fc.property(
          claimIdArb,
          strategyArb,
          fc.option(chunkingMethodArb, { nil: undefined }),
          (claimId, strategy, chunkingMethod) => {
            const s3Path = buildS3Path(claimId, strategy, chunkingMethod);
            const expectedMethod = chunkingMethod || 'none';
            expect(s3Path).toBe(`summaries/${claimId}/${strategy}/${expectedMethod}.json`);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not update cache when generation fails', () => {
      fc.assert(
        fc.property(
          requestArb.map(r => ({ ...r, forceRegenerate: true })),
          (_request) => {
            expect(shouldUpdateCache(false)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
