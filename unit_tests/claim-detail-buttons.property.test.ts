/**
 * Property-based tests for ClaimDetailPage button rendering logic
 * Feature: claim-summary
 *
 * Tests the conditions that determine which buttons render for claims
 * based on claim status, matching the logic in ClaimDetailPage.tsx.
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';

// Claim statuses used in the application
const COMPLETED_STATUS = 'completed';
const NON_COMPLETED_STATUSES = ['processing', 'failed', 'pending', 'not_loaded', 'in_progress'] as const;
const ALL_STATUSES = [COMPLETED_STATUS, ...NON_COMPLETED_STATUSES] as const;

// Arbitrary generators
const claimIdArb = fc.uuid();

const completedClaimStatusArb = fc.record({
  status: fc.constant(COMPLETED_STATUS),
  documentsProcessed: fc.nat({ max: 100 }),
  totalDocuments: fc.nat({ max: 100 }),
});

const nonCompletedStatusArb = fc.constantFrom(...NON_COMPLETED_STATUSES);

const nonCompletedClaimStatusArb = nonCompletedStatusArb.chain((status) =>
  fc.record({
    status: fc.constant(status),
    documentsProcessed: fc.nat({ max: 100 }),
    totalDocuments: fc.nat({ max: 100 }),
  })
);

/**
 * Replicates the button rendering logic from ClaimDetailPage.tsx:
 *
 * {status && status.status === 'completed' && (
 *   <div>
 *     <button>📄 View Documents</button>
 *     <button>📝 Summarize Claim</button>
 *   </div>
 * )}
 */
function shouldShowViewDocumentsButton(status: { status: string } | undefined): boolean {
  return !!status && status.status === 'completed';
}

function shouldShowSummarizeClaimButton(status: { status: string } | undefined): boolean {
  return !!status && status.status === 'completed';
}

describe('Feature: claim-summary', () => {
  describe('Property 1: Completed Claim Button Rendering', () => {
    /**
     * For any claim with status "completed", the ClaimDetailPage component
     * shall render both a "View Documents" button and a "Summarize Claim"
     * button for that claim.
     *
     * Validates: Requirements 1.1, 1.2
     */
    it('should show both View Documents and Summarize Claim buttons for completed claims', () => {
      fc.assert(
        fc.property(
          claimIdArb,
          completedClaimStatusArb,
          (_claimId, status) => {
            expect(shouldShowViewDocumentsButton(status)).toBe(true);
            expect(shouldShowSummarizeClaimButton(status)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should show both buttons regardless of document count for completed claims', () => {
      fc.assert(
        fc.property(
          claimIdArb,
          fc.nat({ max: 1000 }),
          fc.nat({ max: 1000 }),
          (_claimId, processed, total) => {
            const status = { status: 'completed', documentsProcessed: processed, totalDocuments: total };
            expect(shouldShowViewDocumentsButton(status)).toBe(true);
            expect(shouldShowSummarizeClaimButton(status)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 2: Non-Completed Claim Hides Summarize Button', () => {
    /**
     * For any claim with a status other than "completed" (processing, failed,
     * pending, not_loaded), the ClaimDetailPage component shall not render
     * the "Summarize Claim" button for that claim.
     *
     * Validates: Requirements 1.4
     */
    it('should not show Summarize Claim button for non-completed claims', () => {
      fc.assert(
        fc.property(
          claimIdArb,
          nonCompletedClaimStatusArb,
          (_claimId, status) => {
            expect(shouldShowSummarizeClaimButton(status)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not show View Documents button for non-completed claims', () => {
      fc.assert(
        fc.property(
          claimIdArb,
          nonCompletedClaimStatusArb,
          (_claimId, status) => {
            expect(shouldShowViewDocumentsButton(status)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not show Summarize Claim button when status is undefined', () => {
      expect(shouldShowSummarizeClaimButton(undefined)).toBe(false);
      expect(shouldShowViewDocumentsButton(undefined)).toBe(false);
    });

    it('should not show buttons for arbitrary non-completed status strings', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 50 }).filter(s => s !== 'completed'),
          (statusStr) => {
            const status = { status: statusStr, documentsProcessed: 0, totalDocuments: 0 };
            expect(shouldShowSummarizeClaimButton(status)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
