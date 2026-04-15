import { useEffect, useMemo, useState } from 'react';
import { getEvalDataset, EvalDataset, GoldPair } from '../services/api';

/**
 * Admin read-only view of the gold-standard RAG evaluation dataset.
 * Not a runner — that lives in the CLI harness (scripts/evalRag.ts)
 * because running the full eval requires Bedrock credentials and a
 * populated index. This view answers "what are we measuring?" so
 * operators can reason about coverage and propose new questions.
 */
export function RagEvalDatasetViewer() {
  const [dataset, setDataset] = useState<EvalDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    getEvalDataset()
      .then(d => { if (!cancelled) setDataset(d); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load dataset'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const filteredPairs: GoldPair[] = useMemo(() => {
    if (!dataset) return [];
    const term = search.trim().toLowerCase();
    return dataset.pairs.filter(p => {
      if (filterCategory !== 'all' && p.category !== filterCategory) return false;
      if (!term) return true;
      return (
        p.question.toLowerCase().includes(term) ||
        p.expectedKeywords.some(k => k.toLowerCase().includes(term)) ||
        p.expectedCodes.some(c => c.toLowerCase().includes(term))
      );
    });
  }, [dataset, filterCategory, search]);

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <div>
          <h3 style={styles.title}>RAG gold-standard dataset</h3>
          <p style={styles.subtitle}>
            Gold-standard Q&amp;A pairs used by <code>scripts/evalRag.ts</code> to measure
            recall@10 and MRR. Not run from this page — run the CLI against a populated
            index to produce <code>eval-output/junit.xml</code>.
          </p>
        </div>
      </div>

      {loading && <div style={styles.loading}>Loading…</div>}
      {error && <div style={styles.errorBanner}>{error}</div>}

      {dataset && (
        <>
          <div style={styles.metaRow}>
            <span style={styles.metaChip}>v{dataset.version}</span>
            <span style={styles.metaChip}>{dataset.totalPairs} pairs</span>
            <span style={styles.metaChip}>updated {dataset.lastUpdated}</span>
          </div>

          <div style={styles.categoryRow}>
            <button
              type="button"
              onClick={() => setFilterCategory('all')}
              style={{ ...styles.chip, ...(filterCategory === 'all' ? styles.chipActive : {}) }}
            >
              All ({dataset.totalPairs})
            </button>
            {dataset.categories.map(c => (
              <button
                key={c.name}
                type="button"
                onClick={() => setFilterCategory(c.name)}
                style={{ ...styles.chip, ...(filterCategory === c.name ? styles.chipActive : {}) }}
              >
                {c.name} ({c.count})
              </button>
            ))}
          </div>

          <input
            type="text"
            placeholder="Filter by question, keyword, or HCPCS…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={styles.search}
          />

          <div style={styles.count}>
            Showing {filteredPairs.length} of {dataset.pairs.length}
          </div>

          <ul style={styles.list}>
            {filteredPairs.map((p, i) => (
              <li key={i} style={styles.item}>
                <div style={styles.itemTop}>
                  <span style={styles.itemCategory}>{p.category}</span>
                  <span style={styles.itemQuestion}>{p.question}</span>
                </div>
                <div style={styles.itemBottom}>
                  {p.expectedCodes.length > 0 && (
                    <div style={styles.itemMeta}>
                      <strong>codes:</strong>{' '}
                      {p.expectedCodes.map(c => <code key={c} style={styles.codeChip}>{c}</code>)}
                    </div>
                  )}
                  {p.expectedKeywords.length > 0 && (
                    <div style={styles.itemMeta}>
                      <strong>keywords:</strong>{' '}
                      {p.expectedKeywords.map(k => <span key={k} style={styles.keywordChip}>{k}</span>)}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {filteredPairs.length === 0 && (
            <div style={styles.empty}>No pairs match the current filter.</div>
          )}
        </>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: { padding: 20, background: 'var(--ums-bg-surface, #fff)' },
  header: { marginBottom: 12 },
  title: { margin: '0 0 4px', fontSize: 16, fontWeight: 600, color: 'var(--ums-text-primary, #111827)' },
  subtitle: { margin: 0, fontSize: 12, color: 'var(--ums-text-muted, #6b7280)', maxWidth: 660, lineHeight: 1.5 },
  loading: { padding: 20, textAlign: 'center' as const, color: 'var(--ums-text-muted, #6b7280)' },
  errorBanner: { padding: 10, background: '#fef2f2', color: '#b91c1c', borderRadius: 6, fontSize: 12 },
  metaRow: { display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' as const },
  metaChip: { padding: '2px 10px', background: 'var(--ums-bg-app, #f3f4f6)', borderRadius: 999, fontSize: 11, color: 'var(--ums-text-muted, #6b7280)' },
  categoryRow: { display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' as const },
  chip: { padding: '4px 10px', background: 'var(--ums-bg-app, #f3f4f6)', border: '1px solid var(--ums-border-light, #e5e7eb)', borderRadius: 999, cursor: 'pointer', fontSize: 11, color: 'var(--ums-text-primary, #111827)' },
  chipActive: { background: 'var(--ums-accent, #2563eb)', color: '#fff', borderColor: 'var(--ums-accent, #2563eb)' },
  search: { width: '100%', padding: '6px 10px', border: '1px solid var(--ums-border-light, #e5e7eb)', borderRadius: 6, fontSize: 13, marginBottom: 8, boxSizing: 'border-box' as const },
  count: { fontSize: 11, color: 'var(--ums-text-muted, #6b7280)', marginBottom: 8 },
  list: { listStyle: 'none', padding: 0, margin: 0, maxHeight: 420, overflowY: 'auto' as const, border: '1px solid var(--ums-border-light, #e5e7eb)', borderRadius: 6 },
  item: { padding: '10px 12px', borderBottom: '1px solid var(--ums-border-light, #e5e7eb)' },
  itemTop: { display: 'flex', gap: 10, alignItems: 'center', marginBottom: 4 },
  itemCategory: { padding: '1px 8px', background: '#eef2ff', color: '#3730a3', borderRadius: 999, fontSize: 10, textTransform: 'uppercase' as const, fontWeight: 600 },
  itemQuestion: { fontSize: 13, color: 'var(--ums-text-primary, #111827)' },
  itemBottom: { display: 'flex', gap: 14, flexWrap: 'wrap' as const, fontSize: 11, color: 'var(--ums-text-muted, #6b7280)' },
  itemMeta: { display: 'flex', gap: 4, flexWrap: 'wrap' as const, alignItems: 'center' },
  codeChip: { padding: '1px 6px', background: '#e0f2fe', color: '#075985', borderRadius: 4, fontSize: 11, fontFamily: 'monospace' },
  keywordChip: { padding: '1px 6px', background: '#f1f5f9', color: '#475569', borderRadius: 4, fontSize: 11 },
  empty: { padding: 20, textAlign: 'center' as const, color: 'var(--ums-text-muted, #6b7280)', fontStyle: 'italic' as const },
};
