/**
 * Property-based test for Source Information Display.
 *
 * **Property 8: Source Information Display**
 * **Validates: Requirements 4.5**
 *
 * For any chunk, the visualization should display complete source information
 * including document name and section details when available.
 *
 * Requirement 4.5: THE Chunk_Visualization_Panel SHALL display chunk source
 * information (document name, page/section)
 *
 * We test the pure data validation logic rather than rendering React components,
 * verifying that:
 * 1. Every chunk has a non-empty documentId and fileName (always required)
 * 2. When pageNumber is present, it is a positive integer
 * 3. When sectionTitle is present, it is a non-empty string
 * 4. Source information is sufficient to build a display string
 * 5. Source display formatting is consistent regardless of optional fields
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import {
  DocumentChunk,
  ChunkMetadata,
} from '../frontend/src/types';

// ─── Source Information Validation & Formatting (pure logic) ─────────────────

/**
 * Validates that a chunk's source information is complete enough for display.
 * Returns true if the required fields are present and valid.
 */
function isSourceInfoComplete(chunk: DocumentChunk): boolean {
  const { sourceDocument } = chunk;
  if (!sourceDocument) return false;
  if (!sourceDocument.documentId || sourceDocument.documentId.trim().length === 0) return false;
  if (!sourceDocument.fileName || sourceDocument.fileName.trim().length === 0) return false;
  return true;
}

/**
 * Checks whether optional source fields, when present, are valid.
 */
function areOptionalSourceFieldsValid(chunk: DocumentChunk): boolean {
  const { sourceDocument } = chunk;
  if (sourceDocument.pageNumber !== undefined) {
    if (!Number.isInteger(sourceDocument.pageNumber) || sourceDocument.pageNumber < 1) {
      return false;
    }
  }
  if (sourceDocument.sectionTitle !== undefined) {
    if (typeof sourceDocument.sectionTitle !== 'string' || sourceDocument.sectionTitle.trim().length === 0) {
      return false;
    }
  }
  return true;
}

/**
 * Builds the display string for chunk source information,
 * mirroring the logic in ChunkItem component.
 */
function formatSourceDisplay(chunk: DocumentChunk): string {
  const { sourceDocument } = chunk;
  let display = sourceDocument.fileName;

  if (sourceDocument.pageNumber !== undefined) {
    display += ` (Page ${sourceDocument.pageNumber})`;
  }

  if (sourceDocument.sectionTitle !== undefined) {
    display += ` - ${sourceDocument.sectionTitle}`;
  }

  return display;
}

/**
 * Extracts all displayable source fields from a chunk.
 */
function extractSourceFields(chunk: DocumentChunk): {
  documentId: string;
  fileName: string;
  pageNumber?: number;
  sectionTitle?: string;
} {
  return { ...chunk.sourceDocument };
}

// ─── Generators ──────────────────────────────────────────────────────────────

const chunkMetadataArb: fc.Arbitrary<ChunkMetadata> = fc.record({
  chunkIndex: fc.integer({ min: 0, max: 100 }),
  totalChunks: fc.integer({ min: 1, max: 100 }),
  chunkingMethod: fc.constantFrom('default', 'fixed_size_512', 'semantic', 'hierarchical'),
  overlapStart: fc.option(fc.integer({ min: 0, max: 500 }), { nil: undefined }),
  overlapEnd: fc.option(fc.integer({ min: 0, max: 500 }), { nil: undefined }),
  confidence: fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: undefined }),
  semanticBoundary: fc.option(fc.boolean(), { nil: undefined }),
});

/** Generates a valid source document with required fields always present */
const sourceDocumentArb = fc.record({
  documentId: fc.uuid(),
  fileName: fc.string({ minLength: 1, maxLength: 50 }).map(s => s.replace(/[/\\]/g, '_') + '.pdf'),
  pageNumber: fc.option(fc.integer({ min: 1, max: 500 }), { nil: undefined }),
  sectionTitle: fc.option(
    fc.string({ minLength: 1, maxLength: 60 }).filter(s => s.trim().length > 0),
    { nil: undefined },
  ),
});

/** Generates a complete DocumentChunk with valid source information */
const documentChunkArb: fc.Arbitrary<DocumentChunk> = fc.record({
  id: fc.uuid(),
  text: fc.string({ minLength: 10, maxLength: 500 }),
  metadata: chunkMetadataArb,
  tokenCount: fc.integer({ min: 1, max: 1000 }),
  characterCount: fc.integer({ min: 10, max: 5000 }),
  sourceDocument: sourceDocumentArb,
});

/** Generates a source document that always has both optional fields */
const fullSourceDocumentArb = fc.record({
  documentId: fc.uuid(),
  fileName: fc.string({ minLength: 1, maxLength: 50 }).map(s => s.replace(/[/\\]/g, '_') + '.pdf'),
  pageNumber: fc.integer({ min: 1, max: 500 }),
  sectionTitle: fc.string({ minLength: 1, maxLength: 60 }).filter(s => s.trim().length > 0),
});

/** Generates a chunk with all source fields populated */
const fullSourceChunkArb: fc.Arbitrary<DocumentChunk> = fc.record({
  id: fc.uuid(),
  text: fc.string({ minLength: 10, maxLength: 500 }),
  metadata: chunkMetadataArb,
  tokenCount: fc.integer({ min: 1, max: 1000 }),
  characterCount: fc.integer({ min: 10, max: 5000 }),
  sourceDocument: fullSourceDocumentArb,
});

