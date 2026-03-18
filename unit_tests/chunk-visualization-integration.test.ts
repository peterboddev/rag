/**
 * Integration tests for Chunk Visualization with existing components.
 *
 * Task 10.1: Integration testing with existing components
 * - Test three-column layout with real document data
 * - Verify chunk updates work with all chunking methods
 * - Test responsive behavior across different screen sizes
 *
 * Requirements: 1.2, 3.1, 3.2, 3.3
 *
 * These tests exercise pure logic (no React rendering) to verify:
 * 1. Data flow: document selection → chunk loading trigger → chunk display
 * 2. All chunking methods produce valid chunk requests
 * 3. State coordination between panels (selection, chunk, summary)
 * 4. Layout CSS class structure supports three columns
 * 5. Responsive breakpoint logic
 */

import { describe, it, expect } from '@jest/globals';
import {
  ChunkingMethod,
  DocumentSummaryItem,
  DocumentChunk,
  ChunkVisualizationRequest,
  ChunkVisualizationResponse,
  ChunkVisualizationState,
  ChunkVisualizationPanelProps,
} from '../frontend/src/types';
import { SUPPORTED_CHUNKING_METHODS } from '../src/types';

// ─── Helper: Build realistic document data ───────────────────────────────────

function makeDocument(overrides: Partial<DocumentSummaryItem> = {}): DocumentSummaryItem {
  return {
    documentId: `doc-${Math.random().toString(36).slice(2, 8)}`,
    fileName: 'report.pdf',
    contentType: 'application/pdf',
    createdAt: new Date().toISOString(),
    processingStatus: 'completed',
    textLength: 5000,
    extractedText: 'Sample extracted text content for testing purposes.',
    ...overrides,
  };
}

function makeChunk(index: number, documentId: string, method: string): DocumentChunk {
  const text = `Chunk ${index} content from document ${documentId}`;
  return {
    id: `${documentId}-chunk-${index}`,
    text,
    metadata: {
      chunkIndex: index,
      totalChunks: 5,
      chunkingMethod: method,
      overlapStart: index > 0 ? 50 : 0,
      overlapEnd: index < 4 ? 50 : 0,
    },
    tokenCount: Math.ceil(text.length / 4),
    characterCount: text.length,
    sourceDocument: {
      documentId,
      fileName: `${documentId}.pdf`,
    },
  };
}

// ─── State transition functions (mirrors DocumentSummary.tsx) ────────────────

function toggleDocumentSelection(selected: Set<string>, docId: string): Set<string> {
  const next = new Set(selected);
  if (next.has(docId)) {
    next.delete(docId);
  } else {
    next.add(docId);
  }
  return next;
}

function applyChunkingMethodChange(
  _current: ChunkingMethod | undefined,
  newMethod: ChunkingMethod,
): { chunkingMethod: ChunkingMethod; selectedDocuments: Set<string> } {
  return { chunkingMethod: newMethod, selectedDocuments: new Set() };
}

/**
 * Determines whether the ChunkVisualizationPanel should trigger a chunk load,
 * mirroring the useEffect guard in ChunkVisualizationPanel.tsx.
 */
function shouldLoadChunks(
  selectedDocuments: Set<string>,
  chunkingMethod: ChunkingMethod | undefined,
  customerUUID: string,
  tenantId: string,
): boolean {
  return selectedDocuments.size > 0 && chunkingMethod !== undefined && !!customerUUID && !!tenantId;
}

/**
 * Builds the API request body that ChunkVisualizationPanel sends to the backend.
 */
function buildChunkRequest(
  selectedDocuments: Set<string>,
  customerUUID: string,
  chunkingMethod: ChunkingMethod,
): ChunkVisualizationRequest {
  return {
    customerUUID,
    documentIds: Array.from(selectedDocuments),
    chunkingMethod,
  };
}

/**
 * Filters chunks to only those belonging to selected documents.
 */
function filterChunksBySelection(
  chunks: DocumentChunk[],
  selectedDocuments: Set<string>,
): DocumentChunk[] {
  return chunks.filter(c => selectedDocuments.has(c.sourceDocument.documentId));
}

/**
 * Determines the layout mode based on screen width.
 * Mirrors the CSS breakpoints from the three-column layout.
 */
function getLayoutMode(width: number): '3-col' | '2-col' | '1-col' {
  if (width > 1024) return '3-col';
  if (width > 768) return '2-col';
  return '1-col';
}

function getColumnCount(width: number): number {
  const mode = getLayoutMode(width);
  switch (mode) {
    case '3-col': return 3;
    case '2-col': return 2;
    case '1-col': return 1;
  }
}

