import React, { useState } from 'react';
import { ClaimDocument } from '../services/claimApi';

interface DocumentCategoryPanelProps {
  documents: ClaimDocument[];
  onViewDocument?: (documentId: string) => void;
}

export type DocumentCategory = 'CMS1500' | 'EOB' | 'Clinical Note' | 'Radiology Report' | 'Other';

const CATEGORY_ICONS: Record<DocumentCategory, string> = {
  'CMS1500': '📝',
  'EOB': '💰',
  'Clinical Note': '🩺',
  'Radiology Report': '🔬',
  'Other': '📄',
};

const CATEGORY_COLORS: Record<DocumentCategory, string> = {
  'CMS1500': '#007bff',
  'EOB': '#28a745',
  'Clinical Note': '#6f42c1',
  'Radiology Report': '#fd7e14',
  'Other': '#6c757d',
};

/**
 * Categorizes documents by their documentType. Exported for testing.
 */
export function categorizeDocuments(
  documents: ClaimDocument[]
): Record<DocumentCategory, ClaimDocument[]> {
  const categories: Record<DocumentCategory, ClaimDocument[]> = {
    'CMS1500': [],
    'EOB': [],
    'Clinical Note': [],
    'Radiology Report': [],
    'Other': [],
  };

  for (const doc of documents) {
    const type = doc.documentType as DocumentCategory;
    if (type && type in categories) {
      categories[type].push(doc);
    } else {
      categories['Other'].push(doc);
    }
  }

  // Sort each category by date descending (most recent first)
  for (const key of Object.keys(categories) as DocumentCategory[]) {
    categories[key].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  return categories;
}

const DocumentCategoryPanel: React.FC<DocumentCategoryPanelProps> = ({ documents, onViewDocument }) => {
  const [expandedCategory, setExpandedCategory] = useState<DocumentCategory | null>(null);
  const categories = categorizeDocuments(documents);

  const nonEmptyCategories = (Object.keys(categories) as DocumentCategory[]).filter(
    (cat) => categories[cat].length > 0
  );

  if (documents.length === 0) {
    return <div style={{ padding: '16px', color: '#999' }}>No documents to categorize.</div>;
  }

  return (
    <div style={{ padding: '16px' }}>
      <h4 style={{ marginBottom: '12px' }}>📂 Documents by Type</h4>

      {/* Category summary cards */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
        {nonEmptyCategories.map((cat) => (
          <button
            key={cat}
            onClick={() => setExpandedCategory(expandedCategory === cat ? null : cat)}
            style={{
              padding: '8px 14px',
              fontSize: '13px',
              border: expandedCategory === cat ? `2px solid ${CATEGORY_COLORS[cat]}` : '1px solid #dee2e6',
              borderRadius: '20px',
              backgroundColor: expandedCategory === cat ? `${CATEGORY_COLORS[cat]}15` : '#fff',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
            aria-pressed={expandedCategory === cat}
            aria-label={`${cat} (${categories[cat].length} documents)`}
          >
            {CATEGORY_ICONS[cat]} {cat}
            <span style={{
              backgroundColor: CATEGORY_COLORS[cat],
              color: 'white',
              borderRadius: '10px',
              padding: '1px 7px',
              fontSize: '11px',
              fontWeight: 600,
            }}>
              {categories[cat].length}
            </span>
          </button>
        ))}
      </div>

      {/* Expanded category document list */}
      {expandedCategory && categories[expandedCategory].length > 0 && (
        <div style={{ border: '1px solid #e0e0e0', borderRadius: '8px', overflow: 'hidden' }}>
          {categories[expandedCategory].map((doc, idx) => (
            <div
              key={doc.documentId}
              style={{
                padding: '10px 14px',
                borderBottom: idx < categories[expandedCategory!].length - 1 ? '1px solid #f0f0f0' : 'none',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontSize: '14px', fontWeight: 500 }}>{doc.fileName}</div>
                <div style={{ fontSize: '12px', color: '#888' }}>
                  {new Date(doc.createdAt).toLocaleDateString()} • {doc.processingStatus}
                </div>
              </div>
              {onViewDocument && (
                <button
                  onClick={() => onViewDocument(doc.documentId)}
                  style={{
                    padding: '4px 10px',
                    fontSize: '12px',
                    backgroundColor: '#007bff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  View
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default DocumentCategoryPanel;
