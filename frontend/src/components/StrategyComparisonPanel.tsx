import React from 'react';
import EvaluationScoreDisplay from './EvaluationScoreDisplay';

// ─── Types ───────────────────────────────────────────────────────────────────

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

interface PromptInfo {
  promptTemplate: string;
  strategyLabel: string;
  retrievalQuery?: string;
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
}

interface StrategyComparisonPanelProps {
  claimId: string;
  summaries: Map<string, ClaimSummaryResponse>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type MetricKey = 'helpfulness' | 'faithfulness' | 'completeness';

const METRICS: MetricKey[] = ['helpfulness', 'faithfulness', 'completeness'];

/**
 * Finds the strategy with the best score for a given metric.
 * Returns null if no strategies have evaluation data.
 */
function getBestStrategy(
  summaries: Map<string, ClaimSummaryResponse>,
  metric: MetricKey,
): string | null {
  let best: string | null = null;
  let bestScore = -1;
  summaries.forEach((resp, key) => {
    const score = resp.evaluation?.[metric];
    if (score != null && score > bestScore) {
      bestScore = score;
      best = key;
    }
  });
  return best;
}

// ─── Component ───────────────────────────────────────────────────────────────

const StrategyComparisonPanel: React.FC<StrategyComparisonPanelProps> = ({ claimId, summaries }) => {
  const entries = Array.from(summaries.entries());

  if (entries.length === 0) {
    return (
      <div data-testid="comparison-empty" style={{ padding: '16px', color: '#666', textAlign: 'center' }}>
        No strategy evaluations available for comparison.
      </div>
    );
  }

  // Pre-compute best strategy per metric
  const bestByMetric: Record<MetricKey, string | null> = {
    helpfulness: getBestStrategy(summaries, 'helpfulness'),
    faithfulness: getBestStrategy(summaries, 'faithfulness'),
    completeness: getBestStrategy(summaries, 'completeness'),
  };

  return (
    <div data-testid="strategy-comparison-panel" style={{ marginTop: '20px' }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: '15px' }}>📊 Strategy Comparison — {claimId}</h3>

      <div style={{ display: 'flex', gap: '12px', overflowX: 'auto' }}>
        {entries.map(([key, resp]) => {
          const isBestMap: Record<MetricKey, boolean> = {
            helpfulness: bestByMetric.helpfulness === key,
            faithfulness: bestByMetric.faithfulness === key,
            completeness: bestByMetric.completeness === key,
          };

          return (
            <div
              key={key}
              data-testid={`comparison-card-${key}`}
              style={{
                flex: '1 1 0',
                minWidth: '220px',
                border: '1px solid #dee2e6',
                borderRadius: '8px',
                padding: '14px',
                backgroundColor: '#fff',
              }}
            >
              {/* Strategy header */}
              <div style={{ fontWeight: 700, fontSize: '14px', marginBottom: '8px' }}>
                {resp.strategy}
                {resp.chunkingMethod && (
                  <span style={{ fontWeight: 400, fontSize: '12px', color: '#666', marginLeft: '6px' }}>
                    ({resp.chunkingMethod})
                  </span>
                )}
              </div>

              {/* Metadata */}
              <div style={{ fontSize: '12px', color: '#555', marginBottom: '10px' }}>
                📄 {resp.documentCount} docs · ⏱️ {resp.processingTime}ms
              </div>

              {/* Prompt preview */}
              {resp.promptInfo && (
                <div style={{ fontSize: '12px', color: '#555', marginBottom: '10px' }}>
                  <div>🏷️ {resp.promptInfo.strategyLabel}</div>
                  {resp.promptInfo.retrievalQuery && (
                    <div style={{ marginTop: '4px', color: '#666' }}>
                      🔍 KB Query: {resp.promptInfo.retrievalQuery.length > 80
                        ? resp.promptInfo.retrievalQuery.slice(0, 80) + '…'
                        : resp.promptInfo.retrievalQuery}
                    </div>
                  )}
                </div>
              )}

              {/* Evaluation scores with best-highlight */}
              {resp.evaluation ? (
                <div>
                  <EvaluationScoreDisplay scores={resp.evaluation} strategy={resp.strategy} />
                  {/* Best metric indicators */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '6px' }}>
                    {METRICS.map((metric) =>
                      isBestMap[metric] && entries.length > 1 ? (
                        <span
                          key={metric}
                          data-testid={`best-${metric}-${key}`}
                          style={{
                            fontSize: '11px',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            backgroundColor: '#d4edda',
                            color: '#155724',
                            fontWeight: 600,
                          }}
                        >
                          ⭐ Best {metric}
                        </span>
                      ) : null,
                    )}
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: '12px', color: '#999' }}>No evaluation data</div>
              )}

              {/* Truncated summary preview */}
              <div
                style={{
                  marginTop: '10px',
                  fontSize: '12px',
                  color: '#444',
                  lineHeight: 1.5,
                  maxHeight: '80px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {resp.summary.length > 200 ? resp.summary.slice(0, 200) + '…' : resp.summary}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default StrategyComparisonPanel;
