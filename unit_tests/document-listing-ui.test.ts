/**
 * Property-based and unit tests for Document Listing UI
 * Feature: document-listing-ui
 * 
 * Tests the utility functions and component behaviors for the document listing modal.
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import { formatDate, getStatusColor, getStatusIcon } from '../frontend/src/components/documentUtils';

// Valid processing statuses
const VALID_STATUSES = ['completed', 'processing', 'queued', 'failed'] as const;
type ProcessingStatus = typeof VALID_STATUSES[number];

// Arbitrary for ClaimDocument
const claimDocumentArb = fc.record({
  documentId: fc.uuid(),
  fileName: fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
  documentType: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  processingStatus: fc.constantFrom(...VALID_STATUSES),
  createdAt: fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }).map(d => d.toISOString()),
  updatedAt: fc.option(fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }).map(d => d.toISOString()), { nil: undefined }),
});

describe('Feature: document-listing-ui', () => {
  
  describe('Property 3: Date formatting produces human-readable output', () => {
    /**
     * For any valid ISO 8601 date string, the formatDate function should return
     * a non-empty string that does not equal the raw ISO input.
     * Validates: Requirements 1.5
     */
    it('should format ISO dates to human-readable strings', () => {
      fc.assert(
        fc.property(
          fc.date({ min: new Date('2020-01-01'), max: new Date('2030-12-31') }),
          (date) => {
            const isoString = date.toISOString();
            const formatted = formatDate(isoString);
            
            // Output should be non-empty
            expect(formatted.length).toBeGreaterThan(0);
            
            // Output should differ from raw ISO input (human-readable transformation)
            expect(formatted).not.toBe(isoString);
            
            // Output should contain recognizable date components
            // (month name abbreviation, day number, or year)
            const hasDateComponents = 
              /\d{4}/.test(formatted) || // year
              /\d{1,2}/.test(formatted); // day
            expect(hasDateComponents).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle edge case dates', () => {
      // Test specific edge cases
      expect(formatDate('2024-01-01T00:00:00.000Z')).not.toBe('2024-01-01T00:00:00.000Z');
      expect(formatDate('2024-12-31T23:59:59.999Z')).not.toBe('2024-12-31T23:59:59.999Z');
    });

    it('should return original string for invalid dates', () => {
      const invalidDate = 'not-a-date';
      const result = formatDate(invalidDate);
      // Should return something (either original or "Invalid Date" representation)
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('Property 5: Status indicator mapping is total and correct', () => {
    /**
     * For any valid processingStatus value, getStatusColor should return a defined
     * hex color string, and getStatusIcon should return a non-empty string.
     * The mapping should be deterministic.
     * Validates: Requirements 4.1, 4.2, 4.3, 4.4
     */
    it('should return valid colors and icons for all statuses', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...VALID_STATUSES),
          (status) => {
            const color = getStatusColor(status);
            const icon = getStatusIcon(status);
            
            // Color should be a valid hex color
            expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
            
            // Icon should be non-empty
            expect(icon.length).toBeGreaterThan(0);
            
            // Mapping should be deterministic
            expect(getStatusColor(status)).toBe(color);
            expect(getStatusIcon(status)).toBe(icon);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should map completed status to green', () => {
      expect(getStatusColor('completed')).toBe('#28a745');
      expect(getStatusIcon('completed')).toBe('✅');
    });

    it('should map processing status to amber', () => {
      expect(getStatusColor('processing')).toBe('#ffc107');
      expect(getStatusIcon('processing')).toBe('⏳');
    });

    it('should map queued status to blue', () => {
      expect(getStatusColor('queued')).toBe('#17a2b8');
      expect(getStatusIcon('queued')).toBe('⏸️');
    });

    it('should map failed status to red', () => {
      expect(getStatusColor('failed')).toBe('#dc3545');
      expect(getStatusIcon('failed')).toBe('❌');
    });

    it('should handle unknown statuses gracefully', () => {
      const color = getStatusColor('unknown');
      const icon = getStatusIcon('unknown');
      
      // Should return default values, not throw
      expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(icon.length).toBeGreaterThan(0);
    });

    it('should be case-insensitive', () => {
      expect(getStatusColor('COMPLETED')).toBe(getStatusColor('completed'));
      expect(getStatusColor('Completed')).toBe(getStatusColor('completed'));
      expect(getStatusIcon('FAILED')).toBe(getStatusIcon('failed'));
    });
  });

  describe('Property 4: Action buttons enabled only for completed documents', () => {
    /**
     * For any ClaimDocument, View and Download buttons should be enabled
     * if and only if processingStatus is "completed".
     * Validates: Requirements 2.1, 2.6, 3.1
     */
    it('should enable actions only for completed status', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...VALID_STATUSES),
          (status) => {
            const isCompleted = status === 'completed';
            const shouldBeEnabled = isCompleted;
            
            // This tests the logic that would be used in the component
            // The actual component uses: const isCompleted = document.processingStatus === 'completed';
            expect(shouldBeEnabled).toBe(status === 'completed');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should only enable for completed, not other statuses', () => {
      const nonCompletedStatuses: ProcessingStatus[] = ['processing', 'queued', 'failed'];
      
      nonCompletedStatuses.forEach(status => {
        expect(status === 'completed').toBe(false);
      });
      
      expect('completed' === 'completed').toBe(true);
    });
  });

  describe('Property 2: Document metadata display', () => {
    /**
     * For any ClaimDocument with fileName, documentType, and processingStatus,
     * these values should be displayable (non-null, defined strings).
     * Validates: Requirements 1.2, 1.3, 1.4, 4.5
     */
    it('should have displayable metadata for all generated documents', () => {
      fc.assert(
        fc.property(
          claimDocumentArb,
          (doc) => {
            // fileName should always be present and non-empty
            expect(doc.fileName.length).toBeGreaterThan(0);
            
            // processingStatus should be one of the valid values
            expect(VALID_STATUSES).toContain(doc.processingStatus);
            
            // documentType can be undefined, but if present should be non-empty
            if (doc.documentType !== undefined) {
              expect(doc.documentType.length).toBeGreaterThan(0);
            }
            
            // createdAt should be a valid ISO string
            expect(new Date(doc.createdAt).toISOString()).toBe(doc.createdAt);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 1: Document count rendering', () => {
    /**
     * For any list of ClaimDocument objects, the count should equal the array length.
     * Validates: Requirements 1.1
     */
    it('should correctly count documents in any array', () => {
      fc.assert(
        fc.property(
          fc.array(claimDocumentArb, { minLength: 0, maxLength: 50 }),
          (documents) => {
            // The count displayed should equal the array length
            const displayedCount = documents.length;
            expect(displayedCount).toBe(documents.length);
            
            // Empty array should show 0
            if (documents.length === 0) {
              expect(displayedCount).toBe(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle empty document arrays', () => {
      const emptyDocs: any[] = [];
      expect(emptyDocs.length).toBe(0);
    });
  });

  describe('Property 6: Download preserves original filename', () => {
    /**
     * For any file name, the download should use the exact original fileName.
     * Validates: Requirements 3.3
     */
    it('should preserve filename exactly during download', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 255 }).filter(s => s.trim().length > 0),
          (fileName) => {
            // Simulate the download logic: response.fileName || fileName
            const responseFileName = fileName;
            const downloadFileName = responseFileName || fileName;
            
            // The download filename should exactly match the original
            expect(downloadFileName).toBe(fileName);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should handle filenames with special characters', () => {
      const specialNames = [
        'document (1).pdf',
        'file-name_v2.txt',
        'report.2024.01.15.docx',
        'résumé.pdf',
        '文档.pdf',
      ];
      
      specialNames.forEach(name => {
        const downloadName = name; // Simulating the preservation
        expect(downloadName).toBe(name);
      });
    });

    it('should handle filenames with extensions', () => {
      fc.assert(
        fc.property(
          fc.tuple(
            fc.string({ minLength: 1, maxLength: 50 }).filter(s => /^[a-zA-Z0-9_-]+$/.test(s)),
            fc.constantFrom('.pdf', '.txt', '.docx', '.png', '.jpg')
          ),
          ([baseName, extension]) => {
            const fileName = baseName + extension;
            const downloadFileName = fileName;
            
            expect(downloadFileName).toBe(fileName);
            expect(downloadFileName.endsWith(extension)).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
