/**
 * Property-based tests for Claim Summary Cache Service
 * Feature: claim-summary, Property 14: Cache Write Completeness
 *
 * Tests the cache key construction and S3 path generation functions
 * to ensure they produce correctly formatted outputs for all valid inputs.
 *
 * Validates: Requirements 8.1, 8.2, 8.8
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import { buildCacheKey, buildS3Path } from '../src/services/summary-cache';

// Valid strategy values
const VALID_STRATEGIES = ['full-context', 'rag', 'graph-rag'] as const;

// Valid chunking methods (including undefined for non-RAG strategies)
const VALID_CHUNKING_METHODS = ['full-document', 'semantic'] as const;

// Arbitrary for strategy
const strategyArb = fc.constantFrom(...VALID_STRATEGIES);

// Arbitrary for chunking method (can be undefined)
const chunkingMethodArb = fc.option(fc.constantFrom(...VALID_CHUNKING_METHODS), { nil: undefined });

// Arbitrary for claimId - non-empty string without '#' to avoid key parsing issues
const claimIdArb = fc.string({ minLength: 1, maxLength: 100 })
  .filter(s => s.trim().length > 0 && !s.includes('#') && !s.includes('/'));

describe('Feature: claim-summary, Property 14: Cache Write Completeness', () => {
  describe('buildCacheKey', () => {
    /**
     * Property: Cache key always contains exactly 2 '#' separators
     * Validates: Requirements 8.1, 8.8
     */
    it('should always produce cache key with exactly 2 "#" separators', () => {
      fc.assert(
        fc.property(
          claimIdArb,
          strategyArb,
          chunkingMethodArb,
          (claimId, strategy, chunkingMethod) => {
            const cacheKey = buildCacheKey(claimId, strategy, chunkingMethod);
            const separatorCount = (cacheKey.match(/#/g) || []).length;
            
            expect(separatorCount).toBe(2);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Cache key starts with claimId
     * Validates: Requirements 8.1, 8.8
     */
    it('should always start with claimId', () => {
      fc.assert(
        fc.property(
          claimIdArb,
          strategyArb,
          chunkingMethodArb,
          (claimId, strategy, chunkingMethod) => {
            const cacheKey = buildCacheKey(claimId, strategy, chunkingMethod);
            
            expect(cacheKey.startsWith(claimId)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Cache key contains strategy after first '#'
     * Validates: Requirements 8.1, 8.8
     */
    it('should contain strategy after first "#"', () => {
      fc.assert(
        fc.property(
          claimIdArb,
          strategyArb,
          chunkingMethodArb,
          (claimId, strategy, chunkingMethod) => {
            const cacheKey = buildCacheKey(claimId, strategy, chunkingMethod);
            const parts = cacheKey.split('#');
            
            expect(parts.length).toBe(3);
            expect(parts[1]).toBe(strategy);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Cache key ends with chunkingMethod (or "none" if undefined)
     * Validates: Requirements 8.1, 8.8
     */
    it('should end with chunkingMethod or "none" if undefined', () => {
      fc.assert(
        fc.property(
          claimIdArb,
          strategyArb,
          chunkingMethodArb,
          (claimId, strategy, chunkingMethod) => {
            const cacheKey = buildCacheKey(claimId, strategy, chunkingMethod);
            const parts = cacheKey.split('#');
            const expectedMethod = chunkingMethod || 'none';
            
            expect(parts[2]).toBe(expectedMethod);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: buildCacheKey is deterministic (same inputs = same outputs)
     * Validates: Requirements 8.1, 8.8
     */
    it('should be deterministic - same inputs produce same outputs', () => {
      fc.assert(
        fc.property(
          claimIdArb,
          strategyArb,
          chunkingMethodArb,
          (claimId, strategy, chunkingMethod) => {
            const cacheKey1 = buildCacheKey(claimId, strategy, chunkingMethod);
            const cacheKey2 = buildCacheKey(claimId, strategy, chunkingMethod);
            
            expect(cacheKey1).toBe(cacheKey2);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Cache key format is exactly `{claimId}#{strategy}#{chunkingMethod}`
     * Validates: Requirements 8.1, 8.8
     */
    it('should produce cache key in exact format {claimId}#{strategy}#{chunkingMethod}', () => {
      fc.assert(
        fc.property(
          claimIdArb,
          strategyArb,
          chunkingMethodArb,
          (claimId, strategy, chunkingMethod) => {
            const cacheKey = buildCacheKey(claimId, strategy, chunkingMethod);
            const expectedMethod = chunkingMethod || 'none';
            const expectedKey = `${claimId}#${strategy}#${expectedMethod}`;
            
            expect(cacheKey).toBe(expectedKey);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('buildS3Path', () => {
    /**
     * Property: S3 path starts with "summaries/"
     * Validates: Requirements 8.2, 8.8
     */
    it('should always start with "summaries/"', () => {
      fc.assert(
        fc.property(
          claimIdArb,
          strategyArb,
          chunkingMethodArb,
          (claimId, strategy, chunkingMethod) => {
            const s3Path = buildS3Path(claimId, strategy, chunkingMethod);
            
            expect(s3Path.startsWith('summaries/')).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: S3 path ends with ".json"
     * Validates: Requirements 8.2, 8.8
     */
    it('should always end with ".json"', () => {
      fc.assert(
        fc.property(
          claimIdArb,
          strategyArb,
          chunkingMethodArb,
          (claimId, strategy, chunkingMethod) => {
            const s3Path = buildS3Path(claimId, strategy, chunkingMethod);
            
            expect(s3Path.endsWith('.json')).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: S3 path contains claimId, strategy, and chunkingMethod
     * Validates: Requirements 8.2, 8.8
     */
    it('should contain claimId, strategy, and chunkingMethod in path', () => {
      fc.assert(
        fc.property(
          claimIdArb,
          strategyArb,
          chunkingMethodArb,
          (claimId, strategy, chunkingMethod) => {
            const s3Path = buildS3Path(claimId, strategy, chunkingMethod);
            const expectedMethod = chunkingMethod || 'none';
            
            expect(s3Path).toContain(claimId);
            expect(s3Path).toContain(strategy);
            expect(s3Path).toContain(expectedMethod);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: buildS3Path is deterministic (same inputs = same outputs)
     * Validates: Requirements 8.2, 8.8
     */
    it('should be deterministic - same inputs produce same outputs', () => {
      fc.assert(
        fc.property(
          claimIdArb,
          strategyArb,
          chunkingMethodArb,
          (claimId, strategy, chunkingMethod) => {
            const s3Path1 = buildS3Path(claimId, strategy, chunkingMethod);
            const s3Path2 = buildS3Path(claimId, strategy, chunkingMethod);
            
            expect(s3Path1).toBe(s3Path2);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: S3 path format is exactly `summaries/{claimId}/{strategy}/{chunkingMethod}.json`
     * Validates: Requirements 8.2, 8.8
     */
    it('should produce S3 path in exact format summaries/{claimId}/{strategy}/{chunkingMethod}.json', () => {
      fc.assert(
        fc.property(
          claimIdArb,
          strategyArb,
          chunkingMethodArb,
          (claimId, strategy, chunkingMethod) => {
            const s3Path = buildS3Path(claimId, strategy, chunkingMethod);
            const expectedMethod = chunkingMethod || 'none';
            const expectedPath = `summaries/${claimId}/${strategy}/${expectedMethod}.json`;
            
            expect(s3Path).toBe(expectedPath);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: S3 path has exactly 4 path segments (summaries, claimId, strategy, filename)
     * Validates: Requirements 8.2, 8.8
     */
    it('should have exactly 4 path segments', () => {
      fc.assert(
        fc.property(
          claimIdArb,
          strategyArb,
          chunkingMethodArb,
          (claimId, strategy, chunkingMethod) => {
            const s3Path = buildS3Path(claimId, strategy, chunkingMethod);
            const segments = s3Path.split('/');
            
            // summaries / claimId / strategy / chunkingMethod.json
            expect(segments.length).toBe(4);
            expect(segments[0]).toBe('summaries');
            expect(segments[1]).toBe(claimId);
            expect(segments[2]).toBe(strategy);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('buildCacheKey and buildS3Path consistency', () => {
    /**
     * Property: Both functions use the same default for undefined chunkingMethod
     * Validates: Requirements 8.1, 8.2, 8.8
     */
    it('should use "none" as default for undefined chunkingMethod in both functions', () => {
      fc.assert(
        fc.property(
          claimIdArb,
          strategyArb,
          (claimId, strategy) => {
            const cacheKey = buildCacheKey(claimId, strategy, undefined);
            const s3Path = buildS3Path(claimId, strategy, undefined);
            
            expect(cacheKey).toContain('#none');
            expect(s3Path).toContain('/none.json');
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Cache key and S3 path contain the same components
     * Validates: Requirements 8.1, 8.2, 8.8
     */
    it('should contain the same claimId, strategy, and chunkingMethod in both outputs', () => {
      fc.assert(
        fc.property(
          claimIdArb,
          strategyArb,
          chunkingMethodArb,
          (claimId, strategy, chunkingMethod) => {
            const cacheKey = buildCacheKey(claimId, strategy, chunkingMethod);
            const s3Path = buildS3Path(claimId, strategy, chunkingMethod);
            const expectedMethod = chunkingMethod || 'none';
            
            // Both should contain the same components
            const cacheKeyParts = cacheKey.split('#');
            const s3PathParts = s3Path.split('/');
            
            expect(cacheKeyParts[0]).toBe(claimId);
            expect(cacheKeyParts[1]).toBe(strategy);
            expect(cacheKeyParts[2]).toBe(expectedMethod);
            
            expect(s3PathParts[1]).toBe(claimId);
            expect(s3PathParts[2]).toBe(strategy);
            expect(s3PathParts[3]).toBe(`${expectedMethod}.json`);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
