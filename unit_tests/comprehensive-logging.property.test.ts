/**
 * Property-based tests for Comprehensive Logging
 * Feature: token-aware-summarization, Property 16: Comprehensive Logging
 *
 * Validates: Requirements 1.5, 2.5, 5.5, 6.3
 *
 * Properties tested:
 * - TokenEstimationService.estimateTokens logs token estimation info with structured data
 * - TextTruncationService.truncateToTokenLimit logs when truncation occurs with structured data
 * - TokenAwareSummarizationService.generateSummary logs start and completion info with structured data
 * - All log calls include structured data (objects, not just strings)
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import * as fc from 'fast-check';
import { TokenEstimationService } from '../src/services/token-estimation';
import { TextTruncationService, TruncationStrategy } from '../src/services/text-truncation';
import { TokenAwareSummarizationService } from '../src/services/token-aware-summarization';
import { DocumentRecord } from '../src/types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDocRecord(id: string, text: string): DocumentRecord {
  return {
    documentId: id,
    customerUuid: 'cust-1',
    tenantId: 'tenant-1',
    fileName: `${id}.pdf`,
    s3Key: `docs/${id}.pdf`,
    contentType: 'application/pdf',
    processingStatus: 'completed',
    extractedText: text,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** Non-empty text with actual content */
const nonEmptyTextArb = fc.string({ minLength: 1, maxLength: 2000 })
  .filter(s => s.trim().length > 0);

/** Text long enough to force truncation at a small token limit */
const longTextArb = fc.string({ minLength: 200, maxLength: 3000 })
  .filter(s => s.trim().length >= 200);

/** Small token limits that will force truncation on long text */
const smallTokenLimitArb = fc.integer({ min: 5, max: 30 });

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Property 16: Comprehensive Logging', () => {
  let consoleSpy: jest.SpiedFunction<typeof console.log>;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('TokenEstimationService.estimateTokens logging', () => {
    it('should log structured token estimation data for any non-empty text', () => {
      const service = new TokenEstimationService();

      fc.assert(
        fc.property(nonEmptyTextArb, (text) => {
          consoleSpy.mockClear();

          service.estimateTokens(text);

          // At least one console.log call should have been made
          expect(consoleSpy).toHaveBeenCalled();

          // Find the token estimation log call
          const estimationCall = consoleSpy.mock.calls.find(
            (call) => typeof call[0] === 'string' && call[0].includes('Token estimation')
          );
          expect(estimationCall).toBeDefined();

          // Second argument must be a structured object (not just a string)
          const logData = estimationCall![1];
          expect(typeof logData).toBe('object');
          expect(logData).not.toBeNull();
          expect(logData).toHaveProperty('textLength');
          expect(logData).toHaveProperty('estimatedTokens');
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('TextTruncationService.truncateToTokenLimit logging', () => {
    it('should log structured truncation data when truncation occurs', () => {
      const service = new TextTruncationService();

      fc.assert(
        fc.property(longTextArb, smallTokenLimitArb, (text, tokenLimit) => {
          consoleSpy.mockClear();

          service.truncateToTokenLimit(text, tokenLimit);

          // The token estimation service logs on every call, but we specifically
          // look for the truncation log from TextTruncationService
          const truncationCall = consoleSpy.mock.calls.find(
            (call) => typeof call[0] === 'string' && call[0].includes('Truncating text')
          );

          // Truncation should have occurred since text is long and limit is small
          expect(truncationCall).toBeDefined();

          // Verify structured data
          const logData = truncationCall![1];
          expect(typeof logData).toBe('object');
          expect(logData).not.toBeNull();
          expect(logData).toHaveProperty('originalLength');
          expect(logData).toHaveProperty('estimatedTokens');
          expect(logData).toHaveProperty('tokenLimit');
          expect(logData).toHaveProperty('strategy');
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('TokenAwareSummarizationService.generateSummary logging', () => {
    it('should log structured start info for any summarization request', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 10, maxLength: 500 }).filter(s => s.trim().length >= 10),
          fc.uuid(),
          fc.uuid(),
          async (text, customerUUID, tenantId) => {
            consoleSpy.mockClear();
            // Also suppress console.error for fallback paths
            const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

            const service = new TokenAwareSummarizationService();
            (service as any).chunkingService = {
              getCustomerChunkingConfig: jest.fn<any>().mockResolvedValue({
                id: 'fixed_size_1024',
                name: 'Test',
                description: 'Test',
                parameters: { strategy: 'fixed_size', maxTokens: 1024 },
              }),
            };

            const doc = makeDocRecord('doc-1', text);
            await service.generateSummary([doc], customerUUID, tenantId);

            // Find the start log
            const startCall = consoleSpy.mock.calls.find(
              (call) =>
                typeof call[0] === 'string' &&
                call[0].includes('Starting token-aware summarization')
            );
            expect(startCall).toBeDefined();

            // Verify structured data with relevant fields
            const logData = startCall![1];
            expect(typeof logData).toBe('object');
            expect(logData).not.toBeNull();
            expect(logData).toHaveProperty('customerUUID');
            expect(logData).toHaveProperty('documentCount');

            // Find the token limits log (completion/progress info)
            const limitsCall = consoleSpy.mock.calls.find(
              (call) =>
                typeof call[0] === 'string' &&
                call[0].includes('Token limits determined')
            );
            expect(limitsCall).toBeDefined();

            const limitsData = limitsCall![1];
            expect(typeof limitsData).toBe('object');
            expect(limitsData).not.toBeNull();
            expect(limitsData).toHaveProperty('maxTokens');
            expect(limitsData).toHaveProperty('availableTokens');

            errorSpy.mockRestore();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('All log calls include structured data', () => {
    it('every console.log from TokenEstimationService should include an object argument', () => {
      const service = new TokenEstimationService();

      fc.assert(
        fc.property(nonEmptyTextArb, (text) => {
          consoleSpy.mockClear();

          service.estimateTokens(text);

          // Every call that has a string first arg should also have a structured object
          for (const call of consoleSpy.mock.calls) {
            if (typeof call[0] === 'string') {
              expect(call.length).toBeGreaterThanOrEqual(2);
              expect(typeof call[1]).toBe('object');
              expect(call[1]).not.toBeNull();
            }
          }
        }),
        { numRuns: 100 }
      );
    });

    it('every console.log from TextTruncationService truncation should include an object argument', () => {
      const service = new TextTruncationService();

      fc.assert(
        fc.property(longTextArb, smallTokenLimitArb, (text, tokenLimit) => {
          consoleSpy.mockClear();

          service.truncateToTokenLimit(text, tokenLimit);

          // Check that truncation-specific logs have structured data
          const truncationCalls = consoleSpy.mock.calls.filter(
            (call) => typeof call[0] === 'string' && call[0].includes('Truncating text')
          );

          for (const call of truncationCalls) {
            expect(call.length).toBeGreaterThanOrEqual(2);
            expect(typeof call[1]).toBe('object');
            expect(call[1]).not.toBeNull();
          }
        }),
        { numRuns: 100 }
      );
    });
  });
});