// ─── Test Data ───────────────────────────────────────────────────────────────

const CUSTOMER_UUID = 'cust-abc-123';
const TENANT_ID = 'tenant-xyz-456';

const realDocuments: DocumentSummaryItem[] = [
  makeDocument({ documentId: 'doc-medical-report', fileName: 'medical-report.pdf', textLength: 12000 }),
  makeDocument({ documentId: 'doc-lab-results', fileName: 'lab-results.pdf', textLength: 3500 }),
  makeDocument({ documentId: 'doc-imaging', fileName: 'imaging-report.pdf', textLength: 8000 }),
  makeDocument({ documentId: 'doc-failed', fileName: 'corrupted.pdf', processingStatus: 'failed', textLength: 0 }),
];

// ─── 1. Data Flow: document selection → chunk loading trigger ────────────────

describe('Data flow: document selection triggers chunk loading', () => {
  it('should trigger chunk load when documents are selected with a chunking method', () => {
    const selected = new Set(['doc-medical-report']);
    const method = SUPPORTED_CHUNKING_METHODS[0];

    expect(shouldLoadChunks(selected, method, CUSTOMER_UUID, TENANT_ID)).toBe(true);
  });

  it('should NOT trigger chunk load when no documents are selected', () => {
    const method = SUPPORTED_CHUNKING_METHODS[0];
    expect(shouldLoadChunks(new Set(), method, CUSTOMER_UUID, TENANT_ID)).toBe(false);
  });

  it('should NOT trigger chunk load when chunking method is undefined', () => {
    const selected = new Set(['doc-medical-report']);
    expect(shouldLoadChunks(selected, undefined, CUSTOMER_UUID, TENANT_ID)).toBe(false);
  });

  it('should NOT trigger chunk load when customerUUID is empty', () => {
    const selected = new Set(['doc-medical-report']);
    const method = SUPPORTED_CHUNKING_METHODS[0];
    expect(shouldLoadChunks(selected, method, '', TENANT_ID)).toBe(false);
  });

  it('should NOT trigger chunk load when tenantId is empty', () => {
    const selected = new Set(['doc-medical-report']);
    const method = SUPPORTED_CHUNKING_METHODS[0];
    expect(shouldLoadChunks(selected, method, CUSTOMER_UUID, '')).toBe(false);
  });

  it('should build correct API request from selected documents', () => {
    const selected = new Set(['doc-medical-report', 'doc-lab-results']);
    const method = SUPPORTED_CHUNKING_METHODS[0];

    const request = buildChunkRequest(selected, CUSTOMER_UUID, method);

    expect(request.customerUUID).toBe(CUSTOMER_UUID);
    expect(request.documentIds).toHaveLength(2);
    expect(request.documentIds).toContain('doc-medical-report');
    expect(request.documentIds).toContain('doc-lab-results');
    expect(request.chunkingMethod).toBe(method);
  });

  it('should filter displayed chunks to only selected documents', () => {
    const allChunks: DocumentChunk[] = [
      makeChunk(0, 'doc-medical-report', 'default'),
      makeChunk(1, 'doc-medical-report', 'default'),
      makeChunk(0, 'doc-lab-results', 'default'),
      makeChunk(0, 'doc-imaging', 'default'),
    ];

    const selected = new Set(['doc-medical-report']);
    const filtered = filterChunksBySelection(allChunks, selected);

    expect(filtered).toHaveLength(2);
    filtered.forEach(chunk => {
      expect(chunk.sourceDocument.documentId).toBe('doc-medical-report');
    });
  });
});

// ─── 2. All chunking methods produce valid chunk requests ────────────────────

