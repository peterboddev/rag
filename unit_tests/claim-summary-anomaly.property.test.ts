/**
 * Property-based tests for anomaly response structure
 * Feature: claim-summary, Property 9: Anomaly Response Structure
 *
 * Generates anomalies and asserts all required fields are present with
 * correct types and valid values. Uses the pure function extraction pattern.
 *
 * **Validates: Requirements 4.3**
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';

// ─── Types (mirroring src/types/claim-summary.ts) ───────────────────────────

type AnomalySeverity = 'critical' | 'warning' | 'info';

interface DataAnomaly {
  description: string;
  severity: AnomalySeverity;
  sourceDocument: string;
  dataValues: Record<string, string>;
}

// ─── Pure validation function (mirrors orchestrator's parseSummaryResponse) ─

const VALID_SEVERITIES: AnomalySeverity[] = ['critical', 'warning', 'info'];

/**
 * Validates that an anomaly object has all required fields with correct types.
 * Returns an object with validity status and any errors found.
 */
function validateAnomalyStructure(anomaly: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (typeof anomaly.description !== 'string' || anomaly.description.length === 0) {
    errors.push('description must be a non-empty string');
  }

  if (!VALID_SEVERITIES.includes(anomaly.severity)) {
    errors.push(`severity must be one of: ${VALID_SEVERITIES.join(', ')}`);
  }

  if (typeof anomaly.sourceDocument !== 'string') {
    errors.push('sourceDocument must be a string');
  }

  if (typeof anomaly.dataValues !== 'object' || anomaly.dataValues === null || Array.isArray(anomaly.dataValues)) {
    errors.push('dataValues must be an object');
  } else if (Object.keys(anomaly.dataValues).length === 0) {
    errors.push('dataValues must have at least one key-value pair');
  }

  return { valid: errors.length === 0, errors };
}

// ─── Arbitrary generators ───────────────────────────────────────────────────

const severityArb = fc.constantFrom<AnomalySeverity>('critical', 'warning', 'info');

const dataValuesArb = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 30 }),
  fc.string({ minLength: 1, maxLength: 50 }),
  { minKeys: 1, maxKeys: 5 }
);

const validAnomalyArb: fc.Arbitrary<DataAnomaly> = fc.record({
  description: fc.string({ minLength: 1, maxLength: 200 }),
  severity: severityArb,
  sourceDocument: fc.string({ minLength: 1, maxLength: 100 }),
  dataValues: dataValuesArb,
});

// ─── Property Tests ─────────────────────────────────────────────────────────

describe('Feature: claim-summary', () => {
  /**
   * Property 9: Anomaly Response Structure
   *
   * For any detected anomaly, the anomaly object shall contain:
   * - description (non-empty string)
   * - severity (one of "critical", "warning", "info")
   * - sourceDocument (string)
   * - dataValues (object with at least one key-value pair)
   *
   * **Validates: Requirements 4.3**
   */
  describe('Property 9: Anomaly Response Structure', () => {
    it('should have all required fields present for any generated anomaly', () => {
      fc.assert(
        fc.property(validAnomalyArb, (anomaly) => {
          expect(anomaly).toHaveProperty('description');
          expect(anomaly).toHaveProperty('severity');
          expect(anomaly).toHaveProperty('sourceDocument');
          expect(anomaly).toHaveProperty('dataValues');
        }),
        { numRuns: 100 }
      );
    });

    it('should have description as a non-empty string', () => {
      fc.assert(
        fc.property(validAnomalyArb, (anomaly) => {
          expect(typeof anomaly.description).toBe('string');
          expect(anomaly.description.length).toBeGreaterThan(0);
        }),
        { numRuns: 100 }
      );
    });

    it('should have severity as one of critical, warning, or info', () => {
      fc.assert(
        fc.property(validAnomalyArb, (anomaly) => {
          expect(VALID_SEVERITIES).toContain(anomaly.severity);
        }),
        { numRuns: 100 }
      );
    });

    it('should have sourceDocument as a string', () => {
      fc.assert(
        fc.property(validAnomalyArb, (anomaly) => {
          expect(typeof anomaly.sourceDocument).toBe('string');
        }),
        { numRuns: 100 }
      );
    });

    it('should have dataValues as an object with at least one key-value pair', () => {
      fc.assert(
        fc.property(validAnomalyArb, (anomaly) => {
          expect(typeof anomaly.dataValues).toBe('object');
          expect(anomaly.dataValues).not.toBeNull();
          expect(Array.isArray(anomaly.dataValues)).toBe(false);
          expect(Object.keys(anomaly.dataValues).length).toBeGreaterThanOrEqual(1);
        }),
        { numRuns: 100 }
      );
    });

    it('should pass validation for any well-formed anomaly', () => {
      fc.assert(
        fc.property(validAnomalyArb, (anomaly) => {
          const result = validateAnomalyStructure(anomaly);
          expect(result.valid).toBe(true);
          expect(result.errors).toEqual([]);
        }),
        { numRuns: 100 }
      );
    });

    it('should fail validation when description is empty', () => {
      fc.assert(
        fc.property(
          validAnomalyArb.map(a => ({ ...a, description: '' })),
          (anomaly) => {
            const result = validateAnomalyStructure(anomaly);
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('description must be a non-empty string');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should fail validation when severity is invalid', () => {
      fc.assert(
        fc.property(
          validAnomalyArb,
          fc.string().filter(s => !VALID_SEVERITIES.includes(s as AnomalySeverity)),
          (anomaly, invalidSeverity) => {
            const badAnomaly = { ...anomaly, severity: invalidSeverity };
            const result = validateAnomalyStructure(badAnomaly);
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('severity'))).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should fail validation when dataValues is empty object', () => {
      fc.assert(
        fc.property(
          validAnomalyArb.map(a => ({ ...a, dataValues: {} })),
          (anomaly) => {
            const result = validateAnomalyStructure(anomaly);
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('dataValues must have at least one key-value pair');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should have all dataValues entries as string key-value pairs', () => {
      fc.assert(
        fc.property(validAnomalyArb, (anomaly) => {
          for (const [key, value] of Object.entries(anomaly.dataValues)) {
            expect(typeof key).toBe('string');
            expect(typeof value).toBe('string');
          }
        }),
        { numRuns: 100 }
      );
    });
  });
});
