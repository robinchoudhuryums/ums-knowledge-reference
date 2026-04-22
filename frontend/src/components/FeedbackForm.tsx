import { useState, useEffect, useRef, useCallback, type FormEvent } from 'react';
import { CheckCircleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import type { SourceCitation } from '../types';
import { submitFeedback } from '../services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface Props {
  question: string;
  answer: string;
  sources: SourceCitation[];
  onClose: () => void;
  traceId?: string;
}

export function FeedbackForm({ question, answer, sources, onClose, traceId }: Props) {
  const modalRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, input, textarea, select, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
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
        sources: sources.map((s) => ({
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
      <Overlay onClose={onClose}>
        <Modal onClose={onClose}>
          <div className="py-5 text-center">
            <div
              aria-hidden="true"
              className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-sm"
              style={{ background: 'var(--sage-soft)', color: 'var(--sage)' }}
            >
              <CheckCircleIcon className="h-7 w-7" />
            </div>
            <h3 className="mb-2 font-display text-[18px] font-medium text-foreground">
              Feedback submitted
            </h3>
            <p className="mb-5 text-sm text-muted-foreground">
              Your feedback has been sent to the admin for review.
            </p>
            <Button onClick={onClose}>Done</Button>
          </div>
        </Modal>
      </Overlay>
    );
  }

  return (
    <Overlay
      onClose={onClose}
      role="dialog"
      aria-modal={true}
      aria-label="Flag response for review"
    >
      <Modal onClose={onClose} ref={modalRef}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <div
              className="font-mono uppercase text-muted-foreground"
              style={{ fontSize: 10, letterSpacing: '0.12em' }}
            >
              Feedback
            </div>
            <h3
              className="mt-1 font-display font-medium text-foreground"
              style={{ fontSize: 18, lineHeight: 1.2, letterSpacing: '-0.2px' }}
            >
              Flag response for review
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-border bg-card text-muted-foreground hover:text-foreground"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 rounded-sm border border-border bg-muted p-3 text-[13px]">
          <ContextLabel>Question</ContextLabel>
          <p className="mt-1 text-muted-foreground">{question}</p>
          <ContextLabel className="mt-3">Answer preview</ContextLabel>
          <p className="mt-1 text-muted-foreground">
            {answer.length > 200 ? answer.slice(0, 200) + '…' : answer}
          </p>
        </div>

        <div
          className="mb-4 rounded-sm border px-3 py-2 text-[12px] leading-relaxed"
          style={{
            background: 'var(--amber-soft)',
            borderColor: 'var(--amber)',
            color: 'var(--foreground)',
          }}
        >
          <strong className="font-semibold">PHI notice:</strong> Patient names and transaction
          numbers entered here are stored in encrypted audit logs. Only include PHI when necessary
          for review.
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fb-patient">Patient name (optional)</Label>
            <Input
              id="fb-patient"
              type="text"
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
              placeholder="Enter patient name if applicable"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fb-txn">Transaction / order number (optional)</Label>
            <Input
              id="fb-txn"
              type="text"
              value={transactionNumber}
              onChange={(e) => setTransactionNumber(e.target.value)}
              placeholder="Enter transaction or order number"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fb-notes">Notes</Label>
            <Textarea
              id="fb-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Describe the issue: incorrect info, missing context, needs clarification, etc."
              rows={3}
            />
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-sm border px-3 py-2 text-[13px]"
              style={{
                background: 'var(--warm-red-soft)',
                borderColor: 'var(--warm-red)',
                color: 'var(--warm-red)',
              }}
            >
              {error}
            </div>
          )}

          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit feedback'}
            </Button>
          </div>
        </form>
      </Modal>
    </Overlay>
  );
}

function ContextLabel({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`font-mono uppercase text-muted-foreground ${className}`}
      style={{ fontSize: 10, letterSpacing: '0.12em' }}
    >
      {children}
    </div>
  );
}

function Overlay({
  children,
  onClose,
  role,
  'aria-modal': ariaModal,
  'aria-label': ariaLabel,
}: {
  children: React.ReactNode;
  onClose: () => void;
  role?: string;
  'aria-modal'?: boolean;
  'aria-label'?: string;
}) {
  return (
    <div
      role={role}
      aria-modal={ariaModal}
      aria-label={ariaLabel}
      onClick={onClose}
      className="fixed inset-0 z-[1000] flex items-center justify-center px-4"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.45)' }}
    >
      {children}
    </div>
  );
}

function Modal({
  children,
  onClose: _onClose,
  ref,
}: {
  children: React.ReactNode;
  onClose: () => void;
  ref?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={ref}
      onClick={(e) => e.stopPropagation()}
      className="max-h-[85vh] w-full max-w-[520px] overflow-y-auto rounded-sm border border-border bg-card p-6 shadow-lg sm:p-7"
    >
      {children}
    </div>
  );
}
