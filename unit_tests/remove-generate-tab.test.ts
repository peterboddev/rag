/**
 * @jest-environment jsdom
 */
import React from 'react';
import { getAnomalySeverityColor, extractDisplayFields } from '../frontend/src/components/ClaimSummaryModal';

// ─── Pure function tests ─────────────────────────────────────────────────────

describe('Remove Generate Tab — Pure helpers', () => {
  describe('getAnomalySeverityColor', () => {
    it('returns red for critical', () => {
      expect(getAnomalySeverityColor('critical')).toBe('#dc3545');
    });
    it('returns yellow for warning', () => {
      expect(getAnomalySeverityColor('warning')).toBe('#ffc107');
    });
    it('returns blue for info', () => {
      expect(getAnomalySeverityColor('info')).toBe('#17a2b8');
    });
    it('returns grey for unknown severity', () => {
      expect(getAnomalySeverityColor('unknown')).toBe('#6c757d');
    });
  });

  describe('extractDisplayFields', () => {
    const baseResponse = {
      summary: 'Test summary',
      anomalies: [{ description: 'test', severity: 'warning' as const, sourceDocument: 'doc.pdf', dataValues: {} }],
      strategy: 'rag',
      chunkingMethod: 'semantic',
      documentCount: 3,
      processingTime: 1200,
      generatedAt: '2025-01-01T00:00:00Z',
      cached: true,
      cachedAt: '2025-01-01T00:00:00Z',
    };

    it('preserves all fields from response', () => {
      const result = extractDisplayFields(baseResponse);
      expect(result.summary).toBe('Test summary');
      expect(result.strategy).toBe('rag');
      expect(result.chunkingMethod).toBe('semantic');
      expect(result.documentCount).toBe(3);
      expect(result.processingTime).toBe(1200);
      expect(result.cached).toBe(true);
      expect(result.anomalies).toHaveLength(1);
    });

    it('sets hasEvaluation true when evaluation present', () => {
      const result = extractDisplayFields({
        ...baseResponse,
        evaluation: { helpfulness: 0.9, faithfulness: 0.8, completeness: 0.7, evaluatedAt: '2025-01-01' },
      });
      expect(result.hasEvaluation).toBe(true);
    });

    it('sets hasEvaluation false when evaluation absent', () => {
      const result = extractDisplayFields(baseResponse);
      expect(result.hasEvaluation).toBe(false);
    });
  });
});

// ─── Component rendering tests ───────────────────────────────────────────────

// Mock StrategyComparisonView to avoid pulling in API dependencies
jest.mock('../frontend/src/components/StrategyComparisonView', () => {
  const MockView = (props: any) => React.createElement('div', { 'data-testid': 'strategy-comparison-view', 'data-claim-id': props.claimId });
  MockView.displayName = 'StrategyComparisonView';
  return { __esModule: true, default: MockView };
});

// Mock FullContextTab to avoid pulling in API dependencies
jest.mock('../frontend/src/components/FullContextTab', () => {
  const MockTab = (props: any) => React.createElement('div', { 'data-testid': 'full-context-tab', 'data-claim-id': props.claimId });
  MockTab.displayName = 'FullContextTab';
  return { __esModule: true, default: MockTab };
});

import { render, cleanup, fireEvent } from '@testing-library/react';
import ClaimSummaryModal from '../frontend/src/components/ClaimSummaryModal';

describe('Remove Generate Tab — ClaimSummaryModal component', () => {
  const makeProps = () => ({ isOpen: true, onClose: jest.fn(), claimId: 'CLM-001' });

  afterEach(() => {
    cleanup();
  });

  it('renders two tabs: Summarize Claim and Full Context Analysis (Req 1.1, 1.2)', () => {
    const props = makeProps();
    const { container } = render(React.createElement(ClaimSummaryModal, props));

    // StrategyComparisonView is rendered (default tab)
    expect(container.querySelector('[data-testid="strategy-comparison-view"]')).toBeTruthy();

    // Two tab buttons exist
    expect(container.querySelector('[data-testid="tab-summarize"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="tab-full-context"]')).toBeTruthy();

    // Old tab buttons do not exist
    expect(container.querySelector('[data-testid="tab-generate"]')).toBeNull();
    expect(container.querySelector('[data-testid="tab-compare"]')).toBeNull();

    // No "Generate Summary" or "Compare All Strategies" text in buttons
    const buttons = Array.from(container.querySelectorAll('button'));
    const tabTexts = buttons.map(b => b.textContent);
    expect(tabTexts).not.toContain('Generate Summary');
    expect(tabTexts).not.toContain('Compare All Strategies');
  });

  it('modal dialog container has maxWidth 1200px (Req 1.3)', () => {
    const props = makeProps();
    const { container } = render(React.createElement(ClaimSummaryModal, props));
    const dialog = container.querySelector('[tabindex="-1"]') as HTMLElement;
    expect(dialog).toBeTruthy();
    expect(dialog.style.maxWidth).toBe('1200px');
  });

  it('header displays claim ID and close button (Req 2.1)', () => {
    const props = makeProps();
    const { container } = render(React.createElement(ClaimSummaryModal, props));

    const heading = container.querySelector('#claim-summary-title');
    expect(heading).toBeTruthy();
    expect(heading!.textContent).toContain('CLM-001');

    const closeBtn = container.querySelector('[aria-label="Close summary modal"]');
    expect(closeBtn).toBeTruthy();
  });

  it('close button click invokes onClose (Req 2.2)', () => {
    const props = makeProps();
    const { container } = render(React.createElement(ClaimSummaryModal, props));

    const closeBtn = container.querySelector('[aria-label="Close summary modal"]') as HTMLElement;
    fireEvent.click(closeBtn);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('escape key invokes onClose (Req 2.3)', () => {
    const props = makeProps();
    render(React.createElement(ClaimSummaryModal, props));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('overlay click invokes onClose (Req 2.4)', () => {
    const props = makeProps();
    const { container } = render(React.createElement(ClaimSummaryModal, props));

    const overlay = container.querySelector('[role="dialog"]') as HTMLElement;
    fireEvent.click(overlay);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('overlay has role="dialog" and aria-modal="true" (Req 2.6)', () => {
    const props = makeProps();
    const { container } = render(React.createElement(ClaimSummaryModal, props));
    const overlay = container.querySelector('[role="dialog"]');
    expect(overlay).toBeTruthy();
    expect(overlay!.getAttribute('aria-modal')).toBe('true');
  });

  it('no strategy radio buttons, chunking selectors, or generate buttons rendered (Req 3.6)', () => {
    const props = makeProps();
    const { container } = render(React.createElement(ClaimSummaryModal, props));

    // No radio buttons at all
    const radios = container.querySelectorAll('input[type="radio"]');
    expect(radios.length).toBe(0);

    // No checkboxes
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBe(0);

    // No generate button
    const buttons = Array.from(container.querySelectorAll('button'));
    const generateBtn = buttons.find(b => b.textContent?.includes('Generate Summary'));
    expect(generateBtn).toBeUndefined();
  });

  it('does not render when isOpen is false', () => {
    const props = makeProps();
    props.isOpen = false;
    const { container } = render(React.createElement(ClaimSummaryModal, props));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
