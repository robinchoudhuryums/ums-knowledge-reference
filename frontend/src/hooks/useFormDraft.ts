import { useCallback, useEffect, useRef, useState } from 'react';
import {
  upsertFormDraft,
  loadFormDraft,
  discardFormDraft,
  listFormDrafts,
  FormDraft,
  FormDraftType,
  FormDraftIndexEntry,
} from '../services/api';

/**
 * Server-side form drafts hook.
 *
 * Debounced auto-save: calls `upsertFormDraft` 2s after the payload stops
 * changing. The hook is defensive: draft failures are logged but never
 * thrown to the host form, so a dead network doesn't block the reviewer
 * from finishing the interview (localStorage in the parent component
 * remains the first line of defense).
 *
 * The hook does NOT automatically load any draft on mount — the caller
 * decides whether to offer "Resume" UI.
 */

const AUTOSAVE_DELAY_MS = 2_000;

export interface UseFormDraftOptions {
  formType: FormDraftType;
  /** Serializable form state — passed straight to the API */
  payload: unknown;
  /** Short human-readable label (e.g. "Jane Doe / Trx-12345"). No PHI required. */
  label?: string;
  /** Version of the questionnaire at save-time; UI can warn on drift */
  formVersion?: string;
  /** 0-100 completion for progress UI */
  completionPercent?: number;
  /** Set false to disable auto-save entirely (e.g. until patient label entered) */
  enabled?: boolean;
}

export interface UseFormDraftResult {
  currentDraftId: string | null;
  lastSavedAt: Date | null;
  saving: boolean;
  error: string | null;
  /** Force an immediate save (bypasses the debounce) */
  saveNow: () => Promise<void>;
  /** Remove the current draft from the server ("start over") */
  discardCurrent: () => Promise<void>;
  /** Load an existing draft by id and adopt it as the current draft */
  resume: (id: string) => Promise<FormDraft | null>;
  /** Manually bind this hook to an existing draft id without loading its payload */
  bindDraftId: (id: string | null) => void;
}

export function useFormDraft(opts: UseFormDraftOptions): UseFormDraftResult {
  const { formType, payload, label, formVersion, completionPercent, enabled = true } = opts;

  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<boolean>(false);

  // Keep latest inputs in refs so the debounced save sees current values
  // without re-creating the timer on every keystroke.
  const payloadRef = useRef(payload);
  const labelRef = useRef(label);
  const formVersionRef = useRef(formVersion);
  const completionRef = useRef(completionPercent);
  const idRef = useRef(currentDraftId);

  useEffect(() => { payloadRef.current = payload; }, [payload]);
  useEffect(() => { labelRef.current = label; }, [label]);
  useEffect(() => { formVersionRef.current = formVersion; }, [formVersion]);
  useEffect(() => { completionRef.current = completionPercent; }, [completionPercent]);
  useEffect(() => { idRef.current = currentDraftId; }, [currentDraftId]);

  const doSave = useCallback(async () => {
    if (!enabled) return;
    if (inFlightRef.current) return; // Skip if a save is already running
    inFlightRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const res = await upsertFormDraft({
        id: idRef.current || undefined,
        formType,
        payload: payloadRef.current,
        label: labelRef.current,
        formVersion: formVersionRef.current,
        completionPercent: completionRef.current,
      });
      if (!idRef.current) setCurrentDraftId(res.draft.id);
      setLastSavedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save draft');
    } finally {
      setSaving(false);
      inFlightRef.current = false;
    }
  }, [enabled, formType]);

  // Debounced auto-save
  useEffect(() => {
    if (!enabled) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { void doSave(); }, AUTOSAVE_DELAY_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // We intentionally stringify the payload to detect value changes; this
    // is O(payload size) per change but forms are small.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, formType, JSON.stringify(payload), label, formVersion, completionPercent, doSave]);

  const saveNow = useCallback(async () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    await doSave();
  }, [doSave]);

  const discardCurrent = useCallback(async () => {
    const id = idRef.current;
    if (!id) return;
    try {
      await discardFormDraft(formType, id);
      setCurrentDraftId(null);
      setLastSavedAt(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to discard draft');
    }
  }, [formType]);

  const resume = useCallback(async (id: string): Promise<FormDraft | null> => {
    try {
      const res = await loadFormDraft(formType, id);
      setCurrentDraftId(id);
      setLastSavedAt(new Date(res.draft.updatedAt));
      return res.draft;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load draft');
      return null;
    }
  }, [formType]);

  const bindDraftId = useCallback((id: string | null) => {
    setCurrentDraftId(id);
  }, []);

  return { currentDraftId, lastSavedAt, saving, error, saveNow, discardCurrent, resume, bindDraftId };
}

/**
 * Convenience: lists the caller's available drafts for a form type.
 * Suitable for a "Resume draft…" dropdown.
 */
export function useAvailableDrafts(formType: FormDraftType) {
  const [drafts, setDrafts] = useState<FormDraftIndexEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listFormDrafts(formType);
      setDrafts(res.drafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to list drafts');
    } finally {
      setLoading(false);
    }
  }, [formType]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { drafts, loading, error, refresh };
}
