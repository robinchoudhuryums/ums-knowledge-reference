/**
 * PapAccountCreationForm — PAP/CPAP Order Creation form for sleep sales reps.
 * Collects patient demographics, insurance, clinical info, and PAP-specific
 * details (sleep study, current equipment, mask type, machine vs supplies).
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { InsuranceCardUpload } from './InsuranceCardUpload';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';

interface PapQuestion {
  id: string;
  number: string;
  text: string;
  spanishText: string;
  type: 'text' | 'checkbox' | 'textarea' | 'select';
  group: string;
  required: boolean;
  isSecondary?: boolean;
  options?: string[];
  conditionalFormatting?: Record<string, { bgColor: string; textColor: string }>;
}

type Lang = 'en' | 'es';

import { getCsrfToken } from '../services/api';
function getCsrf(): string { return getCsrfToken() || ''; }

function storageKey(patient: string): string {
  return `pap_responses_${patient.replace(/\s+/g, '_').toLowerCase()}`;
}

// ── Styles ────────────────────────────────────────────────────────────

const sty = {
  container: { padding: 20, maxWidth: 900, margin: '0 auto', fontFamily: 'system-ui, sans-serif' } as React.CSSProperties,
  header: { background: 'linear-gradient(135deg, #1a237e, #3949ab)', color: '#fff', padding: '16px 20px', borderRadius: 10, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' as const, gap: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' } as React.CSSProperties,
  headerTitle: { margin: 0, fontSize: 20, fontWeight: 600 } as React.CSSProperties,
  langToggle: { display: 'flex', gap: 0, borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.5)' } as React.CSSProperties,
  section: { border: '1px solid var(--ums-border)', borderRadius: 10, marginBottom: 14, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', background: 'var(--ums-bg-glass)', backdropFilter: 'blur(12px)' } as React.CSSProperties,
  sectionHeader: { background: 'var(--ums-bg-glass-header)', padding: '12px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', userSelect: 'none' as const, transition: 'background 0.2s', borderBottom: '1px solid var(--ums-border-light)' } as React.CSSProperties,
  sectionTitle: { margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--ums-text-primary)' } as React.CSSProperties,
  sectionBody: { padding: '14px 16px' } as React.CSSProperties,
  questionRow: { marginBottom: 10, padding: '12px 16px', background: 'var(--ums-bg-surface)', borderRadius: 8, border: '1px solid var(--ums-border)', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' } as React.CSSProperties,
  questionLabel: { display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 500, color: 'var(--ums-text-primary)' } as React.CSSProperties,
  secondaryLabel: { display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 400, fontStyle: 'italic' as const, color: 'var(--ums-text-muted)', paddingLeft: 16 } as React.CSSProperties,
  textInput: { padding: '8px 12px', borderRadius: 6, border: '1px solid var(--ums-border)', fontSize: 14, width: '100%', boxSizing: 'border-box' as const } as React.CSSProperties,
  textarea: { padding: '8px 12px', borderRadius: 6, border: '1px solid var(--ums-border)', fontSize: 14, width: '100%', boxSizing: 'border-box' as const, minHeight: 70, resize: 'vertical' as const } as React.CSSProperties,
  selectInput: { padding: '8px 12px', borderRadius: 6, border: '1px solid var(--ums-border)', fontSize: 14, width: '100%', boxSizing: 'border-box' as const } as React.CSSProperties,
  checkboxRow: { display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' } as React.CSSProperties,
  checkbox: { width: 20, height: 20, accentColor: '#3949ab', cursor: 'pointer' } as React.CSSProperties,
  progressRing: { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16, padding: '12px 18px', background: 'var(--ums-bg-glass)', backdropFilter: 'blur(12px)', borderRadius: 10, border: '1px solid var(--ums-border)', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' } as React.CSSProperties,
  progressRingText: { fontSize: 13, color: 'var(--ums-text-muted)', fontWeight: 500 } as React.CSSProperties,
  completionBadge: { fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600 } as React.CSSProperties,
  actionBar: { display: 'flex', gap: 12, marginTop: 20, flexWrap: 'wrap' as const, alignItems: 'center' } as React.CSSProperties,
  submitBtn: { background: '#3949ab', color: '#fff', border: 'none', padding: '12px 28px', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
  submitBtnDisabled: { background: '#9fa8da', color: '#fff', border: 'none', padding: '12px 28px', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'not-allowed' } as React.CSSProperties,
  clearBtn: { background: 'var(--ums-bg-surface)', color: '#dc3545', border: '1px solid #dc3545', padding: '10px 20px', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer' } as React.CSSProperties,
  emailInput: { padding: '8px 12px', borderRadius: 6, border: '1px solid var(--ums-border)', fontSize: 14, width: 280 } as React.CSSProperties,
  error: { background: '#f8d7da', color: '#721c24', padding: '10px 14px', borderRadius: 6, marginTop: 12 } as React.CSSProperties,
  success: { background: '#d4edda', color: '#155724', padding: '10px 14px', borderRadius: 6, marginTop: 12, fontWeight: 600 } as React.CSSProperties,
  conditionalBadge: { display: 'inline-block', padding: '4px 10px', borderRadius: 6, fontWeight: 600, fontSize: 13 } as React.CSSProperties,
};

function langBtn(active: boolean): React.CSSProperties {
  return { padding: '6px 14px', cursor: 'pointer', border: 'none', background: active ? 'var(--ums-bg-surface)' : 'transparent', color: active ? '#1a237e' : '#fff', fontWeight: active ? 700 : 400, fontSize: 13 };
}

// ── Component ─────────────────────────────────────────────────────────

export function PapAccountCreationForm() {
  const [lang, setLang] = useState<Lang>('en');
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [questions, setQuestions] = useState<PapQuestion[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [fetchError, setFetchError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Warn user before leaving page if form has unsaved data
  useUnsavedChanges(Object.keys(responses).length > 0 && !success);
  const [sendTo, setSendTo] = useState('');

  useEffect(() => {
    fetch('/api/pap-account/questions', { credentials: 'same-origin' })
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then(data => { setQuestions(data.questions); setGroups(data.groups); setLoading(false); })
      .catch(err => { setFetchError(err.message); setLoading(false); });
  }, []);

  const patientName = responses['pap1'] || '';
  useEffect(() => {
    if (!patientName.trim()) return;
    sessionStorage.setItem(storageKey(patientName), JSON.stringify(responses));
  }, [responses, patientName]);

  useEffect(() => {
    if (!patientName.trim()) return;
    const saved = sessionStorage.getItem(storageKey(patientName));
    if (saved) {
      try { const parsed = JSON.parse(saved); if (parsed['pap1'] === patientName) setResponses(parsed); } catch { /* ignore */ }
    }
  }, [patientName]);

  const setResponse = useCallback((id: string, value: string) => {
    setResponses(prev => ({ ...prev, [id]: value }));
  }, []);

  const toggleSection = useCallback((id: string) => {
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const requiredQuestions = useMemo(() => questions.filter(q => q.required), [questions]);
  const answeredCount = useMemo(() => {
    return requiredQuestions.filter(q => { const v = responses[q.id]; return v !== undefined && v !== '' && v !== 'false'; }).length;
  }, [responses, requiredQuestions]);
  const totalRequired = requiredQuestions.length;
  const progressPct = totalRequired > 0 ? Math.round((answeredCount / totalRequired) * 100) : 0;

  const sectionCompletion = useMemo(() => {
    const result: Record<string, { answered: number; total: number }> = {};
    for (const group of groups) {
      const groupQs = questions.filter(q => q.group === group && q.required);
      const answered = groupQs.filter(q => { const v = responses[q.id]; return v !== undefined && v !== '' && v !== 'false'; }).length;
      result[group] = { answered, total: groupQs.length };
    }
    return result;
  }, [responses, questions, groups]);

  const handleSubmit = async () => {
    setSubmitting(true); setError(''); setSuccess('');
    try {
      const csrf = getCsrf();
      const apiResponses = Object.entries(responses).map(([questionId, answer]) => ({ questionId, answer }));
      const res = await fetch('/api/pap-account/submit', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ patientName: responses['pap1'] || '', dob: responses['pap5'] || '', responses: apiResponses, sendTo: sendTo.trim() || undefined }),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json();
      setSuccess(data.emailed
        ? (lang === 'en' ? `Form emailed to ${sendTo} successfully!` : `Formulario enviado a ${sendTo} exitosamente!`)
        : (lang === 'en' ? 'Form submitted successfully!' : 'Formulario enviado exitosamente!'));
    } catch (err) { setError(err instanceof Error ? err.message : 'Submission failed'); }
    finally { setSubmitting(false); }
  };

  const handleClear = () => {
    if (window.confirm(lang === 'en' ? 'Clear all responses?' : '¿Borrar todas las respuestas?')) {
      setResponses({}); setSuccess(''); setError('');
      if (patientName) sessionStorage.removeItem(storageKey(patientName));
    }
  };

  const translateGroup = (group: string): string => {
    const map: Record<string, string> = { 'Demographics': 'Datos Demográficos', 'Insurance': 'Seguro', 'Clinical Information': 'Información Clínica', 'PAP Details': 'Detalles de PAP/máquina' };
    return map[group] || group;
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ums-text-muted)' }}>Loading form...</div>;
  if (fetchError) return <div style={sty.error}>Failed to load form: {fetchError}</div>;

  return (
    <div style={sty.container}>
      <style>{`
        .pap-section:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        .pap-section-body { transition: max-height 0.3s ease, opacity 0.3s ease; overflow: hidden; }
        .pap-section-body.collapsed { max-height: 0 !important; opacity: 0; padding: 0 16px !important; }
        .pap-section-body.expanded { max-height: 2000px; opacity: 1; }
        @media (max-width: 768px) { .pap-header-wrap { flex-direction: column !important; align-items: flex-start !important; } }
      `}</style>
      <div style={sty.header}>
        <h2 style={sty.headerTitle}>{lang === 'en' ? 'PAP Account Creation' : 'Creación de Cuenta PAP'}</h2>
        <div style={sty.langToggle}>
          <button type="button" style={langBtn(lang === 'en')} onClick={() => setLang('en')}>EN</button>
          <button type="button" style={langBtn(lang === 'es')} onClick={() => setLang('es')}>ES</button>
        </div>
      </div>

      <div style={sty.progressRing}>
        <svg width="60" height="60" viewBox="0 0 60 60">
          <circle cx="30" cy="30" r="25" fill="none" stroke="var(--ums-border)" strokeWidth="5" />
          <circle cx="30" cy="30" r="25" fill="none"
            stroke={progressPct < 25 ? 'var(--ums-text-placeholder)' : progressPct < 75 ? 'var(--ums-warning)' : 'var(--ums-success)'}
            strokeWidth="5" strokeLinecap="round"
            strokeDasharray={`${progressPct * 1.5708} 157.08`}
            transform="rotate(-90 30 30)"
            style={{ transition: 'stroke-dasharray 0.4s ease, stroke 0.3s ease' }} />
          <text x="30" y="34" textAnchor="middle" fontSize="14" fontWeight="700" fill="var(--ums-text-primary)">{progressPct}%</text>
        </svg>
        <div style={sty.progressRingText}>{answeredCount} / {totalRequired} {lang === 'en' ? 'required fields' : 'campos obligatorios'}</div>
      </div>

      {groups.map(group => {
        const isCollapsed = collapsed[group] ?? false;
        const comp = sectionCompletion[group] || { answered: 0, total: 0 };
        const badgeColor = comp.total === 0 ? '#dee2e6' : comp.answered === comp.total ? '#28a745' : comp.answered > 0 ? '#ffc107' : '#dee2e6';
        const groupTitle = lang === 'en' ? group : translateGroup(group);

        return (
          <div key={group} className="pap-section" style={sty.section}>
            <div style={sty.sectionHeader} onClick={() => toggleSection(group)}>
              <h3 style={sty.sectionTitle}>{groupTitle}</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {comp.total > 0 && (
                  <span style={{ ...sty.completionBadge, background: badgeColor, color: badgeColor === '#dee2e6' ? 'var(--ums-text-muted)' : '#fff' }}>
                    {comp.answered}/{comp.total}
                  </span>
                )}
                <span style={{ fontSize: 14, color: 'var(--ums-text-muted)', transition: 'transform 0.3s', transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}>{'\u25B6'}</span>
              </div>
            </div>
            <div className={`pap-section-body ${isCollapsed ? 'collapsed' : 'expanded'}`} style={sty.sectionBody}>
                {group === 'Insurance' && (
                  <InsuranceCardUpload
                    lang={lang}
                    enteredInsurance={responses['pap7']}
                    enteredMemberId={responses['pap7']?.split('#')?.pop()?.trim()}
                    enteredName={responses['pap1']}
                    enteredDob={responses['pap5']}
                    onFieldsExtracted={(fields) => {
                      if (fields.insuranceName && fields.memberId && !responses['pap7']) {
                        setResponse('pap7', `${fields.insuranceName} #${fields.memberId}`);
                      }
                      if (fields.subscriberName && !responses['pap1']) {
                        setResponse('pap1', fields.subscriberName);
                      }
                    }}
                  />
                )}
                {questions.filter(q => q.group === group).map(q => {
                  const label = lang === 'en' ? q.text : q.spanishText;
                  const val = responses[q.id] ?? '';
                  const fmt = q.conditionalFormatting && val ? q.conditionalFormatting[val] : undefined;

                  return (
                    <div key={q.id} style={sty.questionRow}>
                      <label style={q.isSecondary ? sty.secondaryLabel : sty.questionLabel}>
                        {q.number}. {label}
                        {q.required && <span style={{ color: '#dc3545', marginLeft: 3 }}>*</span>}
                      </label>
                      {q.type === 'text' && (
                        <input style={sty.textInput} value={val} onChange={e => setResponse(q.id, e.target.value)} />
                      )}
                      {q.type === 'textarea' && (
                        <textarea style={sty.textarea} value={val} onChange={e => setResponse(q.id, e.target.value)} />
                      )}
                      {q.type === 'select' && q.options && (
                        <div>
                          <select style={sty.selectInput} value={val} onChange={e => setResponse(q.id, e.target.value)}>
                            <option value="">{lang === 'en' ? '-- Select --' : '-- Seleccionar --'}</option>
                            {q.options.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                          {fmt && val && (
                            <span style={{ ...sty.conditionalBadge, background: fmt.bgColor, color: fmt.textColor, marginLeft: 8, marginTop: 4 }}>
                              {val}
                            </span>
                          )}
                        </div>
                      )}
                      {q.type === 'checkbox' && (
                        <div style={sty.checkboxRow} onClick={() => setResponse(q.id, val === 'true' ? 'false' : 'true')}>
                          <input type="checkbox" checked={val === 'true'} readOnly style={sty.checkbox} />
                          <span style={{ fontSize: 13, color: val === 'true' ? '#155724' : 'var(--ums-text-muted)' }}>
                            {val === 'true' ? (lang === 'en' ? 'Yes / Confirmed' : 'Sí / Confirmado') : (lang === 'en' ? 'Not confirmed' : 'No confirmado')}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        );
      })}

      <div style={sty.actionBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>{lang === 'en' ? 'Email to:' : 'Enviar a:'}</label>
          <input style={sty.emailInput} placeholder={lang === 'en' ? 'email@example.com (optional)' : 'email@ejemplo.com (opcional)'} value={sendTo} onChange={e => setSendTo(e.target.value)} />
        </div>
        <button type="button" style={submitting ? sty.submitBtnDisabled : sty.submitBtn} disabled={submitting} onClick={handleSubmit}>
          {submitting ? (lang === 'en' ? 'Submitting...' : 'Enviando...') : (lang === 'en' ? (sendTo.trim() ? 'Submit & Email' : 'Submit') : (sendTo.trim() ? 'Enviar por Email' : 'Enviar'))}
        </button>
        <button type="button" style={sty.clearBtn} onClick={handleClear}>{lang === 'en' ? 'Clear Form' : 'Borrar'}</button>
      </div>

      {error && <div style={sty.error}>{error}</div>}
      {success && <div style={sty.success}>{success}</div>}
    </div>
  );
}
