/**
 * PpdQueueViewer — Queue viewer for the Pre-Appointment Kit team to review
 * submitted PPD (Patient Provided Data) questionnaires.
 */

import { useState, useEffect, useCallback } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

type SubmissionStatus = 'pending' | 'in_review' | 'completed' | 'returned';

interface PpdSubmission {
  id: string;
  patientName: string;
  patientDob?: string;
  patientPhone?: string;
  submittedBy: string;
  submittedAt: string;
  status: SubmissionStatus;
  reviewNotes?: string;
  responses: Record<string, Record<string, string>>;
  recommendations: {
    complexRehab: RecommendationProduct[];
    standard: RecommendationProduct[];
  };
}

interface RecommendationProduct {
  hcpcsCode: string;
  description: string;
  justification: string;
  category: 'complex_rehab' | 'standard';
  imageUrl?: string;
}

// ── Section labels (mirrors PpdQuestionnaire groups) ───────────────────────

const sectionLabels: Record<string, string> = {
  mobility: 'Current Mobility',
  mradl: 'Mobility-Related Activities of Daily Living (MRADLs)',
  extremity: 'Extremity Strength',
  falls: 'Falls & Safety',
  pain: 'Consistent Pain',
  additional: 'Additional Information',
  diagnoses: 'Diagnoses',
};

// ── Status config ──────────────────────────────────────────────────────────

const statusConfig: Record<SubmissionStatus, { label: string; bg: string; fg: string }> = {
  pending:   { label: 'Pending',   bg: '#fff3cd', fg: '#856404' },
  in_review: { label: 'In Review', bg: '#cce5ff', fg: '#004085' },
  completed: { label: 'Completed', bg: '#d4edda', fg: '#155724' },
  returned:  { label: 'Returned',  bg: '#f8d7da', fg: '#721c24' },
};

const allStatuses: Array<SubmissionStatus | 'all'> = ['all', 'pending', 'in_review', 'completed', 'returned'];

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function getCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : '';
}

// ── Component ──────────────────────────────────────────────────────────────

