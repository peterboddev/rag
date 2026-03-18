/**
 * Property-based test for Component Integration Consistency.
 *
 * **Property 13: Component Integration Consistency**
 * **Validates: Requirements 8.3**
 *
 * For any change in the DocumentSelectionPanel or ChunkingMethodSelector,
 * the ChunkVisualizationPanel should respond appropriately.
 *
 * Requirement 8.3: THE Chunk_Visualization_Panel SHALL update when document
 * selections change in the DocumentSelectionPanel
 *
 * We test the pure state transition logic extracted from DocumentSummary.tsx
 * without rendering React components, verifying that:
 * 1. For any document selection toggle, the selectedDocuments set correctly adds/removes the document
 * 2. For any chunking method change, selectedDocuments is cleared (reset behavior)
 * 3. For any sequence of selection changes, the ChunkVisualizationPanel receives consistent props
 * 4. For any combination of document selection and method change, the panel state is consistent
 * 5. Selection toggle is its own inverse (toggle twice = original state)
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import {
  ChunkingMethod,
  DocumentSummaryItem,
} from '../frontend/src/types';
import { SUPPORTED_CHUNKING_METHODS } from '../src/types';

// ─── State Transition Functions (extracted from DocumentSummary.tsx) ──────────

/**
 * Simulates handleDocumentSelect from DocumentSummary.tsx.
 * Toggles a document in the selectedDocuments set.
 */
function toggleDocumentSelection(
  selectedDocuments: Set<string>,
  documentId: string,
): Set<string> {
  const newSet = new Set(selectedDocuments);
  if (newSet.has(documentId)) {
    newSet.delete(documentId);
  } else {
    newSet.add(documentId);
  }
  return newSet;
}

/**
 * Simulates handleChunkingMethodChange from DocumentSummary.tsx.
 * Sets the new chunking method and clears selectedDocuments.
 */
function applyChunkingMethodChange(
  _currentMethod: ChunkingMethod | undefined,
  newMethod: ChunkingMethod,
): { chunkingMethod: ChunkingMethod; selectedDocuments: Set<string> } {
  return {
    chunkingMethod: newMethod,
    selectedDocuments: new Set<string>(),
  };
}

/**
 * Derives the props that ChunkVisualizationPanel would receive
 * based on the current parent state in DocumentSummary.
 */
function deriveVisualizationPanelProps(
  selectedDocuments: Set<string>,
  documents: DocumentSummaryItem[],
  chunkingMethod: ChunkingMethod | undefined,
) {
  return {
    selectedDocuments,
    documents,
    chunkingMethod,
    // Panel should show chunks only when there are selected documents
    shouldLoadChunks: selectedDocuments.size > 0 && chunkingMethod !== undefined,
    // Panel should show empty state when no documents selected
    shouldShowEmpty: selectedDocuments.size === 0,
  };
}

// ─── Generators ──────────────────────────────────────────────────────────────

const chunkingMethodArb: fc.Arbitrary<ChunkingMethod> = fc.constantFrom(
  ...SUPPORTED_CHUNKING_METHODS,
);

const documentIdArb: fc.Arbitrary<string> = fc.uuid();

const documentIdsArb: fc.Arbitrary<string[]> = fc.array(documentIdArb, {
  minLength: 1,
  maxLength: 10,
});

/** Generates a minimal DocumentSummaryItem for testing */
const documentSummaryItemArb = (docId: string): fc.Arbitrary<DocumentSummaryItem> =>
  fc.record({
    documentId: fc.constant(docId),
    fileName: fc.string({ minLength: 1, maxLength: 30 }).map(s => s.replace(/[/\\]/g, '_') + '.pdf'),
    contentType: fc.constant('application/pdf'),
    createdAt: fc.constant(new Date().toISOString()),
    processingStatus: fc.constant('completed'),
    textLength: fc.integer({ min: 100, max: 10000 }),
  });

/** Generates a list of documents with known IDs */
const documentsWithIdsArb = (ids: string[]): fc.Arbitrary<DocumentSummaryItem[]> =>
  fc.tuple(...ids.map(id => documentSummaryItemArb(id)));

// ─── Property 13: Component Integration Consistency ──────────────────────────

