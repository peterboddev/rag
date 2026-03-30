import React from 'react';
import { ClaimSummaryResponse } from '../services/claimApi';
import EvaluationScoreDisplay from './EvaluationScoreDisplay';

// ─── Types ───────────────────────────────────────────────────────────────────

export type Strategy = 'full-context' | 'rag' | 'graph-rag' | 'enriched';

export interface ColumnState {
  status: 'idle' | 'loading' | 'success' | 'error';
  response: ClaimSummaryResponse | null;
  error: string | null;
}

export interface StrategyColumnProps {
  strategyKey: Strategy;
  label: string;
  data: ColumnState;
  onRegenerate: () => void;
}

interface AnomalySummary {
  critical: number;
  warning: number;
  info: number;
  total: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getAnomalySeverityColor(severity: string): string {
  switch (severity) {
    case 'critical': return '#dc3545';
    case 'warning': return '#ffc107';
    case 'info': return '#17a2b8';
    default: return '#6c757d';
  }
}

function computeAnomalySummary(anomalies: ClaimSummaryResponse['anomalies']): AnomalySummary {
  const summary: AnomalySummary = { critical: 0, warning: 0, info: 0, total: 0 };
  for (const a of anomalies) {
    if (a.severity === 'critical') summary.critical++;
    else if (a.severity === 'warning') summary.warning++;
    else if (a.severity === 'info') summary.info++;
    summary.total++;
  }
  return summary;
}

// ─── Component ───────────────────────────────────────────────────────────────

const StrategyColumn: React.FC<StrategyColumnProps> = ({ strategyKey, label, data, onRegenerate }) => {
  const { status, response, error } = data;
  const [promptExpanded, setPromptExpanded] = React.useState(false);

  return (
    <div
      data-testid={`strategy-column-${strategyKey}`}
      style={{
        flex: '1 1 0',
        minWidth: '250px',
        border: '1px solid #dee2e6',
        borderRadius: '8px',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#fff',
      }}
    >
      {/* Column header */}
      <div style={{
        padding: '12px 14px',
        borderBottom: '1px solid #dee2e6',
        fontWeight: 700,
        fontSize: '15px',
        backgroundColor: '#f8f9fa',
        borderRadius: '8px 8px 0 0',
      }}>
        {label}
      </div>

      {/* Column body */}
      <div style={{ padding: '14px', flex: 1, overflowY: 'auto' }}>
        {/* Idle state */}
        {status === 'idle' && (
          <div
            data-testid={`column-idle-${strategyKey}`}
            style={{ color: '#999', textAlign: 'center', padding: '32px 12px', fontSize: '14px' }}
          >
            Click "Generate All" to generate a summary using {label}.
          </div>
        )}

        {/* Loading state */}
        {status === 'loading' && (
          <div
            data-testid={`column-loading-${strategyKey}`}
            style={{ textAlign: 'center', padding: '32px 12px', color: '#666' }}
          >
            <div style={{ fontSize: '28px', marginBottom: '10px' }}>⏳</div>
            <div style={{ fontSize: '14px' }}>Generating summary with <strong>{label}</strong>...</div>
          </div>
        )}

        {/* Error state */}
        {status === 'error' && (
          <div
            data-testid={`column-error-${strategyKey}`}
            style={{
              padding: '12px 14px',
              backgroundColor: '#f8d7da',
              color: '#721c24',
              borderRadius: '6px',
              border: '1px solid #f5c6cb',
              fontSize: '14px',
            }}
          >
            ⚠️ {error || 'An unknown error occurred'}
          </div>
        )}

        {/* Success state */}
        {status === 'success' && response && (
          <div data-testid={`column-success-${strategyKey}`}>
            {/* Cache indicator */}
            {response.cached && (
              <div
                data-testid={`cache-indicator-${strategyKey}`}
                style={{
                  padding: '6px 10px',
                  marginBottom: '10px',
                  backgroundColor: '#e2e3e5',
                  borderRadius: '4px',
                  fontSize: '12px',
                  color: '#383d41',
                }}
              >
                📦 Cached{response.cachedAt ? ` — ${new Date(response.cachedAt).toLocaleString()}` : ''}
              </div>
            )}

            {/* Metadata */}
            <div
              data-testid={`metadata-${strategyKey}`}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px',
                marginBottom: '10px',
                padding: '8px 10px',
                backgroundColor: '#f8f9fa',
                borderRadius: '4px',
                fontSize: '12px',
              }}
            >
              <span>📄 Docs: <strong>{response.documentCount}</strong></span>
              <span>⏱️ <strong>{response.processingTime}ms</strong></span>
            </div>

            {/* Anomalies */}
            <AnomalySection response={response} strategyKey={strategyKey} />

            {/* Evaluation scores */}
            {response.evaluation && (
              <EvaluationScoreDisplay scores={response.evaluation} strategy={label} />
            )}

            {/* Prompt section */}
            {response.promptInfo && (
              <div
                data-testid={`prompt-section-${strategyKey}`}
                style={{ marginBottom: '10px' }}
              >
                <button
                  onClick={() => setPromptExpanded(!promptExpanded)}
                  style={{
                    background: 'none',
                    border: '1px solid #dee2e6',
                    borderRadius: '4px',
                    padding: '6px 10px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    fontWeight: 600,
                    color: '#495057',
                    width: '100%',
                    textAlign: 'left',
                  }}
                >
                  {promptExpanded ? '▼' : '▶'} LLM Prompt
                </button>
                {promptExpanded && (
                  <div style={{
                    marginTop: '6px',
                    padding: '8px 10px',
                    backgroundColor: '#f8f9fa',
                    borderRadius: '4px',
                    border: '1px solid #dee2e6',
                  }}>
                    {response.promptInfo.retrievalQuery && (
                      <div
                        data-testid={`retrieval-query-${strategyKey}`}
                        style={{ marginBottom: '8px' }}
                      >
                        <strong style={{ fontSize: '12px', color: '#495057' }}>Retrieval Query:</strong>
                        <pre style={{
                          margin: '4px 0 0 0',
                          padding: '6px 8px',
                          backgroundColor: '#fff',
                          borderRadius: '3px',
                          border: '1px solid #e0e0e0',
                          fontSize: '12px',
                          fontFamily: 'monospace',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}>
                          {response.promptInfo.retrievalQuery}
                        </pre>
                      </div>
                    )}
                    <pre style={{
                      margin: 0,
                      padding: '6px 8px',
                      backgroundColor: '#fff',
                      borderRadius: '3px',
                      border: '1px solid #e0e0e0',
                      fontSize: '12px',
                      fontFamily: 'monospace',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      maxHeight: '200px',
                      overflowY: 'auto',
                    }}>
                      {response.promptInfo.promptTemplate}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {/* Summary text */}
            <div
              data-testid={`summary-text-${strategyKey}`}
              style={{
                padding: '10px 12px',
                backgroundColor: '#fafafa',
                borderRadius: '6px',
                border: '1px solid #e0e0e0',
                lineHeight: 1.6,
                fontSize: '13px',
                whiteSpace: 'pre-wrap',
                overflowY: 'auto',
                maxHeight: '300px',
              }}
            >
              {response.summary}
            </div>

            {/* Regenerate button */}
            <div style={{ marginTop: '12px' }}>
              <button
                data-testid={`regenerate-btn-${strategyKey}`}
                onClick={onRegenerate}
                style={{
                  padding: '6px 14px',
                  fontSize: '13px',
                  fontWeight: 600,
                  backgroundColor: '#fd7e14',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '5px',
                  cursor: 'pointer',
                  width: '100%',
                }}
              >
                🔄 Regenerate
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Anomaly sub-render ──────────────────────────────────────────────────────

function AnomalySection({ response, strategyKey }: { response: ClaimSummaryResponse; strategyKey: Strategy }) {
  const anomalies = response.anomalies ?? [];
  const [expanded, setExpanded] = React.useState(false);

  if (anomalies.length === 0) {
    return (
      <div
        data-testid={`no-anomalies-${strategyKey}`}
        style={{
          padding: '8px 10px',
          marginBottom: '10px',
          backgroundColor: '#d4edda',
          color: '#155724',
          borderRadius: '4px',
          fontSize: '13px',
        }}
      >
        ✅ No anomalies detected
      </div>
    );
  }

  const summary = computeAnomalySummary(anomalies);

  return (
    <div data-testid={`anomalies-${strategyKey}`} style={{ marginBottom: '10px' }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px',
          padding: '8px 10px',
          backgroundColor: '#fff3cd',
          borderRadius: '4px',
          fontSize: '12px',
          cursor: 'pointer',
        }}>
          <span style={{ fontWeight: 600 }}>{expanded ? '▼' : '▶'} ⚠️ Anomalies:</span>
          {summary.critical > 0 && (
            <span
              data-testid={`anomaly-critical-count-${strategyKey}`}
              style={{
                padding: '1px 6px',
                borderRadius: '3px',
                backgroundColor: getAnomalySeverityColor('critical'),
                color: '#fff',
                fontWeight: 600,
                fontSize: '11px',
              }}
            >
              {summary.critical} critical
            </span>
          )}
          {summary.warning > 0 && (
            <span
              data-testid={`anomaly-warning-count-${strategyKey}`}
              style={{
                padding: '1px 6px',
                borderRadius: '3px',
                backgroundColor: getAnomalySeverityColor('warning'),
                color: '#000',
                fontWeight: 600,
                fontSize: '11px',
              }}
            >
              {summary.warning} warning
            </span>
          )}
          {summary.info > 0 && (
            <span
              data-testid={`anomaly-info-count-${strategyKey}`}
              style={{
                padding: '1px 6px',
                borderRadius: '3px',
                backgroundColor: getAnomalySeverityColor('info'),
                color: '#fff',
                fontWeight: 600,
                fontSize: '11px',
              }}
            >
              {summary.info} info
            </span>
          )}
        </div>
        {/* Anomaly details */}
        {expanded && (
        <div style={{ marginTop: '6px', fontSize: '12px' }}>
          {anomalies.map((a, i) => (
            <div
              key={i}
              data-testid={`anomaly-detail-${strategyKey}-${i}`}
              style={{
                padding: '6px 10px',
                marginBottom: '4px',
                borderLeft: `3px solid ${getAnomalySeverityColor(a.severity)}`,
                backgroundColor: '#fafafa',
                borderRadius: '0 4px 4px 0',
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: '2px' }}>{a.description}</div>
              <div style={{ color: '#666', fontSize: '11px' }}>
                <span style={{
                  display: 'inline-block',
                  padding: '0 4px',
                  borderRadius: '2px',
                  backgroundColor: getAnomalySeverityColor(a.severity),
                  color: a.severity === 'warning' ? '#000' : '#fff',
                  fontSize: '10px',
                  fontWeight: 600,
                  marginRight: '6px',
                }}>
                  {a.severity}
                </span>
                {a.sourceDocument && <span>Source: {a.sourceDocument}</span>}
              </div>
              {a.dataValues && Object.keys(a.dataValues).length > 0 && (
                <div style={{ marginTop: '3px', color: '#555', fontSize: '11px' }}>
                  {Object.entries(a.dataValues).map(([k, v]) => (
                    <span key={k} style={{ marginRight: '10px' }}>
                      {k}: <strong>{v}</strong>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        )}
    </div>
  );
}


export default StrategyColumn;
