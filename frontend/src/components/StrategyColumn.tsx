import React from 'react';
import { ClaimSummaryResponse, EvaluationScores, getFinancialAnalysis } from '../services/claimApi';
import EvaluationScoreDisplay from './EvaluationScoreDisplay';
import ToolTracePanel from './ToolTracePanel';

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
  claimId?: string;
  /** Grouped evaluation scores by source, keyed by evaluation source */
  groupedEvaluations?: {
    'agentcore-online'?: EvaluationScores;
    'bedrock-api'?: EvaluationScores;
  };
}

interface AnomalySummary {
  critical: number;
  warning: number;
  info: number;
  total: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns true if all non-null, non-undefined values are equal, false otherwise.
 * Supports 2-way and 3-way comparison.
 */
export function valuesAgree(a: number | null | undefined, b: number | null | undefined, c?: number | null | undefined): boolean {
  const values = [a, b, c].filter(v => v !== undefined);
  const nonNull = values.filter((v): v is number => v !== null);
  if (nonNull.length <= 1) return true;
  return nonNull.every(v => v === nonNull[0]);
}

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

const StrategyColumn: React.FC<StrategyColumnProps> = ({ strategyKey, label, data, onRegenerate, claimId, groupedEvaluations }) => {
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

            {/* Tool Execution Trace */}
            {response.toolTrace && response.toolTrace.length > 0 && (
              <ToolTracePanel toolTrace={response.toolTrace} strategyKey={strategyKey} />
            )}

            {/* Enhanced Analysis for Full Context Strategy */}
            {strategyKey === 'full-context' && (response.financialSummary || response.timeline || response.agentFinancialSummary || response.agentTimeline || response.bdaFinancialSummary || response.bdaTimeline) && (
              <EnhancedAnalysisSection response={response} strategyKey={strategyKey} claimId={claimId} />
            )}

            {/* Evaluation scores */}
            {groupedEvaluations ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {groupedEvaluations['agentcore-online'] && (
                  <EvaluationScoreDisplay scores={groupedEvaluations['agentcore-online']} strategy={label} sourceLabel="AgentCore Online" />
                )}
                {groupedEvaluations['bedrock-api'] && (
                  <EvaluationScoreDisplay scores={groupedEvaluations['bedrock-api']} strategy={label} sourceLabel="Bedrock API" />
                )}
              </div>
            ) : (
              response.evaluation && (
                <EvaluationScoreDisplay scores={response.evaluation} strategy={label} />
              )
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

export interface AnomalyGroup {
  key: string;
  header: string;
  emoji: string;
  anomalies: ClaimSummaryResponse['anomalies'];
}

export function groupAnomaliesBySource(anomalies: ClaimSummaryResponse['anomalies']): AnomalyGroup[] {
  const deterministic: ClaimSummaryResponse['anomalies'] = [];
  const llm: ClaimSummaryResponse['anomalies'] = [];
  const other: ClaimSummaryResponse['anomalies'] = [];

  for (const a of anomalies) {
    if (a.source === 'deterministic') deterministic.push(a);
    else if (a.source === 'llm') llm.push(a);
    else other.push(a);
  }

  const groups: AnomalyGroup[] = [];
  if (deterministic.length > 0) groups.push({ key: 'deterministic', header: 'Rule-Based Anomalies', emoji: '🔧', anomalies: deterministic });
  if (llm.length > 0) groups.push({ key: 'llm', header: 'AI-Detected Anomalies', emoji: '🤖', anomalies: llm });
  if (other.length > 0) groups.push({ key: 'other', header: 'Other Anomalies', emoji: '⚠️', anomalies: other });
  return groups;
}

function AnomalyGroupSection({ group, strategyKey }: { group: AnomalyGroup; strategyKey: Strategy }) {
  const [expanded, setExpanded] = React.useState(false);
  const summary = computeAnomalySummary(group.anomalies);

  return (
    <div data-testid={`anomaly-group-${group.key}-${strategyKey}`} style={{ marginBottom: '6px' }}>
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
        }}
      >
        <span style={{ fontWeight: 600 }}>{expanded ? '▼' : '▶'} {group.emoji} {group.header}:</span>
        {summary.critical > 0 && (
          <span
            data-testid={`anomaly-critical-count-${group.key}-${strategyKey}`}
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
            data-testid={`anomaly-warning-count-${group.key}-${strategyKey}`}
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
            data-testid={`anomaly-info-count-${group.key}-${strategyKey}`}
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
      {expanded && (
        <div style={{ marginTop: '6px', fontSize: '12px' }}>
          {group.anomalies.map((a, i) => (
            <div
              key={i}
              data-testid={`anomaly-detail-${group.key}-${strategyKey}-${i}`}
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

function AnomalySection({ response, strategyKey }: { response: ClaimSummaryResponse; strategyKey: Strategy }) {
  const anomalies = response.anomalies ?? [];

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

  const groups = groupAnomaliesBySource(anomalies);

  return (
    <div data-testid={`anomalies-${strategyKey}`} style={{ marginBottom: '10px' }}>
      {groups.map(group => (
        <AnomalyGroupSection key={group.key} group={group} strategyKey={strategyKey} />
      ))}
    </div>
  );
}


// ─── Enhanced Analysis sub-render ────────────────────────────────────────────

function ComparisonRow({ label, deterministic, agentPredicted, bdaExtracted, isYear, columnCount }: {
  label: string;
  deterministic: number | null | undefined;
  agentPredicted: number | null | undefined;
  bdaExtracted?: number | null | undefined;
  isYear?: boolean;
  columnCount: number;
}) {
  const agree = valuesAgree(deterministic, agentPredicted, bdaExtracted);
  const format = (v: number | null | undefined) => {
    if (v == null) return 'N/A';
    if (isYear) return `${v}`;
    return `${v.toFixed(2)}`;
  };
  const gridTemplate = `1fr ${'1fr '.repeat(columnCount)}28px`;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: gridTemplate, gap: '4px', padding: '3px 0', fontSize: '12px', alignItems: 'center' }}>
      <div style={{ fontWeight: 600 }}>{label}</div>
      <div>{format(deterministic)}</div>
      {columnCount >= 2 && <div>{format(agentPredicted)}</div>}
      {columnCount >= 3 && <div>{format(bdaExtracted)}</div>}
      <div>{agree ? '✅' : '⚠️'}</div>
    </div>
  );
}


function EnhancedAnalysisSection({ response, strategyKey, claimId }: { response: ClaimSummaryResponse; strategyKey: Strategy; claimId?: string }) {
  const [expanded, setExpanded] = React.useState(false);
  const [reasoningExpanded, setReasoningExpanded] = React.useState(false);
  const [agentData, setAgentData] = React.useState<{
    agentFinancialSummary?: any;
    agentTimeline?: any;
    agentConfidence?: number | null;
    agentReasoning?: string | null;
  } | null>(null);
  const [polling, setPolling] = React.useState(false);

  // Poll for agent-predicted data when it's not in the response
  React.useEffect(() => {
    if (!claimId || response.agentFinancialSummary != null || response.agentTimeline != null) return;
    if (agentData) return; // already fetched

    setPolling(true);
    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 12; // 60 seconds max (5s intervals)

    const poll = async () => {
      while (!cancelled && attempts < maxAttempts) {
        attempts++;
        try {
          const result = await getFinancialAnalysis(claimId);
          if (result.status === 'completed' && (result.agentFinancialSummary || result.agentTimeline)) {
            if (!cancelled) {
              setAgentData({
                agentFinancialSummary: result.agentFinancialSummary,
                agentTimeline: result.agentTimeline,
                agentConfidence: result.agentConfidence,
                agentReasoning: result.agentReasoning,
              });
              setPolling(false);
            }
            return;
          }
        } catch {
          // ignore polling errors
        }
        await new Promise(r => setTimeout(r, 5000));
      }
      if (!cancelled) setPolling(false);
    };

    poll();
    return () => { cancelled = true; };
  }, [claimId, response.agentFinancialSummary, response.agentTimeline, agentData]);

  // Merge agent data from response or polling
  const mergedResponse = {
    ...response,
    agentFinancialSummary: response.agentFinancialSummary ?? agentData?.agentFinancialSummary ?? null,
    agentTimeline: response.agentTimeline ?? agentData?.agentTimeline ?? null,
    agentConfidence: response.agentConfidence ?? agentData?.agentConfidence ?? null,
    agentReasoning: response.agentReasoning ?? agentData?.agentReasoning ?? null,
    bdaFinancialSummary: response.bdaFinancialSummary ?? null,
    bdaTimeline: response.bdaTimeline ?? null,
  };

  if (!mergedResponse.financialSummary && !mergedResponse.timeline && !mergedResponse.agentFinancialSummary && !mergedResponse.agentTimeline && !mergedResponse.bdaFinancialSummary && !mergedResponse.bdaTimeline) {
    return null;
  }

  const hasAgentData = mergedResponse.agentFinancialSummary != null || mergedResponse.agentTimeline != null;
  const hasBdaData = mergedResponse.bdaFinancialSummary != null || mergedResponse.bdaTimeline != null;
  const columnCount = 1 + (hasAgentData ? 1 : 0) + (hasBdaData ? 1 : 0);

  return (
    <div style={{ marginBottom: '10px' }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          background: 'none',
          border: '1px solid #28a745',
          borderRadius: '4px',
          padding: '6px 10px',
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: 600,
          color: '#28a745',
          width: '100%',
          textAlign: 'left',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span>💰📅 Enhanced Analysis{polling ? ' ⏳' : ''}</span>
        <span>{expanded ? '▼' : '▶'}</span>
      </button>

      {expanded && (
        <div
          style={{
            marginTop: '6px',
            padding: '10px 12px',
            backgroundColor: '#f8fff9',
            borderRadius: '4px',
            border: '1px solid #28a745',
            fontSize: '13px',
          }}
        >
          {columnCount >= 2 ? (
            /* Multi-column comparison layout (2 or 3 columns) */
            <div>
              {/* Column headers */}
              <div style={{ display: 'grid', gridTemplateColumns: `1fr ${'1fr '.repeat(columnCount)}28px`, gap: '4px', marginBottom: '8px', fontSize: '11px', fontWeight: 700, color: '#495057' }}>
                <div></div>
                <div>Extracted (Deterministic)</div>
                {hasAgentData && (
                  <div>
                    Agent-Predicted (LLM)
                    {mergedResponse.agentConfidence != null && (
                      <span style={{ fontWeight: 400, marginLeft: '4px', color: '#6c757d' }}>
                        — {Math.round(mergedResponse.agentConfidence * 100)}% confidence
                      </span>
                    )}
                  </div>
                )}
                {hasBdaData && <div>BDA Extraction</div>}
                <div></div>
              </div>

              {/* Financial comparison rows */}
              {(mergedResponse.financialSummary || mergedResponse.agentFinancialSummary || mergedResponse.bdaFinancialSummary) && (
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ fontWeight: 600, marginBottom: '4px', color: '#28a745', fontSize: '12px' }}>
                    💰 Financial Summary
                  </div>
                  <ComparisonRow
                    label="Min Payment"
                    deterministic={mergedResponse.financialSummary?.minPayment ?? null}
                    agentPredicted={mergedResponse.agentFinancialSummary?.minPayment ?? null}
                    bdaExtracted={hasBdaData ? (mergedResponse.bdaFinancialSummary?.minPayment ?? null) : undefined}
                    columnCount={columnCount}
                  />
                  <ComparisonRow
                    label="Max Payment"
                    deterministic={mergedResponse.financialSummary?.maxPayment ?? null}
                    agentPredicted={mergedResponse.agentFinancialSummary?.maxPayment ?? null}
                    bdaExtracted={hasBdaData ? (mergedResponse.bdaFinancialSummary?.maxPayment ?? null) : undefined}
                    columnCount={columnCount}
                  />
                  <ComparisonRow
                    label="Total Value"
                    deterministic={mergedResponse.financialSummary?.totalValue ?? null}
                    agentPredicted={mergedResponse.agentFinancialSummary?.totalValue ?? null}
                    bdaExtracted={hasBdaData ? (mergedResponse.bdaFinancialSummary?.totalValue ?? null) : undefined}
                    columnCount={columnCount}
                  />
                </div>
              )}

              {/* Timeline comparison rows */}
              {(mergedResponse.timeline || mergedResponse.agentTimeline || mergedResponse.bdaTimeline) && (
                <div style={{ marginBottom: '8px' }}>
                  <div style={{ fontWeight: 600, marginBottom: '4px', color: '#28a745', fontSize: '12px' }}>
                    📅 Care History Timeline
                  </div>
                  <ComparisonRow
                    label="Start Year"
                    deterministic={mergedResponse.timeline?.startYear ?? null}
                    agentPredicted={mergedResponse.agentTimeline?.startYear ?? null}
                    bdaExtracted={hasBdaData ? (mergedResponse.bdaTimeline?.startYear ?? null) : undefined}
                    isYear
                    columnCount={columnCount}
                  />
                  <ComparisonRow
                    label="End Year"
                    deterministic={mergedResponse.timeline?.endYear ?? null}
                    agentPredicted={mergedResponse.agentTimeline?.endYear ?? null}
                    bdaExtracted={hasBdaData ? (mergedResponse.bdaTimeline?.endYear ?? null) : undefined}
                    isYear
                    columnCount={columnCount}
                  />
                  <ComparisonRow
                    label="Duration (years)"
                    deterministic={mergedResponse.timeline?.durationYears ?? null}
                    agentPredicted={mergedResponse.agentTimeline?.durationYears ?? null}
                    bdaExtracted={hasBdaData ? (mergedResponse.bdaTimeline?.durationYears ?? null) : undefined}
                    isYear
                    columnCount={columnCount}
                  />
                </div>
              )}

              {/* Agent reasoning collapsible */}
              {mergedResponse.agentReasoning && (
                <div style={{ marginTop: '6px' }}>
                  <button
                    onClick={() => setReasoningExpanded(!reasoningExpanded)}
                    style={{
                      background: 'none',
                      border: '1px solid #dee2e6',
                      borderRadius: '4px',
                      padding: '4px 8px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: '#495057',
                      width: '100%',
                      textAlign: 'left',
                    }}
                  >
                    {reasoningExpanded ? '▼' : '▶'} Agent Reasoning
                  </button>
                  {reasoningExpanded && (
                    <div style={{
                      marginTop: '4px',
                      padding: '8px',
                      backgroundColor: '#fff',
                      borderRadius: '4px',
                      border: '1px solid #dee2e6',
                      fontSize: '12px',
                      lineHeight: 1.5,
                      whiteSpace: 'pre-wrap',
                    }}>
                      {mergedResponse.agentReasoning}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* Single-column deterministic-only layout (existing behavior) */
            <div>
              {/* Financial Summary */}
              {response.financialSummary && (
                <div style={{ marginBottom: response.timeline ? '12px' : '0' }}>
                  <div style={{ fontWeight: 600, marginBottom: '6px', color: '#28a745' }}>
                    💰 Financial Summary
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
                    <div>
                      <strong>Payment Range:</strong><br />
                      ${response.financialSummary.minPayment.toFixed(2)} - ${response.financialSummary.maxPayment.toFixed(2)}
                    </div>
                    <div>
                      <strong>Total Value:</strong><br />
                      ${response.financialSummary.totalValue.toFixed(2)}
                    </div>
                  </div>
                  {response.financialSummary.payments.length > 0 && (
                    <div style={{ marginTop: '8px' }}>
                      <strong style={{ fontSize: '12px' }}>Payments Found: {response.financialSummary.payments.length}</strong>
                      <div style={{ maxHeight: '100px', overflowY: 'auto', marginTop: '4px' }}>
                        {response.financialSummary.payments.slice(0, 5).map((payment, idx) => (
                          <div key={idx} style={{ fontSize: '11px', color: '#666', marginBottom: '2px' }}>
                            ${payment.amount.toFixed(2)} ({payment.sourceDocument})
                          </div>
                        ))}
                        {response.financialSummary.payments.length > 5 && (
                          <div style={{ fontSize: '11px', color: '#999', fontStyle: 'italic' }}>
                            +{response.financialSummary.payments.length - 5} more...
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Timeline Data */}
              {response.timeline && (
                <div>
                  <div style={{ fontWeight: 600, marginBottom: '6px', color: '#28a745' }}>
                    📅 Care History Timeline
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', fontSize: '12px' }}>
                    <div>
                      <strong>Start Year:</strong><br />
                      {response.timeline.startYear || 'N/A'}
                    </div>
                    <div>
                      <strong>End Year:</strong><br />
                      {response.timeline.endYear || 'N/A'}
                    </div>
                    <div>
                      <strong>Duration:</strong><br />
                      {response.timeline.durationYears !== null
                        ? `${response.timeline.durationYears} years`
                        : 'N/A'}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default StrategyColumn;
