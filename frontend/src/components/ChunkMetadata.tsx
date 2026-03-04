import React from 'react';
import { ChunkMetadataProps } from '../types';

const ChunkMetadata: React.FC<ChunkMetadataProps> = ({
  chunk,
  showDetailed
}) => {
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const estimateReadingTime = (text: string): string => {
    const wordsPerMinute = 200;
    const wordCount = text.split(/\s+/).length;
    const minutes = Math.ceil(wordCount / wordsPerMinute);
    return minutes === 1 ? '1 min' : `${minutes} mins`;
  };

  return (
    <div className="chunk-metadata-detailed">
      {/* Basic Metadata */}
      <div className="metadata-section">
        <h5>Basic Information</h5>
        <div className="metadata-grid">
          <div className="metadata-item">
            <span className="metadata-label">Position:</span>
            <span className="metadata-value">
              {chunk.metadata.chunkIndex + 1} of {chunk.metadata.totalChunks}
            </span>
          </div>
          <div className="metadata-item">
            <span className="metadata-label">Method:</span>
            <span className="metadata-value">{chunk.metadata.chunkingMethod}</span>
          </div>
          <div className="metadata-item">
            <span className="metadata-label">Source:</span>
            <span className="metadata-value">{chunk.sourceDocument.fileName}</span>
          </div>
          {chunk.sourceDocument.pageNumber && (
            <div className="metadata-item">
              <span className="metadata-label">Page:</span>
              <span className="metadata-value">{chunk.sourceDocument.pageNumber}</span>
            </div>
          )}
          {chunk.sourceDocument.sectionTitle && (
            <div className="metadata-item">
              <span className="metadata-label">Section:</span>
              <span className="metadata-value">{chunk.sourceDocument.sectionTitle}</span>
            </div>
          )}
        </div>
      </div>

      {/* Content Statistics */}
      <div className="metadata-section">
        <h5>Content Statistics</h5>
        <div className="metadata-grid">
          <div className="metadata-item">
            <span className="metadata-label">Characters:</span>
            <span className="metadata-value">{chunk.characterCount.toLocaleString()}</span>
          </div>
          <div className="metadata-item">
            <span className="metadata-label">Tokens:</span>
            <span className="metadata-value">{chunk.tokenCount.toLocaleString()}</span>
          </div>
          <div className="metadata-item">
            <span className="metadata-label">Size:</span>
            <span className="metadata-value">{formatBytes(chunk.characterCount)}</span>
          </div>
          <div className="metadata-item">
            <span className="metadata-label">Reading Time:</span>
            <span className="metadata-value">{estimateReadingTime(chunk.text)}</span>
          </div>
          <div className="metadata-item">
            <span className="metadata-label">Word Count:</span>
            <span className="metadata-value">{chunk.text.split(/\s+/).length.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Advanced Metadata (if detailed view) */}
      {showDetailed && (
        <>
          {/* Overlap Information */}
          {(chunk.metadata.overlapStart !== undefined || chunk.metadata.overlapEnd !== undefined) && (
            <div className="metadata-section">
              <h5>Overlap Information</h5>
              <div className="metadata-grid">
                {chunk.metadata.overlapStart !== undefined && (
                  <div className="metadata-item">
                    <span className="metadata-label">Overlap Start:</span>
                    <span className="metadata-value">{chunk.metadata.overlapStart}</span>
                  </div>
                )}
                {chunk.metadata.overlapEnd !== undefined && (
                  <div className="metadata-item">
                    <span className="metadata-label">Overlap End:</span>
                    <span className="metadata-value">{chunk.metadata.overlapEnd}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Quality Metrics */}
          <div className="metadata-section">
            <h5>Quality Metrics</h5>
            <div className="metadata-grid">
              {chunk.metadata.confidence !== undefined && (
                <div className="metadata-item">
                  <span className="metadata-label">Confidence:</span>
                  <span className="metadata-value">
                    {Math.round(chunk.metadata.confidence * 100)}%
                    <div className="confidence-bar">
                      <div 
                        className="confidence-fill"
                        style={{ width: `${chunk.metadata.confidence * 100}%` }}
                      />
                    </div>
                  </span>
                </div>
              )}
              <div className="metadata-item">
                <span className="metadata-label">Semantic Boundary:</span>
                <span className="metadata-value">
                  {chunk.metadata.semanticBoundary ? 'Yes' : 'No'}
                  {chunk.metadata.semanticBoundary && (
                    <span className="semantic-indicator">🎯</span>
                  )}
                </span>
              </div>
            </div>
          </div>

          {/* Text Analysis */}
          <div className="metadata-section">
            <h5>Text Analysis</h5>
            <div className="metadata-grid">
              <div className="metadata-item">
                <span className="metadata-label">Sentences:</span>
                <span className="metadata-value">
                  {chunk.text.split(/[.!?]+/).filter(s => s.trim().length > 0).length}
                </span>
              </div>
              <div className="metadata-item">
                <span className="metadata-label">Paragraphs:</span>
                <span className="metadata-value">
                  {chunk.text.split(/\n\s*\n/).filter(p => p.trim().length > 0).length}
                </span>
              </div>
              <div className="metadata-item">
                <span className="metadata-label">Avg Word Length:</span>
                <span className="metadata-value">
                  {(chunk.text.replace(/[^\w\s]/g, '').split(/\s+/).reduce((sum, word) => sum + word.length, 0) / 
                    chunk.text.split(/\s+/).length).toFixed(1)} chars
                </span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ChunkMetadata;