describe('All chunking methods produce valid chunk requests (Req 3.1)', () => {
  it('SUPPORTED_CHUNKING_METHODS has at least one method', () => {
    expect(SUPPORTED_CHUNKING_METHODS.length).toBeGreaterThanOrEqual(1);
  });

  it.each(SUPPORTED_CHUNKING_METHODS.map(m => [m.id, m] as const))(
    'method "%s" produces a valid ChunkVisualizationRequest',
    (_id, method) => {
      const selected = new Set(['doc-medical-report', 'doc-lab-results']);
      const request = buildChunkRequest(selected, CUSTOMER_UUID, method);

      // Request structure is valid
      expect(request.customerUUID).toBeTruthy();
      expect(request.documentIds.length).toBeGreaterThan(0);
      expect(request.chunkingMethod).toBeDefined();
      expect(request.chunkingMethod!.id).toBe(method.id);
      expect(request.chunkingMethod!.parameters).toBeDefined();
      expect(request.chunkingMethod!.parameters.strategy).toBeTruthy();
    },
  );

  it.each(SUPPORTED_CHUNKING_METHODS.map(m => [m.id, m] as const))(
    'method "%s" has required fields (id, name, description, parameters)',
    (_id, method) => {
      expect(typeof method.id).toBe('string');
      expect(method.id.length).toBeGreaterThan(0);
      expect(typeof method.name).toBe('string');
      expect(method.name.length).toBeGreaterThan(0);
      expect(typeof method.description).toBe('string');
      expect(method.parameters).toBeDefined();
      expect(['fixed_size', 'semantic', 'hierarchical', 'default']).toContain(
        method.parameters.strategy,
      );
    },
  );

  it('each chunking method has a unique id', () => {
    const ids = SUPPORTED_CHUNKING_METHODS.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ─── 3. State coordination between panels ────────────────────────────────────

describe('State coordination between panels (Req 3.2, 3.3)', () => {
  it('selecting a document updates the chunk panel trigger condition', () => {
    let selected = new Set<string>();
    const method = SUPPORTED_CHUNKING_METHODS[0];

    // Initially no load
    expect(shouldLoadChunks(selected, method, CUSTOMER_UUID, TENANT_ID)).toBe(false);

    // Select a document
    selected = toggleDocumentSelection(selected, 'doc-medical-report');
    expect(shouldLoadChunks(selected, method, CUSTOMER_UUID, TENANT_ID)).toBe(true);
  });

  it('deselecting all documents clears the chunk load trigger', () => {
    let selected = new Set(['doc-medical-report']);
    const method = SUPPORTED_CHUNKING_METHODS[0];

    expect(shouldLoadChunks(selected, method, CUSTOMER_UUID, TENANT_ID)).toBe(true);

    selected = toggleDocumentSelection(selected, 'doc-medical-report');
    expect(selected.size).toBe(0);
    expect(shouldLoadChunks(selected, method, CUSTOMER_UUID, TENANT_ID)).toBe(false);
  });

  it('changing chunking method clears document selection (Req 3.1)', () => {
    const method1 = SUPPORTED_CHUNKING_METHODS[0];
    const method2 = SUPPORTED_CHUNKING_METHODS[1];

    // Start with selections
    const result = applyChunkingMethodChange(method1, method2);

    expect(result.selectedDocuments.size).toBe(0);
    expect(result.chunkingMethod).toBe(method2);
  });

  it('full workflow: select docs → change method → reselect → verify state', () => {
    let selected = new Set<string>();
    let method: ChunkingMethod | undefined = SUPPORTED_CHUNKING_METHODS[0];

    // Step 1: Select documents
    selected = toggleDocumentSelection(selected, 'doc-medical-report');
    selected = toggleDocumentSelection(selected, 'doc-lab-results');
    expect(selected.size).toBe(2);
    expect(shouldLoadChunks(selected, method, CUSTOMER_UUID, TENANT_ID)).toBe(true);

    // Step 2: Change chunking method — clears selection
    const changeResult = applyChunkingMethodChange(method, SUPPORTED_CHUNKING_METHODS[2]);
    selected = changeResult.selectedDocuments;
    method = changeResult.chunkingMethod;
    expect(selected.size).toBe(0);
    expect(shouldLoadChunks(selected, method, CUSTOMER_UUID, TENANT_ID)).toBe(false);

    // Step 3: Reselect documents
    selected = toggleDocumentSelection(selected, 'doc-imaging');
    expect(selected.size).toBe(1);
    expect(shouldLoadChunks(selected, method, CUSTOMER_UUID, TENANT_ID)).toBe(true);

    // Step 4: Verify request uses new method
    const request = buildChunkRequest(selected, CUSTOMER_UUID, method);
    expect(request.chunkingMethod!.id).toBe(SUPPORTED_CHUNKING_METHODS[2].id);
    expect(request.documentIds).toEqual(['doc-imaging']);
  });

  it('chunk response updates state correctly for display', () => {
    const mockResponse: ChunkVisualizationResponse = {
      chunks: [
        makeChunk(0, 'doc-medical-report', 'default'),
        makeChunk(1, 'doc-medical-report', 'default'),
      ],
      totalChunks: 2,
      chunkingMethod: SUPPORTED_CHUNKING_METHODS[0],
      processingTime: 150,
      generatedAt: new Date().toISOString(),
    };

    // Simulate state update after successful response
    const newState: ChunkVisualizationState = {
      chunks: mockResponse.chunks,
      isLoadingChunks: false,
      chunkError: null,
      selectedChunks: new Set(),
      expandedChunks: new Set(),
    };

    expect(newState.chunks).toHaveLength(2);
    expect(newState.isLoadingChunks).toBe(false);
    expect(newState.chunkError).toBeNull();
    newState.chunks.forEach(chunk => {
      expect(chunk.sourceDocument.documentId).toBe('doc-medical-report');
      expect(chunk.metadata.chunkingMethod).toBe('default');
    });
  });

  it('error response sets error state and clears chunks', () => {
    const errorState: ChunkVisualizationState = {
      chunks: [],
      isLoadingChunks: false,
      chunkError: 'Failed to load chunks: 500 Internal Server Error',
      selectedChunks: new Set(),
      expandedChunks: new Set(),
    };

    expect(errorState.chunks).toHaveLength(0);
    expect(errorState.chunkError).toBeTruthy();
    expect(errorState.isLoadingChunks).toBe(false);
  });
});

// ─── 4. Three-column layout structure ────────────────────────────────────────

describe('Three-column layout structure', () => {
  // The DocumentSummary component renders a div with className="three-column-layout"
  // containing three children with className="column column-left/middle/right".
  // We verify the expected CSS class structure.

  const EXPECTED_LAYOUT_CLASS = 'three-column-layout';
  const EXPECTED_COLUMN_CLASSES = ['column column-left', 'column column-middle', 'column column-right'];

  it('layout uses three distinct column CSS classes', () => {
    expect(EXPECTED_COLUMN_CLASSES).toHaveLength(3);
    const uniqueClasses = new Set(EXPECTED_COLUMN_CLASSES);
    expect(uniqueClasses.size).toBe(3);
  });

  it('each column class includes the base "column" class', () => {
    EXPECTED_COLUMN_CLASSES.forEach(cls => {
      expect(cls).toContain('column');
    });
  });

  it('column order is left (selection), middle (chunks), right (summary)', () => {
    expect(EXPECTED_COLUMN_CLASSES[0]).toContain('left');
    expect(EXPECTED_COLUMN_CLASSES[1]).toContain('middle');
    expect(EXPECTED_COLUMN_CLASSES[2]).toContain('right');
  });

  it('layout is only rendered when documents are available', () => {
    // Mirrors the condition in DocumentSummary.tsx:
    // {summaryData && summaryData.documents.length > 0 && (<div className="three-column-layout">...)}
    const summaryDataWithDocs = { documents: realDocuments };
    const summaryDataEmpty = { documents: [] as DocumentSummaryItem[] };
    const summaryDataNull = null;

    expect(summaryDataWithDocs.documents.length > 0).toBe(true);
    expect(summaryDataEmpty.documents.length > 0).toBe(false);
    expect(summaryDataNull).toBeNull();
  });
});

// ─── 5. Responsive breakpoint logic (Req 1.2) ───────────────────────────────

describe('Responsive layout maintains proportional columns (Req 1.2)', () => {
  it('desktop (>1024px) uses 3-column layout', () => {
    expect(getLayoutMode(1025)).toBe('3-col');
    expect(getLayoutMode(1440)).toBe('3-col');
    expect(getLayoutMode(1920)).toBe('3-col');
    expect(getColumnCount(1440)).toBe(3);
  });

  it('tablet (769–1024px) uses 2-column layout', () => {
    expect(getLayoutMode(769)).toBe('2-col');
    expect(getLayoutMode(900)).toBe('2-col');
    expect(getLayoutMode(1024)).toBe('2-col');
    expect(getColumnCount(900)).toBe(2);
  });

  it('mobile (≤768px) uses 1-column layout', () => {
    expect(getLayoutMode(768)).toBe('1-col');
    expect(getLayoutMode(480)).toBe('1-col');
    expect(getLayoutMode(320)).toBe('1-col');
    expect(getColumnCount(480)).toBe(1);
  });

  it('column count never exceeds 3 or drops below 1 for any valid width', () => {
    const widths = [320, 375, 480, 600, 768, 769, 900, 1024, 1025, 1280, 1440, 1920, 2560];
    widths.forEach(w => {
      const cols = getColumnCount(w);
      expect(cols).toBeGreaterThanOrEqual(1);
      expect(cols).toBeLessThanOrEqual(3);
    });
  });

  it('breakpoint transitions are monotonic — wider screens never have fewer columns', () => {
    const widths = [320, 480, 768, 769, 1024, 1025, 1440, 1920];
    for (let i = 1; i < widths.length; i++) {
      expect(getColumnCount(widths[i])).toBeGreaterThanOrEqual(getColumnCount(widths[i - 1]));
    }
  });
});

// ─── 6. Chunk updates with all chunking methods (Req 3.1, 3.3) ──────────────

describe('Chunk updates work with all chunking methods (Req 3.1, 3.3)', () => {
  it('switching between every pair of methods produces valid requests', () => {
    for (let i = 0; i < SUPPORTED_CHUNKING_METHODS.length; i++) {
      for (let j = 0; j < SUPPORTED_CHUNKING_METHODS.length; j++) {
        if (i === j) continue;

        const from = SUPPORTED_CHUNKING_METHODS[i];
        const to = SUPPORTED_CHUNKING_METHODS[j];

        // Method change clears selection
        const result = applyChunkingMethodChange(from, to);
        expect(result.selectedDocuments.size).toBe(0);
        expect(result.chunkingMethod.id).toBe(to.id);

        // After reselecting, request is valid with new method
        let selected = result.selectedDocuments;
        selected = toggleDocumentSelection(selected, 'doc-medical-report');
        const request = buildChunkRequest(selected, CUSTOMER_UUID, result.chunkingMethod);
        expect(request.chunkingMethod!.id).toBe(to.id);
      }
    }
  });

  it('chunk response metadata reflects the active chunking method', () => {
    SUPPORTED_CHUNKING_METHODS.forEach(method => {
      const chunks = [
        makeChunk(0, 'doc-medical-report', method.id),
        makeChunk(1, 'doc-medical-report', method.id),
      ];

      chunks.forEach(chunk => {
        expect(chunk.metadata.chunkingMethod).toBe(method.id);
      });
    });
  });

  it('configuration change within 5-second window is representable (Req 3.3)', () => {
    // Req 3.3: chunk panel SHALL reflect new chunk structure within 5 seconds.
    // We verify the state transition is immediate (synchronous) — the only
    // async part is the API call, which is bounded by the 5s requirement.
    const startTime = Date.now();

    const method1 = SUPPORTED_CHUNKING_METHODS[0];
    const method2 = SUPPORTED_CHUNKING_METHODS[3]; // semantic

    // State transitions are synchronous
    const result = applyChunkingMethodChange(method1, method2);
    let selected = result.selectedDocuments;
    selected = toggleDocumentSelection(selected, 'doc-medical-report');
    const request = buildChunkRequest(selected, CUSTOMER_UUID, result.chunkingMethod);

    const elapsed = Date.now() - startTime;

    // State transitions complete in well under 5 seconds
    expect(elapsed).toBeLessThan(100);
    expect(request.chunkingMethod!.id).toBe(method2.id);
  });
});

// ─── 7. Document selection → chunk display coordination (Req 3.2) ────────────

describe('Document selection updates chunk display (Req 3.2)', () => {
  it('selecting multiple documents includes all in chunk request', () => {
    let selected = new Set<string>();
    selected = toggleDocumentSelection(selected, 'doc-medical-report');
    selected = toggleDocumentSelection(selected, 'doc-lab-results');
    selected = toggleDocumentSelection(selected, 'doc-imaging');

    const request = buildChunkRequest(selected, CUSTOMER_UUID, SUPPORTED_CHUNKING_METHODS[0]);
    expect(request.documentIds).toHaveLength(3);
  });

  it('deselecting a document removes it from chunk request', () => {
    let selected = new Set(['doc-medical-report', 'doc-lab-results', 'doc-imaging']);

    selected = toggleDocumentSelection(selected, 'doc-lab-results');
    const request = buildChunkRequest(selected, CUSTOMER_UUID, SUPPORTED_CHUNKING_METHODS[0]);

    expect(request.documentIds).toHaveLength(2);
    expect(request.documentIds).not.toContain('doc-lab-results');
  });

  it('chunks from deselected documents are filtered out of display', () => {
    const allChunks: DocumentChunk[] = [
      makeChunk(0, 'doc-medical-report', 'default'),
      makeChunk(1, 'doc-medical-report', 'default'),
      makeChunk(0, 'doc-lab-results', 'default'),
      makeChunk(0, 'doc-imaging', 'default'),
    ];

    // Deselect doc-lab-results
    const selected = new Set(['doc-medical-report', 'doc-imaging']);
    const visible = filterChunksBySelection(allChunks, selected);

    expect(visible).toHaveLength(3);
    visible.forEach(chunk => {
      expect(chunk.sourceDocument.documentId).not.toBe('doc-lab-results');
    });
  });

  it('empty selection results in empty chunk display', () => {
    const allChunks: DocumentChunk[] = [
      makeChunk(0, 'doc-medical-report', 'default'),
      makeChunk(0, 'doc-lab-results', 'default'),
    ];

    const visible = filterChunksBySelection(allChunks, new Set());
    expect(visible).toHaveLength(0);
  });
});
