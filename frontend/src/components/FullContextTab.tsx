import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getClaimSummary, clearClaimCache } from '../services/claimApi';
import StrategyColumn, { ColumnState } from './StrategyColumn';
import { MODEL_OPTIONS } from './StrategyComparisonView';

// ─── Types ───────────────────────────────────────────────────────────────────

interface FullContextTabProps {
  claimId: string;
}

const INITIAL_COLUMN_STATE: ColumnState = {
  status: 'idle',
  response: null,
  error: null,
};

// ─── Component ───────────────────────────────────────────────────────────────

const FullContextTab: React.FC<FullContextTabProps> = ({ claimId }) => {
  const [columnState, setColumnState] = useState<ColumnState>(INITIAL_COLUMN_STATE);
  const [modelId, setModelId] = useState('amazon.nova-pro-v1:0');
  const [customPrompt, setCustomPrompt] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [promptExpanded, setPromptExpanded] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const stopTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    stopTimer();
    setElapsedSeconds(0);
    intervalRef.current = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
  }, [stopTimer]);

  const handleGenerate = useCallback(async () => {
    setColumnState({ status: 'loading', response: null, error: null });
    startTimer();

    try {
      const response = await getClaimSummary(
        claimId,
        'full-context',
        undefined,
        true,
        true,
        undefined,
        modelId,
        customPrompt || undefined,
      );
      stopTimer();
      setColumnState({ status: 'success', response, error: null });
    } catch (err: any) {
      stopTimer();
      const message = err?.message || 'An unknown error occurred';
      const isTimeout = message.toLowerCase().includes('timeout') || message.toLowerCase().includes('timed out');
      setColumnState({
        status: 'error',
        response: null,
        error: isTimeout
          ? 'Full context analysis timed out. The agent may still be processing — try again in a moment.'
          : message,
      });
    }
  }, [claimId, modelId, customPrompt, startTimer, stopTimer]);

  const isLoading = columnState.status === 'loading';
  const hasResult = columnState.status === 'success' || columnState.status === 'error';
  const [cacheClearing, setCacheClearing] = useState(false);
  const [cacheMessage, setCacheMessage] = useState<string | null>(null);

  const handleClearCache = useCallback(async () => {
    setCacheClearing(true);
    setCacheMessage(null);
    try {
      const result = await clearClaimCache(claimId);
      setCacheMessage(`✅ ${result.message}`);
      setTimeout(() => setCacheMessage(null), 5000);
    } catch (err: any) {
      setCacheMessage(`❌ Failed to clear cache: ${err?.message || 'Unknown error'}`);
    } finally {
      setCacheClearing(false);
    }
  }, [claimId]);

  return (
    <div data-testid="full-context-tab">
      {/* Model selector */}
      <div style={{ marginBottom: '12px', textAlign: 'center' }}>
        <label style={{ fontSize: '14px', fontWeight: 600, marginRight: '8px' }}>
          LLM Model:
        </label>
        <select
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          disabled={isLoading}
          style={{
            padding: '4px 8px',
            fontSize: '14px',
            borderRadius: '4px',
            border: '1px solid #ccc',
            cursor: isLoading ? 'not-allowed' : 'pointer',
          }}
        >
          {MODEL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Expandable custom prompt */}
      <div style={{ marginBottom: '12px', textAlign: 'center' }}>
        <button
          onClick={() => setPromptExpanded(!promptExpanded)}
          disabled={isLoading}
          style={{
            background: 'none',
            border: '1px solid #dee2e6',
            borderRadius: '4px',
            padding: '6px 10px',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            fontSize: '13px',
            fontWeight: 600,
            color: '#495057',
          }}
        >
          {promptExpanded ? '▼' : '▶'} Custom Prompt (Full Context)
        </button>
        {promptExpanded && (
          <div style={{ marginTop: '8px', textAlign: 'left', maxWidth: '600px', margin: '8px auto 0' }}>
            <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>
              Use <code>[DOCUMENTS]</code> as a placeholder for the claim documents in your prompt.
            </div>
            <textarea
              data-testid="custom-prompt-textarea"
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              disabled={isLoading}
              placeholder="Enter a custom prompt... Use [DOCUMENTS] where you want the claim documents inserted."
              style={{
                width: '100%',
                minHeight: '80px',
                padding: '8px',
                fontSize: '13px',
                borderRadius: '4px',
                border: '1px solid #ccc',
                fontFamily: 'monospace',
                resize: 'vertical',
              }}
            />
          </div>
        )}
      </div>

      {/* Generate / Regenerate button + Clear Cache */}
      <div style={{ marginBottom: '16px', textAlign: 'center', display: 'flex', gap: '8px', justifyContent: 'center', alignItems: 'center' }}>
        <button
          data-testid="generate-btn"
          onClick={handleGenerate}
          disabled={isLoading}
          style={{
            padding: '10px 24px',
            fontSize: '14px',
            fontWeight: 600,
            backgroundColor: isLoading ? '#6c757d' : hasResult ? '#fd7e14' : '#007bff',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: isLoading ? 'not-allowed' : 'pointer',
          }}
        >
          {isLoading
            ? '⏳ Generating...'
            : hasResult
              ? '🔄 Regenerate'
              : '🚀 Generate'}
        </button>
        <button
          data-testid="clear-cache-btn"
          onClick={handleClearCache}
          disabled={isLoading || cacheClearing}
          style={{
            padding: '10px 16px',
            fontSize: '13px',
            fontWeight: 600,
            backgroundColor: cacheClearing ? '#6c757d' : '#dc3545',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: (isLoading || cacheClearing) ? 'not-allowed' : 'pointer',
          }}
        >
          {cacheClearing ? '⏳ Clearing...' : '🗑️ Clear Cache'}
        </button>
      </div>

      {/* Cache operation message */}
      {cacheMessage && (
        <div style={{ textAlign: 'center', marginBottom: '12px', fontSize: '13px', color: cacheMessage.startsWith('✅') ? '#28a745' : '#dc3545' }}>
          {cacheMessage}
        </div>
      )}

      {/* Elapsed time counter during loading */}
      {isLoading && (
        <div
          data-testid="elapsed-timer"
          style={{
            textAlign: 'center',
            padding: '12px',
            marginBottom: '12px',
            color: '#666',
            fontSize: '14px',
          }}
        >
          ⏳ Processing... {elapsedSeconds}s elapsed
        </div>
      )}

      {/* Result display via StrategyColumn */}
      {(columnState.status === 'success' || columnState.status === 'error') && (
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>
          <StrategyColumn
            strategyKey="full-context"
            label="Full Context Analysis"
            data={columnState}
            onRegenerate={handleGenerate}
            claimId={claimId}
          />
        </div>
      )}
    </div>
  );
};

export default FullContextTab;
