/**
 * PpdQuestionnaire — PPD (Patient Provided Data) questionnaire for DME agents
 * conducting phone interviews with patients for Power Mobility Device orders.
 *
 * Questions are fetched from the API (GET /api/ppd/questions) rather than hardcoded.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import DOMPurify from 'dompurify';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';
import { useFormDraft } from '../hooks/useFormDraft';
import { FormDraftBanner } from './FormDraftBanner';
import { getCsrfToken, type FormDraft } from '../services/api';
import {
  type ApiQuestion,
  type Lang,
  type RecommendApiResponse,
  type RecommendationProduct,
  storageKey,
} from './PpdQuestionnaireShared';
import { PpdQuestionnaireRow } from './PpdQuestionnaireRow';
import { PpdQuestionnairePainGrid } from './PpdQuestionnairePainGrid';
import { PpdQuestionnaireProductCard } from './PpdQuestionnaireProductCard';

function getCsrf(): string {
  return getCsrfToken() || '';
}

function CompletionBadge({ done, total }: { done: number; total: number }) {
  const tone =
    done === total && total > 0
      ? { bg: 'var(--sage)', fg: 'var(--card)' }
      : done > 0
        ? { bg: 'var(--amber)', fg: 'var(--card)' }
        : { bg: 'var(--muted)', fg: 'var(--muted-foreground)' };
  return (
    <span
      className="inline-flex items-center rounded-sm px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums"
      style={{ background: tone.bg, color: tone.fg }}
    >
      {done}/{total}
    </span>
  );
}

export function PpdQuestionnaire() {
  const [lang, setLang] = useState<Lang>('en');
  const [patientInfo, setPatientInfo] = useState('');
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [recommendations, setRecommendations] = useState<{
    complexRehab: RecommendationProduct[];
    standard: RecommendationProduct[];
  } | null>(null);
  const [preferred, setPreferred] = useState('');
  const [productStatus, setProductStatus] = useState<Record<string, string>>({});
  const [copiedId, setCopiedId] = useState('');
  const [seatingEvalHtml, setSeatingEvalHtml] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState('');
  const [evalLoading, setEvalLoading] = useState(false);
  const [questions, setQuestions] = useState<ApiQuestion[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(true);
  const [questionsError, setQuestionsError] = useState('');

  useUnsavedChanges(Object.keys(responses).length > 0 && !recommendations);

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
    return () => {
      cancelled = true;
    };
  }, []);

  const groupedQuestions = useMemo(() => {
    const map = new Map<string, ApiQuestion[]>();
    for (const q of questions) {
      const list = map.get(q.group) || [];
      list.push(q);
      map.set(q.group, list);
    }
    return map;
  }, [questions]);

  const requiredQuestions = useMemo(
    () => questions.filter((q) => q.required && !q.subQuestionOf),
    [questions],
  );

  useEffect(() => {
    if (!patientInfo.trim()) return;
    const saved = sessionStorage.getItem(storageKey(patientInfo));
    if (saved) {
      try {
        setResponses(JSON.parse(saved));
      } catch {
        /* ignore corrupt data */
      }
    }
  }, [patientInfo]);

  useEffect(() => {
    if (!patientInfo.trim()) return;
    sessionStorage.setItem(storageKey(patientInfo), JSON.stringify(responses));
  }, [responses, patientInfo]);

  const setResponse = useCallback((id: string, value: string) => {
    setResponses((prev) => ({ ...prev, [id]: value }));
  }, []);

  const toggleSection = useCallback((id: string) => {
    setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const isVisible = useCallback(
    (q: ApiQuestion): boolean => {
      if (!q.subQuestionOf || !q.showWhen) return true;
      const parentVal = responses[q.subQuestionOf] ?? '';
      return (
        parentVal.toLowerCase() === q.showWhen.toLowerCase() ||
        (parentVal.toLowerCase() === 'yes' && q.showWhen === 'Yes')
      );
    },
    [responses],
  );

  const answeredCount = useMemo(
    () =>
      requiredQuestions.filter((q) => {
        const val = responses[q.id];
        return val !== undefined && val !== '';
      }).length,
    [responses, requiredQuestions],
  );
  const totalRequired = requiredQuestions.length;
  const progressPct =
    totalRequired > 0 ? Math.round((answeredCount / totalRequired) * 100) : 0;

  const sectionCounts = useMemo(() => {
    const result: Record<string, { answered: number; total: number }> = {};
    for (const group of groups) {
      const qs = groupedQuestions.get(group) || [];
      const visibleQs = qs.filter((q) => !q.subQuestionOf || isVisible(q));
      const answered = visibleQs.filter((q) => {
        const val = responses[q.id];
        return val !== undefined && val !== '';
      }).length;
      result[group] = { answered, total: visibleQs.length };
    }
    return result;
  }, [groups, groupedQuestions, responses, isVisible]);

  const handleClearForm = useCallback(() => {
    const msg =
      lang === 'en'
        ? 'Clear all responses? This cannot be undone.'
        : '¿Borrar todas las respuestas? Esto no se puede deshacer.';
    if (!window.confirm(msg)) return;
    setResponses({});
    setRecommendations(null);
    setSeatingEvalHtml('');
    setSubmitSuccess('');
    setError('');
    setPreferred('');
    setProductStatus({});
    if (patientInfo.trim()) sessionStorage.removeItem(storageKey(patientInfo));
  }, [lang, patientInfo]);

  const formatApiResponses = useCallback(
    () => Object.entries(responses).map(([questionId, answer]) => ({ questionId, answer })),
    [responses],
  );

  const draftPayload = useMemo(
    () => ({ patientInfo, responses, lang, preferred, productStatus }),
    [patientInfo, responses, lang, preferred, productStatus],
  );
  const draft = useFormDraft({
    formType: 'ppd',
    payload: draftPayload,
    label: patientInfo.trim() || undefined,
    completionPercent: progressPct,
    enabled: patientInfo.trim().length > 0 && !recommendations,
  });

  const handleResumeDraft = useCallback((rec: FormDraft) => {
    const p = rec.payload as {
      patientInfo?: string;
      responses?: Record<string, string>;
      lang?: Lang;
      preferred?: string;
      productStatus?: Record<string, string>;
    } | null;
    if (!p) return;
    if (typeof p.patientInfo === 'string') setPatientInfo(p.patientInfo);
    if (p.responses && typeof p.responses === 'object') setResponses(p.responses);
    if (p.lang === 'en' || p.lang === 'es') setLang(p.lang);
    if (typeof p.preferred === 'string') setPreferred(p.preferred);
    if (p.productStatus && typeof p.productStatus === 'object')
      setProductStatus(p.productStatus);
  }, []);

  const handleStartOverDraft = useCallback(async () => {
    await draft.discardCurrent();
    setResponses({});
    setRecommendations(null);
    setSeatingEvalHtml('');
    setSubmitSuccess('');
    setError('');
    setPreferred('');
    setProductStatus({});
    if (patientInfo.trim()) sessionStorage.removeItem(storageKey(patientInfo));
    setPatientInfo('');
  }, [draft, patientInfo]);

  const handleSubmit = async () => {
    setLoading(true);
    setError('');
    setRecommendations(null);
    try {
      const res = await fetch('/api/ppd/recommend', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': getCsrf() },
        body: JSON.stringify({
          patientInfo,
          responses: formatApiResponses(),
          language: lang === 'en' ? 'english' : 'spanish',
        }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || `Request failed (${res.status})`);
      }
      const data: RecommendApiResponse = await res.json();
      setRecommendations({
        complexRehab: data.recommendations.filter((r) => r.category === 'complex-rehab'),
        standard: data.recommendations.filter((r) => r.category === 'standard'),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get recommendations');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateEval = async () => {
    if (!recommendations) return;
    setEvalLoading(true);
    setSeatingEvalHtml('');
    try {
      const allRecs = [...recommendations.complexRehab, ...recommendations.standard];
      const res = await fetch('/api/ppd/seating-eval', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': getCsrf() },
        body: JSON.stringify({
          patientInfo,
          responses: formatApiResponses(),
          recommendations: allRecs,
        }),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json();
      setSeatingEvalHtml(data.html);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate seating evaluation');
    } finally {
      setEvalLoading(false);
    }
  };

  const handleSubmitQueue = async () => {
    if (!recommendations) return;
    setSubmitting(true);
    setSubmitSuccess('');
    try {
      const allRecs = [...recommendations.complexRehab, ...recommendations.standard];
      const res = await fetch('/api/ppd/submit', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': getCsrf() },
        body: JSON.stringify({
          patientInfo,
          responses: formatApiResponses(),
          recommendations: allRecs,
          productSelections: productStatus,
          language: lang === 'en' ? 'english' : 'spanish',
        }),
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      setSubmitSuccess(
        lang === 'en'
          ? 'PPD submitted to Pre-Appointment Kit queue.'
          : 'PPD enviado a la cola del Kit de Pre-Cita.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit PPD');
    } finally {
      setSubmitting(false);
    }
  };

  const onCopied = (id: string) => {
    setCopiedId(id);
    setTimeout(() => setCopiedId(''), 2000);
  };

  if (questionsLoading) {
    return (
      <div className="p-10 text-center text-[13px] text-muted-foreground">
        {lang === 'en' ? 'Loading questionnaire…' : 'Cargando cuestionario…'}
      </div>
    );
  }
  if (questionsError) {
    return (
      <div
        role="alert"
        className="mx-auto mt-6 max-w-3xl rounded-sm border px-3 py-2 text-[13px]"
        style={{
          background: 'var(--warm-red-soft)',
          borderColor: 'var(--warm-red)',
          color: 'var(--warm-red)',
        }}
      >
        {questionsError}
      </div>
    );
  }

  const progressStroke =
    progressPct < 25
      ? 'var(--muted-foreground)'
      : progressPct < 75
        ? 'var(--amber)'
        : 'var(--sage)';

  return (
    <div className="mx-auto max-w-3xl px-4 py-5 sm:px-7">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div
            className="font-mono uppercase text-muted-foreground"
            style={{ fontSize: 10, letterSpacing: '0.14em' }}
          >
            PPD
          </div>
          <h2
            className="mt-1 font-display font-medium text-foreground"
            style={{ fontSize: 22, lineHeight: 1.15, letterSpacing: '-0.4px' }}
          >
            {lang === 'en'
              ? 'PPD questionnaire — Power mobility'
              : 'Cuestionario PPD — Movilidad eléctrica'}
          </h2>
        </div>
        <div className="inline-flex rounded-sm border border-border bg-card p-0.5">
          {(['en', 'es'] as const).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              aria-pressed={lang === l}
              className={cn(
                'rounded-sm px-3 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors',
                lang === l
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Patient info */}
      <div className="mb-3">
        <Input
          type="text"
          placeholder={
            lang === 'en' ? 'Patient name — Trx#' : 'Nombre del paciente — Trx#'
          }
          value={patientInfo}
          onChange={(e) => setPatientInfo(e.target.value)}
          // S2-6: bound input so sessionStorage key cannot be ballooned.
          maxLength={200}
          className="max-w-md"
        />
      </div>

      <FormDraftBanner
        formType="ppd"
        currentDraftId={draft.currentDraftId}
        lastSavedAt={draft.lastSavedAt}
        saving={draft.saving}
        error={draft.error}
        resume={draft.resume}
        onResume={handleResumeDraft}
        onStartOver={handleStartOverDraft}
        currentLabel={patientInfo.trim() || undefined}
      />

      {/* Progress ring */}
      <div className="mb-4 flex items-center gap-3.5 rounded-sm border border-border bg-card p-3 shadow-sm">
        <svg width="60" height="60" viewBox="0 0 60 60">
          <circle cx="30" cy="30" r="25" fill="none" stroke="var(--border)" strokeWidth="5" />
          <circle
            cx="30"
            cy="30"
            r="25"
            fill="none"
            stroke={progressStroke}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={`${progressPct * 1.5708} 157.08`}
            transform="rotate(-90 30 30)"
            style={{ transition: 'stroke-dasharray 0.4s ease, stroke 0.3s ease' }}
          />
          <text
            x="30"
            y="34"
            textAnchor="middle"
            fontSize="14"
            fontWeight="700"
            fill="var(--foreground)"
          >
            {progressPct}%
          </text>
        </svg>
        <div className="text-[13px] font-medium text-muted-foreground">
          {answeredCount} / {totalRequired}{' '}
          {lang === 'en'
            ? 'required questions answered'
            : 'preguntas obligatorias respondidas'}
        </div>
      </div>

      {/* Group sections */}
      {groups.map((group) => {
        const qs = groupedQuestions.get(group) || [];
        if (qs.length === 0) return null;
        const isCollapsed = collapsed[group] ?? false;
        const counts = sectionCounts[group] || { answered: 0, total: 0 };
        const isPainGroup = group === 'Consistent Pain';

        return (
          <div
            key={group}
            className="mb-3.5 overflow-hidden rounded-sm border border-border bg-card shadow-sm transition-shadow hover:shadow-md"
          >
            <button
              type="button"
              onClick={() => toggleSection(group)}
              aria-expanded={!isCollapsed}
              className="flex w-full cursor-pointer select-none items-center justify-between border-b border-border bg-muted px-4 py-3 text-left transition-colors hover:bg-[var(--copper-soft)]"
            >
              <h3 className="m-0 text-[15px] font-semibold text-foreground">{group}</h3>
              <div className="flex items-center gap-2">
                {counts.total > 0 && (
                  <CompletionBadge done={counts.answered} total={counts.total} />
                )}
                <ChevronRightIcon
                  className={cn(
                    'h-4 w-4 text-muted-foreground transition-transform',
                    !isCollapsed && 'rotate-90',
                  )}
                />
              </div>
            </button>
            {!isCollapsed && (
              <div className="px-4 py-3">
                {isPainGroup ? (
                  <PpdQuestionnairePainGrid
                    questions={qs}
                    responses={responses}
                    lang={lang}
                    onChange={setResponse}
                  />
                ) : (
                  qs
                    .filter((q) => isVisible(q))
                    .map((q) => (
                      <PpdQuestionnaireRow
                        key={q.id}
                        question={q}
                        value={responses[q.id] ?? ''}
                        lang={lang}
                        onChange={setResponse}
                      />
                    ))
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Action bar (recommend / clear) */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button type="button" onClick={handleSubmit} disabled={loading}>
          {loading
            ? lang === 'en'
              ? 'Getting recommendations…'
              : 'Obteniendo recomendaciones…'
            : lang === 'en'
              ? 'Get recommendations'
              : 'Obtener recomendaciones'}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handleClearForm}
          style={{ borderColor: 'var(--warm-red)', color: 'var(--warm-red)' }}
        >
          {lang === 'en' ? 'Clear form' : 'Borrar'}
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-3 rounded-sm border px-3 py-2 text-[13px]"
          style={{
            background: 'var(--warm-red-soft)',
            borderColor: 'var(--warm-red)',
            color: 'var(--warm-red)',
          }}
        >
          {error}
        </div>
      )}

      {/* Recommendations */}
      {recommendations && (
        <div className="mt-6">
          {recommendations.complexRehab.length > 0 && (
            <>
              <h3
                className="mb-3 rounded-sm px-3 py-2 text-[14px] font-semibold"
                style={{ background: 'var(--warm-red-soft)', color: 'var(--warm-red)' }}
              >
                {lang === 'en'
                  ? 'Complex rehab technology (CRT)'
                  : 'Tecnología de rehabilitación compleja (CRT)'}
              </h3>
              {recommendations.complexRehab.map((p, i) => (
                <PpdQuestionnaireProductCard
                  key={`crt_${i}`}
                  product={p}
                  idx={i}
                  lang={lang}
                  preferred={preferred}
                  onPreferredChange={setPreferred}
                  productStatus={productStatus}
                  onStatusChange={(k, v) => setProductStatus((prev) => ({ ...prev, [k]: v }))}
                  copiedId={copiedId}
                  onCopied={onCopied}
                />
              ))}
            </>
          )}
          {recommendations.standard.length > 0 && (
            <>
              <h3
                className="mb-3 mt-5 rounded-sm px-3 py-2 text-[14px] font-semibold"
                style={{ background: 'var(--copper-soft)', color: 'var(--accent)' }}
              >
                {lang === 'en'
                  ? 'Standard power mobility'
                  : 'Movilidad eléctrica estándar'}
              </h3>
              {recommendations.standard.map((p, i) => (
                <PpdQuestionnaireProductCard
                  key={`std_${i}`}
                  product={p}
                  idx={i}
                  lang={lang}
                  preferred={preferred}
                  onPreferredChange={setPreferred}
                  productStatus={productStatus}
                  onStatusChange={(k, v) => setProductStatus((prev) => ({ ...prev, [k]: v }))}
                  copiedId={copiedId}
                  onCopied={onCopied}
                />
              ))}
            </>
          )}
          {recommendations.complexRehab.length === 0 &&
            recommendations.standard.length === 0 && (
              <div className="rounded-sm border border-border bg-card p-4 text-center text-[13px] text-muted-foreground">
                {lang === 'en'
                  ? 'No recommendations returned. Please review your responses.'
                  : 'No se devolvieron recomendaciones. Revise sus respuestas.'}
              </div>
            )}

          {/* Eval + submit */}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              onClick={handleGenerateEval}
              disabled={evalLoading}
              style={{ background: 'var(--sage)', color: 'var(--card)' }}
            >
              {evalLoading
                ? lang === 'en'
                  ? 'Generating…'
                  : 'Generando…'
                : lang === 'en'
                  ? 'Generate seating evaluation'
                  : 'Generar evaluación de asiento'}
            </Button>
            <Button type="button" onClick={handleSubmitQueue} disabled={submitting}>
              {submitting
                ? lang === 'en'
                  ? 'Submitting…'
                  : 'Enviando…'
                : lang === 'en'
                  ? 'Submit to queue'
                  : 'Enviar a cola'}
            </Button>
          </div>

          {submitSuccess && (
            <div
              role="status"
              className="mt-3 rounded-sm border px-3 py-2 text-[13px] font-semibold"
              style={{
                background: 'var(--sage-soft)',
                borderColor: 'var(--sage)',
                color: 'var(--sage)',
              }}
            >
              {submitSuccess}
            </div>
          )}
        </div>
      )}

      {/* Seating evaluation preview */}
      {seatingEvalHtml && (
        <div className="mt-6">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-[14px] font-semibold text-foreground">
              {lang === 'en'
                ? 'Seating evaluation preview'
                : 'Vista previa de evaluación de asiento'}
            </h3>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const w = window.open('', '_blank');
                  if (w) {
                    w.document.write(DOMPurify.sanitize(seatingEvalHtml));
                    w.document.close();
                    w.print();
                  }
                }}
              >
                {lang === 'en' ? 'Print' : 'Imprimir'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(seatingEvalHtml);
                  onCopied('eval_html');
                }}
              >
                {copiedId === 'eval_html'
                  ? 'Copied!'
                  : lang === 'en'
                    ? 'Copy HTML'
                    : 'Copiar HTML'}
              </Button>
            </div>
          </div>
          <div
            className="max-h-[600px] overflow-auto rounded-sm border border-border bg-background p-4"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(seatingEvalHtml) }}
          />
        </div>
      )}
    </div>
  );
}
