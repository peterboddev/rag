import React, { useState } from 'react';
import { searchClaims, ClaimSearchResult } from '../services/claimApi';

interface ClaimSearchPanelProps {
  /** Called when user clicks a search result to navigate to that claim */
  onSelectClaim?: (claimId: string) => void;
}

const DOC_TYPE_OPTIONS = ['All', 'CMS1500', 'EOB', 'Clinical Note', 'Radiology Report'] as const;

const ClaimSearchPanel: React.FC<ClaimSearchPanelProps> = ({ onSelectClaim }) => {
  const [query, setQuery] = useState('');
  const [docTypeFilter, setDocTypeFilter] = useState<string>('All');
  const [results, setResults] = useState<ClaimSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    try {
      setLoading(true);
      setError(null);
      const docType = docTypeFilter === 'All' ? undefined : docTypeFilter;
      const response = await searchClaims(query.trim(), docType, 10);
      setResults(response.results);
      setSearched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const highlightExcerpt = (text: string): string => {
    if (!query.trim()) return text;
    const words = query.trim().split(/\s+/).filter(Boolean);
    let highlighted = text;
    for (const word of words) {
      const regex = new RegExp(`(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      highlighted = highlighted.replace(regex, '<mark>$1</mark>');
    }
    return highlighted;
  };

  return (
    <div style={{ padding: '20px' }}>
      <h2 style={{ marginBottom: '16px' }}>🔍 Search Claims</h2>

      {/* Search bar */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search across all claim documents..."
          aria-label="Search claims"
          style={{
            flex: 1,
            minWidth: '200px',
            padding: '10px 14px',
            fontSize: '14px',
            border: '1px solid #ccc',
            borderRadius: '4px',
          }}
        />
        <select
          value={docTypeFilter}
          onChange={(e) => setDocTypeFilter(e.target.value)}
          aria-label="Filter by document type"
          style={{ padding: '10px', fontSize: '14px', borderRadius: '4px', border: '1px solid #ccc' }}
        >
          {DOC_TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <button
          onClick={handleSearch}
          disabled={loading || !query.trim()}
          style={{
            padding: '10px 20px',
            fontSize: '14px',
            backgroundColor: loading ? '#6c757d' : '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          {loading ? '⏳ Searching...' : 'Search'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: '12px', backgroundColor: '#f8d7da', borderRadius: '6px', color: '#721c24', marginBottom: '16px' }}>
          ❌ {error}
        </div>
      )}

      {/* Results */}
      {searched && !loading && results.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
          No results found for "{query}"
        </div>
      )}

      {results.map((r, idx) => (
        <div
          key={`${r.documentId}-${idx}`}
          style={{
            padding: '14px',
            marginBottom: '12px',
            border: '1px solid #e0e0e0',
            borderRadius: '8px',
            backgroundColor: '#fff',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <div style={{ fontWeight: 600, fontSize: '14px' }}>{r.fileName}</div>
            <div style={{
              padding: '2px 8px',
              backgroundColor: '#e9ecef',
              borderRadius: '12px',
              fontSize: '12px',
              color: '#495057',
            }}>
              Score: {(r.score * 100).toFixed(0)}%
            </div>
          </div>
          <div style={{ fontSize: '12px', color: '#666', marginBottom: '6px' }}>
            Claim: {r.claimId} {r.documentType && `• ${r.documentType}`}
          </div>
          <div
            style={{ fontSize: '13px', color: '#333', lineHeight: '1.5' }}
            dangerouslySetInnerHTML={{ __html: highlightExcerpt(r.excerpt) }}
          />
          {onSelectClaim && (
            <button
              onClick={() => onSelectClaim(r.claimId)}
              style={{
                marginTop: '8px',
                padding: '4px 12px',
                fontSize: '12px',
                backgroundColor: '#17a2b8',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Go to Claim →
            </button>
          )}
        </div>
      ))}
    </div>
  );
};

export default ClaimSearchPanel;
