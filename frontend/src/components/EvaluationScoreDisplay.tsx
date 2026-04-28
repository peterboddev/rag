import React from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface EvaluationScores {
  helpfulness: number;
  faithfulness: number;
  completeness: number;
  anomalyAccuracy?: number;
  evaluatedAt: string;
}

interface EvaluationScoreDisplayProps {
  scores: EvaluationScores;
  strategy: string;
  sourceLabel?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns the color for a given evaluation score.
 * green (#28a745) >= 0.8, yellow (#ffc107) >= 0.5, red (#dc3545) < 0.5
 */
export function getScoreColor(score: number): string {
  if (score >= 0.8) return '#28a745';
  if (score >= 0.5) return '#ffc107';
  return '#dc3545';
}

function ScoreBadge({ label, score }: { label: string; score: number }) {
  const isNA = label === 'Anomaly Accuracy' && score === 0;
  const color = isNA ? '#6c757d' : getScoreColor(score);
  const textColor = isNA ? '#fff' : (score >= 0.5 && score < 0.8 ? '#000' : '#fff');
  return (
    <span
      data-testid={`score-${label.toLowerCase()}`}
      style={{
        padding: '2px 8px',
        borderRadius: '12px',
        backgroundColor: color,
        color: textColor,
        fontWeight: 600,
        fontSize: '12px',
      }}
    >
      {label}: {isNA ? 'N/A' : `${(score * 100).toFixed(0)}%`}
    </span>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

const EvaluationScoreDisplay: React.FC<EvaluationScoreDisplayProps> = ({ scores, strategy, sourceLabel }) => {
  const metrics: { label: string; score: number }[] = [
    { label: 'Helpfulness', score: scores.helpfulness },
    { label: 'Faithfulness', score: scores.faithfulness },
    { label: 'Completeness', score: scores.completeness },
  ];

  if (scores.anomalyAccuracy != null) {
    metrics.push({ label: 'Anomaly Accuracy', score: scores.anomalyAccuracy });
  }

  return (
    <div
      data-testid="evaluation-score-display"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '10px',
        marginBottom: '16px',
        padding: '10px 14px',
        backgroundColor: '#f0f4ff',
        borderRadius: '6px',
        fontSize: '13px',
        alignItems: 'center',
      }}
    >
      <span style={{ fontWeight: 600, marginRight: '4px' }}>📈 Evaluation ({sourceLabel || strategy}):</span>
      {metrics.map((m) => (
        <ScoreBadge key={m.label} label={m.label} score={m.score} />
      ))}
      <span style={{ fontSize: '11px', color: '#666', marginLeft: 'auto' }}>
        {new Date(scores.evaluatedAt).toLocaleString()}
      </span>
    </div>
  );
};

export default EvaluationScoreDisplay;
