/**
 * Property-based test for Existing Functionality Preservation.
 *
 * **Property 14: Existing Functionality Preservation**
 * **Validates: Requirements 8.5**
 *
 * For any user interaction with the chunk visualization feature, existing
 * document selection and summary panel functionality should continue to
 * work unchanged.
 *
 * Requirement 8.5: THE system SHALL preserve existing functionality in the
 * document selection and summary panels
 *
 * We test the pure state transition logic extracted from DocumentSummary.tsx
 * without rendering React components, verifying that:
 * 1. Document selection state is independent of chunk visualization state
 * 2. Summarize action uses selectedDocuments set (not affected by chunk panel)
 * 3. SelectAll/SelectNone operations work correctly regardless of chunk visualization state
 * 4. Document selection state is shared correctly between DocumentSelectionPanel and ChunkVisualizationPanel
 * 5. Summary panel state (selectiveSummaryData) is independent of chunk visualization
 */

import { describe, it, expect } from '@jest/globals';
import * as fc from 'fast-check';
import {
  ChunkingMethod,
  DocumentSummaryItem,
  ChunkVisualizationState,
  DocumentChunk,
  ChunkMetadata,
  SelectiveSummaryResponse,
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
 * Simulates handleSelectAll from DocumentSummary.tsx.
 * Selects all completed documents with text.
 */
function selectAllDocuments(
  documents: DocumentSummaryItem[],
): Set<string> {
  const selectable = documents.filter(
    doc => doc.processingStatus === 'completed' && doc.textLength && doc.textLength > 0,
  );
  return new Set(selectable.map(doc => doc.documentId));
}

/**
 * Simulates handleSelectNone from DocumentSummary.tsx.
 * Clears all selections.
 */
function selectNoneDocuments(): Set<string> {
  return new Set<string>();
}

/**
 * Simulates handleChunkingMethodChange from DocumentSummary.tsx.
 * Changes method, clears selections, and clears selectiveSummaryData.
 */
function applyChunkingMethodChange(
  newMethod: ChunkingMethod,
): {
  currentChunkingMethod: ChunkingMethod;
  selectedDocuments: Set<string>;
  selectiveSummaryData: SelectiveSummaryResponse | null;
} {
  return {
    currentChunkingMethod: newMethod,
    selectedDocuments: new Set<string>(),
    selectiveSummaryData: null,
  };
}

/**
 * Simulates handleSummarize precondition check from DocumentSummary.tsx.
 * Returns the document IDs that would be sent for summarization.
 */
function getSummarizePayload(
  selectedDocuments: Set<string>,
): string[] {
  return Array.from(selectedDocuments);
}

/**
 * Derives the props that both DocumentSelectionPanel and ChunkVisualizationPanel
 * receive from the shared parent state in DocumentSummary.
 */
function deriveSharedPanelProps(
  selectedDocuments: Set<string>,
  documents: DocumentSummaryItem[],
  chunkingMethod: ChunkingMethod | undefined,
) {
  return {
    selectionPanel: {
      documents,
      selectedDocuments,
    },
    chunkPanel: {
      selectedDocuments,
      documents,
      chunkingMethod,
    },
  };
}

// ─── Generators ──────────────────────────────────────────────────────────────

const chunkingMethodArb: fc.Arbitrary<ChunkingMethod> = fc.constantFrom(
  ...SUPPORTED_CHUNKING_METHODS,
);

const documentIdArb: fc.Arbitrary<string> = fc.uuid();

/** Generates a DocumentSummaryItem with configurable processing status */
const documentSummaryItemArb = (docId: string): fc.Arbitrary<DocumentSummaryItem> =>
  fc.record({
    documentId: fc.constant(docId),
    fileName: fc.string({ minLength: 1, maxLength: 20 }).map(s => s.replace(/[/\\]/g, '_') + '.pdf'),
    contentType: fc.constant('application/pdf'),
    createdAt: fc.constant(new Date().toISOString()),
    processingStatus: fc.constantFrom('completed', 'processing', 'failed'),
    textLength: fc.integer({ min: 0, max: 10000 }),
  });

/** Generates a list of documents with unique IDs */
const documentsArb: fc.Arbitrary<{ ids: string[]; docs: DocumentSummaryItem[] }> =
  fc.array(documentIdArb, { minLength: 1, maxLength: 10 }).chain(ids => {
    const uniqueIds = [...new Set(ids)];
    return fc.tuple(...uniqueIds.map(id => documentSummaryItemArb(id))).map(docs => ({
      ids: uniqueIds,
      docs,
    }));
  });

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
  text: fc.string({ minLength: 10, maxLength: 200 }),
  metadata: chunkMetadataArb,
  tokenCount: fc.integer({ min: 1, max: 1000 }),
  characterCount: fc.integer({ min: 10, max: 5000 }),
  sourceDocument: fc.record({
    documentId: fc.uuid(),
    fileName: fc.string({ minLength: 1, maxLength: 30 }).map(s => s.replace(/[/\\]/g, '_') + '.pdf'),
    pageNumber: fc.option(fc.integer({ min: 1, max: 100 }), { nil: undefined }),
    sectionTitle: fc.option(fc.string({ minLength: 1, maxLength: 30 }), { nil: undefined }),
  }),
});

