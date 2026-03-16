/**
 * Property-based tests for ClaimSummaryModal logic
 * Feature: claim-summary
 *
 * Tests pure helper functions that mirror the logic in ClaimSummaryModal.tsx.
 * Uses the same pure function extraction pattern as claim-detail-buttons tests.
 * Properties 10 and 11 from the design document.
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';

// ─── Types (mirroring ClaimSummaryModal types) ──────────────────────────────

interface DataAnomaly {
  description: string;
  severity: 'critical' | 'warning' | 'info';
  sourceDocument: string;
  dataValues: Record<string, string>;
}

interface EvaluationScores {
  helpfulness: number;
  faithfulness: number;
  completeness: number;
  anomalyAccuracy?: number;
  evaluatedAt: string;
}

interface ClaimSummaryResponse {
  summary: string;
  anomalies: DataAnomaly[];
  strategy: string;
  chunkingMethod?: string;
  documentCount: number;
  processingTime: number;
  generatedAt: string;
  cached: boolean;
  cachedAt?: string;
  evaluation?: EvaluationScores;
}

// ─── Pure functions (mirrors ClaimSummaryModal.tsx exports) ──────────────────

/**
 * Returns the color for a given anomaly severity.
 * Mirrors getAnomalySeverityColor from ClaimSummaryModal.tsx
 */
function getAnomalySeverityColor(severity: string): string {
  switch (severity) {
    case 'critical': return '#dc3545';
    case 'warning': return '#ffc107';
    case 'info': return '#17a2b8';
    default: return '#6c757d';
  }
}

/**
 * Extracts display fields from a ClaimSummaryResponse.
 * Mirrors extractDisplayFields from ClaimSummaryModal.tsx
 */
function extractDisplayFields(response: ClaimSummaryResponse) {
  return {
    summary: response.summary,
    strategy: response.strategy,
    chunkingMethod: response.chunkingMethod,
    documentCount: response.documentCount,
    processingTime: response.processingTime,
    generatedAt: response.generatedAt,
    cached: response.cached,
    cachedAt: response.cachedAt,
    anomalies: response.anomalies ?? [],
    hasEvaluation: !!response.evaluation,
  };
}

// ─── Arbitrary generators ────────────────────────────────────────────────────

const severityArb = fc.constantFrom('critical', 'warning', 'info') as fc.Arbitrary<
  'critical' | 'warning' | 'info'
>;

const dataValuesArb = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 20 }),
  fc.string({ minLength: 1, maxLength: 50 }),
  { minKeys: 1, maxKeys: 5 }
);

const anomalyArb = fc.record({
  description: fc.string({ minLength: 1, maxLength: 200 }),
  severity: severityArb,
  sourceDocument: fc.string({ minLength: 1, maxLength: 100 }),
  dataValues: dataValuesArb,
});

const strategyArb = fc.constantFrom('full-context', 'rag', 'graph-rag');
const chunkingMethodArb = fc.constantFrom('full-document', 'semantic');

const evaluationArb = fc.record({
  helpfulness: fc.double({ min: 0, max: 1, noNaN: true }),
  faithfulness: fc.double({ min: 0, max: 1, noNaN: true }),
  completeness: fc.double({ min: 0, max: 1, noNaN: true }),
  evaluatedAt: fc.date().map((d) => d.toISOString()),
});

const claimSummaryResponseArb = fc.record({
  summary: fc.string({ minLength: 1, maxLength: 500 }),
  anomalies: fc.array(anomalyArb, { minLength: 0, maxLength: 5 }),
  strategy: strategyArb,
  chunkingMethod: fc.option(chunkingMethodArb, { nil: undefined }),
  documentCount: fc.integer({ min: 1, max: 100 }),
  processingTime: fc.integer({ min: 0, max: 60000 }),
  generatedAt: fc.date().map((d) => d.toISOString()),
  cached: fc.boolean(),
  cachedAt: fc.option(fc.date().map((d) => d.toISOString()), { nil: undefined }),
  evaluation: fc.option(evaluationArb, { nil: undefined }),
});

// ─── Property 10: Anomaly Severity Color Coding ─────────────────────────────

