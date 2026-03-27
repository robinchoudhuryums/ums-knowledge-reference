import { useState, useEffect } from 'react';
import { getQualityMetrics, QualityMetrics } from '../services/api';

export function QualityDashboard() {
  const [metrics, setMetrics] = useState<QualityMetrics | null>(null);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    getQualityMetrics(days)
      .then(data => { setMetrics(data); setError(''); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [days]);

  if (loading) return <div style={styles.loading}>Loading quality metrics...</div>;
  if (error) return <div style={styles.error}>{error}</div>;
  if (!metrics) return null;

  const maxDayQueries = Math.max(...metrics.dailyStats.map(d => d.queries), 1);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>Answer Quality Metrics</h3>
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
          <div style={styles.cardValue}>{metrics.qualityScore}%</div>
          <div style={styles.cardLabel}>Quality Score</div>
        </div>
        <div style={styles.card}>
          <div style={styles.cardValue}>{metrics.totalQueries}</div>
          <div style={styles.cardLabel}>Total Queries</div>
        </div>
        <div style={styles.card}>
          <div style={styles.cardValue}>{metrics.totalFlagged}</div>
          <div style={styles.cardLabel}>Flagged Responses</div>
        </div>
        <div style={styles.card}>
          <div style={{ ...styles.cardValue, color: '#166534' }}>{metrics.confidenceCounts.high}</div>
          <div style={styles.cardLabel}>High Confidence</div>
        </div>
        <div style={styles.card}>
          <div style={{ ...styles.cardValue, color: '#c2410c' }}>{metrics.confidenceCounts.partial}</div>
          <div style={styles.cardLabel}>Partial</div>
        </div>
        <div style={styles.card}>
          <div style={{ ...styles.cardValue, color: '#b91c1c' }}>{metrics.confidenceCounts.low}</div>
          <div style={styles.cardLabel}>Low / Unanswered</div>
        </div>
      </div>

      {/* Daily trend */}
      <div style={styles.section}>
        <h4 style={styles.sectionTitle}>Daily Trend</h4>
        <div style={styles.chart}>
          {metrics.dailyStats.map(day => (
            <div key={day.date} style={styles.chartRow}>
              <span style={styles.chartDate}>{day.date.slice(5)}</span>
              <div style={styles.chartBarBg}>
                <div style={{ ...styles.chartBar, width: `${(day.queries / maxDayQueries) * 100}%` }}>
                  <span style={styles.chartBarLabel}>{day.queries}q</span>
                </div>
              </div>
              <span style={styles.chartPct}>{day.highPct}% high</span>
              {day.flagged > 0 && <span style={styles.chartFlagged}>{day.flagged} flagged</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Knowledge gaps */}
      {metrics.unansweredQuestions.length > 0 && (
        <div style={styles.section}>
          <h4 style={styles.sectionTitle}>Knowledge Gaps (Low Confidence Questions)</h4>
          <div style={styles.gapList}>
            {metrics.unansweredQuestions.map((q, i) => (
              <div key={i} style={styles.gapItem}>
                <span style={styles.gapQuestion}>{q.question}</span>
                <span style={styles.gapDate}>{q.date}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: '24px 28px' },
  loading: { padding: '24px', color: 'var(--ums-text-muted)', textAlign: 'center' },
  error: { padding: '24px', color: '#dc2626' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  title: { margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--ums-text-primary)' },
  periodButtons: { display: 'flex', gap: '4px' },
  periodButton: { padding: '5px 12px', border: '1px solid var(--ums-border)', borderRadius: '6px', background: 'var(--ums-bg-surface)', cursor: 'pointer', fontSize: '12px', color: 'var(--ums-text-muted)' },
  periodActive: { padding: '5px 12px', border: '1px solid var(--ums-brand-primary)', borderRadius: '6px', background: 'var(--ums-brand-light)', cursor: 'pointer', fontSize: '12px', color: 'var(--ums-brand-text)', fontWeight: 600 },
  cards: { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '12px', marginBottom: '24px' },
  card: { padding: '16px', background: 'var(--ums-bg-surface-alt)', borderRadius: '10px', border: '1px solid #E8EFF5', textAlign: 'center' as const },
  cardValue: { fontSize: '24px', fontWeight: 700, color: 'var(--ums-text-primary)' },
  cardLabel: { fontSize: '11px', color: 'var(--ums-text-muted)', marginTop: '4px', textTransform: 'uppercase' as const, letterSpacing: '0.3px' },
  section: { marginBottom: '24px' },
  sectionTitle: { margin: '0 0 12px', fontSize: '14px', fontWeight: 600, color: 'var(--ums-text-primary)' },
  chart: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  chartRow: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' },
  chartDate: { width: '50px', color: 'var(--ums-text-muted)', fontSize: '11px', textAlign: 'right' as const },
  chartBarBg: { flex: 1, height: '20px', background: 'var(--ums-bg-surface-alt)', borderRadius: '4px', overflow: 'hidden' },
  chartBar: { height: '100%', background: 'linear-gradient(90deg, var(--ums-brand-primary), #42A5F5)', borderRadius: '4px', display: 'flex', alignItems: 'center', minWidth: '2px' },
  chartBarLabel: { fontSize: '10px', color: 'white', paddingLeft: '6px', whiteSpace: 'nowrap' as const },
  chartPct: { width: '70px', color: '#166534', fontSize: '11px' },
  chartFlagged: { color: '#dc2626', fontSize: '11px' },
  gapList: { display: 'flex', flexDirection: 'column' as const, gap: '6px' },
  gapItem: { display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', fontSize: '13px' },
  gapQuestion: { color: 'var(--ums-text-secondary)', flex: 1 },
  gapDate: { color: 'var(--ums-text-muted)', fontSize: '11px', marginLeft: '12px' },
};