export function PpdQueueViewer() {
  const [submissions, setSubmissions] = useState<PpdSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<SubmissionStatus | 'all'>('all');
  const [selected, setSelected] = useState<PpdSubmission | null>(null);
  const [editStatus, setEditStatus] = useState<SubmissionStatus>('pending');
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchSubmissions = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/ppd/submissions', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`Failed to load submissions (${res.status})`);
      const data = await res.json();
      setSubmissions(data.submissions ?? data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load submissions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSubmissions(); }, [fetchSubmissions]);

  // ── Counts per status ────────────────────────────────────────────────────
  const counts: Record<string, number> = { all: submissions.length };
  for (const s of submissions) counts[s.status] = (counts[s.status] ?? 0) + 1;

  const filtered = filter === 'all' ? submissions : submissions.filter(s => s.status === filter);

  // ── Detail view ──────────────────────────────────────────────────────────
  const openDetail = (sub: PpdSubmission) => {
    setSelected(sub);
    setEditStatus(sub.status);
    setEditNotes(sub.reviewNotes ?? '');
  };

  const handleStatusSave = async () => {
    if (!selected) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/ppd/submissions/${selected.id}/status`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': getCsrfToken() },
        body: JSON.stringify({ status: editStatus, notes: editNotes }),
      });
      if (!res.ok) throw new Error(`Failed to update status (${res.status})`);
      setSelected({ ...selected, status: editStatus, reviewNotes: editNotes });
      setSubmissions(prev => prev.map(s => s.id === selected.id ? { ...s, status: editStatus, reviewNotes: editNotes } : s));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setSaving(false);
    }
  };

  // ── Detail renderer ──────────────────────────────────────────────────────
  if (selected) {
    const recCount = (selected.recommendations?.complexRehab?.length ?? 0)
      + (selected.recommendations?.standard?.length ?? 0);
    const cfg = statusConfig[selected.status];

    return (
      <div style={styles.container}>
        <button onClick={() => setSelected(null)} style={styles.backButton}>&#8592; Back to list</button>

        <div style={styles.detailHeader}>
          <h3 style={styles.title}>{selected.patientName}</h3>
          {selected.patientDob && <span style={styles.meta}>DOB: {selected.patientDob}</span>}
          {selected.patientPhone && <span style={styles.meta}>Phone: {selected.patientPhone}</span>}
          <span style={{ ...styles.badge, background: cfg.bg, color: cfg.fg }}>{cfg.label}</span>
        </div>
        <p style={styles.meta}>Submitted by {selected.submittedBy} on {formatDate(selected.submittedAt)}</p>

        {/* Responses grouped by section */}
        {Object.entries(selected.responses ?? {}).map(([sectionId, answers]) => (
          <div key={sectionId} style={styles.section}>
            <h4 style={styles.sectionTitle}>{sectionLabels[sectionId] ?? sectionId}</h4>
            {Object.entries(answers).map(([qId, val]) => (
              <div key={qId} style={styles.responseRow}>
                <span style={styles.responseLabel}>{qId}:</span>
                <span style={styles.responseValue}>{val}</span>
              </div>
            ))}
          </div>
        ))}

        {/* Recommendations */}
        {recCount > 0 && (
          <div style={styles.section}>
            <h4 style={styles.sectionTitle}>Recommendations ({recCount} product{recCount !== 1 ? 's' : ''})</h4>
            {[...selected.recommendations.complexRehab, ...selected.recommendations.standard].map((p, i) => (
              <div key={i} style={styles.productCard}>
                {p.imageUrl && <img src={p.imageUrl} alt={p.description} style={styles.productImage} />}
                <div>
                  <strong>{p.hcpcsCode}</strong> &mdash; {p.description}
                  <div style={styles.justification}>{p.justification}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Status update controls */}
        <div style={styles.statusControl}>
          <h4 style={styles.sectionTitle}>Update Status</h4>
          <div style={styles.controlRow}>
            <select value={editStatus} onChange={e => setEditStatus(e.target.value as SubmissionStatus)} style={styles.select}>
              <option value="pending">Pending</option>
              <option value="in_review">In Review</option>
              <option value="completed">Completed</option>
              <option value="returned">Returned</option>
            </select>
          </div>
          <textarea
            value={editNotes}
            onChange={e => setEditNotes(e.target.value)}
            placeholder="Review notes..."
            rows={3}
            style={styles.textarea}
          />
          <button onClick={handleStatusSave} disabled={saving} style={{ ...styles.saveButton, opacity: saving ? 0.6 : 1 }}>
            {saving ? 'Saving...' : 'Save Status'}
          </button>
        </div>

        {error && <div style={styles.error}>{error}</div>}
      </div>
    );
  }

  // ── List view ────────────────────────────────────────────────────────────
  return (
    <div style={styles.container}>
      <h3 style={styles.title}>PPD Submission Queue</h3>

      {/* Filter bar */}
      <div style={styles.filterBar}>
        {allStatuses.map(s => {
          const active = filter === s;
          const label = s === 'all' ? 'All' : statusConfig[s].label;
          const count = counts[s] ?? 0;
          return (
            <button
              key={s}
              onClick={() => setFilter(s)}
              style={{ ...styles.filterButton, ...(active ? styles.filterButtonActive : {}) }}
            >
              {label} ({count})
            </button>
          );
        })}
      </div>

      {loading && <p style={styles.meta}>Loading submissions...</p>}
      {error && <div style={styles.error}>{error}</div>}

      {!loading && filtered.length === 0 && (
        <p style={styles.meta}>No submissions found.</p>
      )}

      {!loading && filtered.length > 0 && (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Patient Info</th>
                <th style={styles.th}>Submitted By</th>
                <th style={styles.th}>Submitted At</th>
                <th style={styles.th}>Recommendations</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(sub => {
                const cfg = statusConfig[sub.status];
                const recCount = (sub.recommendations?.complexRehab?.length ?? 0)
                  + (sub.recommendations?.standard?.length ?? 0);
                return (
                  <tr key={sub.id} style={styles.tr}>
                    <td style={styles.td}>
                      <strong>{sub.patientName}</strong>
                      {sub.patientDob && <div style={styles.subText}>{sub.patientDob}</div>}
                    </td>
                    <td style={styles.td}>{sub.submittedBy}</td>
                    <td style={styles.td}>{formatDate(sub.submittedAt)}</td>
                    <td style={styles.td}>{recCount} product{recCount !== 1 ? 's' : ''}</td>
                    <td style={styles.td}>
                      <span style={{ ...styles.badge, background: cfg.bg, color: cfg.fg }}>{cfg.label}</span>
                    </td>
                    <td style={styles.td}>
                      <button onClick={() => openDetail(sub)} style={styles.viewButton}>View</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: { padding: '28px', maxWidth: '1100px' },
  title: { margin: '0 0 16px', fontSize: '18px', fontWeight: 700, color: '#223b5d', letterSpacing: '-0.2px' },
  meta: { fontSize: '13px', color: 'var(--ums-text-muted)', margin: '0 4px 8px 0', display: 'inline-block' },
  error: { marginTop: '12px', padding: '12px 16px', background: '#fef2f2', color: '#dc2626', borderRadius: '10px', fontSize: '13px', border: '1px solid #fecaca' },

  // Filter bar
  filterBar: { display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' as const },
  filterButton: {
    padding: '7px 16px', border: '1px solid var(--ums-border)', borderRadius: '8px',
    background: 'var(--ums-bg-surface-alt)', color: 'var(--ums-text-muted)', fontSize: '13px', fontWeight: 500, cursor: 'pointer',
  },
  filterButtonActive: {
    background: 'var(--ums-brand-gradient)', color: '#fff', border: '1px solid #1565C0',
    boxShadow: '0 2px 8px rgba(27, 111, 201, 0.25)',
  },

  // Table
  tableWrap: { overflowX: 'auto' as const },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '14px' },
  th: { textAlign: 'left' as const, padding: '10px 12px', background: '#223b5d', color: '#fff', fontWeight: 600, fontSize: '13px', whiteSpace: 'nowrap' as const },
  tr: { borderBottom: '1px solid #E8EFF5' },
  td: { padding: '10px 12px', verticalAlign: 'top' as const },
  subText: { fontSize: '12px', color: 'var(--ums-text-muted)' },
  badge: { display: 'inline-block', padding: '3px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 600 },
  viewButton: {
    padding: '5px 14px', background: '#1976d2', color: '#fff', border: 'none',
    borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 500,
  },

  // Detail view
  backButton: {
    padding: '6px 14px', background: 'transparent', color: '#1976d2', border: '1px solid #1976d2',
    borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 500, marginBottom: '16px',
  },
  detailHeader: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' as const, marginBottom: '4px' },
  section: { marginTop: '20px', padding: '16px', background: 'var(--ums-bg-surface-alt)', borderRadius: '10px', border: '1px solid #E8EFF5' },
  sectionTitle: { margin: '0 0 10px', fontSize: '15px', fontWeight: 600, color: '#223b5d' },
  responseRow: { display: 'flex', gap: '8px', padding: '4px 0', fontSize: '13px' },
  responseLabel: { fontWeight: 600, color: 'var(--ums-text-muted)', minWidth: '80px' },
  responseValue: { color: '#223b5d' },
  productCard: { display: 'flex', gap: '12px', padding: '10px', background: 'var(--ums-bg-surface)', borderRadius: '8px', border: '1px solid #E8EFF5', marginBottom: '8px' },
  productImage: { width: '80px', height: '80px', objectFit: 'cover' as const, borderRadius: '6px', flexShrink: 0 },
  justification: { fontSize: '12px', color: 'var(--ums-text-muted)', marginTop: '4px' },

  // Status controls
  statusControl: { marginTop: '24px', padding: '16px', background: 'var(--ums-bg-surface-alt)', borderRadius: '10px', border: '1px solid #E8EFF5' },
  controlRow: { marginBottom: '10px' },
  select: { padding: '8px 12px', border: '1px solid var(--ums-border)', borderRadius: '8px', fontSize: '14px', background: 'var(--ums-bg-surface)' },
  textarea: { width: '100%', padding: '10px 12px', border: '1px solid var(--ums-border)', borderRadius: '8px', fontSize: '13px', fontFamily: 'inherit', resize: 'vertical' as const, marginBottom: '10px', boxSizing: 'border-box' as const },
  saveButton: {
    padding: '9px 22px', background: 'var(--ums-brand-gradient)', color: '#fff',
    border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: 500,
    boxShadow: '0 2px 8px rgba(27, 111, 201, 0.25)',
  },
};
