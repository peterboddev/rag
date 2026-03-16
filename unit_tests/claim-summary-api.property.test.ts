/**
 * Property-based tests for Claim Summary API Client
 * Feature: claim-summary, Property 12: API Client Request Construction
 * Feature: claim-summary, Property 13: API Client Response Parsing
 *
 * Tests the pure functions for request construction and response parsing
 * to ensure they produce correct outputs for all valid inputs.
 *
 * Validates: Requirements 6.2, 6.3
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import { buildSummaryRequest, parseClaimSummaryResponse } from '../frontend/src/services/claimApi';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

const VALID_STRATEGIES = ['full-context', 'rag', 'graph-rag'] as const;
const VALID_CHUNKING_METHODS = ['full-document', 'semantic'] as const;
const VALID_SEVERITIES = ['critical', 'warning', 'info'] as const;

const strategyArb = fc.constantFrom(...VALID_STRATEGIES);
const chunkingMethodArb = fc.option(fc.constantFrom(...VALID_CHUNKING_METHODS), { nil: undefined });

// claimId: non-empty string (may contain special chars that need encoding)
const claimIdArb = fc.string({ minLength: 1, maxLength: 100 })
  .filter(s => s.trim().length > 0);

const booleanOptionArb = fc.option(fc.boolean(), { nil: undefined });

// Arbitrary for a valid DataAnomaly object
const anomalyArb = fc.record({
  description: fc.string({ minLength: 1 }),
  severity: fc.constantFrom(...VALID_SEVERITIES),
  sourceDocument: fc.string({ minLength: 1 }),
  dataValues: fc.dictionary(fc.string({ minLength: 1, maxLength: 20 }), fc.string(), { minKeys: 1, maxKeys: 5 }),
});

// Arbitrary for a valid EvaluationScores object
const evaluationArb = fc.record({
  helpfulness: fc.double({ min: 0, max: 1, noNaN: true }),
  faithfulness: fc.double({ min: 0, max: 1, noNaN: true }),
  completeness: fc.double({ min: 0, max: 1, noNaN: true }),
  evaluatedAt: fc.date().map(d => d.toISOString()),
});

// Arbitrary for a valid ClaimSummaryResponse
const validResponseArb = fc.record({
  summary: fc.string({ minLength: 1 }),
  anomalies: fc.array(anomalyArb, { minLength: 0, maxLength: 5 }),
  strategy: strategyArb.map(s => s as string),
  chunkingMethod: chunkingMethodArb.map(c => c as string | undefined),
  documentCount: fc.integer({ min: 1, max: 1000 }),
  processingTime: fc.integer({ min: 0, max: 300000 }),
  generatedAt: fc.date().map(d => d.toISOString()),
  cached: fc.boolean(),
});

// ─── Property 12: API Client Request Construction ────────────────────────────

describe('Feature: claim-summary, Property 12: API Client Request Construction', () => {
  /**
   * **Validates: Requirements 6.2**
   *
   * For any call to buildSummaryRequest(claimId, strategy, chunkingMethod),
   * the result shall contain a POST endpoint at /claims/{claimId}/summary
   * with a JSON body containing the strategy field, and chunkingMethod if provided.
   */

  it('should always produce a POST request', () => {
    fc.assert(
      fc.property(
        claimIdArb,
        strategyArb,
        chunkingMethodArb,
        booleanOptionArb,
        booleanOptionArb,
        (claimId, strategy, chunkingMethod, forceRegenerate, includeEvaluation) => {
          const req = buildSummaryRequest(claimId, strategy, chunkingMethod, forceRegenerate, includeEvaluation);
          expect(req.method).toBe('POST');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should construct endpoint with encoded claimId', () => {
    fc.assert(
      fc.property(
        claimIdArb,
        strategyArb,
        chunkingMethodArb,
        (claimId, strategy, chunkingMethod) => {
          const req = buildSummaryRequest(claimId, strategy, chunkingMethod);
          const expectedEndpoint = `/claims/${encodeURIComponent(claimId)}/summary`;
          expect(req.endpoint).toBe(expectedEndpoint);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should always include strategy in body', () => {
    fc.assert(
      fc.property(
        claimIdArb,
        strategyArb,
        chunkingMethodArb,
        (claimId, strategy, chunkingMethod) => {
          const req = buildSummaryRequest(claimId, strategy, chunkingMethod);
          expect(req.body.strategy).toBe(strategy);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should include chunkingMethod in body only when provided', () => {
    fc.assert(
      fc.property(
        claimIdArb,
        strategyArb,
        chunkingMethodArb,
        (claimId, strategy, chunkingMethod) => {
          const req = buildSummaryRequest(claimId, strategy, chunkingMethod);
          if (chunkingMethod) {
            expect(req.body.chunkingMethod).toBe(chunkingMethod);
          } else {
            expect(req.body).not.toHaveProperty('chunkingMethod');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should include forceRegenerate in body only when defined', () => {
    fc.assert(
      fc.property(
        claimIdArb,
        strategyArb,
        booleanOptionArb,
        (claimId, strategy, forceRegenerate) => {
          const req = buildSummaryRequest(claimId, strategy, undefined, forceRegenerate);
          if (forceRegenerate !== undefined) {
            expect(req.body.forceRegenerate).toBe(forceRegenerate);
          } else {
            expect(req.body).not.toHaveProperty('forceRegenerate');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should include includeEvaluation in body only when defined', () => {
    fc.assert(
      fc.property(
        claimIdArb,
        strategyArb,
        booleanOptionArb,
        (claimId, strategy, includeEvaluation) => {
          const req = buildSummaryRequest(claimId, strategy, undefined, undefined, includeEvaluation);
          if (includeEvaluation !== undefined) {
            expect(req.body.includeEvaluation).toBe(includeEvaluation);
          } else {
            expect(req.body).not.toHaveProperty('includeEvaluation');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should be deterministic - same inputs produce same outputs', () => {
    fc.assert(
      fc.property(
        claimIdArb,
        strategyArb,
        chunkingMethodArb,
        booleanOptionArb,
        booleanOptionArb,
        (claimId, strategy, chunkingMethod, forceRegenerate, includeEvaluation) => {
          const req1 = buildSummaryRequest(claimId, strategy, chunkingMethod, forceRegenerate, includeEvaluation);
          const req2 = buildSummaryRequest(claimId, strategy, chunkingMethod, forceRegenerate, includeEvaluation);
          expect(req1).toEqual(req2);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 13: API Client Response Parsing ────────────────────────────────

describe('Feature: claim-summary, Property 13: API Client Response Parsing', () => {
  /**
   * **Validates: Requirements 6.3**
   *
   * For any valid API response, parseClaimSummaryResponse shall return
   * { valid: true, errors: [] } confirming all required fields are typed correctly.
   */

  it('should validate a well-formed response as valid', () => {
    fc.assert(
      fc.property(
        validResponseArb,
        (response) => {
          const result = parseClaimSummaryResponse(response);
          expect(result.valid).toBe(true);
          expect(result.errors).toEqual([]);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject response with non-string summary', () => {
    fc.assert(
      fc.property(
        validResponseArb,
        fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.constant(undefined)),
        (response, badSummary) => {
          const badResponse = { ...response, summary: badSummary };
          const result = parseClaimSummaryResponse(badResponse);
          expect(result.valid).toBe(false);
          expect(result.errors).toContain('summary must be string');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject response with non-array anomalies', () => {
    fc.assert(
      fc.property(
        validResponseArb,
        fc.oneof(fc.string(), fc.integer(), fc.constant(null), fc.constant(undefined)),
        (response, badAnomalies) => {
          const badResponse = { ...response, anomalies: badAnomalies };
          const result = parseClaimSummaryResponse(badResponse);
          expect(result.valid).toBe(false);
          expect(result.errors).toContain('anomalies must be array');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject response with non-string strategy', () => {
    fc.assert(
      fc.property(
        validResponseArb,
        fc.oneof(fc.integer(), fc.boolean(), fc.constant(null)),
        (response, badStrategy) => {
          const badResponse = { ...response, strategy: badStrategy };
          const result = parseClaimSummaryResponse(badResponse);
          expect(result.valid).toBe(false);
          expect(result.errors).toContain('strategy must be string');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject response with non-number documentCount', () => {
    fc.assert(
      fc.property(
        validResponseArb,
        fc.oneof(fc.string(), fc.boolean(), fc.constant(null)),
        (response, badCount) => {
          const badResponse = { ...response, documentCount: badCount };
          const result = parseClaimSummaryResponse(badResponse);
          expect(result.valid).toBe(false);
          expect(result.errors).toContain('documentCount must be number');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject response with non-number processingTime', () => {
    fc.assert(
      fc.property(
        validResponseArb,
        fc.oneof(fc.string(), fc.boolean(), fc.constant(null)),
        (response, badTime) => {
          const badResponse = { ...response, processingTime: badTime };
          const result = parseClaimSummaryResponse(badResponse);
          expect(result.valid).toBe(false);
          expect(result.errors).toContain('processingTime must be number');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject response with non-string generatedAt', () => {
    fc.assert(
      fc.property(
        validResponseArb,
        fc.oneof(fc.integer(), fc.boolean(), fc.constant(null)),
        (response, badDate) => {
          const badResponse = { ...response, generatedAt: badDate };
          const result = parseClaimSummaryResponse(badResponse);
          expect(result.valid).toBe(false);
          expect(result.errors).toContain('generatedAt must be string');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should reject response with non-boolean cached', () => {
    fc.assert(
      fc.property(
        validResponseArb,
        fc.oneof(fc.string(), fc.integer(), fc.constant(null)),
        (response, badCached) => {
          const badResponse = { ...response, cached: badCached };
          const result = parseClaimSummaryResponse(badResponse);
          expect(result.valid).toBe(false);
          expect(result.errors).toContain('cached must be boolean');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should collect multiple errors when multiple fields are invalid', () => {
    fc.assert(
      fc.property(
        fc.constant({}),
        () => {
          const result = parseClaimSummaryResponse({});
          expect(result.valid).toBe(false);
          expect(result.errors.length).toBeGreaterThanOrEqual(7);
        }
      ),
      { numRuns: 100 }
    );
  });
});
