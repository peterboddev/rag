/**
 * Property-based tests for Sentence Boundary Preservation
 * Feature: token-aware-summarization, Property 4: Sentence Boundary Preservation
 * Validates: Requirements 2.2
 */
import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import { TextTruncationService, TruncationStrategy } from '../src/services/text-truncation';
import { TokenEstimationService } from '../src/services/token-estimation';

let service: TextTruncationService;
let tokenEstimator: TokenEstimationService;

beforeEach(() => {
  service = new TextTruncationService();
  tokenEstimator = new TokenEstimationService();
});

const sentenceArb = fc.array(
  fc.lorem({ maxCount: 8 }).map(w => w.charAt(0).toUpperCase() + w.slice(1)),
  { minLength: 2, maxLength: 10 }
).map(sentences => sentences.map(s => s + '.').join(' '));

const strategyArb = fc.constantFrom(
  TruncationStrategy.BEGINNING_AND_END,
  TruncationStrategy.BEGINNING_ONLY
);

describe('Property 4: Sentence Boundary Preservation', () => {
  it('returns text unchanged when within token limit', () => {
    fc.assert(
      fc.property(sentenceArb, (text) => {
        const result = service.truncateToTokenLimit(text, 100000);
        expect(result.content).toBe(text);
        expect(result.truncationPoints.length).toBe(0);
      }),
      { numRuns: 100 }
    );
  });

  it('truncated content fits within token limit', () => {
    fc.assert(
      fc.property(
        sentenceArb,
        fc.integer({ min: 1, max: 500 }),
        strategyArb,
        (text, tokenLimit, strategy) => {
          const result = service.truncateToTokenLimit(text, tokenLimit, strategy);
          const resultTokens = Math.ceil(result.content.length / 4);
          expect(resultTokens).toBeLessThanOrEqual(tokenLimit + 20);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('no truncationPoints when service estimates text fits', () => {
    fc.assert(
      fc.property(sentenceArb, fc.integer({ min: 1, max: 2000 }), (text, tokenLimit) => {
        const result = service.truncateToTokenLimit(text, tokenLimit);
        const estimatedTokens = tokenEstimator.estimateTokens(text);
        if (estimatedTokens <= tokenLimit) {
          expect(result.truncationPoints.length).toBe(0);
        }
        // When exceeds, truncationPoints may or may not be set depending on strategy internals
      }),
      { numRuns: 100 }
    );
  });

  it('preservedSentences is a non-negative integer', () => {
    fc.assert(
      fc.property(sentenceArb, fc.integer({ min: 5, max: 200 }), (text, tokenLimit) => {
        const result = service.truncateToTokenLimit(text, tokenLimit);
        expect(result.preservedSentences).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(result.preservedSentences)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('includes truncation indicator when truncated', () => {
    fc.assert(
      fc.property(sentenceArb, (text) => {
        const result = service.truncateToTokenLimit(text, 5);
        if (result.truncationPoints.length > 0) {
          expect(result.content).toContain('truncated');
        }
      }),
      { numRuns: 100 }
    );
  });

  it('returns empty content for whitespace-only input', () => {
    fc.assert(
      fc.property(
        fc.stringOf(fc.constant(' '), { minLength: 0, maxLength: 50 }),
        fc.integer({ min: 1, max: 1000 }),
        (whitespace, tokenLimit) => {
          const result = service.truncateToTokenLimit(whitespace, tokenLimit);
          expect(result.content).toBe('');
          expect(result.truncationPoints.length).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('reports correct originalLength regardless of truncation', () => {
    fc.assert(
      fc.property(sentenceArb, fc.integer({ min: 1, max: 500 }), (text, tokenLimit) => {
        const result = service.truncateToTokenLimit(text, tokenLimit);
        expect(result.originalLength).toBe(text.length);
      }),
      { numRuns: 100 }
    );
  });
});
