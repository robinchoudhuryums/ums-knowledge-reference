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
    if (c === 'high') return '#166534';
    if (c === 'partial') return '#c2410c';
    return '#b91c1c';
  };

  const confidenceBg = (c: string) => {
    if (c === 'high') return '#dcfce7';
    if (c === 'partial') return '#fff7ed';
    return '#fef2f2';
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
          <div style={{ ...styles.cardValue, color: '#166534' }}>{data.confidenceBreakdown.high}</div>
          <div style={styles.cardLabel}>High Confidence</div>
        </div>
        <div style={styles.card}>
          <div style={{ ...styles.cardValue, color: '#c2410c' }}>{data.confidenceBreakdown.partial}</div>
          <div style={styles.cardLabel}>Partial</div>
        </div>
        <div style={styles.card}>
          <div style={{ ...styles.cardValue, color: '#b91c1c' }}>{data.confidenceBreakdown.low}</div>
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
          <div style={styles.tableWrapper}>
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
                  <tr key={i}>
                    <td style={styles.td}>{q.question}</td>
                    <td style={{ ...styles.td, textAlign: 'center', fontWeight: 600, color: '#1B6FC9' }}>{q.frequency}</td>
                    <td style={{ ...styles.td, textAlign: 'center' }}>
                      <span style={{
                        ...styles.badge,
                        color: confidenceColor(q.avgConfidence),
                        backgroundColor: confidenceBg(q.avgConfidence),
                      }}>
                        {q.avgConfidence}
                      </span>
                    </td>
                    <td style={{ ...styles.td, color: '#6B8299' }}>{q.agents.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Low confidence questions — areas needing more docs */}
      {data.lowConfidenceQuestions.length > 0 && (
        <div style={styles.section}>
          <h4 style={styles.sectionTitle}>Knowledge Gaps (Low Confidence Questions)</h4>
          <p style={styles.sectionHint}>
            These questions consistently receive low or partial confidence. Adding documents that address these topics will improve answer quality.
          </p>
          <div style={styles.tableWrapper}>
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
                  <tr key={i}>
                    <td style={styles.td}>{q.question}</td>
                    <td style={{ ...styles.td, textAlign: 'center', fontWeight: 600, color: '#1B6FC9' }}>{q.frequency}</td>
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
        </div>
      )}

      {/* Agent activity */}
      {data.agentActivity.length > 0 && (
        <div style={styles.section}>
          <h4 style={styles.sectionTitle}>Agent Activity</h4>
          <div style={styles.tableWrapper}>
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
                  <tr key={i}>
                    <td style={styles.td}>{a.username}</td>
                    <td style={{ ...styles.td, textAlign: 'center', fontWeight: 600 }}>{a.queryCount}</td>
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
        </div>
      )}

      {data.totalQueries === 0 && (
        <p style={styles.empty}>No queries recorded for this period. The dashboard will populate as agents use the tool.</p>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: '28px', maxWidth: '920px', overflowY: 'auto', height: '100%' },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  title: { margin: 0, fontSize: '20px', fontWeight: 700, color: '#0D2137', letterSpacing: '-0.3px' },
  subtitle: { margin: '4px 0 24px', fontSize: '13px', color: '#5F7A8F' },
  periodSelector: { display: 'flex', gap: '4px' },
  periodButton: {
    padding: '6px 14px',
    background: '#F7FAFD',
    border: '1px solid #D6E4F0',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '13px',
    color: '#6B8299',
    fontWeight: 500,
  },
  periodActive: {
    padding: '6px 14px',
    background: 'linear-gradient(135deg, #1B6FC9, #1565C0)',
    color: 'white',
    border: '1px solid #1B6FC9',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 600,
    boxShadow: '0 2px 6px rgba(27, 111, 201, 0.25)',
  },
  loading: { color: '#5F7A8F', fontSize: '14px' },
  error: { color: '#dc2626', fontSize: '14px', padding: '14px', background: '#fef2f2', borderRadius: '10px', border: '1px solid #fecaca' },
  cardRow: { display: 'flex', gap: '12px', flexWrap: 'wrap' as const, marginBottom: '28px' },
  card: {
    flex: '1 1 120px',
    padding: '18px',
    background: '#ffffff',
    borderRadius: '12px',
    border: '1px solid #E8EFF5',
    textAlign: 'center' as const,
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
  },
  cardValue: { fontSize: '28px', fontWeight: 700, color: '#0D2137' },
  cardLabel: { fontSize: '11px', color: '#5F7A8F', marginTop: '4px', textTransform: 'uppercase' as const, letterSpacing: '0.5px', fontWeight: 500 },
  section: { marginBottom: '32px' },
  sectionTitle: { margin: '0 0 4px', fontSize: '16px', fontWeight: 700, color: '#0D2137', letterSpacing: '-0.2px' },
  sectionHint: { margin: '0 0 14px', fontSize: '13px', color: '#5F7A8F', lineHeight: '1.4' },
  tableWrapper: { borderRadius: '12px', border: '1px solid #E8EFF5', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px' },
  th: {
    textAlign: 'left' as const,
    padding: '12px 16px',
    background: '#F7FAFD',
    color: '#6B8299',
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    borderBottom: '1px solid #E8EFF5',
  },
  td: { padding: '12px 16px', borderBottom: '1px solid #F7FAFD', verticalAlign: 'top' as const, color: '#1A2B3C' },
  badge: {
    display: 'inline-block',
    padding: '3px 10px',
    borderRadius: '6px',
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
  },
  barChart: { display: 'flex', flexDirection: 'column' as const, gap: '4px' },
  barRow: { display: 'flex', alignItems: 'center', gap: '10px' },
  barDate: { width: '45px', fontSize: '12px', color: '#6B8299', textAlign: 'right' as const, fontWeight: 500 },
  barTrack: { flex: 1, height: '20px', background: '#E8EFF5', borderRadius: '6px', overflow: 'hidden' },
  barFill: { height: '100%', background: 'linear-gradient(90deg, #1B6FC9, #64B5F6)', borderRadius: '6px', transition: 'width 0.3s' },
  barCount: { width: '30px', fontSize: '12px', color: '#6B8299', fontWeight: 600 },
  empty: { color: '#5F7A8F', fontSize: '14px', textAlign: 'center' as const, padding: '48px 0' },
};