describe('Feature: claim-summary', () => {
  /**
   * Property 10: Anomaly Severity Color Coding
   *
   * For any anomaly displayed in the Claim_Summary_Modal, the anomaly shall be
   * styled with the correct color based on severity: red (#dc3545) for "critical",
   * yellow (#ffc107) for "warning", and blue (#17a2b8) for "info".
   *
   * **Validates: Requirements 4.6**
   */
  describe('Property 10: Anomaly Severity Color Coding', () => {
    const SEVERITY_COLOR_MAP: Record<string, string> = {
      critical: '#dc3545',
      warning: '#ffc107',
      info: '#17a2b8',
    };

    it('should return correct color for any valid severity', () => {
      fc.assert(
        fc.property(severityArb, (severity) => {
          const color = getAnomalySeverityColor(severity);
          expect(color).toBe(SEVERITY_COLOR_MAP[severity]);
        }),
        { numRuns: 100 }
      );
    });

    it('should map critical to red (#dc3545)', () => {
      fc.assert(
        fc.property(
          anomalyArb.filter((a) => a.severity === 'critical'),
          (anomaly) => {
            expect(getAnomalySeverityColor(anomaly.severity)).toBe('#dc3545');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should map warning to yellow (#ffc107)', () => {
      fc.assert(
        fc.property(
          anomalyArb.filter((a) => a.severity === 'warning'),
          (anomaly) => {
            expect(getAnomalySeverityColor(anomaly.severity)).toBe('#ffc107');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should map info to blue (#17a2b8)', () => {
      fc.assert(
        fc.property(
          anomalyArb.filter((a) => a.severity === 'info'),
          (anomaly) => {
            expect(getAnomalySeverityColor(anomaly.severity)).toBe('#17a2b8');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should return fallback color for unknown severity strings', () => {
      fc.assert(
        fc.property(
          fc.string().filter((s) => !['critical', 'warning', 'info'].includes(s)),
          (unknownSeverity) => {
            const color = getAnomalySeverityColor(unknownSeverity);
            expect(color).toBe('#6c757d');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Property 11: Modal Response Display Completeness
   *
   * For any successful ClaimSummaryResponse displayed in the Claim_Summary_Modal,
   * the modal shall render the summary text, strategy name, document count, and
   * processing time. If the strategy is "rag", the chunking method shall also
   * be displayed.
   *
   * **Validates: Requirements 5.3**
   */
  describe('Property 11: Modal Response Display Completeness', () => {
    it('should extract all required display fields from any valid response', () => {
      fc.assert(
        fc.property(claimSummaryResponseArb, (response) => {
          const fields = extractDisplayFields(response);

          expect(typeof fields.summary).toBe('string');
          expect(fields.summary.length).toBeGreaterThan(0);
          expect(typeof fields.strategy).toBe('string');
          expect(typeof fields.documentCount).toBe('number');
          expect(fields.documentCount).toBeGreaterThanOrEqual(1);
          expect(typeof fields.processingTime).toBe('number');
          expect(fields.processingTime).toBeGreaterThanOrEqual(0);
          expect(typeof fields.generatedAt).toBe('string');
          expect(typeof fields.cached).toBe('boolean');
          expect(Array.isArray(fields.anomalies)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should include chunkingMethod when strategy is rag', () => {
      const ragResponseArb = claimSummaryResponseArb.map((r) => ({
        ...r,
        strategy: 'rag' as const,
        chunkingMethod: r.chunkingMethod ?? 'semantic',
      }));

      fc.assert(
        fc.property(ragResponseArb, (response) => {
          const fields = extractDisplayFields(response);
          expect(fields.strategy).toBe('rag');
          expect(fields.chunkingMethod).toBeDefined();
          expect(['full-document', 'semantic']).toContain(fields.chunkingMethod);
        }),
        { numRuns: 100 }
      );
    });

    it('should preserve all anomalies from the response', () => {
      fc.assert(
        fc.property(claimSummaryResponseArb, (response) => {
          const fields = extractDisplayFields(response);
          expect(fields.anomalies.length).toBe(response.anomalies.length);
          for (let i = 0; i < fields.anomalies.length; i++) {
            expect(fields.anomalies[i].description).toBe(
              response.anomalies[i].description
            );
            expect(fields.anomalies[i].severity).toBe(
              response.anomalies[i].severity
            );
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should correctly report evaluation presence', () => {
      fc.assert(
        fc.property(claimSummaryResponseArb, (response) => {
          const fields = extractDisplayFields(response);
          expect(fields.hasEvaluation).toBe(!!response.evaluation);
        }),
        { numRuns: 100 }
      );
    });

    it('should preserve cached status and cachedAt timestamp', () => {
      fc.assert(
        fc.property(claimSummaryResponseArb, (response) => {
          const fields = extractDisplayFields(response);
          expect(fields.cached).toBe(response.cached);
          expect(fields.cachedAt).toBe(response.cachedAt);
        }),
        { numRuns: 100 }
      );
    });
  });
});
