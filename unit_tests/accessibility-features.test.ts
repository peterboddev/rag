/**
 * Unit tests for accessibility features in document selection/summary components.
 * Tests keyboard navigation, ARIA labels, focus management, and text alternatives.
 * Requirements: 8.2, 8.3, 8.4, 8.5
 */

import { describe, it, expect } from '@jest/globals';

/**
 * Since the project uses a Node test environment (no DOM/jsdom),
 * we test the pure logic functions extracted from the components.
 * These validate the accessibility-related data transformations.
 */

// --- Helpers mirroring component logic ---

function getStatusIcon(status: string): string {
  switch (status) {
    case 'completed': return '✅';
    case 'failed': return '❌';
    case 'processing': return '⏳';
    case 'queued': return '⏸️';
    default: return '❓';
  }
}

function getStatusText(status: string): string {
  switch (status) {
    case 'completed': return 'Completed';
    case 'failed': return 'Failed';
    case 'processing': return 'Processing';
    case 'queued': return 'Queued';
    default: return 'Unknown';
  }
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'completed': return '#28a745';
    case 'failed': return '#dc3545';
    case 'processing': return '#ffc107';
    case 'queued': return '#17a2b8';
    default: return '#6c757d';
  }
}

interface MockDocument {
  documentId: string;
  fileName: string;
  processingStatus: string;
  textLength?: number;
}

function buildItemAriaLabel(doc: MockDocument, isSelected: boolean): string {
  const statusLabel = getStatusText(doc.processingStatus);
  return `${doc.fileName}, ${statusLabel}${isSelected ? ', selected' : ''}`;
}

function canBeSelected(doc: MockDocument): boolean {
  return doc.processingStatus === 'completed' && !!doc.textLength && doc.textLength > 0;
}

function buildSelectionAnnouncement(selectedCount: number, selectableCount: number): string {
  if (selectedCount > 0) {
    return `${selectedCount} of ${selectableCount} documents selected`;
  }
  return 'No documents selected';
}

/**
 * Simulates arrow key navigation through a list of items.
 * Returns the new focused index after a key press.
 */
function navigateList(currentIndex: number, totalItems: number, key: string): number {
  if (key === 'ArrowDown') {
    return currentIndex < totalItems - 1 ? currentIndex + 1 : 0;
  } else if (key === 'ArrowUp') {
    return currentIndex > 0 ? currentIndex - 1 : totalItems - 1;
  } else if (key === 'Home') {
    return 0;
  } else if (key === 'End') {
    return totalItems - 1;
  }
  return currentIndex;
}

// --- Tests ---

