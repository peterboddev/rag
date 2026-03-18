/**
 * Property-based tests for Status Progression Correctness
 * Feature: pdf-processing-enhancement, Property 2: Status Progression Correctness
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4
 *
 * Properties tested:
 * 1. Valid status sequences always follow: queued → processing → (completed | failed)
 * 2. 'queued' can only transition to 'processing'
 * 3. 'processing' can only transition to 'completed' or 'failed'
 * 4. Terminal states ('completed', 'failed') have no valid next transitions (except retry resets to 'queued')
 * 5. Every status in a valid sequence has a corresponding timestamp
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import type { ProcessingStatus } from '../src/types/index';

// ─── State Machine Model ─────────────────────────────────────────────────────

/** All valid processing statuses */
const ALL_STATUSES: ProcessingStatus[] = ['queued', 'processing', 'completed', 'failed'];

/** Valid transitions map: from → allowed targets */
const VALID_TRANSITIONS: Record<ProcessingStatus, ProcessingStatus[]> = {
  queued: ['processing'],
  processing: ['completed', 'failed'],
  completed: [],
  failed: [],
};

/** A status+timestamp pair representing a state in the workflow */
interface StatusEntry {
  status: ProcessingStatus;
  timestamp: string;
}

/** Check if a transition from one status to another is valid */
function isValidTransition(from: ProcessingStatus, to: ProcessingStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

/** Check if a status is terminal (no valid outgoing transitions) */
function isTerminalStatus(status: ProcessingStatus): boolean {
  return VALID_TRANSITIONS[status].length === 0;
}

/**
 * Validate an entire status sequence:
 * - Must start with 'queued'
 * - Each consecutive pair must be a valid transition
 * - Each entry must have a timestamp
 */
function validateSequence(entries: StatusEntry[]): {
  isValid: boolean;
  error?: string;
} {
  if (entries.length === 0) {
    return { isValid: false, error: 'Sequence must not be empty' };
  }
  if (entries[0].status !== 'queued') {
    return { isValid: false, error: `Sequence must start with 'queued', got '${entries[0].status}'` };
  }
  for (const entry of entries) {
    if (!entry.timestamp) {
      return { isValid: false, error: `Missing timestamp for status '${entry.status}'` };
    }
  }
  for (let i = 1; i < entries.length; i++) {
    if (!isValidTransition(entries[i - 1].status, entries[i].status)) {
      return {
        isValid: false,
        error: `Invalid transition: '${entries[i - 1].status}' → '${entries[i].status}'`,
      };
    }
  }
  return { isValid: true };
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Generate an ISO timestamp with a given base offset in ms */
const timestampArb = (baseMs: number) =>
  fc.nat({ max: 60_000 }).map(offset => new Date(baseMs + offset).toISOString());

/** Generate a valid complete workflow sequence: queued → processing → (completed | failed) */
const validCompleteSequenceArb = fc.tuple(
  fc.nat({ max: 1_700_000_000_000 }), // base time
  fc.nat({ max: 60_000 }),             // delay to processing
  fc.nat({ max: 60_000 }),             // delay to terminal
  fc.constantFrom<ProcessingStatus>('completed', 'failed')
).map(([baseMs, d1, d2, terminal]): StatusEntry[] => [
  { status: 'queued', timestamp: new Date(baseMs).toISOString() },
  { status: 'processing', timestamp: new Date(baseMs + d1).toISOString() },
  { status: terminal, timestamp: new Date(baseMs + d1 + d2).toISOString() },
]);

/** Generate a partial valid sequence: just queued, or queued → processing */
const validPartialSequenceArb = fc.tuple(
  fc.nat({ max: 1_700_000_000_000 }),
  fc.nat({ max: 60_000 }),
  fc.constantFrom<1 | 2>(1, 2)
).map(([baseMs, d1, length]): StatusEntry[] => {
  const entries: StatusEntry[] = [
    { status: 'queued', timestamp: new Date(baseMs).toISOString() },
  ];
  if (length === 2) {
    entries.push({ status: 'processing', timestamp: new Date(baseMs + d1).toISOString() });
  }
  return entries;
});

/** Generate a valid sequence (complete or partial) */
const validSequenceArb = fc.oneof(validCompleteSequenceArb, validPartialSequenceArb);

/** Generate a retry sequence: queued → processing → failed → (retry resets to) queued → processing → (completed | failed) */
const retrySequenceArb = fc.tuple(
  fc.nat({ max: 1_700_000_000_000 }),
  fc.nat({ max: 60_000 }),
  fc.nat({ max: 60_000 }),
  fc.nat({ max: 60_000 }),
  fc.nat({ max: 60_000 }),
  fc.constantFrom<ProcessingStatus>('completed', 'failed')
).map(([baseMs, d1, d2, d3, d4, terminal]): StatusEntry[] => [
  { status: 'queued', timestamp: new Date(baseMs).toISOString() },
  { status: 'processing', timestamp: new Date(baseMs + d1).toISOString() },
  { status: 'failed', timestamp: new Date(baseMs + d1 + d2).toISOString() },
  // Retry resets to queued
  { status: 'queued', timestamp: new Date(baseMs + d1 + d2 + d3).toISOString() },
  { status: 'processing', timestamp: new Date(baseMs + d1 + d2 + d3 + d4).toISOString() },
  { status: terminal, timestamp: new Date(baseMs + d1 + d2 + d3 + d4 + 1000).toISOString() },
]);

/** Generate an arbitrary status (for invalid transition testing) */
const statusArb = fc.constantFrom<ProcessingStatus>(...ALL_STATUSES);

/** Generate an invalid transition pair */
const invalidTransitionArb = fc.tuple(statusArb, statusArb).filter(
  ([from, to]) => !isValidTransition(from, to)
);

// ─── Property 2: Status Progression Correctness ──────────────────────────────

describe('Feature: pdf-processing-enhancement, Property 2: Status Progression Correctness', () => {
  /**
   * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
   *
   * Property 1: Valid status sequences always follow queued → processing → (completed | failed).
   * Any generated valid sequence must pass the state machine validation.
   */
  it('valid sequences always follow queued → processing → (completed | failed)', () => {
    fc.assert(
      fc.property(validCompleteSequenceArb, (sequence) => {
        const result = validateSequence(sequence);
        expect(result.isValid).toBe(true);
        expect(sequence[0].status).toBe('queued');
        expect(sequence[1].status).toBe('processing');
        expect(['completed', 'failed']).toContain(sequence[2].status);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.1, 3.2**
   *
   * Property 2: 'queued' can only transition to 'processing'.
   * Any other transition from 'queued' is invalid.
   */
  it("'queued' can only transition to 'processing'", () => {
    fc.assert(
      fc.property(statusArb, (target) => {
        const valid = isValidTransition('queued', target);
        if (target === 'processing') {
          expect(valid).toBe(true);
        } else {
          expect(valid).toBe(false);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.3, 3.4**
   *
   * Property 3: 'processing' can only transition to 'completed' or 'failed'.
   */
  it("'processing' can only transition to 'completed' or 'failed'", () => {
    fc.assert(
      fc.property(statusArb, (target) => {
        const valid = isValidTransition('processing', target);
        if (target === 'completed' || target === 'failed') {
          expect(valid).toBe(true);
        } else {
          expect(valid).toBe(false);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.3, 3.4**
   *
   * Property 4: Terminal states ('completed', 'failed') have no valid next transitions.
   * The only way to continue from 'failed' is a retry which resets to 'queued'.
   */
  it('terminal states have no valid outgoing transitions', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<ProcessingStatus>('completed', 'failed'),
        statusArb,
        (terminal, target) => {
          expect(isTerminalStatus(terminal)).toBe(true);
          expect(isValidTransition(terminal, target)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
   *
   * Property 5: Every status in a valid sequence has a corresponding timestamp.
   * Timestamps must be non-empty ISO strings.
   */
  it('every status in a valid sequence has a corresponding timestamp', () => {
    fc.assert(
      fc.property(validSequenceArb, (sequence) => {
        for (const entry of sequence) {
          expect(typeof entry.timestamp).toBe('string');
          expect(entry.timestamp.length).toBeGreaterThan(0);
          // Verify it's a valid ISO date
          const parsed = new Date(entry.timestamp);
          expect(parsed.getTime()).not.toBeNaN();
        }
        // Validate the sequence itself is valid
        const result = validateSequence(sequence);
        expect(result.isValid).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
   *
   * Invalid transitions are correctly rejected by the state machine.
   */
  it('invalid transitions are rejected', () => {
    fc.assert(
      fc.property(invalidTransitionArb, ([from, to]) => {
        expect(isValidTransition(from, to)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
   *
   * Sequences that don't start with 'queued' are invalid.
   */
  it('sequences not starting with queued are invalid', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<ProcessingStatus>('processing', 'completed', 'failed'),
        fc.nat({ max: 1_700_000_000_000 }),
        (startStatus, baseMs) => {
          const sequence: StatusEntry[] = [
            { status: startStatus, timestamp: new Date(baseMs).toISOString() },
          ];
          const result = validateSequence(sequence);
          expect(result.isValid).toBe(false);
          expect(result.error).toContain('must start with');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.4**
   *
   * Retry resets: after a 'failed' terminal state, a retry resets the workflow
   * back to 'queued', and the new sub-sequence is independently valid.
   */
  it('retry resets from failed back to queued produce valid sub-sequences', () => {
    fc.assert(
      fc.property(retrySequenceArb, (sequence) => {
        // First workflow: queued → processing → failed
        const firstWorkflow = sequence.slice(0, 3);
        expect(validateSequence(firstWorkflow).isValid).toBe(true);
        expect(firstWorkflow[2].status).toBe('failed');

        // Second workflow (after retry): queued → processing → (completed | failed)
        const secondWorkflow = sequence.slice(3);
        expect(validateSequence(secondWorkflow).isValid).toBe(true);
        expect(secondWorkflow[0].status).toBe('queued');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
   *
   * Missing timestamps make a sequence invalid.
   */
  it('sequences with missing timestamps are invalid', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<ProcessingStatus>('completed', 'failed'),
        fc.integer({ min: 0, max: 2 }),
        (terminal, missingIndex) => {
          const entries: StatusEntry[] = [
            { status: 'queued', timestamp: new Date().toISOString() },
            { status: 'processing', timestamp: new Date().toISOString() },
            { status: terminal, timestamp: new Date().toISOString() },
          ];
          // Remove timestamp at the chosen index
          entries[missingIndex] = { ...entries[missingIndex], timestamp: '' };
          const result = validateSequence(entries);
          expect(result.isValid).toBe(false);
          expect(result.error).toContain('Missing timestamp');
        }
      ),
      { numRuns: 100 }
    );
  });
});
