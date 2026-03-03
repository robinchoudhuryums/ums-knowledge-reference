import { useState, useEffect } from 'react';
import { getFaqDashboard, FaqDashboardData } from '../services/api';

export function FaqDashboard() {
  const [data, setData] = useState<FaqDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [days, setDays] = useState(7);

  useEffect(() => {
    loadDashboard();
  }, [days]);

  const loadDashboard = async () => {
    setLoading(true);
    setError('');
    try {
      const end = new Date().toISOString().split('T')[0];
      const startD = new Date();
      startD.setDate(startD.getDate() - (days - 1));
      const start = startD.toISOString().split('T')[0];
      const result = await getFaqDashboard(start, end);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  const confidenceColor = (c: string) => {
    if (c === 'high') return '#2e7d32';
    if (c === 'partial') return '#e65100';
    return '#c62828';
  };

  const confidenceBg = (c: string) => {
    if (c === 'high') return '#e8f5e9';
    if (c === 'partial') return '#fff3e0';
    return '#fce4ec';
  };

  if (loading) {
    return <div style={styles.container}><p style={styles.loading}>Loading dashboard...</p></div>;
  }

  if (error) {
    return <div style={styles.container}><p style={styles.error}>{error}</p></div>;
  }

  if (!data) return null;

  return (
    <div style={styles.container}>
      <div style={styles.headerRow}>
        <h3 style={styles.title}>FAQ & Analytics Dashboard</h3>
        <div style={styles.periodSelector}>
          {[7, 14, 30].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              style={days === d ? styles.periodActive : styles.periodButton}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      <p style={styles.subtitle}>
        {data.period.start} to {data.period.end}
      </p>

      {/* Summary cards */}
      <div style={styles.cardRow}>
        <div style={styles.card}>
          <div style={styles.cardValue}>{data.totalQueries}</div>
          <div style={styles.cardLabel}>Total Queries</div>
        </div>
        <div style={styles.card}>
          <div style={styles.cardValue}>{data.uniqueAgents}</div>
          <div style={styles.cardLabel}>Active Agents</div>
        </div>
        <div style={styles.card}>
          <div style={{ ...styles.cardValue, color: '#2e7d32' }}>{data.confidenceBreakdown.high}</div>
          <div style={styles.cardLabel}>High Confidence</div>
        </div>
        <div style={styles.card}>
          <div style={{ ...styles.cardValue, color: '#e65100' }}>{data.confidenceBreakdown.partial}</div>
          <div style={styles.cardLabel}>Partial</div>
        </div>
        <div style={styles.card}>
          <div style={{ ...styles.cardValue, color: '#c62828' }}>{data.confidenceBreakdown.low}</div>
          <div style={styles.cardLabel}>Low Confidence</div>
        </div>
      </div>

      {/* Daily activity bar chart (simple text-based) */}
      {data.queriesByDay.length > 0 && (
        <div style={styles.section}>
          <h4 style={styles.sectionTitle}>Daily Query Volume</h4>
          <div style={styles.barChart}>
            {data.queriesByDay.map(d => {
              const maxCount = Math.max(...data.queriesByDay.map(x => x.count), 1);
              const pct = (d.count / maxCount) * 100;
              return (
                <div key={d.date} style={styles.barRow}>
                  <span style={styles.barDate}>{d.date.slice(5)}</span>
                  <div style={styles.barTrack}>
                    <div style={{ ...styles.barFill, width: `${Math.max(pct, 2)}%` }} />
                  </div>
                  <span style={styles.barCount}>{d.count}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top questions */}
      {data.topQuestions.length > 0 && (
        <div style={styles.section}>
          <h4 style={styles.sectionTitle}>Most Frequently Asked Questions</h4>
          <p style={styles.sectionHint}>
            Questions asked multiple times indicate topics that could benefit from clearer documentation or a quick-reference guide.
          </p>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Question</th>
                <th style={{ ...styles.th, width: '60px', textAlign: 'center' }}>Count</th>
                <th style={{ ...styles.th, width: '90px', textAlign: 'center' }}>Confidence</th>
                <th style={{ ...styles.th, width: '120px' }}>Agents</th>
              </tr>
            </thead>
            <tbody>
              {data.topQuestions.map((q, i) => (
                <tr key={i} style={i % 2 === 0 ? styles.trEven : undefined}>
                  <td style={styles.td}>{q.question}</td>
                  <td style={{ ...styles.td, textAlign: 'center', fontWeight: 600 }}>{q.frequency}</td>
                  <td style={{ ...styles.td, textAlign: 'center' }}>
                    <span style={{
                      ...styles.badge,
                      color: confidenceColor(q.avgConfidence),
                      backgroundColor: confidenceBg(q.avgConfidence),
                    }}>
                      {q.avgConfidence}
                    </span>
                  </td>
                  <td style={styles.td}>{q.agents.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Low confidence questions — areas needing more docs */}
      {data.lowConfidenceQuestions.length > 0 && (
        <div style={styles.section}>
          <h4 style={styles.sectionTitle}>Knowledge Gaps (Low Confidence Questions)</h4>
          <p style={styles.sectionHint}>
            These questions consistently receive low or partial confidence. Adding documents that address these topics will improve answer quality.
          </p>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Question</th>
                <th style={{ ...styles.th, width: '60px', textAlign: 'center' }}>Count</th>
                <th style={{ ...styles.th, width: '90px', textAlign: 'center' }}>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {data.lowConfidenceQuestions.map((q, i) => (
                <tr key={i} style={i % 2 === 0 ? styles.trEven : undefined}>
                  <td style={styles.td}>{q.question}</td>
                  <td style={{ ...styles.td, textAlign: 'center', fontWeight: 600 }}>{q.frequency}</td>
                  <td style={{ ...styles.td, textAlign: 'center' }}>
                    <span style={{
                      ...styles.badge,
                      color: confidenceColor(q.avgConfidence),
                      backgroundColor: confidenceBg(q.avgConfidence),
                    }}>
                      {q.avgConfidence}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Agent activity */}
      {data.agentActivity.length > 0 && (
        <div style={styles.section}>
          <h4 style={styles.sectionTitle}>Agent Activity</h4>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Agent</th>
                <th style={{ ...styles.th, width: '100px', textAlign: 'center' }}>Queries</th>
                <th style={{ ...styles.th, width: '120px', textAlign: 'center' }}>Avg. Confidence</th>
              </tr>
            </thead>
            <tbody>
              {data.agentActivity.map((a, i) => (
                <tr key={i} style={i % 2 === 0 ? styles.trEven : undefined}>
                  <td style={styles.td}>{a.username}</td>
                  <td style={{ ...styles.td, textAlign: 'center' }}>{a.queryCount}</td>
                  <td style={{ ...styles.td, textAlign: 'center' }}>
                    <span style={{
                      ...styles.badge,
                      color: confidenceColor(a.avgConfidence),
                      backgroundColor: confidenceBg(a.avgConfidence),
                    }}>
                      {a.avgConfidence}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.totalQueries === 0 && (
        <p style={styles.empty}>No queries recorded for this period. The dashboard will populate as agents use the tool.</p>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: '24px', maxWidth: '900px', overflowY: 'auto', height: '100%' },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  title: { margin: 0, fontSize: '20px', fontWeight: 600, color: '#1a1a2e' },
  subtitle: { margin: '4px 0 20px', fontSize: '13px', color: '#888' },
  periodSelector: { display: 'flex', gap: '4px' },
  periodButton: {
    padding: '6px 12px',
    background: '#f0f0f0',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    color: '#555',
  },
  periodActive: {
    padding: '6px 12px',
    background: '#1a1a2e',
    color: 'white',
    border: '1px solid #1a1a2e',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600,
  },
  loading: { color: '#888', fontSize: '14px' },
  error: { color: '#c62828', fontSize: '14px', padding: '12px', background: '#fce4ec', borderRadius: '6px' },
  cardRow: { display: 'flex', gap: '12px', flexWrap: 'wrap' as const, marginBottom: '24px' },
  card: {
    flex: '1 1 120px',
    padding: '16px',
    background: '#f8f9fa',
    borderRadius: '8px',
    border: '1px solid #eee',
    textAlign: 'center' as const,
  },
  cardValue: { fontSize: '28px', fontWeight: 700, color: '#1a1a2e' },
  cardLabel: { fontSize: '12px', color: '#888', marginTop: '4px', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
  section: { marginBottom: '28px' },
  sectionTitle: { margin: '0 0 4px', fontSize: '16px', fontWeight: 600, color: '#333' },
  sectionHint: { margin: '0 0 12px', fontSize: '13px', color: '#888', lineHeight: '1.4' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px' },
  th: {
    textAlign: 'left' as const,
    padding: '10px 12px',
    borderBottom: '2px solid #ddd',
    color: '#555',
    fontSize: '12px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
  },
  td: { padding: '10px 12px', borderBottom: '1px solid #f0f0f0', verticalAlign: 'top' as const },
  trEven: { background: '#fafafa' },
  badge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '10px',
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
  },
  barChart: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  barRow: { display: 'flex', alignItems: 'center', gap: '8px' },
  barDate: { width: '45px', fontSize: '12px', color: '#666', textAlign: 'right' as const },
  barTrack: { flex: 1, height: '18px', background: '#f0f0f0', borderRadius: '4px', overflow: 'hidden' },
  barFill: { height: '100%', background: '#1a1a2e', borderRadius: '4px', transition: 'width 0.3s' },
  barCount: { width: '30px', fontSize: '12px', color: '#555' },
  empty: { color: '#888', fontSize: '14px', textAlign: 'center' as const, padding: '40px 0' },
};
