import React, { useState, useRef, useEffect, useCallback } from 'react';
import { getClaimSummary, ClaimSummaryResponse } from '../services/claimApi';
import StrategyColumn, { Strategy, ColumnState } from './StrategyColumn';

// ─── Types ───────────────────────────────────────────────────────────────────

interface StrategyComparisonViewProps {
  claimId: string;
}

interface StrategyConfig {
  key: Strategy;
  label: string;
  chunkingMethod?: string;
}

type ChunkingMethod = 'full-document' | 'semantic';

const CHUNKING_OPTIONS: { value: ChunkingMethod; label: string }[] = [
  { value: 'full-document', label: 'Full Document Chunking' },
  { value: 'semantic', label: 'Semantic Chunking' },
];

const MODEL_OPTIONS: { value: string; label: string }[] = [
  { value: 'amazon.nova-pro-v1:0', label: 'Amazon Nova Pro' },
  { value: 'amazon.nova-lite-v1:0', label: 'Amazon Nova Lite' },
  { value: 'amazon.nova-micro-v1:0', label: 'Amazon Nova Micro' },
  { value: 'us.amazon.nova-premier-v1:0', label: 'Amazon Nova Premier' },
  { value: 'us.anthropic.claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'anthropic.claude-sonnet-4-5-20250929-v1:0', label: 'Claude Sonnet 4.5' },
  { value: 'global.anthropic.claude-sonnet-4-20250514-v1:0', label: 'Claude Sonnet 4' },
  { value: 'us.anthropic.claude-3-5-sonnet-20240620-v1:0', label: 'Claude 3.5 Sonnet' },
  { value: 'us.anthropic.claude-3-5-haiku-20241022-v1:0', label: 'Claude 3.5 Haiku' },
  { value: 'us.meta.llama4-maverick-17b-instruct-v1:0', label: 'Llama 4 Maverick' },
  { value: 'us.meta.llama4-scout-17b-instruct-v1:0', label: 'Llama 4 Scout' },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildStrategies(chunkingMethod: ChunkingMethod): StrategyConfig[] {
  return [
    { key: 'full-context', label: 'Full Context' },
    { key: 'rag', label: 'RAG', chunkingMethod },
    { key: 'graph-rag', label: 'Graph RAG' },
    { key: 'enriched', label: 'Enriched' },
  ];
}

const INITIAL_COLUMN_STATE: ColumnState = {
  status: 'idle',
  response: null,
  error: null,
};

function createInitialColumns(): Record<Strategy, ColumnState> {
  return {
    'full-context': { ...INITIAL_COLUMN_STATE },
    'rag': { ...INITIAL_COLUMN_STATE },
    'graph-rag': { ...INITIAL_COLUMN_STATE },
    'enriched': { ...INITIAL_COLUMN_STATE },
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

const StrategyComparisonView: React.FC<StrategyComparisonViewProps> = ({ claimId }) => {
  const [columns, setColumns] = useState<Record<Strategy, ColumnState>>(createInitialColumns);
  const [chunkingMethod, setChunkingMethod] = useState<ChunkingMethod>('semantic');
  const [useReranker, setUseReranker] = useState(false);
  const [modelId, setModelId] = useState('amazon.nova-pro-v1:0');
  const [customPrompt, setCustomPrompt] = useState('');
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [isNarrow, setIsNarrow] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // ResizeObserver to detect width < 900px and switch flex-direction
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        setIsNarrow(width < 900);
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Generate summary for a single strategy
  const generateForStrategy = useCallback(
    async (config: StrategyConfig, forceRegenerate: boolean = false) => {
      setColumns((prev) => ({
        ...prev,
        [config.key]: { status: 'loading', response: null, error: null },
      }));

      try {
        const response = await getClaimSummary(
          claimId,
          config.key,
          config.chunkingMethod,
          forceRegenerate,
          true, // includeEvaluation
          config.key === 'graph-rag' ? useReranker : undefined,
          modelId,
          config.key === 'full-context' && customPrompt ? customPrompt : undefined
        );
        setColumns((prev) => ({
          ...prev,
          [config.key]: { status: 'success', response, error: null },
        }));
      } catch (err: any) {
        setColumns((prev) => ({
          ...prev,
          [config.key]: {
            status: 'error',
            response: null,
            error: err?.message || 'An unknown error occurred',
          },
        }));
      }
    },
    [claimId, useReranker, modelId]
  );

  // Generate All: call getClaimSummary concurrently for all three strategies
  const handleGenerateAll = useCallback(async () => {
    const strategies = buildStrategies(chunkingMethod);

    // Set all columns to loading
    setColumns({
      'full-context': { status: 'loading', response: null, error: null },
      'rag': { status: 'loading', response: null, error: null },
      'graph-rag': { status: 'loading', response: null, error: null },
      'enriched': { status: 'loading', response: null, error: null },
    });

    const promises = strategies.map((config) =>
      getClaimSummary(
        claimId,
        config.key,
        config.chunkingMethod,
        false,
        true, // includeEvaluation
        config.key === 'graph-rag' ? useReranker : undefined,
        modelId,
        config.key === 'full-context' && customPrompt ? customPrompt : undefined
      )
    );

    const results = await Promise.allSettled(promises);

    results.forEach((result, index) => {
      const strategyKey = strategies[index].key;
      if (result.status === 'fulfilled') {
        setColumns((prev) => ({
          ...prev,
          [strategyKey]: { status: 'success', response: result.value, error: null },
        }));
      } else {
        setColumns((prev) => ({
          ...prev,
          [strategyKey]: {
            status: 'error',
            response: null,
            error: result.reason?.message || 'An unknown error occurred',
          },
        }));
      }
    });
  }, [claimId, chunkingMethod, useReranker, modelId]);

  // Individual regeneration handler
  const handleRegenerate = useCallback(
    (strategyKey: Strategy) => {
      const strategies = buildStrategies(chunkingMethod);
      const config = strategies.find((c) => c.key === strategyKey);
      if (config) {
        generateForStrategy(config, true);
      }
    },
    [generateForStrategy, chunkingMethod]
  );

  const isAnyLoading = Object.values(columns).some((col) => col.status === 'loading');

  return (
    <div ref={containerRef} data-testid="strategy-comparison-view">
      {/* Model selector */}
      <div style={{ marginBottom: '12px', textAlign: 'center' }}>
        <label style={{ fontSize: '14px', fontWeight: 600, marginRight: '8px' }}>
          LLM Model:
        </label>
        <select
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          style={{
            padding: '4px 8px', fontSize: '14px', borderRadius: '4px',
            border: '1px solid #ccc', cursor: 'pointer',
          }}
        >
          {MODEL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Chunking method selector for RAG strategy */}
      <div style={{ marginBottom: '12px', textAlign: 'center' }}>
        <label style={{ fontSize: '14px', fontWeight: 600, marginRight: '12px' }}>
          RAG Chunking Method:
        </label>
        {CHUNKING_OPTIONS.map((opt) => (
          <label key={opt.value} style={{ marginRight: '16px', cursor: 'pointer', fontSize: '14px' }}>
            <input
              type="radio"
              name="comparison-chunking"
              value={opt.value}
              checked={chunkingMethod === opt.value}
              onChange={() => setChunkingMethod(opt.value)}
              style={{ marginRight: '4px' }}
            />
            {opt.label}
          </label>
        ))}
      </div>

      {/* Reranker toggle for Graph RAG */}
      <div style={{ marginBottom: '12px', textAlign: 'center' }}>
        <label style={{ fontSize: '14px', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={useReranker}
            onChange={() => setUseReranker(!useReranker)}
            style={{ marginRight: '4px' }}
          />
          Graph RAG: Use Reranker (Cohere Rerank 3.5)
        </label>
      </div>

      {/* Editable prompt for Full Context strategy */}
      <div style={{ marginBottom: '12px' }}>
        <button
          onClick={() => setPromptExpanded(!promptExpanded)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '14px', fontWeight: 600, color: '#333', padding: '4px 0',
          }}
        >
          {promptExpanded ? '▼' : '▶'} Custom Prompt (Full Context)
        </button>
        {promptExpanded && (
          <div style={{ marginTop: '6px' }}>
            <textarea
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="Enter custom prompt... Use [DOCUMENTS] as placeholder for document text. Leave empty to use default prompt."
              style={{
                width: '100%', minHeight: '150px', padding: '8px',
                fontSize: '12px', fontFamily: 'monospace',
                border: '1px solid #ccc', borderRadius: '4px',
                resize: 'vertical',
              }}
            />
            <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>
              Use <code>[DOCUMENTS]</code> where document text should be inserted. Leave empty for default prompt.
            </div>
          </div>
        )}
      </div>

      {/* Generate All button */}
      <div style={{ marginBottom: '16px', textAlign: 'center' }}>
        <button
          data-testid="generate-all-btn"
          onClick={handleGenerateAll}
          disabled={isAnyLoading}
          style={{
            padding: '10px 24px',
            fontSize: '14px',
            fontWeight: 600,
            backgroundColor: isAnyLoading ? '#6c757d' : '#007bff',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: isAnyLoading ? 'not-allowed' : 'pointer',
          }}
        >
          {isAnyLoading ? '⏳ Generating...' : '🚀 Generate All'}
        </button>
      </div>

      {/* Three-column layout */}
      <div
        data-testid="columns-container"
        style={{
          display: 'flex',
          flexDirection: isNarrow ? 'column' : 'row',
          gap: '12px',
        }}
      >
        {buildStrategies(chunkingMethod).map((config) => (
          <div
            key={config.key}
            style={{ flex: '1 1 0', minWidth: '250px' }}
          >
            <StrategyColumn
              strategyKey={config.key}
              label={config.label}
              data={columns[config.key]}
              onRegenerate={() => handleRegenerate(config.key)}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default StrategyComparisonView;
