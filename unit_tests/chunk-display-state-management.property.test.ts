/**
 * Property-based test for Chunk Display State Management.
 *
 * **Property 5: Chunk Display State Management**
 * **Validates: Requirements 3.4, 3.5**
 *
 * For any UI interaction that changes document selection, the system should
 * maintain consistent chunk display state and clear display when no documents
 * are selected.
 *
 * Requirements:
 * - 3.4: THE system SHALL maintain chunk display state during document selection changes
 * - 3.5: THE system SHALL clear chunk display when all documents are deselected
 *
 * We test the pure state transition logic extracted from ChunkVisualizationPanel
 * without rendering React components, verifying that:
 * 1. Selected chunks are preserved when documents change but selection is non-empty
 * 2. All state (chunks, selectedChunks, expandedChunks) is cleared when selection becomes empty
 * 3. State is cleared when chunking method changes (new chunks will be loaded)
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import {
  ChunkVisualizationState,
  DocumentChunk,
  ChunkMetadata,
  ChunkingMethod,
} from '../frontend/src/types';
import { SUPPORTED_CHUNKING_METHODS } from '../src/types';

// ─── State Transition Functions (extracted from component logic) ─────────────

/**
 * Simulates the useEffect logic in ChunkVisualizationPanel when
 * selectedDocuments or chunkingMethod changes.
 *
 * When documents are selected and a chunking method is active:
 *   - loadChunks() is called, which sets isLoadingChunks=true and preserves
 *     selectedChunks/expandedChunks (Req 3.4)
 *   - After loading, chunks are replaced but selectedChunks/expandedChunks remain
 *
 * When no documents are selected:
 *   - State is fully cleared (Req 3.5)
 */
function applySelectionChange(
  prevState: ChunkVisualizationState,
  selectedDocuments: Set<string>,
  chunkingMethod: ChunkingMethod | undefined,
  newChunks: DocumentChunk[],
): ChunkVisualizationState {
  if (selectedDocuments.size > 0 && chunkingMethod) {
    // Mirrors loadChunks() success path: chunks are replaced,
    // but selectedChunks and expandedChunks are preserved (Req 3.4)
    return {
      ...prevState,
      chunks: newChunks,
      isLoadingChunks: false,
      chunkError: null,
    };
  }

  // No documents selected → clear everything (Req 3.5)
  return {
    chunks: [],
    isLoadingChunks: false,
    chunkError: null,
    selectedChunks: new Set(),
    expandedChunks: new Set(),
  };
}

/**
 * Simulates the state transition when chunking method changes.
 * In DocumentSummary, handleChunkingMethodChange clears selectedDocuments
 * and selectiveSummaryData, which triggers the useEffect to clear state.
 */
