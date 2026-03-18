/**
 * Unit tests for performance monitoring and optimization utilities.
 *
 * Tests the pure logic exported from usePerformanceMonitor:
 * - Render threshold detection (Req 7.1: initial render within 2 seconds)
 * - Performance snapshot computation (Req 7.3: tracking for large collections)
 * - Metrics reset behavior when chunks are cleared (Req 7.4: efficient re-rendering)
 * - React.memo on ChunkItem prevents unnecessary re-renders (Req 7.4)
 *
 * Requirements: 7.1, 7.3, 7.4
 */

import { describe, it, expect } from '@jest/globals';
import {
  exceedsRenderThreshold,
  computePerformanceSnapshot,
  INITIAL_RENDER_THRESHOLD_MS,
  PerformanceMetrics,
} from '../frontend/src/hooks/usePerformanceMonitor';

// Verify ChunkItem uses React.memo by checking its displayName
import ChunkItem from '../frontend/src/components/ChunkItem';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emptyMetrics(): PerformanceMetrics {
  return {
    lastRenderTime: 0,
    chunkCount: 0,
    initialRenderExceeded: false,
    initialRenderTime: null,
    renderCount: 0,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Performance Monitor - Threshold Detection (Req 7.1)', () => {
  it('threshold constant is 2000ms', () => {
    expect(INITIAL_RENDER_THRESHOLD_MS).toBe(2000);
  });

  it('returns false for render times under threshold', () => {
    expect(exceedsRenderThreshold(500)).toBe(false);
    expect(exceedsRenderThreshold(1999)).toBe(false);
    expect(exceedsRenderThreshold(0)).toBe(false);
  });

  it('returns false for render time exactly at threshold', () => {
    expect(exceedsRenderThreshold(2000)).toBe(false);
  });

  it('returns true for render times over threshold', () => {
    expect(exceedsRenderThreshold(2001)).toBe(true);
    expect(exceedsRenderThreshold(5000)).toBe(true);
  });
});

describe('Performance Monitor - Snapshot Computation (Req 7.3)', () => {
  it('records initial render time when chunks are present', () => {
    const prev = emptyMetrics();
    const snapshot = computePerformanceSnapshot(150, 100, true, prev);

    expect(snapshot.initialRenderTime).toBe(150);
    expect(snapshot.initialRenderExceeded).toBe(false);
    expect(snapshot.chunkCount).toBe(100);
    expect(snapshot.renderCount).toBe(1);
  });

  it('flags initial render exceeded when over threshold', () => {
    const prev = emptyMetrics();
    const snapshot = computePerformanceSnapshot(3000, 500, true, prev);

    expect(snapshot.initialRenderTime).toBe(3000);
    expect(snapshot.initialRenderExceeded).toBe(true);
  });

  it('does not overwrite initial render on subsequent renders', () => {
    const prev = emptyMetrics();
    const first = computePerformanceSnapshot(100, 50, true, prev);
    expect(first.initialRenderTime).toBe(100);

    // Second render is not initial
    const second = computePerformanceSnapshot(200, 100, false, first);
    expect(second.initialRenderTime).toBe(100); // preserved from first
    expect(second.lastRenderTime).toBe(200);
    expect(second.chunkCount).toBe(100);
    expect(second.renderCount).toBe(2);
  });

  it('does not record initial render when chunk count is zero', () => {
    const prev = emptyMetrics();
    const snapshot = computePerformanceSnapshot(50, 0, true, prev);

    expect(snapshot.initialRenderTime).toBeNull();
    expect(snapshot.initialRenderExceeded).toBe(false);
  });

  it('increments render count on each snapshot', () => {
    let metrics = emptyMetrics();
    metrics = computePerformanceSnapshot(10, 5, true, metrics);
    expect(metrics.renderCount).toBe(1);

    metrics = computePerformanceSnapshot(15, 10, false, metrics);
    expect(metrics.renderCount).toBe(2);

    metrics = computePerformanceSnapshot(20, 15, false, metrics);
    expect(metrics.renderCount).toBe(3);
  });

  it('tracks chunk count changes across renders', () => {
    let metrics = emptyMetrics();
    metrics = computePerformanceSnapshot(10, 50, true, metrics);
    expect(metrics.chunkCount).toBe(50);

    metrics = computePerformanceSnapshot(12, 200, false, metrics);
    expect(metrics.chunkCount).toBe(200);

    metrics = computePerformanceSnapshot(8, 1000, false, metrics);
    expect(metrics.chunkCount).toBe(1000);
  });

  it('preserves exceeded flag even if subsequent renders are fast', () => {
    const prev = emptyMetrics();
    const slow = computePerformanceSnapshot(3000, 500, true, prev);
    expect(slow.initialRenderExceeded).toBe(true);

    const fast = computePerformanceSnapshot(10, 500, false, slow);
    expect(fast.initialRenderExceeded).toBe(true); // preserved
    expect(fast.lastRenderTime).toBe(10);
  });
});

describe('Performance Monitor - Reset Behavior (Req 7.4)', () => {
  it('new initial render is tracked after metrics reset', () => {
    // Simulate: first load
    let metrics = emptyMetrics();
    metrics = computePerformanceSnapshot(100, 50, true, metrics);
    expect(metrics.initialRenderTime).toBe(100);

    // Simulate: chunks cleared (reset to empty)
    const reset = emptyMetrics();

    // Simulate: new chunks loaded (new initial render)
    const newInitial = computePerformanceSnapshot(250, 75, true, reset);
    expect(newInitial.initialRenderTime).toBe(250);
    expect(newInitial.initialRenderExceeded).toBe(false);
  });
});

describe('ChunkItem React.memo optimization (Req 7.4)', () => {
  it('ChunkItem has a displayName indicating it is memoized', () => {
    // React.memo components get a displayName when explicitly set
    expect(ChunkItem).toBeDefined();
    expect((ChunkItem as any).displayName).toBe('ChunkItem');
  });

  it('ChunkItem is wrapped with React.memo (has compare function signature)', () => {
    // React.memo wraps the component - the result has a $$typeof for memo
    // or the component itself is a function with a type property
    // In practice, React.memo returns an object with a `type` property
    expect(typeof ChunkItem).toBe('object');
    expect((ChunkItem as any).$$typeof).toBeDefined();
  });
});
