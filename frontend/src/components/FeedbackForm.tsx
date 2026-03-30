import { useState, useEffect, useRef, useCallback, FormEvent } from 'react';
import { SourceCitation } from '../types';
import { submitFeedback } from '../services/api';

interface Props {
  question: string;
  answer: string;
  sources: SourceCitation[];
  onClose: () => void;
  traceId?: string;
}

export function FeedbackForm({ question, answer, sources, onClose, traceId }: Props) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Focus trap + Escape to close
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'Tab' && modalRef.current) {
      const focusable = modalRef.current.querySelectorAll<HTMLElement>('button, input, textarea, select, [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    // Auto-focus first input
    const firstInput = modalRef.current?.querySelector<HTMLElement>('input, textarea');
    firstInput?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
  const [patientName, setPatientName] = useState('');
  const [transactionNumber, setTransactionNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');

    try {
      await submitFeedback({
        question,
        answer,
        patientName: patientName.trim() || undefined,
        transactionNumber: transactionNumber.trim() || undefined,
        notes: notes.trim() || undefined,
        sources: sources.map(s => ({
          documentName: s.documentName,
          chunkId: s.chunkId,
          score: s.score,
        })),
        traceId,
        feedbackType: 'thumbs_down',
      });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit feedback');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div style={styles.overlay} onClick={onClose}>
        <div style={styles.modal} onClick={e => e.stopPropagation()}>
          <div style={styles.successMessage}>
            <div style={styles.successIcon}>&#10003;</div>
            <h3 style={styles.successTitle}>Feedback Submitted</h3>
            <p style={styles.successText}>Your feedback has been sent to the admin for review.</p>
            <button onClick={onClose} style={styles.doneButton}>Done</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label="Flag response for review">
      <div ref={modalRef} style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={styles.title}>Flag Response for Review</h3>
          <button onClick={onClose} style={styles.closeButton}>&#10005;</button>
        </div>

        <div style={styles.context}>
          <div style={styles.contextLabel}>Question:</div>
          <div style={styles.contextText}>{question}</div>
          <div style={{ ...styles.contextLabel, marginTop: '10px' }}>Answer preview:</div>
          <div style={styles.contextText}>
            {answer.length > 200 ? answer.slice(0, 200) + '...' : answer}
          </div>
        </div>

        <div style={styles.phiWarning}>
          <strong>PHI Notice:</strong> Patient names and transaction numbers entered here are stored in encrypted audit logs. Only include PHI when necessary for review.
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label}>Patient Name (optional)</label>
            <input
              type="text"
              value={patientName}
              onChange={e => setPatientName(e.target.value)}
              placeholder="Enter patient name if applicable"
              style={styles.input}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Transaction / Order Number (optional)</label>
            <input
              type="text"
              value={transactionNumber}
              onChange={e => setTransactionNumber(e.target.value)}
              placeholder="Enter transaction or order number"
              style={styles.input}
            />
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Notes</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Describe the issue: incorrect info, missing context, needs clarification, etc."
              style={styles.textarea}
              rows={3}
            />
          </div>

          {error && <div style={styles.error}>{error}</div>}

          <div style={styles.actions}>
            <button type="button" onClick={onClose} style={styles.cancelButton}>Cancel</button>
            <button type="submit" disabled={submitting} style={styles.submitButton}>
              {submitting ? 'Submitting...' : 'Submit Feedback'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.5)', display: 'flex',
    justifyContent: 'center', alignItems: 'center', zIndex: 1000,
    backdropFilter: 'blur(4px)',
  },
  modal: {
    backgroundColor: 'var(--ums-bg-surface)', borderRadius: '16px', padding: '28px',
    maxWidth: '520px', width: '92%', maxHeight: '85vh', overflowY: 'auto',
    boxShadow: '0 25px 60px rgba(0,0,0,0.2)',
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' },
  title: { margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--ums-text-primary)', letterSpacing: '-0.2px' },
  closeButton: { background: 'var(--ums-bg-surface-alt)', border: '1px solid var(--ums-border-light)', fontSize: '16px', cursor: 'pointer', color: 'var(--ums-text-muted)', padding: '6px 10px', borderRadius: '8px' },

  context: { background: 'var(--ums-bg-surface-alt)', borderRadius: '12px', padding: '14px', marginBottom: '20px', fontSize: '13px', border: '1px solid var(--ums-border-light)' },
  contextLabel: { fontWeight: 600, color: 'var(--ums-text-muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' },
  contextText: { color: 'var(--ums-text-muted)', lineHeight: '1.5' },

  form: { display: 'flex', flexDirection: 'column', gap: '14px' },
  field: { display: 'flex', flexDirection: 'column', gap: '6px' },
  label: { fontSize: '13px', fontWeight: 500, color: 'var(--ums-text-muted)' },
  input: { padding: '10px 14px', border: '1px solid var(--ums-border)', borderRadius: '10px', fontSize: '14px', background: 'var(--ums-bg-surface-alt)' },
  textarea: { padding: '10px 14px', border: '1px solid var(--ums-border)', borderRadius: '10px', fontSize: '14px', fontFamily: 'inherit', resize: 'vertical', background: 'var(--ums-bg-surface-alt)' },

  error: { color: '#dc2626', fontSize: '13px', background: '#fef2f2', padding: '10px 14px', borderRadius: '8px', border: '1px solid #fecaca' },

  actions: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' },
  cancelButton: { padding: '9px 18px', background: 'none', border: '1px solid var(--ums-border)', borderRadius: '10px', cursor: 'pointer', fontSize: '14px', color: 'var(--ums-text-muted)' },
  submitButton: { padding: '9px 22px', background: 'var(--ums-brand-gradient)', color: 'var(--ums-bg-surface)', border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: 500, boxShadow: '0 2px 8px rgba(27, 111, 201, 0.25)' },

  phiWarning: { padding: '12px 14px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '10px', fontSize: '12px', color: '#92400e', lineHeight: '1.5', marginBottom: '16px' },
  successMessage: { textAlign: 'center', padding: '20px 0' },
  successIcon: { fontSize: '40px', color: '#166534', marginBottom: '12px', width: '56px', height: '56px', lineHeight: '56px', borderRadius: '50%', background: '#dcfce7', display: 'inline-block' },
  successTitle: { margin: '0 0 8px', fontSize: '18px', color: 'var(--ums-text-primary)', fontWeight: 700 },
  successText: { margin: '0 0 20px', color: 'var(--ums-text-muted)', fontSize: '14px' },
  doneButton: { padding: '9px 28px', background: 'var(--ums-brand-gradient)', color: 'var(--ums-bg-surface)', border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: 500 },
};