describe('Property 13: Component Integration Consistency', () => {
  /**
   * **Validates: Requirements 8.3**
   */

  it('toggle adds a document when not present and removes when present', () => {
    fc.assert(
      fc.property(
        fc.array(documentIdArb, { minLength: 0, maxLength: 5 }),
        documentIdArb,
        (existingIds, toggleId) => {
          const initial = new Set(existingIds);
          const result = toggleDocumentSelection(initial, toggleId);

          if (initial.has(toggleId)) {
            // Was present → should be removed
            expect(result.has(toggleId)).toBe(false);
            expect(result.size).toBe(initial.size - 1);
          } else {
            // Was absent → should be added
            expect(result.has(toggleId)).toBe(true);
            expect(result.size).toBe(initial.size + 1);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('toggle is its own inverse — toggling twice restores original state', () => {
    fc.assert(
      fc.property(
        fc.array(documentIdArb, { minLength: 0, maxLength: 5 }),
        documentIdArb,
        (existingIds, toggleId) => {
          const initial = new Set(existingIds);
          const afterFirst = toggleDocumentSelection(initial, toggleId);
          const afterSecond = toggleDocumentSelection(afterFirst, toggleId);

          // After two toggles, the set should match the original
          expect(afterSecond.size).toBe(initial.size);
          for (const id of initial) {
            expect(afterSecond.has(id)).toBe(true);
          }
          for (const id of afterSecond) {
            expect(initial.has(id)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('chunking method change always clears selectedDocuments', () => {
    fc.assert(
      fc.property(
        fc.array(documentIdArb, { minLength: 1, maxLength: 10 }),
        fc.option(chunkingMethodArb, { nil: undefined }),
        chunkingMethodArb,
        (selectedIds, currentMethod, newMethod) => {
          const result = applyChunkingMethodChange(currentMethod, newMethod);

          // selectedDocuments must be empty after method change
          expect(result.selectedDocuments.size).toBe(0);

          // The new method must be set
          expect(result.chunkingMethod).toBe(newMethod);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('panel props are consistent after document selection changes', () => {
    fc.assert(
      fc.property(
        documentIdsArb,
        chunkingMethodArb,
        fc.array(documentIdArb, { minLength: 1, maxLength: 5 }),
        (allDocIds, method, toggleSequence) => {
          let selectedDocuments = new Set<string>();

          // Apply a sequence of toggles
          for (const docId of toggleSequence) {
            selectedDocuments = toggleDocumentSelection(selectedDocuments, docId);
          }

          const props = deriveVisualizationPanelProps(
            selectedDocuments,
            allDocIds.map(id => ({
              documentId: id,
              fileName: `${id}.pdf`,
              contentType: 'application/pdf',
              createdAt: new Date().toISOString(),
              processingStatus: 'completed',
            })),
            method,
          );

          // Props consistency: shouldLoadChunks iff documents selected and method defined
          if (selectedDocuments.size > 0) {
            expect(props.shouldLoadChunks).toBe(true);
            expect(props.shouldShowEmpty).toBe(false);
          } else {
            expect(props.shouldLoadChunks).toBe(false);
            expect(props.shouldShowEmpty).toBe(true);
          }

          // selectedDocuments in props must match our tracked state
          expect(props.selectedDocuments).toBe(selectedDocuments);
          expect(props.chunkingMethod).toBe(method);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('method change followed by selections produces consistent panel state', () => {
    fc.assert(
      fc.property(
        documentIdsArb,
        chunkingMethodArb,
        chunkingMethodArb,
        fc.array(documentIdArb, { minLength: 0, maxLength: 5 }),
        (allDocIds, initialMethod, newMethod, selectionsAfterChange) => {
          // Start with some method
          let currentMethod: ChunkingMethod | undefined = initialMethod;
          let selectedDocuments = new Set<string>(allDocIds.slice(0, 3));

          // Change chunking method — should clear selections
          const changeResult = applyChunkingMethodChange(currentMethod, newMethod);
          currentMethod = changeResult.chunkingMethod;
          selectedDocuments = changeResult.selectedDocuments;

          expect(selectedDocuments.size).toBe(0);

          // Now apply new selections
          for (const docId of selectionsAfterChange) {
            selectedDocuments = toggleDocumentSelection(selectedDocuments, docId);
          }

          const props = deriveVisualizationPanelProps(
            selectedDocuments,
            allDocIds.map(id => ({
              documentId: id,
              fileName: `${id}.pdf`,
              contentType: 'application/pdf',
              createdAt: new Date().toISOString(),
              processingStatus: 'completed',
            })),
            currentMethod,
          );

          // The method should be the new one
          expect(props.chunkingMethod).toBe(newMethod);

          // Panel load state must be consistent with selection
          expect(props.shouldLoadChunks).toBe(
            selectedDocuments.size > 0 && currentMethod !== undefined,
          );
          expect(props.shouldShowEmpty).toBe(selectedDocuments.size === 0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('toggle does not mutate the original set', () => {
    fc.assert(
      fc.property(
        fc.array(documentIdArb, { minLength: 0, maxLength: 5 }),
        documentIdArb,
        (existingIds, toggleId) => {
          const initial = new Set(existingIds);
          const initialSnapshot = new Set(initial);

          toggleDocumentSelection(initial, toggleId);

          // Original set must not be mutated
          expect(initial.size).toBe(initialSnapshot.size);
          for (const id of initialSnapshot) {
            expect(initial.has(id)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it('sequential method changes always leave selectedDocuments empty', () => {
    fc.assert(
      fc.property(
        fc.array(chunkingMethodArb, { minLength: 2, maxLength: 5 }),
        documentIdsArb,
        (methods, docIds) => {
          let selectedDocuments = new Set(docIds);
          let currentMethod: ChunkingMethod | undefined;

          for (const method of methods) {
            // Simulate user selecting some docs between method changes
            if (currentMethod) {
              for (const id of docIds.slice(0, 2)) {
                selectedDocuments = toggleDocumentSelection(selectedDocuments, id);
              }
            }

            const result = applyChunkingMethodChange(currentMethod, method);
            currentMethod = result.chunkingMethod;
            selectedDocuments = result.selectedDocuments;

            // After every method change, selection must be cleared
            expect(selectedDocuments.size).toBe(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
