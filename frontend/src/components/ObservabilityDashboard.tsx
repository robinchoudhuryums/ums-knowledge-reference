import { useState, useEffect } from 'react';
import { getObservabilityMetrics, ObservabilityMetrics } from '../services/api';

export function ObservabilityDashboard() {
  const [metrics, setMetrics] = useState<ObservabilityMetrics | null>(null);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeFailureTab, setActiveFailureTab] = useState<'retrieval' | 'generation'>('retrieval');

  useEffect(() => {
    setLoading(true);
    getObservabilityMetrics(days)
      .then(data => { setMetrics(data); setError(''); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [days]);

  if (loading) return <div style={styles.loading}>Loading observability data...</div>;
  if (error) return <div style={styles.error}>{error}</div>;
  if (!metrics) return null;

  const maxResponseTime = Math.max(...metrics.dailyStats.map(d => d.avgResponseTimeMs), 1);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>RAG Observability</h3>
        <div style={styles.periodButtons}>
          {[7, 14, 30].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              style={days === d ? styles.periodActive : styles.periodButton}
            >{d}d</button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div style={styles.cards}>
        <div style={styles.card}>
          <div style={styles.cardValue}>{metrics.totalTraces}</div>
          <div style={styles.cardLabel}>Total Traces</div>
        </div>
        <div style={styles.card}>
          <div style={styles.cardValue}>{metrics.avgResponseTimeMs > 0 ? `${(metrics.avgResponseTimeMs / 1000).toFixed(1)}s` : '—'}</div>
          <div style={styles.cardLabel}>Avg Response Time</div>
        </div>
        <div style={styles.card}>
          <div style={styles.cardValue}>{metrics.avgRetrievalScore > 0 ? `${Math.round(metrics.avgRetrievalScore * 100)}%` : '—'}</div>
          <div style={styles.cardLabel}>Avg Retrieval Score</div>
        </div>
        <div style={styles.card}>
          <div style={{ ...styles.cardValue, color: 'var(--ums-conf-high)' }}>{metrics.thumbsUp}</div>
          <div style={styles.cardLabel}>Thumbs Up</div>
        </div>
        <div style={styles.card}>
          <div style={{ ...styles.cardValue, color: 'var(--ums-conf-low)' }}>{metrics.thumbsDown}</div>
          <div style={styles.cardLabel}>Thumbs Down</div>
        </div>
        <div style={styles.card}>
          <div style={{ ...styles.cardValue, color: metrics.thumbsUpRatio >= 80 ? 'var(--ums-conf-high)' : metrics.thumbsUpRatio >= 50 ? 'var(--ums-conf-partial)' : 'var(--ums-conf-low)' }}>
            {(metrics.thumbsUp + metrics.thumbsDown) > 0 ? `${metrics.thumbsUpRatio}%` : '—'}
          </div>
          <div style={styles.cardLabel}>Approval Rate</div>
        </div>
      </div>

      {/* Daily retrieval score trend */}
      <div style={styles.section}>
        <h4 style={styles.sectionTitle}>Daily Retrieval Score</h4>
        <div style={styles.chart}>
          {metrics.dailyStats.map(day => {
            const scorePct = Math.round(day.avgRetrievalScore * 100);
            const scoreColor = scorePct >= 50 ? 'var(--ums-success)' : scorePct >= 30 ? 'var(--ums-warning)' : 'var(--ums-error)';
            return (
              <div key={day.date} style={styles.chartRow}>
                <span style={styles.chartDate}>{day.date.slice(5)}</span>
                <div style={styles.chartBarBg}>
                  <div style={{ ...styles.chartBar, width: `${scorePct}%`, background: `linear-gradient(90deg, ${scoreColor}88, ${scoreColor})` }}>
                    {day.traceCount > 0 && <span style={styles.chartBarLabel}>{scorePct}%</span>}
                  </div>
                </div>
                <span style={styles.chartMeta}>{day.traceCount}q</span>
                {(day.thumbsUp + day.thumbsDown) > 0 && (
                  <span style={styles.chartFeedback}>
                    {day.thumbsUp > 0 && <span style={{ color: 'var(--ums-conf-high)' }}>{'\u{1F44D}'}{day.thumbsUp}</span>}
                    {day.thumbsDown > 0 && <span style={{ color: 'var(--ums-conf-low)', marginLeft: '4px' }}>{'\u{1F44E}'}{day.thumbsDown}</span>}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Daily response time trend */}
      <div style={styles.section}>
        <h4 style={styles.sectionTitle}>Daily Avg Response Time</h4>
        <div style={styles.chart}>
          {metrics.dailyStats.map(day => (
            <div key={day.date} style={styles.chartRow}>
              <span style={styles.chartDate}>{day.date.slice(5)}</span>
              <div style={styles.chartBarBg}>
                <div style={{
                  ...styles.chartBar,
                  width: `${(day.avgResponseTimeMs / maxResponseTime) * 100}%`,
                  background: day.avgResponseTimeMs > 10000
                    ? `linear-gradient(90deg, var(--ums-error), var(--ums-error))`
                    : day.avgResponseTimeMs > 5000
                      ? `linear-gradient(90deg, var(--ums-warning), var(--ums-warning))`
                      : 'linear-gradient(90deg, var(--ums-brand-primary), var(--ums-brand-primary))',
                }}>
                  {day.traceCount > 0 && (
                    <span style={styles.chartBarLabel}>{(day.avgResponseTimeMs / 1000).toFixed(1)}s</span>
                  )}
                </div>
              </div>
              <span style={styles.chartMeta}>{day.traceCount}q</span>
            </div>
          ))}
        </div>
      </div>

      {/* Failure correlation */}
      {(metrics.retrievalFailures.length > 0 || metrics.generationFailures.length > 0) && (
        <div style={styles.section}>
          <h4 style={styles.sectionTitle}>Thumbs-Down Diagnosis</h4>
          <p style={styles.sectionDesc}>
            Correlates negative feedback with retrieval scores to distinguish retrieval failures
            (documents not found) from generation failures (documents found but answer was poor).
          </p>
          <div style={styles.failureTabs}>
            <button
              onClick={() => setActiveFailureTab('retrieval')}
              style={activeFailureTab === 'retrieval' ? styles.failureTabActive : styles.failureTab}
            >
              Retrieval Failures ({metrics.retrievalFailures.length})
            </button>
            <button
              onClick={() => setActiveFailureTab('generation')}
              style={activeFailureTab === 'generation' ? styles.failureTabActive : styles.failureTab}
            >
              Generation Failures ({metrics.generationFailures.length})
            </button>
          </div>
          <div style={styles.failureExplain}>
            {activeFailureTab === 'retrieval'
              ? 'Low retrieval score (< 40%) + thumbs down = relevant documents are missing or poorly chunked.'
              : 'Good retrieval score (\u2265 40%) + thumbs down = model generated a poor answer despite having good context.'}
          </div>
          <div style={styles.failureList}>
            {(activeFailureTab === 'retrieval' ? metrics.retrievalFailures : metrics.generationFailures).map((entry, i) => (
              <div key={i} style={styles.failureItem}>
                <div style={styles.failureQuery}>{entry.queryText}</div>
                <div style={styles.failureMetaRow}>
                  <span style={styles.failureBadge}>Score: {Math.round(entry.avgRetrievalScore * 100)}%</span>
                  <span style={styles.failureBadge}>Confidence: {entry.confidence}</span>
                  <span style={styles.failureBadge}>{(entry.responseTimeMs / 1000).toFixed(1)}s</span>
                  <span style={styles.failureDate}>{entry.date}</span>
                </div>
                {entry.feedbackNotes && (
                  <div style={styles.failureNotes}>Note: {entry.feedbackNotes}</div>
                )}
              </div>
            ))}
            {(activeFailureTab === 'retrieval' ? metrics.retrievalFailures : metrics.generationFailures).length === 0 && (
              <div style={styles.emptyState}>No {activeFailureTab} failures in this period.</div>
            )}
          </div>
        </div>
      )}

      {/* Empty state when no traces yet */}
      {metrics.totalTraces === 0 && (
        <div style={styles.emptyState}>
          No RAG traces recorded yet. Traces will appear here after users start querying the knowledge base.
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: '24px 28px' },
  loading: { padding: '24px', color: 'var(--ums-text-muted)', textAlign: 'center' },
  error: { padding: '24px', color: 'var(--ums-error)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  title: { margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--ums-text-primary)' },
  periodButtons: { display: 'flex', gap: '4px' },
  periodButton: { padding: '5px 12px', border: '1px solid var(--ums-border)', borderRadius: '6px', background: 'var(--ums-bg-surface)', cursor: 'pointer', fontSize: '12px', color: 'var(--ums-text-muted)' },
  periodActive: { padding: '5px 12px', border: '1px solid var(--ums-brand-primary)', borderRadius: '6px', background: 'var(--ums-brand-light)', cursor: 'pointer', fontSize: '12px', color: 'var(--ums-brand-text)', fontWeight: 600 },
  cards: { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '12px', marginBottom: '24px' },
  card: { padding: '16px', background: 'var(--ums-bg-surface-alt)', borderRadius: '10px', border: '1px solid var(--ums-border)', textAlign: 'center' as const },
  cardValue: { fontSize: '24px', fontWeight: 700, color: 'var(--ums-text-primary)' },
  cardLabel: { fontSize: '11px', color: 'var(--ums-text-muted)', marginTop: '4px', textTransform: 'uppercase' as const, letterSpacing: '0.3px' },
  section: { marginBottom: '24px' },
  sectionTitle: { margin: '0 0 12px', fontSize: '14px', fontWeight: 600, color: 'var(--ums-text-primary)' },
  sectionDesc: { margin: '0 0 12px', fontSize: '12px', color: 'var(--ums-text-muted)', lineHeight: '1.5' },
  chart: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  chartRow: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' },
  chartDate: { width: '50px', color: 'var(--ums-text-muted)', fontSize: '11px', textAlign: 'right' as const },
  chartBarBg: { flex: 1, height: '20px', background: 'var(--ums-bg-surface-alt)', borderRadius: '4px', overflow: 'hidden' },
  chartBar: { height: '100%', borderRadius: '4px', display: 'flex', alignItems: 'center', minWidth: '2px', transition: 'width 0.3s ease' },
  chartBarLabel: { fontSize: '10px', color: 'white', paddingLeft: '6px', whiteSpace: 'nowrap' as const },
  chartMeta: { width: '35px', color: 'var(--ums-text-muted)', fontSize: '11px' },
  chartFeedback: { fontSize: '11px', whiteSpace: 'nowrap' as const },
  failureTabs: { display: 'flex', gap: '4px', marginBottom: '12px' },
  failureTab: { padding: '6px 14px', border: '1px solid var(--ums-border)', borderRadius: '6px', background: 'var(--ums-bg-surface)', cursor: 'pointer', fontSize: '12px', color: 'var(--ums-text-muted)' },
  failureTabActive: { padding: '6px 14px', border: '1px solid var(--ums-error)', borderRadius: '6px', background: 'var(--ums-error-light)', cursor: 'pointer', fontSize: '12px', color: 'var(--ums-error)', fontWeight: 600 },
  failureExplain: { fontSize: '11px', color: 'var(--ums-text-muted)', marginBottom: '12px', fontStyle: 'italic' },
  failureList: { display: 'flex', flexDirection: 'column' as const, gap: '8px' },
  failureItem: { padding: '12px 14px', background: 'var(--ums-bg-surface)', border: '1px solid var(--ums-border)', borderRadius: '10px' },
  failureQuery: { fontSize: '13px', color: 'var(--ums-text-secondary)', fontWeight: 500, marginBottom: '6px' },
  failureMetaRow: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' as const },
  failureBadge: { fontSize: '11px', padding: '2px 8px', background: 'var(--ums-border)', borderRadius: '4px', color: 'var(--ums-text-muted)' },
  failureDate: { fontSize: '11px', color: 'var(--ums-text-muted)' },
  failureNotes: { marginTop: '6px', fontSize: '12px', color: 'var(--ums-text-muted)', fontStyle: 'italic' },
  emptyState: { padding: '24px', textAlign: 'center' as const, color: 'var(--ums-text-muted)', fontSize: '13px' },
};
