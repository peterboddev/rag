import React, { useState, useEffect } from 'react';
import { ChunkVisualizationPanelProps, ChunkVisualizationState, DocumentChunk, ChunkVisualizationResponse, ChunkVisualizationError } from '../types';
import ChunkItem from './ChunkItem';

const ChunkVisualizationPanel: React.FC<ChunkVisualizationPanelProps> = ({
  selectedDocuments,
  documents,
  chunkingMethod,
  customerUUID,
  tenantId,
  isLoading,
  onChunkSelect
}) => {
  const [state, setState] = useState<ChunkVisualizationState>({
    chunks: [],
    isLoadingChunks: false,
    chunkError: null,
    selectedChunks: new Set(),
    expandedChunks: new Set()
  });

  const API_BASE_URL = process.env.REACT_APP_API_GATEWAY_URL || 'https://0128pkytnc.execute-api.us-east-1.amazonaws.com/prod';

  // Effect to load chunks when selected documents or chunking method changes
  useEffect(() => {
    if (selectedDocuments.size > 0 && chunkingMethod && customerUUID && tenantId) {
      loadChunks();
    } else {
      // Clear chunks when no documents are selected
      setState(prev => ({
        ...prev,
        chunks: [],
        chunkError: null,
        selectedChunks: new Set(),
        expandedChunks: new Set()
      }));
    }
  }, [selectedDocuments, chunkingMethod, customerUUID, tenantId]);

  const loadChunks = async () => {
    if (!chunkingMethod) return;

    setState(prev => ({ ...prev, isLoadingChunks: true, chunkError: null }));

    try {
      const response = await fetch(`${API_BASE_URL}/documents/chunks/visualization`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Id': tenantId
        },
        body: JSON.stringify({
          customerUUID,
          documentIds: Array.from(selectedDocuments),
          chunkingMethod
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to load chunks: ${response.statusText}`);
      }

      const data: ChunkVisualizationResponse = await response.json();
      
      setState(prev => ({
        ...prev,
        chunks: data.chunks,
        isLoadingChunks: false,
        chunkError: null
      }));

    } catch (error) {
      console.error('Error loading chunks:', error);
      setState(prev => ({
        ...prev,
        chunks: [],
        isLoadingChunks: false,
        chunkError: error instanceof Error ? error.message : 'Failed to load chunks'
      }));
    }
  };

  const handleChunkSelect = (chunkId: string) => {
    setState(prev => {
      const newSelectedChunks = new Set(prev.selectedChunks);
      if (newSelectedChunks.has(chunkId)) {
        newSelectedChunks.delete(chunkId);
      } else {
        newSelectedChunks.add(chunkId);
      }
      return { ...prev, selectedChunks: newSelectedChunks };
    });

    if (onChunkSelect) {
      onChunkSelect(chunkId);
    }
  };

  const handleToggleExpand = (chunkId: string) => {
    setState(prev => {
      const newExpandedChunks = new Set(prev.expandedChunks);
      if (newExpandedChunks.has(chunkId)) {
        newExpandedChunks.delete(chunkId);
      } else {
        newExpandedChunks.add(chunkId);
      }
      return { ...prev, expandedChunks: newExpandedChunks };
    });
  };

  const renderEmptyState = () => {
    if (selectedDocuments.size === 0) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          textAlign: 'center',
          padding: '40px 20px',
          color: '#666'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>📄</div>
          <h4 style={{ margin: '0 0 8px 0', color: '#333', fontSize: '16px' }}>No Documents Selected</h4>
          <p style={{ margin: '0', fontSize: '14px', lineHeight: '1.4' }}>Select documents from the left panel to view their chunks</p>
        </div>
      );
    }

    if (!chunkingMethod) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          textAlign: 'center',
          padding: '40px 20px',
          color: '#666'
        }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚙️</div>
          <h4 style={{ margin: '0 0 8px 0', color: '#333', fontSize: '16px' }}>No Chunking Method</h4>
          <p style={{ margin: '0', fontSize: '14px', lineHeight: '1.4' }}>Configure a chunking method to generate document chunks</p>
        </div>
      );
    }

    return null;
  };

  const renderLoadingState = () => (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      textAlign: 'center',
      padding: '40px 20px',
      color: '#666'
    }}>
      <div style={{
        width: '32px',
        height: '32px',
        border: '3px solid #f3f3f3',
        borderTop: '3px solid #007bff',
        borderRadius: '50%',
        animation: 'spin 1s linear infinite',
        marginBottom: '16px'
      }} />
      <h4 style={{ margin: '0 0 8px 0', color: '#333', fontSize: '16px' }}>Generating Chunks</h4>
      <p style={{ margin: '0', fontSize: '14px', lineHeight: '1.4' }}>Processing {selectedDocuments.size} document(s) with {chunkingMethod?.name}...</p>
    </div>
  );

  const renderErrorState = () => (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      textAlign: 'center',
      padding: '40px 20px',
      color: '#666'
    }}>
      <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
      <h4 style={{ margin: '0 0 8px 0', color: '#333', fontSize: '16px' }}>Error Loading Chunks</h4>
      <p style={{ margin: '0 0 16px 0', fontSize: '14px', lineHeight: '1.4' }}>{state.chunkError}</p>
      <button 
        style={{
          padding: '12px 24px',
          border: 'none',
          borderRadius: '4px',
          fontSize: '16px',
          fontWeight: '600',
          backgroundColor: '#007bff',
          color: 'white',
          opacity: state.isLoadingChunks ? 0.6 : 1,
          cursor: state.isLoadingChunks ? 'not-allowed' : 'pointer'
        }}
        onClick={loadChunks}
        disabled={state.isLoadingChunks}
      >
        Retry
      </button>
      
      {/* CSS Animations */}
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );

  const renderChunkList = () => (
    <div>
      <div style={{ 
        padding: '16px 20px',
        backgroundColor: '#fff',
        borderRadius: '8px',
        border: '1px solid #ddd',
        marginBottom: '16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <h4 style={{ margin: '0', color: '#333', fontSize: '16px' }}>
          {state.chunks.length} Chunk{state.chunks.length !== 1 ? 's' : ''} 
          {chunkingMethod && ` (${chunkingMethod.name})`}
        </h4>
        {state.chunks.length > 0 && (
          <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: '#666' }}>
            <span>Selected: {state.selectedChunks.size}</span>
            <span>Expanded: {state.expandedChunks.size}</span>
          </div>
        )}
      </div>
      
      <div>
        {state.chunks.map((chunk) => (
          <ChunkItem
            key={chunk.id}
            chunk={chunk}
            isSelected={state.selectedChunks.has(chunk.id)}
            isExpanded={state.expandedChunks.has(chunk.id)}
            onSelect={handleChunkSelect}
            onToggleExpand={handleToggleExpand}
          />
        ))}
      </div>
    </div>
  );

  return (
    <div style={{ 
      flex: '1',
      overflow: 'auto',
      padding: '20px',
      height: '100%'
    }}>
      {/* Header */}
      <div style={{ 
        marginBottom: '20px',
        padding: '20px',
        backgroundColor: '#f8f9fa',
        borderRadius: '8px',
        border: '1px solid #eee'
      }}>
        <h3 style={{ margin: '0 0 5px 0', color: '#333', fontSize: '18px' }}>Document Chunks</h3>
        {selectedDocuments.size > 0 && (
          <div style={{ fontSize: '14px', color: '#666' }}>
            {selectedDocuments.size} document{selectedDocuments.size !== 1 ? 's' : ''} selected
          </div>
        )}
      </div>

      {/* Content */}
      <div>
        {state.isLoadingChunks && renderLoadingState()}
        {!state.isLoadingChunks && state.chunkError && renderErrorState()}
        {!state.isLoadingChunks && !state.chunkError && state.chunks.length === 0 && renderEmptyState()}
        {!state.isLoadingChunks && !state.chunkError && state.chunks.length > 0 && renderChunkList()}
      </div>
    </div>
  );
};

export default ChunkVisualizationPanel;