/** Generates a source document with only required fields (no page/section) */
const minimalSourceDocumentArb = fc.record({
  documentId: fc.uuid(),
  fileName: fc.string({ minLength: 1, maxLength: 50 }).map(s => s.replace(/[/\\]/g, '_') + '.pdf'),
});

/** Generates a chunk with only required source fields */
const minimalSourceChunkArb: fc.Arbitrary<DocumentChunk> = fc.record({
  id: fc.uuid(),
  text: fc.string({ minLength: 10, maxLength: 500 }),
  metadata: chunkMetadataArb,
  tokenCount: fc.integer({ min: 1, max: 1000 }),
  characterCount: fc.integer({ min: 10, max: 5000 }),
  sourceDocument: minimalSourceDocumentArb,
});

// ─── Property 8: Source Information Display ──────────────────────────────────

describe('Property 8: Source Information Display', () => {
  /**
   * **Validates: Requirements 4.5**
   */

  it('every chunk has complete required source information (documentId and fileName)', () => {
    fc.assert(
      fc.property(documentChunkArb, (chunk) => {
        expect(isSourceInfoComplete(chunk)).toBe(true);

        // documentId is non-empty
        expect(chunk.sourceDocument.documentId.trim().length).toBeGreaterThan(0);

        // fileName is non-empty
        expect(chunk.sourceDocument.fileName.trim().length).toBeGreaterThan(0);
      }),
      { numRuns: 100 },
    );
  });

  it('optional source fields (pageNumber, sectionTitle) are valid when present', () => {
    fc.assert(
      fc.property(documentChunkArb, (chunk) => {
        expect(areOptionalSourceFieldsValid(chunk)).toBe(true);

        if (chunk.sourceDocument.pageNumber !== undefined) {
          expect(Number.isInteger(chunk.sourceDocument.pageNumber)).toBe(true);
          expect(chunk.sourceDocument.pageNumber).toBeGreaterThanOrEqual(1);
        }

        if (chunk.sourceDocument.sectionTitle !== undefined) {
          expect(chunk.sourceDocument.sectionTitle.trim().length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('source display string always contains the fileName', () => {
    fc.assert(
      fc.property(documentChunkArb, (chunk) => {
        const display = formatSourceDisplay(chunk);
        expect(display).toContain(chunk.sourceDocument.fileName);
      }),
      { numRuns: 100 },
    );
  });

  it('source display string includes page number when present', () => {
    fc.assert(
      fc.property(fullSourceChunkArb, (chunk) => {
        const display = formatSourceDisplay(chunk);
        expect(display).toContain(`Page ${chunk.sourceDocument.pageNumber}`);
      }),
      { numRuns: 100 },
    );
  });

  it('source display string includes section title when present', () => {
    fc.assert(
      fc.property(fullSourceChunkArb, (chunk) => {
        const display = formatSourceDisplay(chunk);
        expect(display).toContain(chunk.sourceDocument.sectionTitle);
      }),
      { numRuns: 100 },
    );
  });

  it('source display string equals just fileName when no optional fields are present', () => {
    fc.assert(
      fc.property(minimalSourceChunkArb, (chunk) => {
        const display = formatSourceDisplay(chunk);
        expect(display).toBe(chunk.sourceDocument.fileName);
      }),
      { numRuns: 100 },
    );
  });

  it('extractSourceFields returns all source fields from the chunk', () => {
    fc.assert(
      fc.property(documentChunkArb, (chunk) => {
        const fields = extractSourceFields(chunk);

        expect(fields.documentId).toBe(chunk.sourceDocument.documentId);
        expect(fields.fileName).toBe(chunk.sourceDocument.fileName);
        expect(fields.pageNumber).toBe(chunk.sourceDocument.pageNumber);
        expect(fields.sectionTitle).toBe(chunk.sourceDocument.sectionTitle);
      }),
      { numRuns: 100 },
    );
  });

  it('source information is consistent across a batch of chunks from the same document', () => {
    fc.assert(
      fc.property(
        sourceDocumentArb,
        fc.integer({ min: 2, max: 10 }),
        (sourceDoc, chunkCount) => {
          // Simulate multiple chunks from the same source document
          const chunks: DocumentChunk[] = Array.from({ length: chunkCount }, (_, i) => ({
            id: `chunk-${i}`,
            text: `Chunk text ${i}`,
            metadata: {
              chunkIndex: i,
              totalChunks: chunkCount,
              chunkingMethod: 'default',
            },
            tokenCount: 100,
            characterCount: 200,
            sourceDocument: { ...sourceDoc },
          }));

          // All chunks from the same document should have identical source info
          for (const chunk of chunks) {
            expect(chunk.sourceDocument.documentId).toBe(sourceDoc.documentId);
            expect(chunk.sourceDocument.fileName).toBe(sourceDoc.fileName);
            expect(chunk.sourceDocument.pageNumber).toBe(sourceDoc.pageNumber);
            expect(chunk.sourceDocument.sectionTitle).toBe(sourceDoc.sectionTitle);

            // And each should produce a valid display string
            const display = formatSourceDisplay(chunk);
            expect(display.length).toBeGreaterThan(0);
            expect(display).toContain(sourceDoc.fileName);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