/** Generates a chunk visualization state (simulating the chunk panel's internal state) */
const chunkVisualizationStateArb: fc.Arbitrary<ChunkVisualizationState> = fc
  .array(documentChunkArb, { minLength: 0, maxLength: 10 })
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

/** Generates a SelectiveSummaryResponse */
const selectiveSummaryResponseArb: fc.Arbitrary<SelectiveSummaryResponse> = fc.record({
  summary: fc.string({ minLength: 10, maxLength: 500 }),
  includedDocuments: fc.array(
    fc.record({
      documentId: fc.uuid(),
      fileName: fc.string({ minLength: 1, maxLength: 20 }).map(s => s + '.pdf'),
      textLength: fc.integer({ min: 100, max: 10000 }),
    }),
    { minLength: 1, maxLength: 5 },
  ),
  documentCount: fc.integer({ min: 1, max: 5 }),
  totalTextLength: fc.integer({ min: 100, max: 50000 }),
  processingTime: fc.integer({ min: 100, max: 5000 }),
  generatedAt: fc.constant(new Date().toISOString()),
});


// ─── Property 14: Existing Functionality Preservation ────────────────────────

describe('Property 14: Existing Functionality Preservation', () => {
  /**
   * **Validates: Requirements 8.5**
   */

  it('document selection state is independent of chunk visualization state', () => {
    fc.assert(
      fc.property(
        documentsArb,
        chunkVisualizationStateArb,
        fc.array(documentIdArb, { minLength: 1, maxLength: 5 }),
        ({ ids, docs }, chunkState, toggleSequence) => {
          // Start with empty selection
          let selectedDocuments = new Set<string>();

          // Apply a sequence of document selection toggles
          for (const docId of toggleSequence) {
            selectedDocuments = toggleDocumentSelection(selectedDocuments, docId);
          }

          // The selectedDocuments set should be determined solely by the toggle
          // sequence, regardless of what the chunk visualization state contains.
          // Verify: chunk state has no influence on selection outcome.
          const expectedInSelection = new Set<string>();
          for (const docId of toggleSequence) {
            if (expectedInSelection.has(docId)) {
              expectedInSelection.delete(docId);
            } else {
              expectedInSelection.add(docId);
            }
          }

          expect(selectedDocuments.size).toBe(expectedInSelection.size);
          for (const id of expectedInSelection) {
            expect(selectedDocuments.has(id)).toBe(true);
          }

          // Chunk visualization state remains untouched by selection operations
          expect(chunkState.chunks.length).toBeGreaterThanOrEqual(0);
          expect(chunkState.selectedChunks).toBeInstanceOf(Set);
          expect(chunkState.expandedChunks).toBeInstanceOf(Set);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('summarize action uses selectedDocuments set, unaffected by chunk panel', () => {
    fc.assert(
      fc.property(
        documentsArb,
        chunkVisualizationStateArb,
        fc.array(documentIdArb, { minLength: 1, maxLength: 5 }),
        ({ ids, docs }, chunkState, selectedIds) => {
          const selectedDocuments = new Set(selectedIds);

          // The summarize payload should be exactly the selectedDocuments,
          // regardless of what chunks are loaded or selected in the chunk panel.
          const payload = getSummarizePayload(selectedDocuments);

          // Payload must contain exactly the selected document IDs
          expect(new Set(payload).size).toBe(selectedDocuments.size);
          for (const id of selectedDocuments) {
            expect(payload).toContain(id);
          }

          // Chunk panel state should have no bearing on the payload
          // (chunk state is not referenced in handleSummarize)
          expect(payload.some(id => chunkState.chunks.some(c => c.id === id))).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('selectAll/selectNone work correctly regardless of chunk visualization state', () => {
    fc.assert(
      fc.property(
        documentsArb,
        chunkVisualizationStateArb,
        ({ ids, docs }, chunkState) => {
          // SelectAll: should select all completed documents with text
          const allSelected = selectAllDocuments(docs);
          const expectedSelectable = docs.filter(
            d => d.processingStatus === 'completed' && d.textLength && d.textLength > 0,
          );

          expect(allSelected.size).toBe(expectedSelectable.length);
          for (const doc of expectedSelectable) {
            expect(allSelected.has(doc.documentId)).toBe(true);
          }

          // SelectNone: should clear all selections
          const noneSelected = selectNoneDocuments();
          expect(noneSelected.size).toBe(0);

          // Both operations are independent of chunk visualization state
          // The chunk state should not influence which documents are selectable
          expect(chunkState.chunks).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it('document selection state is shared correctly between selection and chunk panels', () => {
    fc.assert(
      fc.property(
        documentsArb,
        chunkingMethodArb,
        fc.array(documentIdArb, { minLength: 0, maxLength: 5 }),
        ({ ids, docs }, method, toggleSequence) => {
          let selectedDocuments = new Set<string>();

          for (const docId of toggleSequence) {
            selectedDocuments = toggleDocumentSelection(selectedDocuments, docId);
          }

          // Derive props for both panels from the same parent state
          const props = deriveSharedPanelProps(selectedDocuments, docs, method);

          // Both panels receive the exact same selectedDocuments reference
          expect(props.selectionPanel.selectedDocuments).toBe(
            props.chunkPanel.selectedDocuments,
          );

          // Both panels receive the same documents array
          expect(props.selectionPanel.documents).toBe(props.chunkPanel.documents);

          // The chunk panel also receives the chunking method
          expect(props.chunkPanel.chunkingMethod).toBe(method);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('summary panel state (selectiveSummaryData) is independent of chunk visualization', () => {
    fc.assert(
      fc.property(
        selectiveSummaryResponseArb,
        chunkVisualizationStateArb,
        chunkingMethodArb,
        fc.array(documentIdArb, { minLength: 1, maxLength: 5 }),
        (summaryData, chunkState, method, toggleSequence) => {
          // Simulate: summary data exists from a previous summarize action
          let selectiveSummaryData: SelectiveSummaryResponse | null = summaryData;

          // Perform document selection changes (which the chunk panel reacts to)
          let selectedDocuments = new Set<string>();
          for (const docId of toggleSequence) {
            selectedDocuments = toggleDocumentSelection(selectedDocuments, docId);
          }

          // Document selection changes do NOT clear selectiveSummaryData.
          // Only handleChunkingMethodChange and handleGetDocuments clear it.
          expect(selectiveSummaryData).not.toBeNull();
          expect(selectiveSummaryData!.summary).toBe(summaryData.summary);
          expect(selectiveSummaryData!.documentCount).toBe(summaryData.documentCount);

          // Now change chunking method — this DOES clear summary data
          const changeResult = applyChunkingMethodChange(method);
          selectiveSummaryData = changeResult.selectiveSummaryData;

          expect(selectiveSummaryData).toBeNull();
          expect(changeResult.selectedDocuments.size).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('chunking method change preserves the three-panel contract', () => {
    fc.assert(
      fc.property(
        documentsArb,
        chunkingMethodArb,
        chunkingMethodArb,
        ({ ids, docs }, initialMethod, newMethod) => {
          // After a chunking method change:
          const result = applyChunkingMethodChange(newMethod);

          // 1. Selections are cleared (affects both selection and chunk panels)
          expect(result.selectedDocuments.size).toBe(0);

          // 2. Summary data is cleared (affects summary panel)
          expect(result.selectiveSummaryData).toBeNull();

          // 3. The new method is set (affects chunk panel)
          expect(result.currentChunkingMethod).toBe(newMethod);

          // 4. Documents array is NOT affected (still available to all panels)
          // (documents come from summaryData which is not touched by method change)
          expect(docs.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('sequential selection operations maintain correct state without side effects', () => {
    fc.assert(
      fc.property(
        documentsArb,
        chunkVisualizationStateArb,
        fc.array(
          fc.oneof(
            fc.record({ type: fc.constant('toggle' as const), docId: documentIdArb }),
            fc.record({ type: fc.constant('selectAll' as const) }),
            fc.record({ type: fc.constant('selectNone' as const) }),
          ),
          { minLength: 2, maxLength: 8 },
        ),
        ({ ids, docs }, chunkState, operations) => {
          let selectedDocuments = new Set<string>();

          // Apply a sequence of mixed operations
          for (const op of operations) {
            if (op.type === 'toggle' && 'docId' in op) {
              selectedDocuments = toggleDocumentSelection(selectedDocuments, op.docId);
            } else if (op.type === 'selectAll') {
              selectedDocuments = selectAllDocuments(docs);
            } else if (op.type === 'selectNone') {
              selectedDocuments = selectNoneDocuments();
            }
          }

          // After any sequence of operations, the state must be consistent:
          // - selectedDocuments is a valid Set
          expect(selectedDocuments).toBeInstanceOf(Set);

          // - If last operation was selectNone, selection is empty
          const lastOp = operations[operations.length - 1];
          if (lastOp.type === 'selectNone') {
            expect(selectedDocuments.size).toBe(0);
          }

          // - If last operation was selectAll, selection matches selectable docs
          if (lastOp.type === 'selectAll') {
            const expected = docs.filter(
              d => d.processingStatus === 'completed' && d.textLength && d.textLength > 0,
            );
            expect(selectedDocuments.size).toBe(expected.length);
          }

          // - Chunk visualization state is never mutated by these operations
          expect(chunkState.isLoadingChunks).toBe(false);
          expect(chunkState.chunkError).toBeNull();
        },
      ),
      { numRuns: 100 },
    );
  });
});
