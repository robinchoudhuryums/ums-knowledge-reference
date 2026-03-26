/**
 * PpdQuestionnaire — PPD (Patient Provided Data) questionnaire for DME agents
 * conducting phone interviews with patients for Power Mobility Device orders.
 *
 * Questions are fetched from the API (GET /api/ppd/questions) rather than hardcoded.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

type Lang = 'en' | 'es';

interface ApiQuestion {
  id: string;
  number: string;
  text: string;
  spanishText: string;
  type: 'yes-no' | 'text' | 'select' | 'number' | 'multi-select';
  group: string;
  required: boolean;
  subQuestionOf?: string;
  showWhen?: string;
  options?: string[];
}

interface RecommendationProduct {
  hcpcsCode: string;
  description: string;
  justification: string;
  category: 'complex-rehab' | 'standard';
  imageUrl?: string;
  brochureUrl?: string;
  seatDimensions?: string;
  colors?: string;
  leadTime?: string;
  notes?: string;
  portable?: boolean;
}

interface RecommendApiResponse {
  patientInfo: string;
  recommendations: RecommendationProduct[];
  submittedAt: string;
  agentName: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getCsrf(): string {
  return document.cookie.match(/(^|;\s*)csrf_token=([^;]*)/)?.[2] || '';
}

function storageKey(patient: string): string {
  return `ppd_responses_${patient.replace(/\s+/g, '_').toLowerCase()}`;
}

// ── Styles ─────────────────────────────────────────────────────────────────

const sty = {
  container: { padding: 20, maxWidth: 900, margin: '0 auto', fontFamily: 'system-ui, sans-serif' } as React.CSSProperties,
  header: { background: '#223b5d', color: '#fff', padding: '16px 20px', borderRadius: 8, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 } as React.CSSProperties,
  headerTitle: { margin: 0, fontSize: 20, fontWeight: 600 } as React.CSSProperties,
  patientInput: { padding: '8px 12px', borderRadius: 6, border: '1px solid #ccc', fontSize: 14, width: 280 } as React.CSSProperties,
  langToggle: { display: 'flex', gap: 0, borderRadius: 6, overflow: 'hidden', border: '1px solid #fff' } as React.CSSProperties,
  progressBar: { background: '#e9ecef', borderRadius: 8, height: 22, marginBottom: 16, position: 'relative' as const, overflow: 'hidden' } as React.CSSProperties,
  progressText: { position: 'absolute' as const, top: 0, left: 0, right: 0, textAlign: 'center' as const, lineHeight: '22px', fontSize: 12, fontWeight: 600, color: '#333' } as React.CSSProperties,
  section: { border: '1px solid #d0d7de', borderRadius: 8, marginBottom: 12, overflow: 'hidden' } as React.CSSProperties,
  sectionHeader: { background: '#f0f4f8', padding: '10px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', userSelect: 'none' as const } as React.CSSProperties,
  sectionTitle: { margin: 0, fontSize: 15, fontWeight: 600, color: '#223b5d' } as React.CSSProperties,
  sectionBody: { padding: '12px 16px' } as React.CSSProperties,
  questionRow: { marginBottom: 14 } as React.CSSProperties,
  questionLabel: { display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 500, color: '#333' } as React.CSSProperties,
  yesNoGroup: { display: 'flex', gap: 8 } as React.CSSProperties,
  textInput: { padding: '7px 10px', borderRadius: 6, border: '1px solid #ccc', fontSize: 14, width: '100%', boxSizing: 'border-box' as const } as React.CSSProperties,
  textarea: { padding: '7px 10px', borderRadius: 6, border: '1px solid #ccc', fontSize: 14, width: '100%', boxSizing: 'border-box' as const, minHeight: 60, resize: 'vertical' as const } as React.CSSProperties,
  selectInput: { padding: '7px 10px', borderRadius: 6, border: '1px solid #ccc', fontSize: 14, width: '100%', boxSizing: 'border-box' as const } as React.CSSProperties,
  submitBtn: { background: '#1976d2', color: '#fff', border: 'none', padding: '12px 28px', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer', marginTop: 8 } as React.CSSProperties,
  submitBtnDisabled: { background: '#90b4d8', color: '#fff', border: 'none', padding: '12px 28px', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'not-allowed', marginTop: 8 } as React.CSSProperties,
  error: { background: '#f8d7da', color: '#721c24', padding: '10px 14px', borderRadius: 6, marginTop: 12 } as React.CSSProperties,
  recSection: { marginTop: 24 } as React.CSSProperties,
  recHeading: { fontSize: 17, fontWeight: 700, color: '#223b5d', borderBottom: '2px solid #1976d2', paddingBottom: 6, marginBottom: 12 } as React.CSSProperties,
  recCard: { border: '1px solid #d0d7de', borderRadius: 8, padding: 14, marginBottom: 12, display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' as const } as React.CSSProperties,
  recImage: { width: 100, height: 100, objectFit: 'cover' as const, borderRadius: 6, border: '1px solid #ddd', flexShrink: 0 } as React.CSSProperties,
  recBody: { flex: 1, minWidth: 200 } as React.CSSProperties,
  recHcpcs: { fontSize: 16, fontWeight: 700, color: '#1976d2', textDecoration: 'none' } as React.CSSProperties,
  recJustification: { fontSize: 13, color: '#555', margin: '6px 0' } as React.CSSProperties,
  recDetail: { fontSize: 12, color: '#666', margin: '2px 0' } as React.CSSProperties,
  recControls: { display: 'flex', gap: 10, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' as const } as React.CSSProperties,
  starLabel: { cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 } as React.CSSProperties,
  statusSelect: { padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc', fontSize: 12 } as React.CSSProperties,
  copyBtn: { padding: '4px 10px', borderRadius: 4, border: '1px solid #1976d2', background: '#e3f2fd', color: '#1565c0', fontSize: 11, cursor: 'pointer', fontWeight: 500 } as React.CSSProperties,
  actionBar: { display: 'flex', gap: 12, marginTop: 20, flexWrap: 'wrap' as const } as React.CSSProperties,
  loadingContainer: { padding: 60, textAlign: 'center' as const, color: '#666', fontSize: 16 } as React.CSSProperties,
  badge: { display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700, marginLeft: 8 } as React.CSSProperties,
  painGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 } as React.CSSProperties,
  clearBtn: { background: '#fff', color: '#dc3545', border: '1px solid #dc3545', padding: '12px 28px', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer', marginTop: 8 } as React.CSSProperties,
};

function langBtn(active: boolean): React.CSSProperties {
  return { padding: '6px 14px', cursor: 'pointer', border: 'none', background: active ? '#fff' : 'transparent', color: active ? '#223b5d' : '#fff', fontWeight: active ? 700 : 400, fontSize: 13 };
}

function yesBtn(sel: boolean): React.CSSProperties {
  return { padding: '6px 20px', borderRadius: 6, cursor: 'pointer', border: '1px solid #28a745', background: sel ? '#d4edda' : '#fff', color: sel ? '#155724' : '#333', fontWeight: sel ? 700 : 400 };
}

function noBtn(sel: boolean): React.CSSProperties {
  return { padding: '6px 20px', borderRadius: 6, cursor: 'pointer', border: '1px solid #dc3545', background: sel ? '#f8d7da' : '#fff', color: sel ? '#721c24' : '#333', fontWeight: sel ? 700 : 400 };
}

function progressFill(pct: number): React.CSSProperties {
  return { background: '#1976d2', height: '100%', width: `${pct}%`, transition: 'width 0.3s', borderRadius: 8 };
}

function painToggle(active: boolean): React.CSSProperties {
  return {
    padding: '10px 14px',
    borderRadius: 8,
    cursor: 'pointer',
    border: active ? '2px solid #dc3545' : '1px solid #ccc',
    background: active ? '#f8d7da' : '#fff',
    color: active ? '#721c24' : '#333',
    fontWeight: active ? 700 : 400,
    fontSize: 14,
    textAlign: 'center' as const,
    transition: 'all 0.15s',
  };
}

function badgeStyle(answered: number, total: number): React.CSSProperties {
  const pct = total > 0 ? answered / total : 0;
  let bg = '#e9ecef';
  let color = '#666';
  if (pct === 1) { bg = '#d4edda'; color = '#155724'; }
  else if (pct > 0) { bg = '#fff3cd'; color = '#856404'; }
  return { ...sty.badge, background: bg, color };
}

// ── Component ──────────────────────────────────────────────────────────────

export function PpdQuestionnaire() {
  const [lang, setLang] = useState<Lang>('en');
  const [patientInfo, setPatientInfo] = useState('');
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [recommendations, setRecommendations] = useState<{ complexRehab: RecommendationProduct[]; standard: RecommendationProduct[] } | null>(null);
  const [preferred, setPreferred] = useState('');
  const [productStatus, setProductStatus] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState('');
  const [seatingEvalHtml, setSeatingEvalHtml] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState('');
  const [evalLoading, setEvalLoading] = useState(false);

  // Questions fetched from API
  const [questions, setQuestions] = useState<ApiQuestion[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(true);
  const [questionsError, setQuestionsError] = useState('');

  // Fetch questions on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/ppd/questions', { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`Failed to load questions (${res.status})`);
        const data = await res.json();
        if (!cancelled) {
          setQuestions(data.questions || []);
          setGroups(data.groups || []);
        }
      } catch (err) {
        if (!cancelled) {
          setQuestionsError(err instanceof Error ? err.message : 'Failed to load questions');
        }
      } finally {
        if (!cancelled) setQuestionsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Group questions by group field
  const groupedQuestions = useMemo(() => {
    const map = new Map<string, ApiQuestion[]>();
    for (const q of questions) {
      const list = map.get(q.group) || [];
      list.push(q);
      map.set(q.group, list);
    }
    return map;
  }, [questions]);

  // Required questions (top-level, no subQuestionOf)
  const requiredQuestions = useMemo(() => {
    return questions.filter(q => q.required && !q.subQuestionOf);
  }, [questions]);

  // Load from sessionStorage on patient change
  useEffect(() => {
    if (!patientInfo.trim()) return;
    const saved = sessionStorage.getItem(storageKey(patientInfo));
    if (saved) {
      try { setResponses(JSON.parse(saved)); } catch { /* ignore corrupt data */ }
    }
  }, [patientInfo]);

  // Auto-save responses to sessionStorage
  useEffect(() => {
    if (!patientInfo.trim()) return;
    sessionStorage.setItem(storageKey(patientInfo), JSON.stringify(responses));
  }, [responses, patientInfo]);

  const setResponse = useCallback((id: string, value: string) => {
    setResponses(prev => ({ ...prev, [id]: value }));
  }, []);

  const toggleSection = useCallback((id: string) => {
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const isVisible = useCallback((q: ApiQuestion): boolean => {
    if (!q.subQuestionOf || !q.showWhen) return true;
    const parentVal = responses[q.subQuestionOf] ?? '';
    return parentVal.toLowerCase() === q.showWhen.toLowerCase() || parentVal.toLowerCase() === 'yes' && q.showWhen === 'Yes';
  }, [responses]);

  // Progress calculation
  const answeredCount = useMemo(() => {
    return requiredQuestions.filter(q => {
      const val = responses[q.id];
      return val !== undefined && val !== '';
    }).length;
  }, [responses, requiredQuestions]);

  const totalRequired = requiredQuestions.length;
  const progressPct = totalRequired > 0 ? Math.round((answeredCount / totalRequired) * 100) : 0;

  // Section completion counts
  const sectionCounts = useMemo(() => {
    const counts: Record<string, { answered: number; total: number }> = {};
    for (const group of groups) {
      const qs = groupedQuestions.get(group) || [];
      const visibleQs = qs.filter(q => !q.subQuestionOf || isVisible(q));
      const answered = visibleQs.filter(q => {
        const val = responses[q.id];
        return val !== undefined && val !== '';
      }).length;
      counts[group] = { answered, total: visibleQs.length };
    }
    return counts;
  }, [groups, groupedQuestions, responses, isVisible]);

  // Clear form
  const handleClearForm = useCallback(() => {
    if (!window.confirm(lang === 'en'
      ? 'Are you sure you want to clear all responses? This cannot be undone.'
      : 'Esta seguro de que desea borrar todas las respuestas? Esto no se puede deshacer.')) {
      return;
    }
    setResponses({});
    setRecommendations(null);
    setSeatingEvalHtml('');
    setSubmitSuccess('');
    setError('');
    setPreferred('');
    setProductStatus({});
    if (patientInfo.trim()) {
      sessionStorage.removeItem(storageKey(patientInfo));
    }
  }, [lang, patientInfo]);

  // Format responses for API calls
  const formatApiResponses = useCallback(() => {
    return Object.entries(responses).map(([questionId, answer]) => ({ questionId, answer }));
  }, [responses]);

  // Submit to API for recommendations
  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    setRecommendations(null);
    try {
      const csrf = getCsrf();
      const apiResponses = formatApiResponses();
      const res = await fetch('/api/ppd/recommend', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ patientInfo, responses: apiResponses, language: lang === 'en' ? 'english' : 'spanish' }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || `Request failed (${res.status})`);
      }
      const data: RecommendApiResponse = await res.json();
      const complexRehab = data.recommendations.filter(r => r.category === 'complex-rehab');
      const standard = data.recommendations.filter(r => r.category === 'standard');
      setRecommendations({ complexRehab, standard });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get recommendations');
    } finally {
      setLoading(false);
    }
  };

  // ── Render helpers ─────────────────────────────────────────────────────

  const renderQuestion = (q: ApiQuestion) => {
    if (!isVisible(q)) return null;
    const label = lang === 'en' ? q.text : q.spanishText;
    const val = responses[q.id] ?? '';

    return (
      <div key={q.id} style={sty.questionRow}>
        <label style={sty.questionLabel}>
          {q.number}. {label}
          {q.required && <span style={{ color: '#dc3545', marginLeft: 3 }}>*</span>}
        </label>

        {q.type === 'yes-no' && (
          <div style={sty.yesNoGroup}>
            <button type="button" style={yesBtn(val === 'Yes')} onClick={() => setResponse(q.id, 'Yes')}>
              {lang === 'en' ? 'Yes' : 'Si'}
            </button>
            <button type="button" style={noBtn(val === 'No')} onClick={() => setResponse(q.id, 'No')}>
              No
            </button>
          </div>
        )}

        {q.type === 'text' && (
          <input style={sty.textInput} value={val} onChange={e => setResponse(q.id, e.target.value)} />
        )}

        {q.type === 'number' && (
          <input type="number" style={{ ...sty.textInput, width: 120 }} value={val} onChange={e => setResponse(q.id, e.target.value)} />
        )}

        {q.type === 'select' && q.options && (
          <select style={sty.selectInput} value={val} onChange={e => setResponse(q.id, e.target.value)}>
            <option value="">{lang === 'en' ? '-- Select --' : '-- Seleccionar --'}</option>
            {q.options.map(o => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        )}

        {q.type === 'multi-select' && q.options && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {q.options.map(o => {
              const selected = (val || '').split(',').filter(Boolean).includes(o);
              return (
                <button
                  key={o}
                  type="button"
                  style={{
                    padding: '6px 12px', borderRadius: 6, cursor: 'pointer',
                    border: selected ? '2px solid #1976d2' : '1px solid #ccc',
                    background: selected ? '#e3f2fd' : '#fff',
                    color: selected ? '#1565c0' : '#333',
                    fontWeight: selected ? 700 : 400, fontSize: 13,
                  }}
                  onClick={() => {
                    const current = (val || '').split(',').filter(Boolean);
                    const next = selected ? current.filter(v => v !== o) : [...current, o];
                    setResponse(q.id, next.join(','));
                  }}
                >
                  {o}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderPainGroup = (qs: ApiQuestion[]) => {
    return (
      <div style={sty.painGrid}>
        {qs.map(q => {
          const label = lang === 'en' ? q.text.replace('?', '') : q.spanishText.replace('?', '').replace('\u00bf', '');
          const val = responses[q.id] ?? '';
          const active = val === 'Yes';
          return (
            <button
              key={q.id}
              type="button"
              style={painToggle(active)}
              onClick={() => setResponse(q.id, active ? 'No' : 'Yes')}
            >
              {label}
            </button>
          );
        })}
      </div>
    );
  };

  const renderProductCard = (product: RecommendationProduct, idx: number) => {
    const key = `${product.category}_${idx}`;
    return (
      <div key={key} style={sty.recCard}>
        {product.imageUrl && (
          <img src={product.imageUrl} alt={product.hcpcsCode} style={sty.recImage} />
        )}
        <div style={sty.recBody}>
          {product.brochureUrl ? (
            <a href={product.brochureUrl} target="_blank" rel="noopener noreferrer" style={sty.recHcpcs}>{product.hcpcsCode}</a>
          ) : (
            <span style={sty.recHcpcs}>{product.hcpcsCode}</span>
          )}
          {product.description && <div style={{ fontSize: 14, fontWeight: 500, marginTop: 2 }}>{product.description}</div>}
          <p style={sty.recJustification}>{product.justification}</p>
          {product.seatDimensions && <div style={sty.recDetail}><strong>Seat:</strong> {product.seatDimensions}</div>}
          {product.colors && <div style={sty.recDetail}><strong>Colors:</strong> {product.colors}</div>}
          {product.leadTime && <div style={sty.recDetail}><strong>Lead time:</strong> {product.leadTime}</div>}
          {product.notes && <div style={sty.recDetail}><strong>Notes:</strong> {product.notes}</div>}

          {/* Copy buttons for 8x8 / patient communication */}
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' as const }}>
            {product.imageUrl && (
              <button
                type="button"
                style={sty.copyBtn}
                onClick={() => { navigator.clipboard.writeText(product.imageUrl!); setCopiedId(`img_${key}`); setTimeout(() => setCopiedId(''), 2000); }}
              >
                {copiedId === `img_${key}` ? 'Copied!' : 'Copy Image URL'}
              </button>
            )}
            {product.brochureUrl && (
              <button
                type="button"
                style={sty.copyBtn}
                onClick={() => { navigator.clipboard.writeText(product.brochureUrl!); setCopiedId(`pdf_${key}`); setTimeout(() => setCopiedId(''), 2000); }}
              >
                {copiedId === `pdf_${key}` ? 'Copied!' : 'Copy Brochure Link'}
              </button>
            )}
          </div>

          <div style={sty.recControls}>
            <label style={sty.starLabel}>
              <input type="radio" name="preferred_product" checked={preferred === key} onChange={() => setPreferred(key)} />
              {lang === 'en' ? 'Preferred' : 'Preferido'}
            </label>
            <select
              style={sty.statusSelect}
              value={productStatus[key] || 'undecided'}
              onChange={e => setProductStatus(prev => ({ ...prev, [key]: e.target.value }))}
            >
              <option value="undecided">{lang === 'en' ? 'Undecided' : 'Indeciso'}</option>
              <option value="accept">{lang === 'en' ? 'Accept' : 'Aceptar'}</option>
              <option value="reject">{lang === 'en' ? 'Reject' : 'Rechazar'}</option>
            </select>
          </div>
        </div>
      </div>
    );
  };

  // ── Main render ────────────────────────────────────────────────────────

  if (questionsLoading) {
    return (
      <div style={sty.container}>
        <div style={sty.loadingContainer}>
          {lang === 'en' ? 'Loading questionnaire...' : 'Cargando cuestionario...'}
        </div>
      </div>
    );
  }

  if (questionsError) {
    return (
      <div style={sty.container}>
        <div style={sty.error}>{questionsError}</div>
      </div>
    );
  }

  return (
    <div style={sty.container}>
      {/* Header */}
      <div style={sty.header}>
        <h2 style={sty.headerTitle}>
          {lang === 'en' ? 'PPD Questionnaire \u2014 Power Mobility' : 'Cuestionario PPD \u2014 Movilidad El\u00e9ctrica'}
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' as const }}>
          <input
            style={sty.patientInput}
            placeholder={lang === 'en' ? 'Patient Name - Trx#' : 'Nombre del Paciente - Trx#'}
            value={patientInfo}
            onChange={e => setPatientInfo(e.target.value)}
          />
          <div style={sty.langToggle}>
            <button type="button" style={langBtn(lang === 'en')} onClick={() => setLang('en')}>EN</button>
            <button type="button" style={langBtn(lang === 'es')} onClick={() => setLang('es')}>ES</button>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div style={sty.progressBar}>
        <div style={progressFill(progressPct)} />
        <div style={sty.progressText}>
          {answeredCount} / {totalRequired} {lang === 'en' ? 'required questions answered' : 'preguntas obligatorias respondidas'}
        </div>
      </div>

      {/* Question sections — grouped dynamically by API groups */}
      {groups.map(group => {
        const qs = groupedQuestions.get(group) || [];
        if (qs.length === 0) return null;
        const isCollapsed = collapsed[group] ?? false;
        const counts = sectionCounts[group] || { answered: 0, total: 0 };
        const isPainGroup = group === 'Consistent Pain';

        return (
          <div key={group} style={sty.section}>
            <div style={sty.sectionHeader} onClick={() => toggleSection(group)}>
              <h3 style={sty.sectionTitle}>
                {group}
                <span style={badgeStyle(counts.answered, counts.total)}>
                  {counts.answered}/{counts.total}
                </span>
              </h3>
              <span style={{ fontSize: 14, color: '#666' }}>{isCollapsed ? '\u25B6' : '\u25BC'}</span>
            </div>
            {!isCollapsed && (
              <div style={sty.sectionBody}>
                {isPainGroup
                  ? renderPainGroup(qs)
                  : qs.map(renderQuestion)
                }
              </div>
            )}
          </div>
        );
      })}

      {/* Action buttons row */}
      <div style={sty.actionBar}>
        {/* Get Recommendations */}
        <button
          type="button"
          style={loading ? sty.submitBtnDisabled : sty.submitBtn}
          disabled={loading}
          onClick={handleSubmit}
        >
          {loading
            ? (lang === 'en' ? 'Getting Recommendations...' : 'Obteniendo Recomendaciones...')
            : (lang === 'en' ? 'Get Recommendations' : 'Obtener Recomendaciones')}
        </button>

        {/* Clear Form */}
        <button
          type="button"
          style={sty.clearBtn}
          onClick={handleClearForm}
        >
          {lang === 'en' ? 'Clear Form' : 'Borrar Formulario'}
        </button>
      </div>

      {/* Error display */}
      {error && <div style={sty.error}>{error}</div>}

      {/* Recommendation results */}
      {recommendations && (
        <div style={sty.recSection}>
          {recommendations.complexRehab.length > 0 && (
            <>
              <h3 style={sty.recHeading}>
                {lang === 'en' ? 'Complex Rehab Technology (CRT)' : 'Tecnolog\u00eda de Rehabilitaci\u00f3n Compleja (CRT)'}
              </h3>
              {recommendations.complexRehab.map((p, i) => renderProductCard(p, i))}
            </>
          )}
          {recommendations.standard.length > 0 && (
            <>
              <h3 style={sty.recHeading}>
                {lang === 'en' ? 'Standard Power Mobility' : 'Movilidad El\u00e9ctrica Est\u00e1ndar'}
              </h3>
              {recommendations.standard.map((p, i) => renderProductCard(p, i))}
            </>
          )}
          {recommendations.complexRehab.length === 0 && recommendations.standard.length === 0 && (
            <div style={{ padding: 16, textAlign: 'center', color: '#666' }}>
              {lang === 'en' ? 'No recommendations returned. Please review your responses.' : 'No se devolvieron recomendaciones. Revise sus respuestas.'}
            </div>
          )}

          {/* ── Action Buttons ─────────────────────────────── */}
          <div style={sty.actionBar}>
            <button
              type="button"
              style={evalLoading ? sty.submitBtnDisabled : { ...sty.submitBtn, background: '#2e7d32' }}
              disabled={evalLoading}
              onClick={async () => {
                setEvalLoading(true);
                setSeatingEvalHtml('');
                try {
                  const csrf = getCsrf();
                  const allRecs = [...recommendations.complexRehab, ...recommendations.standard];
                  const apiResponses = formatApiResponses();
                  const res = await fetch('/api/ppd/seating-eval', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
                    body: JSON.stringify({ patientInfo, responses: apiResponses, recommendations: allRecs }),
                  });
                  if (!res.ok) throw new Error(`Failed (${res.status})`);
                  const data = await res.json();
                  setSeatingEvalHtml(data.html);
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Failed to generate seating evaluation');
                } finally {
                  setEvalLoading(false);
                }
              }}
            >
              {evalLoading
                ? (lang === 'en' ? 'Generating...' : 'Generando...')
                : (lang === 'en' ? 'Generate Seating Evaluation' : 'Generar Evaluaci\u00f3n de Asiento')}
            </button>

            <button
              type="button"
              style={submitting ? sty.submitBtnDisabled : { ...sty.submitBtn, background: '#e65100' }}
              disabled={submitting}
              onClick={async () => {
                setSubmitting(true);
                setSubmitSuccess('');
                try {
                  const csrf = getCsrf();
                  const allRecs = [...recommendations.complexRehab, ...recommendations.standard];
                  const apiResponses = formatApiResponses();
                  const res = await fetch('/api/ppd/submit', {
                    method: 'POST',
                    credentials: 'same-origin',
                    headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
                    body: JSON.stringify({
                      patientInfo,
                      responses: apiResponses,
                      recommendations: allRecs,
                      productSelections: productStatus,
                      language: lang === 'en' ? 'english' : 'spanish',
                    }),
                  });
                  if (!res.ok) throw new Error(`Failed (${res.status})`);
                  setSubmitSuccess(lang === 'en'
                    ? 'PPD submitted to Pre-Appointment Kit queue!'
                    : 'PPD enviado a la cola del Kit de Pre-Cita!');
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Failed to submit PPD');
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              {submitting
                ? (lang === 'en' ? 'Submitting...' : 'Enviando...')
                : (lang === 'en' ? 'Submit to Queue' : 'Enviar a Cola')}
            </button>
          </div>

          {submitSuccess && (
            <div style={{ background: '#d4edda', color: '#155724', padding: '10px 14px', borderRadius: 6, marginTop: 12, fontWeight: 600 }}>
              {submitSuccess}
            </div>
          )}
        </div>
      )}

      {/* ── Seating Evaluation Preview ─────────────────────── */}
      {seatingEvalHtml && (
        <div style={sty.recSection}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={sty.recHeading}>
              {lang === 'en' ? 'Seating Evaluation Preview' : 'Vista Previa de Evaluaci\u00f3n de Asiento'}
            </h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                style={sty.copyBtn}
                onClick={() => {
                  const w = window.open('', '_blank');
                  if (w) { w.document.write(seatingEvalHtml); w.document.close(); w.print(); }
                }}
              >
                {lang === 'en' ? 'Print' : 'Imprimir'}
              </button>
              <button
                type="button"
                style={sty.copyBtn}
                onClick={() => {
                  navigator.clipboard.writeText(seatingEvalHtml);
                  setCopiedId('eval_html');
                  setTimeout(() => setCopiedId(''), 2000);
                }}
              >
                {copiedId === 'eval_html' ? 'Copied!' : (lang === 'en' ? 'Copy HTML' : 'Copiar HTML')}
              </button>
            </div>
          </div>
          <div
            style={{ border: '1px solid #d0d7de', borderRadius: 8, padding: 16, background: '#fff', overflow: 'auto', maxHeight: 600 }}
            dangerouslySetInnerHTML={{ __html: seatingEvalHtml }}
          />
        </div>
      )}
    </div>
  );
}
