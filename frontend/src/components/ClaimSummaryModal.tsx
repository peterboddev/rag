import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getClaimSummary, getClaimEvaluations } from '../services/claimApi';
import EvaluationScoreDisplay from './EvaluationScoreDisplay';
import StrategyComparisonPanel from './StrategyComparisonPanel';
import StrategyComparisonView from './StrategyComparisonView';

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
}

interface EvaluationScores {
  helpfulness: number;
  faithfulness: number;
  completeness: number;
  anomalyAccuracy?: number;
  evaluatedAt: string;
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
}

type Strategy = 'full-context' | 'rag' | 'graph-rag';
type ChunkingMethod = 'full-document' | 'semantic';

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

// ─── Strategy metadata ───────────────────────────────────────────────────────

const STRATEGY_OPTIONS: { value: Strategy; label: string; description: string }[] = [
  {
    value: 'full-context',
    label: 'Full Context',
    description: 'Passes all document text directly to the LLM for comprehensive summarization.',
  },
  {
    value: 'rag',
    label: 'RAG',
    description: 'Uses Knowledge Base retrieval with configurable chunking for focused summarization.',
  },
  {
    value: 'graph-rag',
    label: 'Graph RAG',
    description: 'Builds a knowledge graph for entity-relationship-aware retrieval and summarization.',
  },
];

const CHUNKING_OPTIONS: { value: ChunkingMethod; label: string }[] = [
  { value: 'full-document', label: 'Full Document Chunking' },
  { value: 'semantic', label: 'Semantic Chunking' },
];

// ─── Component ───────────────────────────────────────────────────────────────

