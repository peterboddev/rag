import React, { useState, useEffect, useRef } from 'react';
import StrategyComparisonView from './StrategyComparisonView';
import FullContextTab from './FullContextTab';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ClaimSummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  claimId: string;
}

interface DataAnomaly {
  description: string;
  severity: 'critical' | 'warning' | 'info';
  sourceDocument: string;
  dataValues: Record<string, string>;
  source?: 'deterministic' | 'llm';
}

interface EvaluationScores {
  helpfulness: number;
  faithfulness: number;
  completeness: number;
  anomalyAccuracy?: number;
  evaluatedAt: string;
}

interface PromptInfo {
  promptTemplate: string;
  strategyLabel: string;
  retrievalQuery?: string;
}

interface PaymentEntry {
  amount: number;
  sourceDocument: string;
  rawText: string;
}

interface FinancialSummary {
  minPayment: number;
  maxPayment: number;
  totalValue: number;
  payments: PaymentEntry[];
}

interface TimelineData {
  startYear: number | null;
  endYear: number | null;
  durationYears: number | null;
}

interface ClaimSummaryResponse {
  summary: string;
  anomalies: DataAnomaly[];
  strategy: string;
  chunkingMethod?: string;
  documentCount: number;
  processingTime: number;
  generatedAt: string;
  cached: boolean;
  cachedAt?: string;
  evaluation?: EvaluationScores;
  promptInfo?: PromptInfo;
  financialSummary?: FinancialSummary;
  timeline?: TimelineData;
}

// ─── Pure helper functions (exported for testing) ────────────────────────────

/**
 * Returns the color for a given anomaly severity.
 * critical → '#dc3545' (red), warning → '#ffc107' (yellow), info → '#17a2b8' (blue)
 */
export function getAnomalySeverityColor(severity: string): string {
  switch (severity) {
    case 'critical': return '#dc3545';
    case 'warning': return '#ffc107';
    case 'info': return '#17a2b8';
    default: return '#6c757d';
  }
}

/**
 * Extracts the display fields from a ClaimSummaryResponse.
 * Returns an object with all required display fields for the modal.
 */
export function extractDisplayFields(response: ClaimSummaryResponse): {
  summary: string;
  strategy: string;
  chunkingMethod?: string;
  documentCount: number;
  processingTime: number;
  generatedAt: string;
  cached: boolean;
  cachedAt?: string;
  anomalies: DataAnomaly[];
  hasEvaluation: boolean;
} {
  return {
    summary: response.summary,
    strategy: response.strategy,
    chunkingMethod: response.chunkingMethod,
    documentCount: response.documentCount,
    processingTime: response.processingTime,
    generatedAt: response.generatedAt,
    cached: response.cached,
    cachedAt: response.cachedAt,
    anomalies: response.anomalies ?? [],
    hasEvaluation: !!response.evaluation,
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

const ClaimSummaryModal: React.FC<ClaimSummaryModalProps> = ({ isOpen, onClose, claimId }) => {
  const [mountKey, setMountKey] = useState(0);
  const [activeTab, setActiveTab] = useState<'summarize' | 'full-context'>('summarize');
  const dialogRef = useRef<HTMLDivElement>(null);

  // Increment mountKey when modal opens to force remount; reset activeTab
  useEffect(() => {
    if (isOpen) {
      setMountKey((prev) => prev + 1);
      setActiveTab('summarize');
    }
  }, [isOpen]);

  // Focus trap: focus the dialog when it opens
  useEffect(() => {
    if (isOpen && dialogRef.current) {
      dialogRef.current.focus();
    }
  }, [isOpen]);

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="claim-summary-title"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        style={{
          backgroundColor: 'white', borderRadius: '8px',
          width: '90%', maxWidth: '1200px', maxHeight: '85vh',
          overflow: 'hidden', display: 'flex', flexDirection: 'column',
          outline: 'none',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid #e0e0e0',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <h2 id="claim-summary-title" style={{ margin: 0, fontSize: '18px' }}>
            📝 Claim Summary — {claimId}
          </h2>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', padding: '4px 8px', color: '#666' }}
            aria-label="Close summary modal"
          >×</button>
        </div>

        {/* Tab bar */}
        <div style={{
          display: 'flex', borderBottom: '1px solid #e0e0e0', padding: '0 20px',
        }}>
          <button
            data-testid="tab-summarize"
            onClick={() => setActiveTab('summarize')}
            style={{
              padding: '10px 20px', fontSize: '14px', fontWeight: 600,
              background: 'none', border: 'none', cursor: 'pointer',
              borderBottom: activeTab === 'summarize' ? '3px solid #007bff' : '3px solid transparent',
              color: activeTab === 'summarize' ? '#007bff' : '#666',
            }}
          >
            Summarize Claim
          </button>
          <button
            data-testid="tab-full-context"
            onClick={() => setActiveTab('full-context')}
            style={{
              padding: '10px 20px', fontSize: '14px', fontWeight: 600,
              background: 'none', border: 'none', cursor: 'pointer',
              borderBottom: activeTab === 'full-context' ? '3px solid #007bff' : '3px solid transparent',
              color: activeTab === 'full-context' ? '#007bff' : '#666',
            }}
          >
            Full Context Analysis
          </button>
        </div>

        {/* Scrollable content — both tabs always mounted, hidden via display */}
        <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
          <div style={{ display: activeTab === 'summarize' ? 'block' : 'none' }}>
            <StrategyComparisonView key={mountKey} claimId={claimId} />
          </div>
          <div style={{ display: activeTab === 'full-context' ? 'block' : 'none' }}>
            <FullContextTab key={mountKey} claimId={claimId} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClaimSummaryModal;
