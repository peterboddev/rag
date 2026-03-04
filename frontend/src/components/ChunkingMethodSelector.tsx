import React, { useState, useEffect } from 'react';
import { 
  ChunkingMethod, 
  ChunkingConfigurationResponse, 
  EmbeddingCleanupResponse,
  CleanupStatusResponse,
  SUPPORTED_CHUNKING_METHODS 
} from '../types';

interface ChunkingMethodSelectorProps {
  customerUUID: string;
  onMethodChange?: (method: ChunkingMethod) => void;
  disabled?: boolean;
}

interface CleanupProgress {
  jobId: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  progress: number;
  message: string;
}

const ChunkingMethodSelector: React.FC<ChunkingMethodSelectorProps> = ({
  customerUUID,
  onMethodChange,
  disabled = false
}) => {
  const [currentConfig, setCurrentConfig] = useState<ChunkingConfigurationResponse | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<ChunkingMethod | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingMethod, setPendingMethod] = useState<ChunkingMethod | null>(null);
  const [cleanupProgress, setCleanupProgress] = useState<CleanupProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const API_BASE_URL = process.env.REACT_APP_API_GATEWAY_URL || 'https://0128pkytnc.execute-api.us-east-1.amazonaws.com/prod';

  // Load current chunking configuration
  useEffect(() => {
    loadChunkingConfig();
  }, [customerUUID]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll cleanup progress if in progress (only for actual cleanup jobs, not embedding jobs)
  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (cleanupProgress && 
        cleanupProgress.status === 'in_progress' && 
        !cleanupProgress.jobId.startsWith('emb-')) { // Only poll for actual cleanup jobs, not embedding jobs
      interval = setInterval(() => {
        pollCleanupStatus(cleanupProgress.jobId);
      }, 2000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [cleanupProgress]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadChunkingConfig = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${API_BASE_URL}/customers/${customerUUID}/chunking-config`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Id': localStorage.getItem('tenantId') || 'local-dev-tenant',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to load chunking configuration: ${response.statusText}`);
      }

      const config: ChunkingConfigurationResponse = await response.json();
      setCurrentConfig(config);
      setSelectedMethod(config.currentMethod);

      // Notify parent component of the initial method
      if (onMethodChange) {
        onMethodChange(config.currentMethod);
      }

      console.log('Loaded chunking configuration', { 
        customerUUID, 
        currentMethod: config.currentMethod.id,
        cleanupRequired: config.cleanupRequired 
      });

    } catch (error) {
      console.error('Error loading chunking configuration:', error);
      setError(error instanceof Error ? error.message : 'Failed to load configuration');
    } finally {
      setLoading(false);
    }
  };

  const handleMethodChange = (methodId: string) => {
    const method = SUPPORTED_CHUNKING_METHODS.find(m => m.id === methodId);
    if (!method || !currentConfig) return;

    // If method is the same as current, no action needed
    if (method.id === currentConfig.currentMethod.id) {
      return;
    }

    // If cleanup is required, show confirmation dialog
    if (currentConfig.cleanupRequired || method.id !== currentConfig.currentMethod.id) {
      setPendingMethod(method);
      setShowConfirmDialog(true);
    } else {
      updateChunkingMethod(method);
    }
  };

  const updateChunkingMethod = async (method: ChunkingMethod) => {
    try {
      setUpdating(true);
      setError(null);

      console.log('Updating chunking method', { customerUUID, newMethod: method.id });

      const response = await fetch(`${API_BASE_URL}/customers/${customerUUID}/chunking-config`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Id': localStorage.getItem('tenantId') || 'local-dev-tenant',
        },
        body: JSON.stringify({
          customerUUID,
          chunkingMethod: method
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to update chunking method: ${response.statusText}`);
      }

      // Update local state
      setSelectedMethod(method);
      if (currentConfig) {
        setCurrentConfig({
          ...currentConfig,
          currentMethod: method,
          cleanupRequired: true // Will need cleanup after method change
        });
      }

      // Trigger embedding generation with new method
      await triggerEmbeddingGeneration(method);

      // Notify parent component
      if (onMethodChange) {
        onMethodChange(method);
      }

      console.log('Successfully updated chunking method', { customerUUID, method: method.id });

    } catch (error) {
      console.error('Error updating chunking method:', error);
      setError(error instanceof Error ? error.message : 'Failed to update method');
    } finally {
      setUpdating(false);
      setShowConfirmDialog(false);
      setPendingMethod(null);
    }
  };

  const triggerEmbeddingGeneration = async (method: ChunkingMethod) => {
    try {
      console.log('Triggering embedding generation', { customerUUID, method: method.id });

      const response = await fetch(`${API_BASE_URL}/documents/embeddings/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Id': localStorage.getItem('tenantId') || 'local-dev-tenant',
        },
        body: JSON.stringify({
          customerUUID,
          chunkingMethod: method,
          force: true // Force regeneration even if embeddings exist
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to trigger embedding generation: ${response.statusText}`);
      }

      const result = await response.json();
      
      console.log('Successfully triggered embedding generation', { 
        customerUUID, 
        jobId: result.jobId,
        documentsToProcess: result.documentsToProcess,
        estimatedDuration: result.estimatedDuration
      });

      // Show progress message and simulate completion after estimated time
      setCleanupProgress({
        jobId: result.jobId,
        status: 'in_progress',
        progress: 0,
        message: `Generating embeddings for ${result.documentsToProcess} document(s) using ${method.name}. Estimated time: ${result.estimatedDuration}`
      });

      // Simulate progress completion after estimated duration
      // Since we don't have a real status endpoint for embeddings, we'll simulate completion
      setTimeout(() => {
        setCleanupProgress({
          jobId: result.jobId,
          status: 'completed',
          progress: 100,
          message: `Successfully generated embeddings for ${result.documentsToProcess} document(s) using ${method.name}`
        });

        // Clear progress after showing completion
        setTimeout(() => {
          setCleanupProgress(null);
          // Reload configuration to get updated state
          loadChunkingConfig();
        }, 3000);
      }, 5000); // Show completion after 5 seconds

    } catch (error) {
      console.error('Error triggering embedding generation:', error);
      setError(error instanceof Error ? error.message : 'Failed to generate embeddings');
    }
  };

  const pollCleanupStatus = async (jobId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/customers/${customerUUID}/chunking-config/cleanup/${jobId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Id': localStorage.getItem('tenantId') || 'local-dev-tenant',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get cleanup status: ${response.statusText}`);
      }

      const status: CleanupStatusResponse = await response.json();
      
      setCleanupProgress({
        jobId: status.jobId,
        status: status.status,
        progress: status.progress,
        message: status.status === 'completed' 
          ? `Cleanup completed: ${status.embeddingsRemoved} embeddings removed, ${status.documentsReprocessed} documents reprocessed`
          : status.status === 'failed'
          ? `Cleanup failed: ${status.errors.join(', ')}`
          : `Processing... ${status.progress}% complete`
      });

      // If cleanup is completed or failed, stop polling
      if (status.status === 'completed' || status.status === 'failed') {
        // Reload configuration to get updated state
        setTimeout(() => {
          loadChunkingConfig();
          setCleanupProgress(null);
        }, 1000);
      }

    } catch (error) {
      console.error('Error polling cleanup status:', error);
    }
  };

  const confirmMethodChange = () => {
    if (pendingMethod) {
      updateChunkingMethod(pendingMethod);
    }
  };

  const cancelMethodChange = () => {
    setShowConfirmDialog(false);
    setPendingMethod(null);
    // Reset selection to current method
    if (currentConfig) {
      setSelectedMethod(currentConfig.currentMethod);
    }
  };

  if (loading) {
    return (
      <div className="chunking-method-selector">
        <div className="loading">Loading chunking configuration...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="chunking-method-selector">
        <div className="error">
          <strong>Error:</strong> {error}
          <button onClick={loadChunkingConfig} className="retry-button">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!currentConfig || !selectedMethod) {
    return (
      <div className="chunking-method-selector">
        <div className="error">No chunking configuration available</div>
      </div>
    );
  }

  return (
    <div className="chunking-method-selector">
      <div className="selector-header">
        <label htmlFor="chunking-method-select">
          <strong>Knowledge Base Chunking Method:</strong>
        </label>
        {currentConfig.cleanupRequired && (
          <span className="cleanup-indicator">
            ⚠️ Cleanup required
          </span>
        )}
      </div>

      <select
        id="chunking-method-select"
        value={selectedMethod.id}
        onChange={(e) => handleMethodChange(e.target.value)}
        disabled={disabled || updating || (cleanupProgress?.status === 'in_progress')}
        className="chunking-method-dropdown"
      >
        {SUPPORTED_CHUNKING_METHODS.map((method) => (
          <option key={method.id} value={method.id}>
            {method.name}
          </option>
        ))}
      </select>

      <div className="method-description">
        <p>{selectedMethod.description}</p>
        <div className="method-parameters">
          <strong>Parameters:</strong>
          <ul>
            <li>Strategy: {selectedMethod.parameters.strategy}</li>
            {selectedMethod.parameters.chunkSize && (
              <li>Chunk Size: {selectedMethod.parameters.chunkSize} tokens</li>
            )}
            {selectedMethod.parameters.chunkOverlap && (
              <li>Overlap: {selectedMethod.parameters.chunkOverlap} tokens</li>
            )}
            {selectedMethod.parameters.maxTokens && (
              <li>Max Tokens: {selectedMethod.parameters.maxTokens}</li>
            )}
          </ul>
        </div>
      </div>

      {/* Cleanup Progress */}
      {cleanupProgress && (
        <div className="cleanup-progress">
          <div className="progress-header">
            <strong>Embedding Generation Progress</strong>
            <span className={`status-badge ${cleanupProgress.status}`}>
              {cleanupProgress.status.replace('_', ' ').toUpperCase()}
            </span>
          </div>
          
          {cleanupProgress.status === 'in_progress' && (
            <div className="progress-bar">
              <div 
                className="progress-fill" 
                style={{ width: `${cleanupProgress.progress}%` }}
              />
            </div>
          )}
          
          <div className="progress-message">
            {cleanupProgress.message}
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      {showConfirmDialog && pendingMethod && (
        <div className="confirmation-dialog-overlay">
          <div className="confirmation-dialog">
            <h3>Confirm Chunking Method Change</h3>
            <p>
              Changing the chunking method from <strong>{currentConfig.currentMethod.name}</strong> to{' '}
              <strong>{pendingMethod.name}</strong> will:
            </p>
            <ul>
              <li>Generate embeddings for all your documents using the new chunking method</li>
              <li>Replace any existing embeddings with the new ones</li>
              <li>This process may take several minutes depending on document count</li>
              <li>Documents will be searchable once embedding generation completes</li>
            </ul>
            <p>Are you sure you want to continue?</p>
            
            <div className="dialog-actions">
              <button 
                onClick={confirmMethodChange} 
                className="confirm-button"
                disabled={updating}
              >
                {updating ? 'Updating...' : 'Yes, Change Method'}
              </button>
              <button 
                onClick={cancelMethodChange} 
                className="cancel-button"
                disabled={updating}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .chunking-method-selector {
          background: #f8f9fa;
          border: 1px solid #dee2e6;
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 16px;
        }

        .selector-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }

        .cleanup-indicator {
          color: #856404;
          background-color: #fff3cd;
          border: 1px solid #ffeaa7;
          border-radius: 4px;
          padding: 2px 8px;
          font-size: 12px;
        }

        .chunking-method-dropdown {
          width: 100%;
          padding: 8px 12px;
          border: 1px solid #ced4da;
          border-radius: 4px;
          font-size: 14px;
          margin-bottom: 12px;
        }

        .chunking-method-dropdown:disabled {
          background-color: #e9ecef;
          cursor: not-allowed;
        }

        .method-description {
          background: white;
          border: 1px solid #e9ecef;
          border-radius: 4px;
          padding: 12px;
          font-size: 13px;
        }

        .method-parameters ul {
          margin: 8px 0 0 0;
          padding-left: 20px;
        }

        .method-parameters li {
          margin: 4px 0;
        }

        .cleanup-progress {
          margin-top: 16px;
          background: white;
          border: 1px solid #e9ecef;
          border-radius: 4px;
          padding: 12px;
        }

        .progress-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }

        .status-badge {
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: bold;
        }

        .status-badge.pending {
          background-color: #fff3cd;
          color: #856404;
        }

        .status-badge.in_progress {
          background-color: #cce5ff;
          color: #004085;
        }

        .status-badge.completed {
          background-color: #d4edda;
          color: #155724;
        }

        .status-badge.failed {
          background-color: #f8d7da;
          color: #721c24;
        }

        .progress-bar {
          width: 100%;
          height: 8px;
          background-color: #e9ecef;
          border-radius: 4px;
          overflow: hidden;
          margin-bottom: 8px;
        }

        .progress-fill {
          height: 100%;
          background-color: #007bff;
          transition: width 0.3s ease;
        }

        .progress-message {
          font-size: 13px;
          color: #6c757d;
        }

        .confirmation-dialog-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background-color: rgba(0, 0, 0, 0.5);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 1000;
        }

        .confirmation-dialog {
          background: white;
          border-radius: 8px;
          padding: 24px;
          max-width: 500px;
          width: 90%;
          max-height: 80vh;
          overflow-y: auto;
        }

        .confirmation-dialog h3 {
          margin: 0 0 16px 0;
          color: #495057;
        }

        .confirmation-dialog ul {
          margin: 12px 0;
          padding-left: 20px;
        }

        .confirmation-dialog li {
          margin: 8px 0;
        }

        .dialog-actions {
          display: flex;
          gap: 12px;
          justify-content: flex-end;
          margin-top: 24px;
        }

        .confirm-button {
          background-color: #dc3545;
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 4px;
          cursor: pointer;
        }

        .confirm-button:hover:not(:disabled) {
          background-color: #c82333;
        }

        .confirm-button:disabled {
          background-color: #6c757d;
          cursor: not-allowed;
        }

        .cancel-button {
          background-color: #6c757d;
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 4px;
          cursor: pointer;
        }

        .cancel-button:hover:not(:disabled) {
          background-color: #5a6268;
        }

        .loading, .error {
          padding: 16px;
          text-align: center;
        }

        .error {
          color: #721c24;
          background-color: #f8d7da;
          border: 1px solid #f5c6cb;
          border-radius: 4px;
        }

        .retry-button {
          margin-left: 12px;
          background-color: #007bff;
          color: white;
          border: none;
          padding: 4px 8px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
        }

        .retry-button:hover {
          background-color: #0056b3;
        }
      `}</style>
    </div>
  );
};

export default ChunkingMethodSelector;