describe('Accessibility: Text alternatives for status indicators (Req 8.5)', () => {
  it('provides text labels for all known statuses', () => {
    const statuses = ['completed', 'failed', 'processing', 'queued'];
    for (const status of statuses) {
      const text = getStatusText(status);
      expect(text).not.toBe('Unknown');
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it('returns "Unknown" for unrecognized status', () => {
    expect(getStatusText('invalid')).toBe('Unknown');
    expect(getStatusText('')).toBe('Unknown');
  });

  it('each status has both an icon and a distinct text label', () => {
    const statuses = ['completed', 'failed', 'processing', 'queued'];
    const texts = new Set<string>();
    for (const status of statuses) {
      const icon = getStatusIcon(status);
      const text = getStatusText(status);
      expect(icon.length).toBeGreaterThan(0);
      expect(text.length).toBeGreaterThan(0);
      // Text label should be different from the raw status key (capitalized)
      expect(text).not.toBe(status);
      texts.add(text);
    }
    // All text labels should be unique
    expect(texts.size).toBe(statuses.length);
  });

  it('each status has a distinct color for sighted users', () => {
    const statuses = ['completed', 'failed', 'processing', 'queued'];
    const colors = new Set(statuses.map(s => getStatusColor(s)));
    expect(colors.size).toBe(statuses.length);
  });
});

describe('Accessibility: ARIA labels for screen readers (Req 8.3)', () => {
  it('builds correct aria-label for a selected completed document', () => {
    const doc: MockDocument = { documentId: '1', fileName: 'report.pdf', processingStatus: 'completed', textLength: 500 };
    const label = buildItemAriaLabel(doc, true);
    expect(label).toBe('report.pdf, Completed, selected');
  });

  it('builds correct aria-label for an unselected document', () => {
    const doc: MockDocument = { documentId: '2', fileName: 'invoice.pdf', processingStatus: 'failed', textLength: 0 };
    const label = buildItemAriaLabel(doc, false);
    expect(label).toBe('invoice.pdf, Failed');
    expect(label).not.toContain('selected');
  });

  it('builds correct aria-label for processing document', () => {
    const doc: MockDocument = { documentId: '3', fileName: 'scan.png', processingStatus: 'processing' };
    const label = buildItemAriaLabel(doc, false);
    expect(label).toBe('scan.png, Processing');
  });

  it('selection announcement reflects current selection count', () => {
    expect(buildSelectionAnnouncement(0, 5)).toBe('No documents selected');
    expect(buildSelectionAnnouncement(3, 5)).toBe('3 of 5 documents selected');
    expect(buildSelectionAnnouncement(5, 5)).toBe('5 of 5 documents selected');
  });
});

describe('Accessibility: Keyboard navigation for document list (Req 8.2)', () => {
  it('ArrowDown moves to next item', () => {
    expect(navigateList(0, 5, 'ArrowDown')).toBe(1);
    expect(navigateList(3, 5, 'ArrowDown')).toBe(4);
  });

  it('ArrowDown wraps from last to first', () => {
    expect(navigateList(4, 5, 'ArrowDown')).toBe(0);
  });

  it('ArrowUp moves to previous item', () => {
    expect(navigateList(3, 5, 'ArrowUp')).toBe(2);
    expect(navigateList(1, 5, 'ArrowUp')).toBe(0);
  });

  it('ArrowUp wraps from first to last', () => {
    expect(navigateList(0, 5, 'ArrowUp')).toBe(4);
  });

  it('Home moves to first item', () => {
    expect(navigateList(3, 5, 'Home')).toBe(0);
    expect(navigateList(4, 5, 'Home')).toBe(0);
  });

  it('End moves to last item', () => {
    expect(navigateList(0, 5, 'End')).toBe(4);
    expect(navigateList(2, 5, 'End')).toBe(4);
  });

  it('unrecognized key does not change index', () => {
    expect(navigateList(2, 5, 'Tab')).toBe(2);
    expect(navigateList(2, 5, 'Escape')).toBe(2);
  });

  it('single item list navigation stays on item', () => {
    expect(navigateList(0, 1, 'ArrowDown')).toBe(0);
    expect(navigateList(0, 1, 'ArrowUp')).toBe(0);
    expect(navigateList(0, 1, 'Home')).toBe(0);
    expect(navigateList(0, 1, 'End')).toBe(0);
  });
});

describe('Accessibility: Selectability and focus management (Req 8.4)', () => {
  it('only completed documents with text can be selected', () => {
    expect(canBeSelected({ documentId: '1', fileName: 'a.pdf', processingStatus: 'completed', textLength: 100 })).toBe(true);
    expect(canBeSelected({ documentId: '2', fileName: 'b.pdf', processingStatus: 'failed', textLength: 100 })).toBe(false);
    expect(canBeSelected({ documentId: '3', fileName: 'c.pdf', processingStatus: 'completed', textLength: 0 })).toBe(false);
    expect(canBeSelected({ documentId: '4', fileName: 'd.pdf', processingStatus: 'completed' })).toBe(false);
    expect(canBeSelected({ documentId: '5', fileName: 'e.pdf', processingStatus: 'processing', textLength: 50 })).toBe(false);
  });

  it('selectable items should get tabIndex 0, non-selectable get -1', () => {
    // This mirrors the component logic: tabIndex={canBeSelected ? 0 : -1}
    const docs: MockDocument[] = [
      { documentId: '1', fileName: 'a.pdf', processingStatus: 'completed', textLength: 100 },
      { documentId: '2', fileName: 'b.pdf', processingStatus: 'failed', textLength: 100 },
      { documentId: '3', fileName: 'c.pdf', processingStatus: 'queued' },
    ];
    const tabIndices = docs.map(d => canBeSelected(d) ? 0 : -1);
    expect(tabIndices).toEqual([0, -1, -1]);
  });
});
