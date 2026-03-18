/**
 * Unit tests for ChunkVisualizationErrorBoundary.
 * Tests the error boundary's static methods and state logic.
 * Since the test environment is node (not jsdom), we test the pure logic
 * of the component rather than rendering.
 *
 * Requirements: 6.1, 6.2, 6.3
 */

import { describe, it, expect } from '@jest/globals';

// Import the component class to test its static methods
import ChunkVisualizationErrorBoundary from '../frontend/src/components/ChunkVisualizationErrorBoundary';

describe('ChunkVisualizationErrorBoundary', () => {
  describe('getDerivedStateFromError', () => {
    it('returns hasError true with the error message', () => {
      const error = new Error('Chunking failed for document report.pdf');
      const state = (ChunkVisualizationErrorBoundary as any).getDerivedStateFromError(error);

      expect(state.hasError).toBe(true);
      expect(state.error).toBe('Chunking failed for document report.pdf');
    });

    it('captures empty error messages', () => {
      const error = new Error('');
      const state = (ChunkVisualizationErrorBoundary as any).getDerivedStateFromError(error);

      expect(state.hasError).toBe(true);
      expect(state.error).toBe('');
    });

    it('handles errors with special characters in message', () => {
      const error = new Error('Failed: <script>alert("xss")</script>');
      const state = (ChunkVisualizationErrorBoundary as any).getDerivedStateFromError(error);

      expect(state.hasError).toBe(true);
      expect(state.error).toBe('Failed: <script>alert("xss")</script>');
    });

    it('handles timeout error messages (Req 6.3)', () => {
      const error = new Error('Chunking timed out after 30s');
      const state = (ChunkVisualizationErrorBoundary as any).getDerivedStateFromError(error);

      expect(state.hasError).toBe(true);
      expect(state.error).toContain('timed out');
    });

    it('handles document-specific error messages (Req 6.1)', () => {
      const error = new Error('Chunking failed for document: invoice.pdf');
      const state = (ChunkVisualizationErrorBoundary as any).getDerivedStateFromError(error);

      expect(state.hasError).toBe(true);
      expect(state.error).toContain('invoice.pdf');
    });
  });

  describe('constructor initial state', () => {
    it('initializes with no error', () => {
      const instance = new (ChunkVisualizationErrorBoundary as any)({});
      expect(instance.state.hasError).toBe(false);
      expect(instance.state.error).toBeNull();
    });
  });

  describe('handleReset', () => {
    it('resets error state when called', () => {
      const instance = new (ChunkVisualizationErrorBoundary as any)({});
      // Simulate error state
      instance.state = { hasError: true, error: 'Some error' };

      // Mock setState to capture the new state
      let newState: any = null;
      instance.setState = (s: any) => { newState = s; };

      instance.handleReset();

      expect(newState).toEqual({ hasError: false, error: null });
    });
  });

  describe('integration with DocumentSummary', () => {
    it('error boundary is exported as default export', () => {
      expect(ChunkVisualizationErrorBoundary).toBeDefined();
      expect(typeof ChunkVisualizationErrorBoundary).toBe('function');
    });

    it('has getDerivedStateFromError static method', () => {
      expect(typeof (ChunkVisualizationErrorBoundary as any).getDerivedStateFromError).toBe('function');
    });

    it('has componentDidCatch instance method', () => {
      const instance = new (ChunkVisualizationErrorBoundary as any)({});
      expect(typeof instance.componentDidCatch).toBe('function');
    });
  });
});
