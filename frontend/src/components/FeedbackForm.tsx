import { useState, FormEvent } from 'react';
import { SourceCitation } from '../types';
import { submitFeedback } from '../services/api';

interface Props {
  question: string;
  answer: string;
  sources: SourceCitation[];
  onClose: () => void;
}

export function FeedbackForm({ question, answer, sources, onClose }: Props) {
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
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={styles.title}>Flag Response for Review</h3>
          <button onClick={onClose} style={styles.closeButton}>&#10005;</button>
        </div>

        <div style={styles.context}>
          <div style={styles.contextLabel}>Question:</div>
          <div style={styles.contextText}>{question}</div>
          <div style={{ ...styles.contextLabel, marginTop: '8px' }}>Answer preview:</div>
          <div style={styles.contextText}>
            {answer.length > 200 ? answer.slice(0, 200) + '...' : answer}
          </div>
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
    backgroundColor: 'rgba(0,0,0,0.45)', display: 'flex',
    justifyContent: 'center', alignItems: 'center', zIndex: 1000,
    backdropFilter: 'blur(2px)',
  },
  modal: {
    backgroundColor: 'white', borderRadius: '12px', padding: '24px',
    maxWidth: '520px', width: '92%', maxHeight: '85vh', overflowY: 'auto',
    boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  title: { margin: 0, fontSize: '18px', fontWeight: 600, color: '#1a1a2e' },
  closeButton: { background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#999' },

  context: { background: '#f8f9fa', borderRadius: '8px', padding: '12px', marginBottom: '16px', fontSize: '13px' },
  contextLabel: { fontWeight: 600, color: '#666', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' },
  contextText: { color: '#444', lineHeight: '1.5' },

  form: { display: 'flex', flexDirection: 'column', gap: '12px' },
  field: { display: 'flex', flexDirection: 'column', gap: '4px' },
  label: { fontSize: '13px', fontWeight: 500, color: '#555' },
  input: { padding: '8px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' },
  textarea: { padding: '8px 12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px', fontFamily: 'inherit', resize: 'vertical' },

  error: { color: '#e74c3c', fontSize: '13px', background: '#fef2f2', padding: '8px 12px', borderRadius: '6px' },

  actions: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '4px' },
  cancelButton: { padding: '8px 16px', background: 'none', border: '1px solid #ddd', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' },
  submitButton: { padding: '8px 20px', background: '#1a1a2e', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' },

  successMessage: { textAlign: 'center', padding: '16px 0' },
  successIcon: { fontSize: '36px', color: '#2e7d32', marginBottom: '8px' },
  successTitle: { margin: '0 0 8px', fontSize: '18px' },
  successText: { margin: '0 0 16px', color: '#666', fontSize: '14px' },
  doneButton: { padding: '8px 24px', background: '#1a1a2e', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' },
};
