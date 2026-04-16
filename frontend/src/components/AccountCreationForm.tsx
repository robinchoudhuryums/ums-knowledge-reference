/**
 * AccountCreationForm — PMD Order Creation form for sales reps.
 * Collects patient demographics, insurance, clinical info, and scheduling
 * to determine if a PMD order can be initiated.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { InsuranceCardUpload } from './InsuranceCardUpload';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { useFormDraft } from '../hooks/useFormDraft';
import { FormDraftBanner } from './FormDraftBanner';
import type { FormDraft } from '../services/api';

interface AcQuestion {
  id: string;
  number: string;
  text: string;
  spanishText: string;
  type: 'text' | 'checkbox' | 'textarea';
  group: string;
  required: boolean;
  isSecondary?: boolean;
}

type Lang = 'en' | 'es';

import { getCsrfToken } from '../services/api';
function getCsrf(): string { return getCsrfToken() || ''; }

function storageKey(patient: string): string {
  return `ac_responses_${patient.replace(/\s+/g, '_').toLowerCase()}`;
}

// ── Styles ────────────────────────────────────────────────────────────

const sty = {
  container: { padding: 20, maxWidth: 900, margin: '0 auto', fontFamily: 'system-ui, sans-serif' } as React.CSSProperties,
  header: { background: 'linear-gradient(135deg, #223b5d, #1565c0)', color: '#fff', padding: '16px 20px', borderRadius: 10, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' as const, gap: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.15)' } as React.CSSProperties,
  headerTitle: { margin: 0, fontSize: 20, fontWeight: 600 } as React.CSSProperties,
  patientInput: { padding: '8px 12px', borderRadius: 6, border: 'none', fontSize: 14, width: 260, outline: 'none' } as React.CSSProperties,
  langToggle: { display: 'flex', gap: 0, borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.5)' } as React.CSSProperties,
  section: { border: '1px solid var(--ums-border)', borderRadius: 10, marginBottom: 14, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', transition: 'all 0.3s ease', background: 'var(--ums-bg-glass)', backdropFilter: 'blur(12px)' } as React.CSSProperties,
  sectionHeader: { background: 'var(--ums-bg-glass-header)', padding: '12px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', userSelect: 'none' as const, transition: 'background 0.2s', borderBottom: '1px solid var(--ums-border-light)' } as React.CSSProperties,
  sectionTitle: { margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--ums-text-primary)' } as React.CSSProperties,
  sectionBody: { padding: '14px 16px', transition: 'max-height 0.3s ease', overflow: 'hidden' } as React.CSSProperties,
  questionRow: { marginBottom: 10, padding: '12px 16px', background: 'var(--ums-bg-surface)', borderRadius: 8, border: '1px solid var(--ums-border)', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' } as React.CSSProperties,
  questionLabel: { display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 500, color: 'var(--ums-text-primary)' } as React.CSSProperties,
  secondaryLabel: { display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 400, fontStyle: 'italic' as const, color: 'var(--ums-text-muted)', paddingLeft: 16 } as React.CSSProperties,
  textInput: { padding: '8px 12px', borderRadius: 6, border: '1px solid var(--ums-border)', fontSize: 14, width: '100%', boxSizing: 'border-box' as const, transition: 'border-color 0.2s' } as React.CSSProperties,
  textarea: { padding: '8px 12px', borderRadius: 6, border: '1px solid var(--ums-border)', fontSize: 14, width: '100%', boxSizing: 'border-box' as const, minHeight: 70, resize: 'vertical' as const } as React.CSSProperties,
  checkboxRow: { display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' } as React.CSSProperties,
  checkbox: { width: 20, height: 20, accentColor: 'var(--ums-brand-primary)', cursor: 'pointer' } as React.CSSProperties,
  progressRing: { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16, padding: '12px 18px', background: 'var(--ums-bg-glass)', backdropFilter: 'blur(12px)', borderRadius: 10, border: '1px solid var(--ums-border)', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' } as React.CSSProperties,
  progressRingText: { fontSize: 13, color: 'var(--ums-text-muted)', fontWeight: 500 } as React.CSSProperties,
  completionBadge: { fontSize: 11, padding: '2px 8px', borderRadius: 10, fontWeight: 600 } as React.CSSProperties,
  actionBar: { display: 'flex', gap: 12, marginTop: 20, flexWrap: 'wrap' as const, alignItems: 'center' } as React.CSSProperties,
  submitBtn: { background: 'var(--ums-brand-primary)', color: '#fff', border: 'none', padding: '12px 28px', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
  submitBtnDisabled: { background: '#90b4d8', color: '#fff', border: 'none', padding: '12px 28px', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'not-allowed' } as React.CSSProperties,
  clearBtn: { background: 'var(--ums-bg-surface)', color: '#dc3545', border: '1px solid #dc3545', padding: '10px 20px', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: 'pointer' } as React.CSSProperties,
  emailInput: { padding: '8px 12px', borderRadius: 6, border: '1px solid var(--ums-border)', fontSize: 14, width: 280 } as React.CSSProperties,
  error: { background: '#f8d7da', color: '#721c24', padding: '10px 14px', borderRadius: 6, marginTop: 12 } as React.CSSProperties,
  success: { background: '#d4edda', color: '#155724', padding: '10px 14px', borderRadius: 6, marginTop: 12, fontWeight: 600 } as React.CSSProperties,
};

function langBtn(active: boolean): React.CSSProperties {
  return { padding: '6px 14px', cursor: 'pointer', border: 'none', background: active ? 'var(--ums-bg-surface)' : 'transparent', color: active ? '#223b5d' : '#fff', fontWeight: active ? 700 : 400, fontSize: 13 };
}

// ── Component ─────────────────────────────────────────────────────────

export function AccountCreationForm() {
  const [lang, setLang] = useState<Lang>('en');
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [questions, setQuestions] = useState<AcQuestion[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [fetchError, setFetchError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Warn user before leaving page if form has unsaved data
  useUnsavedChanges(Object.keys(responses).length > 0 && !success);
  const [sendTo, setSendTo] = useState('');

  // Fetch questions from API
  useEffect(() => {
    fetch('/api/account-creation/questions', { credentials: 'same-origin' })
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); })
      .then(data => { setQuestions(data.questions); setGroups(data.groups); setLoading(false); })
      .catch(err => { setFetchError(err.message); setLoading(false); });
  }, []);

  // Auto-save
  const patientName = responses['ac1'] || '';
  useEffect(() => {
    if (!patientName.trim()) return;
    sessionStorage.setItem(storageKey(patientName), JSON.stringify(responses));
  }, [responses, patientName]);

  // Load saved
  useEffect(() => {
    if (!patientName.trim()) return;
    const saved = sessionStorage.getItem(storageKey(patientName));
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed['ac1'] === patientName) setResponses(parsed);
      } catch { /* ignore */ }
    }
  }, [patientName]);

  const setResponse = useCallback((id: string, value: string) => {
    setResponses(prev => ({ ...prev, [id]: value }));
  }, []);

  const toggleSection = useCallback((id: string) => {
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  // Progress
  const requiredQuestions = useMemo(() => questions.filter(q => q.required), [questions]);
  const answeredCount = useMemo(() => {
    return requiredQuestions.filter(q => {
      const val = responses[q.id];
      return val !== undefined && val !== '' && val !== 'false';
    }).length;
  }, [responses, requiredQuestions]);
  const totalRequired = requiredQuestions.length;
  const progressPct = totalRequired > 0 ? Math.round((answeredCount / totalRequired) * 100) : 0;

  // Section completion
  const sectionCompletion = useMemo(() => {
    const result: Record<string, { answered: number; total: number }> = {};
    for (const group of groups) {
      const groupQs = questions.filter(q => q.group === group && q.required);
      const answered = groupQs.filter(q => {
        const v = responses[q.id]; return v !== undefined && v !== '' && v !== 'false';
      }).length;
      result[group] = { answered, total: groupQs.length };
    }
    return result;
  }, [responses, questions, groups]);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');
    setSuccess('');
    try {
      const csrf = getCsrf();
      const apiResponses = Object.entries(responses).map(([questionId, answer]) => ({ questionId, answer }));
      const res = await fetch('/api/account-creation/submit', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({
          patientName: responses['ac1'] || '',
          dob: responses['ac5'] || '',
          responses: apiResponses,
          sendTo: sendTo.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json();
      setSuccess(data.emailed
        ? (lang === 'en' ? `Form emailed to ${sendTo} successfully!` : `Formulario enviado a ${sendTo} exitosamente!`)
        : (lang === 'en' ? 'Form submitted successfully!' : 'Formulario enviado exitosamente!'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClear = () => {
    const msg = lang === 'en' ? 'Clear all responses? This cannot be undone.' : '¿Borrar todas las respuestas? Esto no se puede deshacer.';
    if (window.confirm(msg)) {
      setResponses({});
      setSuccess('');
      setError('');
      if (patientName) sessionStorage.removeItem(storageKey(patientName));
    }
  };

  // Server-side draft: complements sessionStorage for cross-device resume.
  const draftPayload = useMemo(
    () => ({ responses, lang, sendTo }),
    [responses, lang, sendTo],
  );
  const draft = useFormDraft({
    formType: 'pmd-account',
    payload: draftPayload,
    label: patientName.trim() || undefined,
    completionPercent: progressPct,
    enabled: patientName.trim().length > 0 && !success,
  });

  const handleResumeDraft = useCallback((rec: FormDraft) => {
    const p = rec.payload as {
      responses?: Record<string, string>;
      lang?: Lang;
      sendTo?: string;
    } | null;
    if (!p) return;
    if (p.responses && typeof p.responses === 'object') setResponses(p.responses);
    if (p.lang === 'en' || p.lang === 'es') setLang(p.lang);
    if (typeof p.sendTo === 'string') setSendTo(p.sendTo);
  }, []);

  const handleStartOverDraft = useCallback(async () => {
    await draft.discardCurrent();
    setResponses({});
    setSendTo('');
    setSuccess('');
    setError('');
    if (patientName) sessionStorage.removeItem(storageKey(patientName));
  }, [draft, patientName]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--ums-text-muted)' }}>Loading form...</div>;
  if (fetchError) return <div style={sty.error}>Failed to load form: {fetchError}</div>;

  return (
    <div style={sty.container}>
      <style>{`
        .ac-section:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        .ac-section-body { transition: max-height 0.3s ease, opacity 0.3s ease; overflow: hidden; }
        .ac-section-body.collapsed { max-height: 0 !important; opacity: 0; padding: 0 16px !important; }
        .ac-section-body.expanded { max-height: 2000px; opacity: 1; }
        @media (max-width: 768px) { .ac-header-wrap { flex-direction: column !important; align-items: flex-start !important; } }
      `}</style>
      {/* Header */}
      <div style={sty.header}>
        <h2 style={sty.headerTitle}>
          {lang === 'en' ? 'PMD Account Creation' : 'Creación de Cuenta PMD'}
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' as const }}>
          <div style={sty.langToggle}>
            <button type="button" style={langBtn(lang === 'en')} onClick={() => setLang('en')}>EN</button>
            <button type="button" style={langBtn(lang === 'es')} onClick={() => setLang('es')}>ES</button>
          </div>
        </div>
      </div>

      {/* Server-side draft status */}
      <FormDraftBanner
        formType="pmd-account"
        currentDraftId={draft.currentDraftId}
        lastSavedAt={draft.lastSavedAt}
        saving={draft.saving}
        error={draft.error}
        resume={draft.resume}
        onResume={handleResumeDraft}
        onStartOver={handleStartOverDraft}
        currentLabel={patientName.trim() || undefined}
      />

      {/* Progress ring */}
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
        <div style={sty.progressRingText}>
          {answeredCount} / {totalRequired} {lang === 'en' ? 'required fields' : 'campos obligatorios'}
        </div>
      </div>

      {/* Sections */}
      {groups.map(group => {
        const isCollapsed = collapsed[group] ?? false;
        const comp = sectionCompletion[group] || { answered: 0, total: 0 };
        const badgeColor = comp.total === 0 ? '#dee2e6' : comp.answered === comp.total ? '#28a745' : comp.answered > 0 ? '#ffc107' : '#dee2e6';
        const badgeText = comp.total === 0 ? '' : `${comp.answered}/${comp.total}`;
        const groupTitle = lang === 'en' ? group : translateGroup(group);

        return (
          <div key={group} className="ac-section" style={sty.section}>
            <div style={sty.sectionHeader} onClick={() => toggleSection(group)}>
              <h3 style={sty.sectionTitle}>{groupTitle}</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {badgeText && (
                  <span style={{ ...sty.completionBadge, background: badgeColor, color: badgeColor === '#dee2e6' ? 'var(--ums-text-muted)' : '#fff' }}>
                    {badgeText}
                  </span>
                )}
                <span style={{ fontSize: 14, color: 'var(--ums-text-muted)', transition: 'transform 0.3s', transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}>{'\u25B6'}</span>
              </div>
            </div>
            <div className={`ac-section-body ${isCollapsed ? 'collapsed' : 'expanded'}`} style={sty.sectionBody}>
              {group === 'Insurance' && (
                <InsuranceCardUpload
                  lang={lang}
                  enteredInsurance={responses['ac7']}
                  enteredMemberId={responses['ac7']?.split('#')?.pop()?.trim()}
                  enteredName={responses['ac1']}
                  enteredDob={responses['ac5']}
                  onFieldsExtracted={(fields) => {
                    if (fields.insuranceName && fields.memberId && !responses['ac7']) {
                      setResponse('ac7', `${fields.insuranceName} #${fields.memberId}`);
                    }
                    if (fields.subscriberName && !responses['ac1']) {
                      setResponse('ac1', fields.subscriberName);
                    }
                  }}
                />
              )}
              {questions.filter(q => q.group === group).map(q => {
                  const label = lang === 'en' ? q.text : q.spanishText;
                  const val = responses[q.id] ?? '';
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

      {/* Actions */}
      <div style={sty.actionBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 14, fontWeight: 600 }}>{lang === 'en' ? 'Email to:' : 'Enviar a:'}</label>
          <input
            style={sty.emailInput}
            placeholder={lang === 'en' ? 'email@example.com (optional)' : 'email@ejemplo.com (opcional)'}
            value={sendTo}
            onChange={e => setSendTo(e.target.value)}
          />
        </div>
        <button
          type="button"
          style={submitting ? sty.submitBtnDisabled : sty.submitBtn}
          disabled={submitting}
          onClick={handleSubmit}
        >
          {submitting
            ? (lang === 'en' ? 'Submitting...' : 'Enviando...')
            : (lang === 'en' ? (sendTo.trim() ? 'Submit & Email' : 'Submit') : (sendTo.trim() ? 'Enviar por Email' : 'Enviar'))}
        </button>
        <button type="button" style={sty.clearBtn} onClick={handleClear}>
          {lang === 'en' ? 'Clear Form' : 'Borrar'}
        </button>
      </div>

      {error && <div style={sty.error}>{error}</div>}
      {success && <div style={sty.success}>{success}</div>}
    </div>
  );
}

function translateGroup(group: string): string {
  const map: Record<string, string> = {
    'Demographics': 'Información del Paciente',
    'Insurance': 'Información del Seguro',
    'Clinical Information': 'Información Clínica',
    'Mobility Evaluation & Scheduling': 'Evaluación de Movilidad y Programación',
  };
  return map[group] || group;
}
