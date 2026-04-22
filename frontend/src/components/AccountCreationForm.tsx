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
import { getCsrfToken, type FormDraft } from '../services/api';
import {
  ActionBar,
  CheckboxQuestion,
  ErrorBanner,
  FormHeader,
  GroupSection,
  ProgressRing,
  QuestionRow,
  SuccessBanner,
  TextQuestion,
  TextareaQuestion,
} from './AccountFormShared';

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

function storageKey(patient: string): string {
  return `ac_responses_${patient.replace(/\s+/g, '_').toLowerCase()}`;
}

function getCsrf(): string {
  return getCsrfToken() || '';
}

function translateGroup(group: string): string {
  const map: Record<string, string> = {
    Demographics: 'Información del Paciente',
    Insurance: 'Información del Seguro',
    'Clinical Information': 'Información Clínica',
    'Mobility Evaluation & Scheduling': 'Evaluación de Movilidad y Programación',
  };
  return map[group] || group;
}

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
  const [sendTo, setSendTo] = useState('');

  // Warn before leaving if there's unsaved data.
  useUnsavedChanges(Object.keys(responses).length > 0 && !success);

  useEffect(() => {
    fetch('/api/account-creation/questions', { credentials: 'same-origin' })
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((data) => {
        setQuestions(data.questions);
        setGroups(data.groups);
        setLoading(false);
      })
      .catch((err) => {
        setFetchError(err.message);
        setLoading(false);
      });
  }, []);

  const patientName = responses['ac1'] || '';

  // Auto-save to sessionStorage (keyed by patient name for per-patient resume).
  useEffect(() => {
    if (!patientName.trim()) return;
    sessionStorage.setItem(storageKey(patientName), JSON.stringify(responses));
  }, [responses, patientName]);

  // Load saved on patient-name change.
  useEffect(() => {
    if (!patientName.trim()) return;
    const saved = sessionStorage.getItem(storageKey(patientName));
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed['ac1'] === patientName) setResponses(parsed);
      } catch {
        /* ignore corrupt storage */
      }
    }
  }, [patientName]);

  const setResponse = useCallback((id: string, value: string) => {
    setResponses((prev) => ({ ...prev, [id]: value }));
  }, []);

  const toggleSection = useCallback((id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const requiredQuestions = useMemo(
    () => questions.filter((q) => q.required),
    [questions],
  );
  const answeredCount = useMemo(
    () =>
      requiredQuestions.filter((q) => {
        const val = responses[q.id];
        return val !== undefined && val !== '' && val !== 'false';
      }).length,
    [responses, requiredQuestions],
  );
  const totalRequired = requiredQuestions.length;
  const progressPct =
    totalRequired > 0 ? Math.round((answeredCount / totalRequired) * 100) : 0;

  const sectionCompletion = useMemo(() => {
    const result: Record<string, { answered: number; total: number }> = {};
    for (const group of groups) {
      const groupQs = questions.filter((q) => q.group === group && q.required);
      const answered = groupQs.filter((q) => {
        const v = responses[q.id];
        return v !== undefined && v !== '' && v !== 'false';
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
      const apiResponses = Object.entries(responses).map(([questionId, answer]) => ({
        questionId,
        answer,
      }));
      const res = await fetch('/api/account-creation/submit', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': getCsrf(),
        },
        body: JSON.stringify({
          patientName: responses['ac1'] || '',
          dob: responses['ac5'] || '',
          responses: apiResponses,
          sendTo: sendTo.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json();
      setSuccess(
        data.emailed
          ? lang === 'en'
            ? `Form emailed to ${sendTo} successfully!`
            : `Formulario enviado a ${sendTo} exitosamente!`
          : lang === 'en'
            ? 'Form submitted successfully!'
            : 'Formulario enviado exitosamente!',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClear = () => {
    const msg =
      lang === 'en'
        ? 'Clear all responses? This cannot be undone.'
        : '¿Borrar todas las respuestas? Esto no se puede deshacer.';
    if (window.confirm(msg)) {
      setResponses({});
      setSuccess('');
      setError('');
      if (patientName) sessionStorage.removeItem(storageKey(patientName));
    }
  };

  // Server-side draft (complements sessionStorage for cross-device resume).
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

  if (loading)
    return (
      <div className="p-10 text-center text-[13px] text-muted-foreground">
        Loading form…
      </div>
    );
  if (fetchError) return <ErrorBanner message={`Failed to load form: ${fetchError}`} />;

  return (
    <div className="mx-auto max-w-3xl px-4 py-5 sm:px-7">
      <FormHeader
        kicker="PMD"
        title={lang === 'en' ? 'PMD Account Creation' : 'Creación de Cuenta PMD'}
        lang={lang}
        onLangChange={setLang}
      />

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

      <ProgressRing
        percent={progressPct}
        answered={answeredCount}
        total={totalRequired}
        lang={lang}
      />

      {groups.map((group) => {
        const isCollapsed = collapsed[group] ?? false;
        const comp = sectionCompletion[group] || { answered: 0, total: 0 };
        const groupTitle = lang === 'en' ? group : translateGroup(group);

        return (
          <GroupSection
            key={group}
            title={groupTitle}
            completedCount={comp.answered}
            totalCount={comp.total}
            collapsed={isCollapsed}
            onToggle={() => toggleSection(group)}
          >
            {group === 'Insurance' && (
              <div className="mb-3">
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
              </div>
            )}
            {questions
              .filter((q) => q.group === group)
              .map((q) => {
                const label = lang === 'en' ? q.text : q.spanishText;
                const val = responses[q.id] ?? '';
                return (
                  <QuestionRow
                    key={q.id}
                    number={q.number}
                    label={label}
                    required={q.required}
                    isSecondary={q.isSecondary}
                  >
                    {q.type === 'text' && (
                      <TextQuestion
                        value={val}
                        onChange={(v) => setResponse(q.id, v)}
                      />
                    )}
                    {q.type === 'textarea' && (
                      <TextareaQuestion
                        value={val}
                        onChange={(v) => setResponse(q.id, v)}
                      />
                    )}
                    {q.type === 'checkbox' && (
                      <CheckboxQuestion
                        value={val}
                        onChange={(v) => setResponse(q.id, v)}
                        lang={lang}
                      />
                    )}
                  </QuestionRow>
                );
              })}
          </GroupSection>
        );
      })}

      <ActionBar
        sendTo={sendTo}
        onSendToChange={setSendTo}
        onSubmit={handleSubmit}
        onClear={handleClear}
        submitting={submitting}
        lang={lang}
      />

      {error && <ErrorBanner message={error} />}
      {success && <SuccessBanner message={success} />}
    </div>
  );
}
