import React, { useState, useEffect } from 'react';
import { getClaimHistory, getClaimStatus, ClaimStatusHistoryEntry, ClaimStatusValue, ClaimDocument } from '../services/claimApi';

export interface TimelineEvent {
  id: string;
  timestamp: string;
  type: 'status_change' | 'document_added';
  label: string;
  detail?: string;
  status?: ClaimStatusValue;
  documentId?: string;
}

interface ClaimTimelineProps {
  claimId: string;
  filterType?: 'all' | 'status_change' | 'document_added';
}

/**
 * Merges status history entries and document events into a single
 * chronologically sorted timeline. Exported for testing.
 */
export function mergeTimelineEvents(
  history: ClaimStatusHistoryEntry[],
  documents: ClaimDocument[]
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const h of history) {
    events.push({
      id: `status-${h.timestamp}`,
      timestamp: h.timestamp,
      type: 'status_change',
      label: `Status changed to ${h.status}`,
      detail: h.note || (h.changedBy ? `by ${h.changedBy}` : undefined),
      status: h.status,
    });
  }

  for (const d of documents) {
    events.push({
      id: `doc-${d.documentId}`,
      timestamp: d.createdAt,
      type: 'document_added',
      label: `Document added: ${d.fileName}`,
      detail: d.documentType || undefined,
      documentId: d.documentId,
    });
  }

  events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  return events;
}


const statusColors: Record<ClaimStatusValue, string> = {
  'Submitted': '#17a2b8',
  'Under Review': '#ffc107',
  'Approved': '#28a745',
  'Denied': '#dc3545',
  'Pending Information': '#fd7e14',
};

const ClaimTimeline: React.FC<ClaimTimelineProps> = ({ claimId, filterType = 'all' }) => {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadTimeline();
  }, [claimId]);

  const loadTimeline = async () => {
    try {
      setLoading(true);
      setError(null);

      const [historyRes, statusRes] = await Promise.all([
        getClaimHistory(claimId),
        getClaimStatus(claimId),
      ]);

      const merged = mergeTimelineEvents(historyRes.history, statusRes.documents || []);
      setEvents(merged);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load timeline');
    } finally {
      setLoading(false);
    }
  };

  const filtered = filterType === 'all' ? events : events.filter((e) => e.type === filterType);

  if (loading) {
    return <div style={{ padding: '16px', textAlign: 'center' }}>⏳ Loading timeline...</div>;
  }

  if (error) {
    return (
      <div style={{ padding: '16px', color: '#dc3545' }}>
        ❌ {error}
        <button onClick={loadTimeline} style={{ marginLeft: 8, cursor: 'pointer' }}>Retry</button>
      </div>
    );
  }

  if (filtered.length === 0) {
    return <div style={{ padding: '16px', color: '#999' }}>No timeline events yet.</div>;
  }

  return (
    <div style={{ padding: '16px' }} role="list" aria-label="Claim timeline">
      {filtered.map((evt, idx) => (
        <div
          key={evt.id}
          role="listitem"
          style={{
            display: 'flex',
            gap: '12px',
            marginBottom: idx < filtered.length - 1 ? '0' : '0',
          }}
        >
          {/* Vertical line + dot */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '24px' }}>
            <div
              style={{
                width: '12px',
                height: '12px',
                borderRadius: '50%',
                backgroundColor: evt.status ? statusColors[evt.status] || '#6c757d' : '#007bff',
                flexShrink: 0,
                marginTop: '4px',
              }}
            />
            {idx < filtered.length - 1 && (
              <div style={{ width: '2px', flex: 1, backgroundColor: '#dee2e6', minHeight: '24px' }} />
            )}
          </div>

          {/* Content */}
          <div style={{ paddingBottom: '16px', flex: 1 }}>
            <div style={{ fontSize: '13px', color: '#666', marginBottom: '2px' }}>
              {new Date(evt.timestamp).toLocaleString()}
            </div>
            <div style={{ fontSize: '14px', fontWeight: 500 }}>{evt.label}</div>
            {evt.detail && <div style={{ fontSize: '13px', color: '#888', marginTop: '2px' }}>{evt.detail}</div>}
          </div>
        </div>
      ))}
    </div>
  );
};

export default ClaimTimeline;
