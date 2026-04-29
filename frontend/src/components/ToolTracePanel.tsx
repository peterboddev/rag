import React from 'react';
import { ToolTraceEntry } from '../services/claimApi';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ToolTracePanelProps {
  toolTrace: ToolTraceEntry[];
  strategyKey: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

const ToolTracePanel: React.FC<ToolTracePanelProps> = ({ toolTrace, strategyKey }) => {
  const [expanded, setExpanded] = React.useState(false);

  if (!toolTrace || toolTrace.length === 0) {
    return null;
  }

  const totalDurationMs = toolTrace.reduce((sum, entry) => sum + entry.durationMs, 0);
  const totalSeconds = (totalDurationMs / 1000).toFixed(1);

  return (
    <div
      data-testid={`tool-trace-panel-${strategyKey}`}
      style={{ marginBottom: '10px' }}
    >
      {/* Collapsed header */}
      <button
        data-testid={`tool-trace-toggle-${strategyKey}`}
        onClick={() => setExpanded(!expanded)}
        style={{
          background: 'none',
          border: '1px solid #6f42c1',
          borderRadius: '4px',
          padding: '6px 10px',
          cursor: 'pointer',
          fontSize: '13px',
          fontWeight: 600,
          color: '#6f42c1',
          width: '100%',
          textAlign: 'left',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span>🔧 Tool Execution Trace: {toolTrace.length} tools · {totalSeconds}s total</span>
        <span>{expanded ? '▼' : '▶'}</span>
      </button>

      {/* Expanded trace entries */}
      {expanded && (
        <div
          data-testid={`tool-trace-entries-${strategyKey}`}
          style={{
            marginTop: '6px',
            padding: '8px',
            backgroundColor: '#f8f7fc',
            borderRadius: '4px',
            border: '1px solid #6f42c1',
            fontSize: '12px',
          }}
        >
          {toolTrace.map((entry, idx) => (
            <TraceEntryRow
              key={idx}
              entry={entry}
              strategyKey={strategyKey}
              index={idx}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Trace Entry Row ─────────────────────────────────────────────────────────

function TraceEntryRow({ entry, strategyKey, index }: {
  entry: ToolTraceEntry;
  strategyKey: string;
  index: number;
}) {
  const [detailExpanded, setDetailExpanded] = React.useState(false);
  const hasError = !!entry.error;

  return (
    <div
      data-testid={`trace-entry-${strategyKey}-${index}`}
      style={{
        marginBottom: '4px',
        borderLeft: hasError ? '3px solid #dc3545' : '3px solid #6f42c1',
        backgroundColor: '#fff',
        borderRadius: '0 4px 4px 0',
      }}
    >
      {/* Row header — clickable to expand details */}
      <div
        data-testid={`trace-entry-header-${strategyKey}-${index}`}
        onClick={() => setDetailExpanded(!detailExpanded)}
        style={{
          padding: '6px 10px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}
      >
        <span style={{ color: '#6c757d', fontWeight: 600, minWidth: '24px' }}>
          #{entry.executionOrder}
        </span>
        <span style={{ fontWeight: 600, flex: 1 }}>
          {entry.toolName}
          {hasError && (
            <span style={{ color: '#dc3545', marginLeft: '6px', fontSize: '11px' }}>
              ❌ Error
            </span>
          )}
        </span>
        <span style={{
          color: '#6c757d',
          fontSize: '11px',
          fontFamily: 'monospace',
        }}>
          {entry.durationMs}ms
        </span>
        <span style={{ color: '#999', fontSize: '10px' }}>
          {detailExpanded ? '▼' : '▶'}
        </span>
      </div>

      {/* Expanded details */}
      {detailExpanded && (
        <div
          data-testid={`trace-entry-detail-${strategyKey}-${index}`}
          style={{
            padding: '6px 10px 8px 42px',
            borderTop: '1px solid #eee',
            fontSize: '11px',
          }}
        >
          {/* Input summary */}
          <div style={{ marginBottom: '4px' }}>
            <strong style={{ color: '#495057' }}>Input:</strong>
            <div style={{
              marginTop: '2px',
              padding: '4px 6px',
              backgroundColor: '#f8f9fa',
              borderRadius: '3px',
              fontFamily: 'monospace',
              fontSize: '11px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: '#555',
            }}>
              {entry.inputSummary}
            </div>
          </div>

          {/* Output summary */}
          <div style={{ marginBottom: hasError ? '4px' : '0' }}>
            <strong style={{ color: '#495057' }}>Output:</strong>
            <div style={{
              marginTop: '2px',
              padding: '4px 6px',
              backgroundColor: '#f8f9fa',
              borderRadius: '3px',
              fontFamily: 'monospace',
              fontSize: '11px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: '#555',
            }}>
              {entry.outputSummary}
            </div>
          </div>

          {/* Error message */}
          {hasError && (
            <div>
              <strong style={{ color: '#dc3545' }}>Error:</strong>
              <div style={{
                marginTop: '2px',
                padding: '4px 6px',
                backgroundColor: '#f8d7da',
                borderRadius: '3px',
                fontFamily: 'monospace',
                fontSize: '11px',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: '#721c24',
              }}>
                {entry.error}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ToolTracePanel;
