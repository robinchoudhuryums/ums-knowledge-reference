/**
 * PpdQuestionnaire — PPD (Patient Provided Data) questionnaire for DME agents
 * conducting phone interviews with patients for Power Mobility Device orders.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

type QuestionType = 'yes-no' | 'text' | 'number' | 'select';
type Lang = 'en' | 'es';

interface Question {
  id: string;
  type: QuestionType;
  en: string;
  es: string;
  required?: boolean;
  options?: { value: string; labelEn: string; labelEs: string }[];
  showWhen?: { questionId: string; value: string };
  long?: boolean;
}

interface QuestionSection {
  id: string;
  titleEn: string;
  titleEs: string;
  questions: Question[];
}

interface RecommendationProduct {
  hcpcsCode: string;
  description: string;
  justification: string;
  category: 'complex_rehab' | 'standard';
  imageUrl?: string;
  brochureUrl?: string;
  seatDimensions?: string;
  colors?: string;
  leadTime?: string;
  notes?: string;
}

interface RecommendationResponse {
  complexRehab: RecommendationProduct[];
  standard: RecommendationProduct[];
}

// ── Question definitions ───────────────────────────────────────────────────

const sections: QuestionSection[] = [
  {
    id: 'mobility',
    titleEn: 'Current Mobility',
    titleEs: 'Movilidad Actual',
    questions: [
      { id: 'q1', type: 'select', en: 'How do you currently move around your home?', es: '\u00bfC\u00f3mo se mueve actualmente dentro de su hogar?', required: true, options: [
        { value: 'walk', labelEn: 'Walk independently', labelEs: 'Camino independientemente' },
        { value: 'walker', labelEn: 'Walker / Rollator', labelEs: 'Andador / Rollator' },
        { value: 'cane', labelEn: 'Cane', labelEs: 'Bast\u00f3n' },
        { value: 'wheelchair', labelEn: 'Manual wheelchair', labelEs: 'Silla de ruedas manual' },
        { value: 'power', labelEn: 'Power wheelchair / Scooter', labelEs: 'Silla de ruedas el\u00e9ctrica / Scooter' },
        { value: 'bedbound', labelEn: 'Mostly bedbound', labelEs: 'Principalmente en cama' },
      ]},
      { id: 'q2', type: 'text', en: 'How far can you walk without stopping?', es: '\u00bfQu\u00e9 distancia puede caminar sin detenerse?', required: true },
      { id: 'q3', type: 'yes-no', en: 'Do you use any assistive device right now?', es: '\u00bfUsa alg\u00fan dispositivo de asistencia actualmente?', required: true },
      { id: 'q4', type: 'text', en: 'Describe your home layout (stairs, doorway widths, flooring).', es: 'Describa la distribuci\u00f3n de su hogar (escaleras, ancho de puertas, pisos).', long: true },
    ],
  },
  {
    id: 'mradls',
    titleEn: 'Mobility-Related Activities of Daily Living (MRADLs)',
    titleEs: 'Actividades de la Vida Diaria Relacionadas con la Movilidad (MRADLs)',
    questions: [
      { id: 'q10', type: 'yes-no', en: 'Can you dress yourself independently?', es: '\u00bfPuede vestirse solo/a?', required: true },
      { id: 'q11', type: 'yes-no', en: 'Can you bathe/shower independently?', es: '\u00bfPuede ba\u00f1arse/ducharse solo/a?', required: true },
      { id: 'q12', type: 'yes-no', en: 'Can you use the toilet independently?', es: '\u00bfPuede usar el ba\u00f1o solo/a?', required: true },
      { id: 'q13', type: 'yes-no', en: 'Can you prepare meals independently?', es: '\u00bfPuede preparar comidas solo/a?', required: true },
      { id: 'q14', type: 'yes-no', en: 'Can you move between bed, chair, and wheelchair safely?', es: '\u00bfPuede trasladarse entre cama, silla y silla de ruedas de forma segura?', required: true },
    ],
  },
  {
    id: 'strength',
    titleEn: 'Extremity Strength',
    titleEs: 'Fuerza de Extremidades',
    questions: [
      { id: 'q20', type: 'select', en: 'Rate your upper body strength:', es: 'Califique su fuerza del tren superior:', required: true, options: [
        { value: 'normal', labelEn: 'Normal', labelEs: 'Normal' },
        { value: 'mild', labelEn: 'Mild weakness', labelEs: 'Debilidad leve' },
        { value: 'moderate', labelEn: 'Moderate weakness', labelEs: 'Debilidad moderada' },
        { value: 'severe', labelEn: 'Severe weakness', labelEs: 'Debilidad severa' },
      ]},
      { id: 'q21', type: 'select', en: 'Rate your lower body strength:', es: 'Califique su fuerza del tren inferior:', required: true, options: [
        { value: 'normal', labelEn: 'Normal', labelEs: 'Normal' },
        { value: 'mild', labelEn: 'Mild weakness', labelEs: 'Debilidad leve' },
        { value: 'moderate', labelEn: 'Moderate weakness', labelEs: 'Debilidad moderada' },
        { value: 'severe', labelEn: 'Severe weakness', labelEs: 'Debilidad severa' },
      ]},
      { id: 'q22', type: 'yes-no', en: 'Can you propel a manual wheelchair by yourself?', es: '\u00bfPuede impulsar una silla de ruedas manual por s\u00ed mismo/a?', required: true },
    ],
  },
  {
    id: 'falls',
    titleEn: 'Falls & Safety',
    titleEs: 'Ca\u00eddas y Seguridad',
    questions: [
      { id: 'q30', type: 'number', en: 'How many falls have you had in the last 6 months?', es: '\u00bfCu\u00e1ntas ca\u00eddas ha tenido en los \u00faltimos 6 meses?', required: true },
      { id: 'q31', type: 'yes-no', en: 'Have any falls resulted in injury?', es: '\u00bfAlguna ca\u00edda result\u00f3 en lesi\u00f3n?', required: true },
      { id: 'q31a', type: 'text', en: 'Describe the injuries from falls.', es: 'Describa las lesiones por ca\u00eddas.', showWhen: { questionId: 'q31', value: 'yes' }, long: true },
      { id: 'q32', type: 'yes-no', en: 'Do you feel safe moving around your home?', es: '\u00bfSe siente seguro/a movi\u00e9ndose por su hogar?', required: true },
      { id: 'q33', type: 'yes-no', en: 'Have you been hospitalized due to a fall?', es: '\u00bfHa sido hospitalizado/a debido a una ca\u00edda?', required: true },
      { id: 'q33a', type: 'text', en: 'When and how long was the hospitalization?', es: '\u00bfCu\u00e1ndo y cu\u00e1nto dur\u00f3 la hospitalizaci\u00f3n?', showWhen: { questionId: 'q33', value: 'yes' } },
    ],
  },
  {
    id: 'pain',
    titleEn: 'Consistent Pain',
    titleEs: 'Dolor Constante',
    questions: [
      { id: 'q40', type: 'yes-no', en: 'Do you experience consistent pain that limits mobility?', es: '\u00bfExperimenta dolor constante que limita su movilidad?', required: true },
      { id: 'q41', type: 'number', en: 'Rate your average pain level (0-10):', es: 'Califique su nivel promedio de dolor (0-10):', required: true },
      { id: 'q42', type: 'text', en: 'Where is the pain located?', es: '\u00bfD\u00f3nde se localiza el dolor?', required: true },
    ],
  },
  {
    id: 'additional',
    titleEn: 'Additional Information',
    titleEs: 'Informaci\u00f3n Adicional',
    questions: [
      { id: 'q50', type: 'number', en: 'Patient weight (lbs):', es: 'Peso del paciente (libras):', required: true },
      { id: 'q51', type: 'number', en: 'Patient height (inches):', es: 'Estatura del paciente (pulgadas):', required: true },
      { id: 'q52', type: 'text', en: 'Any other comments or concerns?', es: '\u00bfAlg\u00fan otro comentario o preocupaci\u00f3n?', long: true },
    ],
  },
  {
    id: 'diagnoses',
    titleEn: 'Diagnoses',
    titleEs: 'Diagn\u00f3sticos',
    questions: [
      { id: 'q60', type: 'text', en: 'Primary diagnosis / ICD-10 code:', es: 'Diagn\u00f3stico primario / c\u00f3digo ICD-10:', required: true },
      { id: 'q61', type: 'text', en: 'Secondary diagnoses:', es: 'Diagn\u00f3sticos secundarios:', long: true },
      { id: 'q62', type: 'text', en: 'Current medications affecting mobility:', es: 'Medicamentos actuales que afectan la movilidad:', long: true },
    ],
  },
];

const allQuestions = sections.flatMap(s => s.questions);
const requiredQuestions = allQuestions.filter(q => q.required && !q.showWhen);

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

// ── Component ──────────────────────────────────────────────────────────────

export function PpdQuestionnaire() {
  const [lang, setLang] = useState<Lang>('en');
  const [patientInfo, setPatientInfo] = useState('');
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [recommendations, setRecommendations] = useState<RecommendationResponse | null>(null);
  const [preferred, setPreferred] = useState('');
  const [productStatus, setProductStatus] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState('');
  const [seatingEvalHtml, setSeatingEvalHtml] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState('');
  const [evalLoading, setEvalLoading] = useState(false);

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

  const isVisible = useCallback((q: Question): boolean => {
    if (!q.showWhen) return true;
    return responses[q.showWhen.questionId] === q.showWhen.value;
  }, [responses]);

  // Progress calculation
  const answeredCount = useMemo(() => {
    return requiredQuestions.filter(q => {
      const val = responses[q.id];
      return val !== undefined && val !== '';
    }).length;
  }, [responses]);

  const totalRequired = requiredQuestions.length;
  const progressPct = totalRequired > 0 ? Math.round((answeredCount / totalRequired) * 100) : 0;

  // Submit to API
  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    setRecommendations(null);
    try {
      const csrf = getCsrf();
      const res = await fetch('/api/ppd/recommend', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ patientInfo, responses, language: lang }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || `Request failed (${res.status})`);
      }
      const data: RecommendationResponse = await res.json();
      setRecommendations(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get recommendations');
    } finally {
      setLoading(false);
    }
  };

  // ── Render helpers ─────────────────────────────────────────────────────

  const renderQuestion = (q: Question) => {
    if (!isVisible(q)) return null;
    const label = lang === 'en' ? q.en : q.es;
    const val = responses[q.id] ?? '';

    return (
      <div key={q.id} style={sty.questionRow}>
        <label style={sty.questionLabel}>
          {label}
          {q.required && <span style={{ color: '#dc3545', marginLeft: 3 }}>*</span>}
        </label>

        {q.type === 'yes-no' && (
          <div style={sty.yesNoGroup}>
            <button type="button" style={yesBtn(val === 'yes')} onClick={() => setResponse(q.id, 'yes')}>
              {lang === 'en' ? 'Yes' : 'S\u00ed'}
            </button>
            <button type="button" style={noBtn(val === 'no')} onClick={() => setResponse(q.id, 'no')}>
              No
            </button>
          </div>
        )}

        {q.type === 'text' && !q.long && (
          <input style={sty.textInput} value={val} onChange={e => setResponse(q.id, e.target.value)} />
        )}

        {q.type === 'text' && q.long && (
          <textarea style={sty.textarea} value={val} onChange={e => setResponse(q.id, e.target.value)} />
        )}

        {q.type === 'number' && (
          <input type="number" style={{ ...sty.textInput, width: 120 }} value={val} onChange={e => setResponse(q.id, e.target.value)} />
        )}

        {q.type === 'select' && q.options && (
          <select style={sty.selectInput} value={val} onChange={e => setResponse(q.id, e.target.value)}>
            <option value="">{lang === 'en' ? '-- Select --' : '-- Seleccionar --'}</option>
            {q.options.map(o => (
              <option key={o.value} value={o.value}>{lang === 'en' ? o.labelEn : o.labelEs}</option>
            ))}
          </select>
        )}
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

      {/* Question sections */}
      {sections.map(section => {
        const isCollapsed = collapsed[section.id] ?? false;
        const title = lang === 'en' ? section.titleEn : section.titleEs;
        return (
          <div key={section.id} style={sty.section}>
            <div style={sty.sectionHeader} onClick={() => toggleSection(section.id)}>
              <h3 style={sty.sectionTitle}>{title}</h3>
              <span style={{ fontSize: 14, color: '#666' }}>{isCollapsed ? '\u25B6' : '\u25BC'}</span>
            </div>
            {!isCollapsed && (
              <div style={sty.sectionBody}>
                {section.questions.map(renderQuestion)}
              </div>
            )}
          </div>
        );
      })}

      {/* Submit button */}
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
                  const apiResponses = Object.entries(responses).map(([questionId, answer]) => ({ questionId, answer }));
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
                : (lang === 'en' ? 'Generate Seating Evaluation' : 'Generar Evaluación de Asiento')}
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
                  const apiResponses = Object.entries(responses).map(([questionId, answer]) => ({ questionId, answer }));
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
              {lang === 'en' ? 'Seating Evaluation Preview' : 'Vista Previa de Evaluación de Asiento'}
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