const ClaimSummaryModal: React.FC<ClaimSummaryModalProps> = ({ isOpen, onClose, claimId }) => {
  const [activeTab, setActiveTab] = useState<'generate' | 'compare'>('generate');
  const [strategy, setStrategy] = useState<Strategy>('full-context');
  const [chunkingMethod, setChunkingMethod] = useState<ChunkingMethod>('semantic');
  const [includeEvaluation, setIncludeEvaluation] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<ClaimSummaryResponse | null>(null);
  const [showComparison, setShowComparison] = useState(false);
  const [comparisonData, setComparisonData] = useState<Map<string, ClaimSummaryResponse>>(new Map());
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setActiveTab('generate');
      setStrategy('full-context');
      setChunkingMethod('semantic');
      setIncludeEvaluation(true);
      setIsLoading(false);
      setError(null);
      setResponse(null);
      setShowComparison(false);
      setComparisonData(new Map());
      setComparisonLoading(false);
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

  const handleGenerate = useCallback(async (forceRegenerate = false) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await getClaimSummary(
        claimId,
        strategy,
        strategy === 'rag' ? chunkingMethod : undefined,
        forceRegenerate || undefined,
        includeEvaluation || undefined,
      );
      setResponse(result as ClaimSummaryResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate summary');
    } finally {
      setIsLoading(false);
    }
  }, [claimId, strategy, chunkingMethod, includeEvaluation]);

  const handleCompareStrategies = useCallback(async () => {
    setComparisonLoading(true);
    try {
      const data = await getClaimEvaluations(claimId);
      const map = new Map<string, ClaimSummaryResponse>();
      if (data?.evaluations && Array.isArray(data.evaluations)) {
        for (const entry of data.evaluations) {
          const key = entry.chunkingMethod
            ? `${entry.strategy}#${entry.chunkingMethod}`
            : entry.strategy;
          map.set(key, {
            summary: '',
            anomalies: [],
            strategy: entry.strategy,
            chunkingMethod: entry.chunkingMethod ?? undefined,
            documentCount: 0,
            processingTime: 0,
            generatedAt: '',
            cached: false,
            evaluation: entry.evaluation,
          });
        }
      }
      setComparisonData(map);
      setShowComparison(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load comparison data');
    } finally {
      setComparisonLoading(false);
    }
  }, [claimId]);

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
          width: '90%', maxWidth: activeTab === 'compare' ? '1200px' : '800px', maxHeight: '85vh',
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
        <div style={{ display: 'flex', borderBottom: '1px solid #e0e0e0', padding: '0 20px' }}>
          <button
            data-testid="tab-generate"
            onClick={() => setActiveTab('generate')}
            style={{
              padding: '10px 20px',
              border: 'none',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 600,
              backgroundColor: activeTab === 'generate' ? '#fff' : 'transparent',
              borderBottom: activeTab === 'generate' ? '3px solid #6f42c1' : '3px solid transparent',
              color: activeTab === 'generate' ? '#6f42c1' : '#666',
            }}
          >
            Generate Summary
          </button>
          <button
            data-testid="tab-compare"
            onClick={() => setActiveTab('compare')}
            style={{
              padding: '10px 20px',
              border: 'none',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: 600,
              backgroundColor: activeTab === 'compare' ? '#fff' : 'transparent',
              borderBottom: activeTab === 'compare' ? '3px solid #6f42c1' : '3px solid transparent',
              color: activeTab === 'compare' ? '#6f42c1' : '#666',
            }}
          >
            Compare All Strategies
          </button>
        </div>

        {/* Scrollable content */}
        <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
          {activeTab === 'compare' ? (
            <StrategyComparisonView claimId={claimId} />
          ) : (
          <>
          {/* Strategy Selection */}
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '15px' }}>Summarization Strategy</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {STRATEGY_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  style={{
                    display: 'flex', alignItems: 'flex-start', gap: '8px',
                    padding: '10px 12px', borderRadius: '6px', cursor: 'pointer',
                    border: strategy === opt.value ? '2px solid #6f42c1' : '1px solid #dee2e6',
                    backgroundColor: strategy === opt.value ? '#f8f5ff' : '#fff',
                  }}
                >
                  <input
                    type="radio"
                    name="strategy"
                    value={opt.value}
                    checked={strategy === opt.value}
                    onChange={() => setStrategy(opt.value)}
                    style={{ marginTop: '3px' }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '14px' }}>{opt.label}</div>
                    <div style={{ fontSize: '12px', color: '#666', marginTop: '2px' }}>{opt.description}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Chunking Method (RAG only) */}
          {strategy === 'rag' && (
            <div style={{ marginBottom: '20px' }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '15px' }}>Chunking Method</h3>
              <div style={{ display: 'flex', gap: '12px' }}>
                {CHUNKING_OPTIONS.map((opt) => (
                  <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name="chunkingMethod"
                      value={opt.value}
                      checked={chunkingMethod === opt.value}
                      onChange={() => setChunkingMethod(opt.value)}
                    />
                    <span style={{ fontSize: '14px' }}>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Include Evaluation checkbox */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={includeEvaluation}
                onChange={(e) => setIncludeEvaluation(e.target.checked)}
              />
              <span style={{ fontSize: '14px' }}>Include Evaluation Scores</span>
            </label>
          </div>

          {/* Generate / Regenerate buttons */}
          <div style={{ marginBottom: '20px', display: 'flex', gap: '8px' }}>
            <button
              onClick={() => handleGenerate(false)}
              disabled={isLoading}
              style={{
                padding: '10px 20px', fontSize: '14px', fontWeight: 600,
                backgroundColor: isLoading ? '#6c757d' : '#6f42c1',
                color: 'white', border: 'none', borderRadius: '6px',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                opacity: isLoading ? 0.7 : 1,
              }}
            >
              {isLoading ? '⏳ Generating...' : '🚀 Generate Summary'}
            </button>
            {response?.cached && (
              <button
                onClick={() => handleGenerate(true)}
                disabled={isLoading}
                style={{
                  padding: '10px 20px', fontSize: '14px', fontWeight: 600,
                  backgroundColor: isLoading ? '#6c757d' : '#fd7e14',
                  color: 'white', border: 'none', borderRadius: '6px',
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  opacity: isLoading ? 0.7 : 1,
                }}
              >
                🔄 Regenerate
              </button>
            )}
          </div>

          {/* Error display */}
          {error && (
            <div style={{
              padding: '12px 16px', marginBottom: '16px',
              backgroundColor: '#f8d7da', color: '#721c24',
              borderRadius: '6px', border: '1px solid #f5c6cb', fontSize: '14px',
            }}>
              ⚠️ {error}
            </div>
          )}

          {/* Loading indicator */}
          {isLoading && (
            <div style={{ textAlign: 'center', padding: '32px', color: '#666' }}>
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>⏳</div>
              <div>Generating summary with <strong>{STRATEGY_OPTIONS.find(o => o.value === strategy)?.label}</strong> strategy...</div>
            </div>
          )}

          {/* Summary results */}
          {response && !isLoading && (
            <div>
              {/* Cache indicator */}
              {response.cached && response.cachedAt && (
                <div style={{
                  padding: '8px 12px', marginBottom: '12px',
                  backgroundColor: '#e2e3e5', borderRadius: '6px', fontSize: '13px', color: '#383d41',
                }}>
                  📦 Cached summary from {new Date(response.cachedAt).toLocaleString()}
                </div>
              )}

              {/* Anomalies section */}
              {response.anomalies && response.anomalies.length > 0 ? (
                <div style={{ marginBottom: '16px' }}>
                  <h3 style={{ margin: '0 0 8px 0', fontSize: '15px' }}>⚠️ Data Anomalies Detected</h3>
                  {response.anomalies.map((anomaly, idx) => (
                    <div
                      key={idx}
                      data-testid={`anomaly-${anomaly.severity}`}
                      style={{
                        padding: '10px 14px', marginBottom: '8px',
                        borderLeft: `4px solid ${getAnomalySeverityColor(anomaly.severity)}`,
                        backgroundColor: anomaly.severity === 'critical' ? '#f8d7da'
                          : anomaly.severity === 'warning' ? '#fff3cd'
                          : '#d1ecf1',
                        borderRadius: '0 6px 6px 0', fontSize: '13px',
                      }}
                    >
                      <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                        <span style={{
                          display: 'inline-block', padding: '1px 6px', borderRadius: '3px',
                          backgroundColor: getAnomalySeverityColor(anomaly.severity),
                          color: anomaly.severity === 'warning' ? '#000' : '#fff',
                          fontSize: '11px', fontWeight: 700, marginRight: '8px', textTransform: 'uppercase',
                        }}>
                          {anomaly.severity}
                        </span>
                        {anomaly.description}
                      </div>
                      <div style={{ color: '#555' }}>
                        Source: {anomaly.sourceDocument}
                      </div>
                      {Object.keys(anomaly.dataValues).length > 0 && (
                        <div style={{ marginTop: '4px', color: '#555' }}>
                          {Object.entries(anomaly.dataValues).map(([k, v]) => (
                            <span key={k} style={{ marginRight: '12px' }}>{k}: <strong>{v}</strong></span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : response.anomalies && (
                <div style={{
                  padding: '10px 14px', marginBottom: '16px',
                  backgroundColor: '#d4edda', color: '#155724',
                  borderRadius: '6px', border: '1px solid #c3e6cb', fontSize: '14px',
                }}>
                  ✅ No data anomalies detected
                </div>
              )}

              {/* Summary metadata */}
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '16px',
                padding: '10px 14px', backgroundColor: '#f8f9fa', borderRadius: '6px', fontSize: '13px',
              }}>
                <span>📊 Strategy: <strong>{response.strategy}</strong></span>
                {response.chunkingMethod && (
                  <span>🔗 Chunking: <strong>{response.chunkingMethod}</strong></span>
                )}
                <span>📄 Documents: <strong>{response.documentCount}</strong></span>
                <span>⏱️ Time: <strong>{response.processingTime}ms</strong></span>
                <span>🕐 Generated: <strong>{new Date(response.generatedAt).toLocaleString()}</strong></span>
              </div>

              {/* Evaluation scores */}
              {response.evaluation && (
                <EvaluationScoreDisplay scores={response.evaluation} strategy={response.strategy} />
              )}

              {/* Summary text */}
              <div>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '15px' }}>Summary</h3>
                <div style={{
                  padding: '14px', backgroundColor: '#fafafa',
                  borderRadius: '6px', border: '1px solid #e0e0e0',
                  lineHeight: 1.6, fontSize: '14px', whiteSpace: 'pre-wrap',
                }}>
                  {response.summary}
                </div>
              </div>

              {/* Compare Strategies button */}
              <div style={{ marginTop: '16px' }}>
                <button
                  data-testid="compare-strategies-btn"
                  onClick={handleCompareStrategies}
                  disabled={comparisonLoading}
                  style={{
                    padding: '8px 16px', fontSize: '13px', fontWeight: 600,
                    backgroundColor: comparisonLoading ? '#6c757d' : '#0d6efd',
                    color: 'white', border: 'none', borderRadius: '6px',
                    cursor: comparisonLoading ? 'not-allowed' : 'pointer',
                    opacity: comparisonLoading ? 0.7 : 1,
                  }}
                >
                  {comparisonLoading ? '⏳ Loading...' : '📊 Compare Strategies'}
                </button>
              </div>

              {/* Strategy Comparison Panel */}
              {showComparison && (
                <StrategyComparisonPanel claimId={claimId} summaries={comparisonData} />
              )}
            </div>
          )}
          </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ClaimSummaryModal;
