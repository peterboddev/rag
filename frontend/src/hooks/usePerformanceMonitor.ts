import { useRef, useEffect, useCallback } from 'react';

/**
 * Performance metrics collected by the monitor.
 */
export interface PerformanceMetrics {
  /** Time in ms for the most recent render cycle */
  lastRenderTime: number;
  /** Total number of chunks currently tracked */
  chunkCount: number;
  /** Whether the initial render exceeded the 2-second threshold (Req 7.1) */
  initialRenderExceeded: boolean;
  /** Time in ms for the very first render after data became available */
  initialRenderTime: number | null;
  /** Total number of render cycles recorded */
  renderCount: number;
}

const INITIAL_RENDER_THRESHOLD_MS = 2000;

/**
 * Lightweight performance monitoring hook for the ChunkVisualizationPanel.
 *
 * Tracks render timing using `performance.now()` and logs a warning
 * if the initial render after data availability exceeds 2 seconds (Req 7.1).
 * Also tracks chunk count and render count for monitoring purposes (Req 7.3, 7.4).
 */
export function usePerformanceMonitor(chunkCount: number): PerformanceMetrics {
  const metricsRef = useRef<PerformanceMetrics>({
    lastRenderTime: 0,
    chunkCount: 0,
    initialRenderExceeded: false,
    initialRenderTime: null,
    renderCount: 0,
  });

  const renderStartRef = useRef<number>(performance.now());
  const hasRecordedInitialRef = useRef(false);

  // Mark render start on every render cycle
  renderStartRef.current = performance.now();

  useEffect(() => {
    const renderEnd = performance.now();
    const renderTime = renderEnd - renderStartRef.current;

    metricsRef.current.lastRenderTime = renderTime;
    metricsRef.current.chunkCount = chunkCount;
    metricsRef.current.renderCount += 1;

    // Record initial render time when chunks first become available
    if (chunkCount > 0 && !hasRecordedInitialRef.current) {
      hasRecordedInitialRef.current = true;
      metricsRef.current.initialRenderTime = renderTime;

      if (renderTime > INITIAL_RENDER_THRESHOLD_MS) {
        metricsRef.current.initialRenderExceeded = true;
        console.warn(
          `[ChunkVisualization] Initial render took ${renderTime.toFixed(1)}ms ` +
          `(threshold: ${INITIAL_RENDER_THRESHOLD_MS}ms) for ${chunkCount} chunks`
        );
      }
    }

    // Reset tracking when chunks are cleared so next load is treated as initial
    if (chunkCount === 0) {
      hasRecordedInitialRef.current = false;
      metricsRef.current.initialRenderTime = null;
      metricsRef.current.initialRenderExceeded = false;
    }
  });

  return metricsRef.current;
}

/**
 * Pure utility: determines if a render time exceeds the initial render threshold.
 * Exported for unit testing without React.
 */
export function exceedsRenderThreshold(renderTimeMs: number): boolean {
  return renderTimeMs > INITIAL_RENDER_THRESHOLD_MS;
}

/**
 * Pure utility: computes performance metrics snapshot from raw measurements.
 * Exported for unit testing without React.
 */
export function computePerformanceSnapshot(
  renderTimeMs: number,
  chunkCount: number,
  isInitialRender: boolean,
  previousMetrics: PerformanceMetrics
): PerformanceMetrics {
  const initialRenderTime = isInitialRender && chunkCount > 0
    ? renderTimeMs
    : previousMetrics.initialRenderTime;

  const initialRenderExceeded = isInitialRender && chunkCount > 0
    ? renderTimeMs > INITIAL_RENDER_THRESHOLD_MS
    : previousMetrics.initialRenderExceeded;

  return {
    lastRenderTime: renderTimeMs,
    chunkCount,
    initialRenderExceeded,
    initialRenderTime,
    renderCount: previousMetrics.renderCount + 1,
  };
}

export { INITIAL_RENDER_THRESHOLD_MS };