function applyChunkingMethodChange(
  _prevState: ChunkVisualizationState,
): ChunkVisualizationState {
  // Chunking method change clears document selection in parent,
  // which triggers the empty-selection branch
  return {
    chunks: [],
    isLoadingChunks: false,
    chunkError: null,
    selectedChunks: new Set(),
    expandedChunks: new Set(),
  };
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

const documentChunkArb: fc.Arbitrary<DocumentChunk> = fc.record({
  id: fc.uuid(),
  text: fc.string({ minLength: 10, maxLength: 500 }),
  metadata: chunkMetadataArb,
  tokenCount: fc.integer({ min: 1, max: 1000 }),
  characterCount: fc.integer({ min: 10, max: 5000 }),
  sourceDocument: fc.record({
    documentId: fc.uuid(),
    fileName: fc.string({ minLength: 1, maxLength: 50 }).map(s => s.replace(/[/\\]/g, '_') + '.pdf'),
    pageNumber: fc.option(fc.integer({ min: 1, max: 100 }), { nil: undefined }),
    sectionTitle: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
  }),
});

const chunkingMethodArb: fc.Arbitrary<ChunkingMethod> = fc.constantFrom(
  ...SUPPORTED_CHUNKING_METHODS,
);

/** Generates a non-empty Set of document IDs */
const nonEmptyDocSelectionArb: fc.Arbitrary<Set<string>> = fc
  .array(fc.uuid(), { minLength: 1, maxLength: 10 })
  .map(ids => new Set(ids));

/** Generates a state with some chunks, selectedChunks, and expandedChunks */
const populatedStateArb: fc.Arbitrary<ChunkVisualizationState> = fc
  .array(documentChunkArb, { minLength: 1, maxLength: 20 })
  .chain(chunks => {
    const chunkIds = chunks.map(c => c.id);
    return fc.tuple(
      fc.constant(chunks),
      fc.subarray(chunkIds, { minLength: 0 }),
      fc.subarray(chunkIds, { minLength: 0 }),
    );
  })
  .map(([chunks, selectedIds, expandedIds]) => ({
    chunks,
    isLoadingChunks: false,
    chunkError: null,
    selectedChunks: new Set(selectedIds),
    expandedChunks: new Set(expandedIds),
  }));

// ─── Property 5: Chunk Display State Management ─────────────────────────────

describe('Property 5: Chunk Display State Management', () => {
  /**
   * **Validates: Requirements 3.4, 3.5**
   */

  it('preserves selectedChunks and expandedChunks when documents change but selection is non-empty (Req 3.4)', () => {
    fc.assert(
      fc.property(
        populatedStateArb,
        nonEmptyDocSelectionArb,
        chunkingMethodArb,
        fc.array(documentChunkArb, { minLength: 0, maxLength: 10 }),
        (prevState, selectedDocs, method, newChunks) => {
          const nextState = applySelectionChange(prevState, selectedDocs, method, newChunks);

          // selectedChunks must be preserved from previous state
          expect(nextState.selectedChunks).toBe(prevState.selectedChunks);

          // expandedChunks must be preserved from previous state
          expect(nextState.expandedChunks).toBe(prevState.expandedChunks);

          // Chunks are updated to the new set
          expect(nextState.chunks).toBe(newChunks);

          // No error state
          expect(nextState.chunkError).toBeNull();
          expect(nextState.isLoadingChunks).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('clears all state when all documents are deselected (Req 3.5)', () => {
    fc.assert(
      fc.property(
        populatedStateArb,
        fc.option(chunkingMethodArb, { nil: undefined }),
        (prevState, method) => {
          const emptySelection = new Set<string>();
          const nextState = applySelectionChange(prevState, emptySelection, method, []);

          // All chunks must be cleared
          expect(nextState.chunks).toEqual([]);

          // Selected chunks must be cleared
          expect(nextState.selectedChunks.size).toBe(0);

          // Expanded chunks must be cleared
          expect(nextState.expandedChunks.size).toBe(0);

          // No error or loading state
          expect(nextState.chunkError).toBeNull();
          expect(nextState.isLoadingChunks).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('clears all state when chunking method is undefined with non-empty selection', () => {
    fc.assert(
      fc.property(
        populatedStateArb,
        nonEmptyDocSelectionArb,
        (prevState, selectedDocs) => {
          // When chunkingMethod is undefined, the component clears state
          const nextState = applySelectionChange(prevState, selectedDocs, undefined, []);

          expect(nextState.chunks).toEqual([]);
          expect(nextState.selectedChunks.size).toBe(0);
          expect(nextState.expandedChunks.size).toBe(0);
          expect(nextState.chunkError).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('clears all state when chunking method changes (triggers parent to reset selection)', () => {
    fc.assert(
      fc.property(
        populatedStateArb,
        (prevState) => {
          const nextState = applyChunkingMethodChange(prevState);

          // Everything must be cleared on method change
          expect(nextState.chunks).toEqual([]);
          expect(nextState.selectedChunks.size).toBe(0);
          expect(nextState.expandedChunks.size).toBe(0);
          expect(nextState.chunkError).toBeNull();
          expect(nextState.isLoadingChunks).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('state transitions are idempotent for repeated empty selections', () => {
    fc.assert(
      fc.property(
        populatedStateArb,
        fc.option(chunkingMethodArb, { nil: undefined }),
        (prevState, method) => {
          const emptySelection = new Set<string>();

          // Apply empty selection twice
          const state1 = applySelectionChange(prevState, emptySelection, method, []);
          const state2 = applySelectionChange(state1, emptySelection, method, []);

          // Both should produce equivalent cleared state
          expect(state2.chunks).toEqual(state1.chunks);
          expect(state2.selectedChunks.size).toBe(state1.selectedChunks.size);
          expect(state2.expandedChunks.size).toBe(state1.expandedChunks.size);
          expect(state2.chunkError).toBe(state1.chunkError);
          expect(state2.isLoadingChunks).toBe(state1.isLoadingChunks);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('preserves state through multiple non-empty selection changes (Req 3.4)', () => {
    fc.assert(
      fc.property(
        populatedStateArb,
        fc.array(nonEmptyDocSelectionArb, { minLength: 2, maxLength: 5 }),
        chunkingMethodArb,
        fc.array(fc.array(documentChunkArb, { minLength: 0, maxLength: 5 }), { minLength: 2, maxLength: 5 }),
        (initialState, selections, method, chunkSets) => {
          let currentState = initialState;

          // Apply multiple selection changes, each with new chunks
          const count = Math.min(selections.length, chunkSets.length);
          for (let i = 0; i < count; i++) {
            currentState = applySelectionChange(currentState, selections[i], method, chunkSets[i]);
          }

          // After all changes, selectedChunks and expandedChunks should still
          // be the same object reference from the initial state (preserved)
          expect(currentState.selectedChunks).toBe(initialState.selectedChunks);
          expect(currentState.expandedChunks).toBe(initialState.expandedChunks);

          // Chunks should be the last set applied
          expect(currentState.chunks).toBe(chunkSets[count - 1]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
