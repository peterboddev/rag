import React from 'react';
import { ChunkItemProps } from '../types';

const ChunkItem: React.FC<ChunkItemProps> = ({
  chunk,
  isSelected,
  isExpanded,
  onSelect,
  onToggleExpand
}) => {
  const handleClick = () => {
    onSelect(chunk.id);
  };

  const handleExpandClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleExpand(chunk.id);
  };

  const shouldShowExpandButton = chunk.text.length > 200;
  const displayText = isExpanded ? chunk.text : chunk.text.substring(0, 200) + (chunk.text.length > 200 ? '...' : '');

  return (
    <div
      className={`chunk-item ${isSelected ? 'selected' : ''}`}
      onClick={handleClick}
      data-testid={`chunk-${chunk.id}`}
      data-document-id={chunk.sourceDocument.documentId}
    >
      <div className="chunk-header">
        <div className="chunk-index">
          Chunk {chunk.metadata.chunkIndex + 1} of {chunk.metadata.totalChunks}
        </div>
        <div className="chunk-source">
          {chunk.sourceDocument.fileName}
          {chunk.sourceDocument.pageNumber && (
            <span className="page-number"> (Page {chunk.sourceDocument.pageNumber})</span>
          )}
        </div>
      </div>
      
      <div className="chunk-metadata">
        <span className="chunk-stat">
          {chunk.tokenCount} tokens
        </span>
        <span className="chunk-stat">
          {chunk.characterCount} chars
        </span>
        {chunk.metadata.overlapStart !== undefined && chunk.metadata.overlapEnd !== undefined && (
          <span className="chunk-stat overlap">
            Overlap: {chunk.metadata.overlapStart}-{chunk.metadata.overlapEnd}
          </span>
        )}
        {chunk.metadata.confidence !== undefined && (
          <span className="chunk-stat confidence">
            Confidence: {Math.round(chunk.metadata.confidence * 100)}%
          </span>
        )}
        {chunk.metadata.semanticBoundary && (
          <span className="chunk-stat semantic">
            Semantic Boundary
          </span>
        )}
      </div>
      
      <div className="chunk-content">
        <div className="chunk-text">
          {displayText}
        </div>
        
        {shouldShowExpandButton && (
          <button
            className="chunk-expand-btn"
            onClick={handleExpandClick}
            aria-label={isExpanded ? 'Show less text' : 'Show more text'}
          >
            {isExpanded ? 'Show Less' : 'Show More'}
          </button>
        )}
      </div>

      {/* Selection indicator */}
      {isSelected && (
        <div className="chunk-selection-indicator">
          ✓
        </div>
      )}
    </div>
  );
};

export default ChunkItem;