import { useEffect, useState } from 'react';
import { getExtractionQualityStats, ExtractionQualityStats } from '../services/api';

/**
 * Compact admin card showing aggregate extraction accuracy from reviewer
 * corrections. Complements the per-template extraction UI by giving a
 * top-level view of "how often is the model getting it right?".
 */
export function ExtractionQualityStatsCard() {
  const [stats, setStats] = useState<ExtractionQualityStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getExtractionQualityStats()
      .then(res => { if (!cancelled) setStats(res.stats); })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load stats'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <div>
          <h3 style={styles.title}>Extraction accuracy (reviewer feedback)</h3>
          <p style={styles.subtitle}>
            Aggregate quality across all reviewer-submitted corrections.
            Reviewers rate each extraction after editing; the LLM's self-reported
            "confidence" is compared against the reviewer's verdict.
          </p>
        </div>
      </div>

      {loading && <div style={styles.loading}>Loading…</div>}
      {error && <div style={styles.errorBanner}>{error}</div>}

      {stats && stats.total === 0 && (
        <div style={styles.empty}>
          No reviewer feedback yet. Use the "Submit correction" panel on the
          extraction page after editing a result to start building this baseline.
        </div>
      )}

      {stats && stats.total > 0 && (
        <div style={styles.statsGrid}>
          <div style={styles.statBox}>
            <div style={styles.statValue}>{(stats.accuracyRate * 100).toFixed(0)}%</div>
            <div style={styles.statLabel}>accuracy</div>
            <div style={styles.statSub}>{stats.byActualQuality.correct} of {stats.total} rated "correct"</div>
          </div>
          <div style={styles.statBox}>
            <div style={{ ...styles.statValue, color: stats.overconfidenceRate > 0.15 ? '#b91c1c' : '#059669' }}>
              {(stats.overconfidenceRate * 100).toFixed(0)}%
            </div>
            <div style={styles.statLabel}>overconfidence</div>
            <div style={styles.statSub}>reported high but wasn't correct</div>
          </div>
          <div style={styles.statBox}>
            <div style={styles.statValue}>{stats.totalFieldsCorrected}</div>
            <div style={styles.statLabel}>fields corrected</div>
            <div style={styles.statSub}>total edits across all extractions</div>
          </div>
        </div>
      )}

      {stats && stats.total > 0 && (
        <div style={styles.breakdown}>
          <div style={styles.breakdownHeader}>Quality breakdown</div>
          {(['correct', 'minor_errors', 'major_errors', 'unusable'] as const).map(q => {
            const count = stats.byActualQuality[q] || 0;
            const pct = stats.total > 0 ? (count / stats.total) * 100 : 0;
            return (
              <div key={q} style={styles.breakdownRow}>
                <span style={styles.breakdownLabel}>{q.replace('_', ' ')}</span>
                <div style={styles.breakdownBarWrap}>
                  <div style={{ ...styles.breakdownBar, width: `${pct}%`, background: colorFor(q) }} />
                </div>
                <span style={styles.breakdownCount}>{count}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function colorFor(quality: string): string {
  if (quality === 'correct') return '#10b981';
  if (quality === 'minor_errors') return '#f59e0b';
  if (quality === 'major_errors') return '#ef4444';
  return '#991b1b';
}

const styles: Record<string, React.CSSProperties> = {
  card: { padding: 20, background: 'var(--ums-bg-surface, #fff)' },
  header: { marginBottom: 12 },
  title: { margin: '0 0 4px', fontSize: 16, fontWeight: 600, color: 'var(--ums-text-primary, #111827)' },
  subtitle: { margin: 0, fontSize: 12, color: 'var(--ums-text-muted, #6b7280)', maxWidth: 620, lineHeight: 1.5 },
  loading: { padding: 20, textAlign: 'center' as const, color: 'var(--ums-text-muted, #6b7280)' },
  errorBanner: { padding: 10, background: '#fef2f2', color: '#b91c1c', borderRadius: 6, fontSize: 12 },
  empty: { padding: 20, textAlign: 'center' as const, color: 'var(--ums-text-muted, #6b7280)', fontSize: 13, fontStyle: 'italic' as const },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 },
  statBox: { padding: 12, background: 'var(--ums-bg-app, #f9fafb)', borderRadius: 8, textAlign: 'center' as const },
  statValue: { fontSize: 28, fontWeight: 700, color: 'var(--ums-text-primary, #111827)' },
  statLabel: { fontSize: 12, color: 'var(--ums-text-muted, #6b7280)', marginTop: 2 },
  statSub: { fontSize: 10, color: 'var(--ums-text-muted, #6b7280)', marginTop: 4 },
  breakdown: { marginTop: 8 },
  breakdownHeader: { fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--ums-text-primary, #111827)' },
  breakdownRow: { display: 'grid', gridTemplateColumns: '120px 1fr 40px', alignItems: 'center', gap: 8, marginBottom: 4 },
  breakdownLabel: { fontSize: 12, textTransform: 'capitalize' as const, color: 'var(--ums-text-primary, #111827)' },
  breakdownBarWrap: { height: 8, background: 'var(--ums-bg-app, #f3f4f6)', borderRadius: 4, overflow: 'hidden' as const },
  breakdownBar: { height: '100%', transition: 'width 0.3s ease' },
  breakdownCount: { fontSize: 11, color: 'var(--ums-text-muted, #6b7280)', textAlign: 'right' as const, fontFamily: 'monospace' },
};
