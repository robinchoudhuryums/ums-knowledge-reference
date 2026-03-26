/**
 * PpdQuestionnaire — PPD (Patient Provided Data) questionnaire for DME agents
 * conducting phone interviews with patients for Power Mobility Device orders.
 *
 * Features: English/Spanish toggle, collapsible sections, progress bar,
 * auto-save to sessionStorage, recommendation cards with accept/reject.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

type QuestionType = 'yes-no' | 'text' | 'number' | 'select';

interface QuestionDef {
  id: string;
  en: string;
  es: string;
  type: QuestionType;
  options?: { value: string; labelEn: string; labelEs: string }[];
  required?: boolean;
  showWhen?: { questionId: string; value: string };
  long?: boolean; // use textarea instead of input
}

interface SectionDef {
  id: string;
  titleEn: string;
  titleEs: string;
  questions: QuestionDef[];
}

interface RecommendationProduct {
  id: string;
  category: 'complex_rehab' | 'standard';
  hcpcsCode: string;
  brochureUrl?: string;
  imageUrl?: string;
  justification: string;
  seatDimensions?: string;
  colors?: string;
  leadTime?: string;
  notes?: string;
}

interface RecommendationResponse {
  products: RecommendationProduct[];
}

type ProductDecision = 'accept' | 'reject' | 'undecided';

// ─── Colors ──────────────────────────────────────────────────────────────────

const C = {
  primary: '#1976d2',
  headerDark: '#223b5d',
  greenBg: '#d4edda', greenFg: '#155724',
  redBg: '#f8d7da', redFg: '#721c24',
  yellowBg: '#fff3cd', yellowFg: '#856404',
  grayBg: '#e2e3e5', grayFg: '#383d41',
  white: '#ffffff',
  border: '#c8d6e5',
};

// ─── Question Data ───────────────────────────────────────────────────────────

const SECTIONS: SectionDef[] = [
  {
    id: 'mobility', titleEn: 'Current Mobility', titleEs: 'Movilidad Actual',
    questions: [
      { id: 'q1', en: 'Do you currently use a wheelchair or scooter?', es: '¿Actualmente usa una silla de ruedas o scooter?', type: 'yes-no', required: true },
      { id: 'q2', en: 'How do you currently move around your home?', es: '¿Cómo se mueve actualmente en su hogar?', type: 'text', required: true },
      { id: 'q3', en: 'How far can you walk without stopping (in feet)?', es: '¿Qué distancia puede caminar sin detenerse (en pies)?', type: 'number', required: true },
    ],
  },
  {
    id: 'mradl', titleEn: 'MRADLs (Mobility-Related Activities of Daily Living)', titleEs: 'MRADLs (Actividades de la Vida Diaria Relacionadas con la Movilidad)',
    questions: [
      { id: 'q10', en: 'Can you get to the bathroom on your own?', es: '¿Puede llegar al baño solo/a?', type: 'yes-no', required: true },
      { id: 'q11', en: 'Can you prepare meals independently?', es: '¿Puede preparar comidas de manera independiente?', type: 'yes-no', required: true },
      { id: 'q12', en: 'Can you get dressed without assistance?', es: '¿Puede vestirse sin ayuda?', type: 'yes-no' },
      { id: 'q13', en: 'Can you feed yourself?', es: '¿Puede alimentarse solo/a?', type: 'yes-no' },
    ],
  },
  {
    id: 'extremity', titleEn: 'Extremity Strength', titleEs: 'Fuerza de Extremidades',
    questions: [
      { id: 'q20', en: 'Rate your upper body strength', es: 'Califique la fuerza de su parte superior del cuerpo', type: 'select', required: true, options: [
        { value: 'good', labelEn: 'Good', labelEs: 'Buena' },
        { value: 'fair', labelEn: 'Fair', labelEs: 'Regular' },
        { value: 'poor', labelEn: 'Poor', labelEs: 'Mala' },
      ]},
      { id: 'q21', en: 'Rate your lower body strength', es: 'Califique la fuerza de su parte inferior del cuerpo', type: 'select', required: true, options: [
        { value: 'good', labelEn: 'Good', labelEs: 'Buena' },
        { value: 'fair', labelEn: 'Fair', labelEs: 'Regular' },
        { value: 'poor', labelEn: 'Poor', labelEs: 'Mala' },
      ]},
      { id: 'q22', en: 'Can you self-propel a manual wheelchair?', es: '¿Puede impulsar una silla de ruedas manual por sí mismo/a?', type: 'yes-no', required: true },
    ],
  },
  {
    id: 'falls', titleEn: 'Falls & Safety', titleEs: 'Caídas y Seguridad',
    questions: [
      { id: 'q30', en: 'How many times have you fallen in the past 6 months?', es: '¿Cuántas veces se ha caído en los últimos 6 meses?', type: 'number', required: true },
      { id: 'q31', en: 'Have you been hospitalized due to a fall?', es: '¿Ha sido hospitalizado/a debido a una caída?', type: 'yes-no', required: true },
      { id: 'q31a', en: 'Please describe the hospitalization', es: 'Por favor describa la hospitalización', type: 'text', long: true, showWhen: { questionId: 'q31', value: 'yes' } },
      { id: 'q32', en: 'Do you feel unsteady when standing?', es: '¿Se siente inestable al estar de pie?', type: 'yes-no' },
    ],
  },
  {
    id: 'pain', titleEn: 'Consistent Pain', titleEs: 'Dolor Constante',
    questions: [
      { id: 'q33', en: 'Do you experience consistent pain that limits mobility?', es: '¿Experimenta dolor constante que limita su movilidad?', type: 'yes-no', required: true },
      { id: 'q33a', en: 'Where is the pain and what is the severity (1-10)?', es: '¿Dónde es el dolor y cuál es la severidad (1-10)?', type: 'text', showWhen: { questionId: 'q33', value: 'yes' } },
      { id: 'q34', en: 'Does pain increase with prolonged sitting?', es: '¿El dolor aumenta al estar sentado/a por mucho tiempo?', type: 'yes-no' },
    ],
  },
  {
    id: 'additional', titleEn: 'Additional Information', titleEs: 'Información Adicional',
    questions: [
      { id: 'q40', en: 'What is your height (inches)?', es: '¿Cuál es su estatura (pulgadas)?', type: 'number', required: true },
      { id: 'q41', en: 'What is your weight (lbs)?', es: '¿Cuál es su peso (libras)?', type: 'number', required: true },
      { id: 'q42', en: 'Door width at narrowest point in home (inches)?', es: '¿Ancho de la puerta más estrecha en su hogar (pulgadas)?', type: 'number' },
      { id: 'q43', en: 'Any additional comments or concerns?', es: '¿Algún comentario o preocupación adicional?', type: 'text', long: true },
    ],
  },
  {
    id: 'diagnoses', titleEn: 'Diagnoses', titleEs: 'Diagnósticos',
    questions: [
      { id: 'q50', en: 'Primary diagnosis related to mobility impairment', es: 'Diagnóstico principal relacionado con la discapacidad de movilidad', type: 'text', required: true },
      { id: 'q51', en: 'Secondary diagnoses (if any)', es: 'Diagnósticos secundarios (si los hay)', type: 'text', long: true },
      { id: 'q52', en: 'Date of onset of primary condition', es: 'Fecha de inicio de la condición primaria', type: 'text' },
    ],
  },
];

const ALL_QUESTIONS = SECTIONS.flatMap(s => s.questions);
const REQUIRED_QUESTIONS = ALL_QUESTIONS.filter(q => q.required);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function storageKey(patient: string) {
  return `ppd_responses_${patient.trim().toLowerCase()}`;
}

function getCsrf(): string {
  return document.cookie.match(/csrf_token=([^;]+)/)?.[1] || '';
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PpdQuestionnaire() {
  const [lang, setLang] = useState<'en' | 'es'>('en');
  const [patientInfo, setPatientInfo] = useState('');
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [recommendations, setRecommendations] = useState<RecommendationProduct[] | null>(null);
  const [preferred, setPreferred] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Record<string, ProductDecision>>({});

  // Load from sessionStorage when patientInfo changes
  useEffect(() => {
    if (!patientInfo.trim()) return;
    const saved = sessionStorage.getItem(storageKey(patientInfo));
    if (saved) {
      try { setResponses(JSON.parse(saved)); } catch { /* ignore */ }
    }
  }, [patientInfo]);

  // Auto-save to sessionStorage
  useEffect(() => {
    if (!patientInfo.trim()) return;
    sessionStorage.setItem(storageKey(patientInfo), JSON.stringify(responses));
  }, [responses, patientInfo]);

  const setResponse = useCallback((id: string, value: string) => {
    setResponses(prev => ({ ...prev, [id]: value }));
  }, []);

  const toggleSection = useCallback((sectionId: string) => {
    setCollapsed(prev => ({ ...prev, [sectionId]: !prev[sectionId] }));
  }, []);

  // Progress
  const answeredRequired = useMemo(() => {
    return REQUIRED_QUESTIONS.filter(q => {
      if (q.showWhen) {
        const parentVal = responses[q.showWhen.questionId];
        if (parentVal !== q.showWhen.value) return false;
      }
      return (responses[q.id] ?? '').trim() !== '';
    }).length;
  }, [responses]);

  const visibleRequired = useMemo(() => {
    return REQUIRED_QUESTIONS.filter(q => {
      if (q.showWhen) {
        return responses[q.showWhen.questionId] === q.showWhen.value;
      }
      return true;
    }).length;
  }, [responses]);

  const progressPct = visibleRequired > 0 ? Math.round((answeredRequired / visibleRequired) * 100) : 0;

  // Submit
  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    setRecommendations(null);
    setPreferred(null);
    setDecisions({});

    try {
      const res = await fetch('/api/ppd/recommend', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': getCsrf(),
        },
        body: JSON.stringify({ patientInfo, responses, lang }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data: RecommendationResponse = await res.json();
      setRecommendations(data.products);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get recommendations');
    } finally {
      setLoading(false);
    }
  };

  const isVisible = (q: QuestionDef) => {
    if (!q.showWhen) return true;
    return responses[q.showWhen.questionId] === q.showWhen.value;
  };

  // ─── Styles ──────────────────────────────────────────────────────────────

  const styles = {
    container: { maxWidth: 900, margin: '0 auto', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#333' } as React.CSSProperties,
    header: { background: C.headerDark, color: C.white, padding: '16px 20px', borderRadius: '8px 8px 0 0', marginBottom: 0 } as React.CSSProperties,
    headerTitle: { margin: 0, fontSize: 20, fontWeight: 600 } as React.CSSProperties,
    topRow: { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' as const, marginTop: 12 },
    input: { padding: '8px 12px', borderRadius: 4, border: `1px solid ${C.border}`, fontSize: 14, flex: 1, minWidth: 200 } as React.CSSProperties,
    toggleBtn: (active: boolean) => ({
      padding: '6px 16px', borderRadius: 4, border: `1px solid ${C.primary}`, cursor: 'pointer', fontSize: 13, fontWeight: 600,
      background: active ? C.primary : C.white, color: active ? C.white : C.primary,
    } as React.CSSProperties),
    progressWrap: { background: '#f0f4f8', padding: '10px 20px', borderBottom: `1px solid ${C.border}` } as React.CSSProperties,
    progressBar: { height: 8, borderRadius: 4, background: '#dce3eb', overflow: 'hidden' as const, marginTop: 6 },
    progressFill: (pct: number) => ({ height: '100%', width: `${pct}%`, background: C.primary, borderRadius: 4, transition: 'width 0.3s' } as React.CSSProperties),
    body: { background: C.white, border: `1px solid ${C.border}`, borderTop: 'none', borderRadius: '0 0 8px 8px', padding: '0 0 16px' } as React.CSSProperties,
    sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', background: '#eaf0f7', cursor: 'pointer', userSelect: 'none' as const, borderTop: `1px solid ${C.border}` },
    sectionTitle: { margin: 0, fontSize: 15, fontWeight: 600, color: C.headerDark } as React.CSSProperties,
    questionRow: { padding: '10px 20px' } as React.CSSProperties,
    label: { display: 'block', fontSize: 14, marginBottom: 6, fontWeight: 500 } as React.CSSProperties,
    ynBtn: (selected: boolean, variant: 'yes' | 'no') => ({
      padding: '6px 20px', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 600, marginRight: 8,
      border: '1px solid',
      background: selected ? (variant === 'yes' ? C.greenBg : C.redBg) : C.white,
      color: selected ? (variant === 'yes' ? C.greenFg : C.redFg) : C.grayFg,
      borderColor: selected ? (variant === 'yes' ? C.greenFg : C.redFg) : C.border,
    } as React.CSSProperties),
    textInput: { padding: '8px 12px', borderRadius: 4, border: `1px solid ${C.border}`, fontSize: 14, width: '100%', boxSizing: 'border-box' as const } as React.CSSProperties,
    textarea: { padding: '8px 12px', borderRadius: 4, border: `1px solid ${C.border}`, fontSize: 14, width: '100%', boxSizing: 'border-box' as const, minHeight: 60, resize: 'vertical' as const } as React.CSSProperties,
    select: { padding: '8px 12px', borderRadius: 4, border: `1px solid ${C.border}`, fontSize: 14 } as React.CSSProperties,
    submitBtn: { padding: '10px 28px', borderRadius: 6, border: 'none', background: C.primary, color: C.white, fontSize: 15, fontWeight: 600, cursor: 'pointer', margin: '16px 20px' } as React.CSSProperties,
    error: { color: C.redFg, background: C.redBg, padding: '10px 20px', margin: '0 20px', borderRadius: 4, fontSize: 14 } as React.CSSProperties,
    recSection: { padding: '0 20px', marginTop: 16 } as React.CSSProperties,
    recHeading: { fontSize: 16, fontWeight: 600, color: C.headerDark, borderBottom: `2px solid ${C.primary}`, paddingBottom: 6, marginBottom: 12 } as React.CSSProperties,
    card: { display: 'flex', gap: 16, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14, marginBottom: 12, background: '#fafbfd' } as React.CSSProperties,
    cardImg: { width: 120, height: 120, objectFit: 'contain' as const, borderRadius: 6, background: '#f0f0f0', flexShrink: 0 } as React.CSSProperties,
    cardBody: { flex: 1, minWidth: 0 } as React.CSSProperties,
    hcpcsLink: { fontSize: 16, fontWeight: 700, color: C.primary, textDecoration: 'none' } as React.CSSProperties,
    cardDetail: { fontSize: 13, color: '#555', margin: '4px 0' } as React.CSSProperties,
    radioLabel: { fontSize: 13, cursor: 'pointer', marginRight: 16, color: C.yellowFg } as React.CSSProperties,
    decisionSelect: { padding: '4px 8px', borderRadius: 4, border: `1px solid ${C.border}`, fontSize: 13 } as React.CSSProperties,
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  const renderQuestion = (q: QuestionDef) => {
    if (!isVisible(q)) return null;
    const text = lang === 'en' ? q.en : q.es;
    const val = responses[q.id] ?? '';

    return (
      <div key={q.id} style={styles.questionRow}>
        <label style={styles.label}>
          {text}
          {q.required && <span style={{ color: C.redFg, marginLeft: 4 }}>*</span>}
        </label>

        {q.type === 'yes-no' && (
          <div>
            <button
              type="button"
              style={styles.ynBtn(val === 'yes', 'yes')}
              onClick={() => setResponse(q.id, val === 'yes' ? '' : 'yes')}
            >
              {lang === 'en' ? 'Yes' : 'Sí'}
            </button>
            <button
              type="button"
              style={styles.ynBtn(val === 'no', 'no')}
              onClick={() => setResponse(q.id, val === 'no' ? '' : 'no')}
            >
              No
            </button>
          </div>
        )}

        {q.type === 'text' && (
          q.long
            ? <textarea style={styles.textarea} value={val} onChange={e => setResponse(q.id, e.target.value)} />
            : <input style={styles.textInput} type="text" value={val} onChange={e => setResponse(q.id, e.target.value)} />
        )}

        {q.type === 'number' && (
          <input style={{ ...styles.textInput, width: 120 }} type="number" value={val} onChange={e => setResponse(q.id, e.target.value)} />
        )}

        {q.type === 'select' && q.options && (
          <select style={styles.select} value={val} onChange={e => setResponse(q.id, e.target.value)}>
            <option value="">{lang === 'en' ? '-- Select --' : '-- Seleccionar --'}</option>
            {q.options.map(o => (
              <option key={o.value} value={o.value}>{lang === 'en' ? o.labelEn : o.labelEs}</option>
            ))}
          </select>
        )}
      </div>
    );
  };

  const complexProducts = recommendations?.filter(p => p.category === 'complex_rehab') ?? [];
  const standardProducts = recommendations?.filter(p => p.category === 'standard') ?? [];

  const renderProductCard = (p: RecommendationProduct) => (
    <div key={p.id} style={styles.card}>
      {p.imageUrl ? (
        <img src={p.imageUrl} alt={p.hcpcsCode} style={styles.cardImg} />
      ) : (
        <div style={{ ...styles.cardImg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: 12 }}>
          No Image
        </div>
      )}
      <div style={styles.cardBody}>
        <div>
          {p.brochureUrl ? (
            <a href={p.brochureUrl} target="_blank" rel="noopener noreferrer" style={styles.hcpcsLink}>{p.hcpcsCode}</a>
          ) : (
            <span style={styles.hcpcsLink}>{p.hcpcsCode}</span>
          )}
        </div>
        <p style={{ ...styles.cardDetail, fontStyle: 'italic' }}>{p.justification}</p>
        {p.seatDimensions && <p style={styles.cardDetail}><strong>Seat:</strong> {p.seatDimensions}</p>}
        {p.colors && <p style={styles.cardDetail}><strong>Colors:</strong> {p.colors}</p>}
        {p.leadTime && <p style={styles.cardDetail}><strong>Lead Time:</strong> {p.leadTime}</p>}
        {p.notes && <p style={styles.cardDetail}><strong>Notes:</strong> {p.notes}</p>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 8 }}>
          <label style={styles.radioLabel}>
            <input
              type="radio"
              name="preferred-product"
              checked={preferred === p.id}
              onChange={() => setPreferred(p.id)}
              style={{ marginRight: 4 }}
            />
            {lang === 'en' ? 'Preferred' : 'Preferido'}
          </label>
          <select
            style={styles.decisionSelect}
            value={decisions[p.id] ?? 'undecided'}
            onChange={e => setDecisions(prev => ({ ...prev, [p.id]: e.target.value as ProductDecision }))}
          >
            <option value="undecided">{lang === 'en' ? 'Undecided' : 'Indeciso'}</option>
            <option value="accept">{lang === 'en' ? 'Accept' : 'Aceptar'}</option>
            <option value="reject">{lang === 'en' ? 'Reject' : 'Rechazar'}</option>
          </select>
        </div>
      </div>
    </div>
  );

  const renderRecSection = (title: string, products: RecommendationProduct[]) => {
    if (products.length === 0) return null;
    return (
      <div style={styles.recSection}>
        <h3 style={styles.recHeading}>{title}</h3>
        {products.map(renderProductCard)}
      </div>
    );
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h2 style={styles.headerTitle}>
          {lang === 'en' ? 'PPD Questionnaire — Power Mobility Device' : 'Cuestionario PPD — Dispositivo de Movilidad Motorizada'}
        </h2>
        <div style={styles.topRow}>
          <input
            style={{ ...styles.input, background: 'rgba(255,255,255,0.95)', color: '#333' }}
            placeholder={lang === 'en' ? 'Patient Name - Trx#' : 'Nombre del Paciente - Trx#'}
            value={patientInfo}
            onChange={e => setPatientInfo(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 0 }}>
            <button type="button" style={{ ...styles.toggleBtn(lang === 'en'), borderRadius: '4px 0 0 4px' }} onClick={() => setLang('en')}>English</button>
            <button type="button" style={{ ...styles.toggleBtn(lang === 'es'), borderRadius: '0 4px 4px 0' }} onClick={() => setLang('es')}>Español</button>
          </div>
        </div>
      </div>

      {/* Progress */}
      <div style={styles.progressWrap}>
        <span style={{ fontSize: 13, color: C.grayFg }}>
          {answeredRequired} {lang === 'en' ? 'of' : 'de'} {visibleRequired} {lang === 'en' ? 'required questions answered' : 'preguntas requeridas respondidas'}
        </span>
        <div style={styles.progressBar}>
          <div style={styles.progressFill(progressPct)} />
        </div>
      </div>

      {/* Body */}
      <div style={styles.body}>
        {SECTIONS.map(section => (
          <div key={section.id}>
            <div style={styles.sectionHeader} onClick={() => toggleSection(section.id)}>
              <h3 style={styles.sectionTitle}>{lang === 'en' ? section.titleEn : section.titleEs}</h3>
              <span style={{ fontSize: 18, color: C.grayFg }}>{collapsed[section.id] ? '▸' : '▾'}</span>
            </div>
            {!collapsed[section.id] && section.questions.map(renderQuestion)}
          </div>
        ))}

        {/* Submit */}
        <button
          type="button"
          style={{ ...styles.submitBtn, opacity: loading ? 0.6 : 1 }}
          disabled={loading}
          onClick={handleSubmit}
        >
          {loading
            ? (lang === 'en' ? 'Loading...' : 'Cargando...')
            : (lang === 'en' ? 'Get Recommendations' : 'Obtener Recomendaciones')}
        </button>

        {error && <div style={styles.error}>{error}</div>}

        {/* Recommendations */}
        {recommendations && recommendations.length === 0 && (
          <div style={{ ...styles.recSection, color: C.grayFg, fontStyle: 'italic' }}>
            {lang === 'en' ? 'No product recommendations returned.' : 'No se devolvieron recomendaciones de productos.'}
          </div>
        )}
        {renderRecSection(lang === 'en' ? 'Complex Rehab Technology' : 'Tecnología de Rehabilitación Compleja', complexProducts)}
        {renderRecSection(lang === 'en' ? 'Standard Power Mobility' : 'Movilidad Motorizada Estándar', standardProducts)}
      </div>
    </div>
  );
}
