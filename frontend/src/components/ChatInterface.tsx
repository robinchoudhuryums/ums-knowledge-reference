import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import ReactMarkdown from 'react-markdown';
import {
  PaperAirplaneIcon,
  ArrowPathIcon,
  FlagIcon,
  ClipboardDocumentIcon,
  CheckIcon,
  HandThumbUpIcon,
  HandThumbDownIcon,
  DocumentTextIcon,
  SparklesIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import type { ConversationTurn, SourceCitation, Collection } from '../types';
import {
  queryKnowledgeBaseStream,
  submitTraceFeedback,
  type ProductImageRef,
  type ResponseStyle,
} from '../services/api';
import { SourceViewer } from './SourceViewer';
import { FeedbackForm } from './FeedbackForm';
import { useConfirm } from './ConfirmDialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Props {
  collections: Collection[];
}

// Strip the [CONFIDENCE: ...] tag from streamed text before display.
function stripConfidenceTag(text: string): string {
  return text.replace(/\[CONFIDENCE:\s*(?:HIGH|PARTIAL|LOW)\]\s*$/i, '').trimEnd();
}

/**
 * Detect common PHI patterns in user input before submission.
 * Client-side safety net — backend also redacts PHI in logs.
 */
function detectPotentialPhi(text: string): string[] {
  const detected: string[] = [];
  if (/\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/.test(text)) detected.push('SSN');
  if (/(?:\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/.test(text) && !detected.includes('SSN')) {
    if (/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/.test(text)) detected.push('Phone number');
  }
  if (/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/.test(text)) detected.push('Email address');
  if (/(?:DOB|date\s+of\s+birth|born\s+on)[:\s]*\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}/i.test(text)) detected.push('Date of birth');
  if (/(?:MRN|medical\s+record|patient\s+(?:id|number))[:\s#]*[A-Z0-9-]{4,}/i.test(text)) detected.push('Medical record number');
  return detected;
}

// Confidence pill text + token mapping, sourced from --conf-* aliases.
const CONFIDENCE_LABELS: Record<'high' | 'partial' | 'low', string> = {
  high: 'Verified in docs',
  partial: 'Partially covered',
  low: 'Not found in docs',
};

function ConfidencePill({ level }: { level: 'high' | 'partial' | 'low' }) {
  return (
    <span
      className="inline-flex items-center rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider"
      style={{
        background: `var(--conf-${level}-bg)`,
        borderColor: `var(--conf-${level}-border)`,
        color: `var(--conf-${level})`,
      }}
    >
      {CONFIDENCE_LABELS[level]}
    </span>
  );
}

function SectionKicker({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="font-mono uppercase text-muted-foreground"
      style={{ fontSize: 10, letterSpacing: '0.12em' }}
    >
      {children}
    </div>
  );
}

export function ChatInterface({ collections }: Props) {
  const { confirm } = useConfirm();
  const [conversation, setConversation] = useState<ConversationTurn[]>([]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [streamingSources, setStreamingSources] = useState<SourceCitation[]>([]);
  const [streamingConfidence, setStreamingConfidence] = useState<'high' | 'partial' | 'low' | null>(null);
  const [, setStreamingTraceId] = useState<string | null>(null);
  const [streamingProductImages, setStreamingProductImages] = useState<ProductImageRef[]>([]);

  // Refs track latest streaming values so onDone can read them synchronously.
  const streamingTextRef = useRef('');
  const streamingSourcesRef = useRef<SourceCitation[]>([]);
  const streamingConfidenceRef = useRef<'high' | 'partial' | 'low' | null>(null);
  const streamingTraceIdRef = useRef<string | null>(null);
  const streamingProductImagesRef = useRef<ProductImageRef[]>([]);

  const [selectedCollections, setSelectedCollections] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('ums-selected-collections');
      if (!stored) return [];
      const parsed: unknown = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) return parsed;
      return [];
    } catch {
      return [];
    }
  });
  const [expandedSource, setExpandedSource] = useState<SourceCitation | null>(null);
  const [feedbackTarget, setFeedbackTarget] = useState<{
    question: string;
    answer: string;
    sources: SourceCitation[];
    traceId?: string;
  } | null>(null);
  const [thumbsVoted, setThumbsVoted] = useState<Record<string, 'up' | 'down'>>({});
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [failedQuery, setFailedQuery] = useState<string | null>(null);
  const [responseStyle, setResponseStyle] = useState<ResponseStyle>(() => {
    const stored = localStorage.getItem('ums-response-style');
    return stored === 'concise' || stored === 'comprehensive' ? stored : 'detailed';
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation, streamingText]);

  useEffect(() => {
    try {
      localStorage.setItem('ums-selected-collections', JSON.stringify(selectedCollections));
    } catch {
      /* storage full or disabled */
    }
  }, [selectedCollections]);

  useEffect(() => {
    try {
      localStorage.setItem('ums-response-style', responseStyle);
    } catch {
      /* storage full or disabled */
    }
  }, [responseStyle]);

  // Filter out deleted collections from selection when collection list updates.
  useEffect(() => {
    if (collections.length > 0) {
      setSelectedCollections((prev) => {
        const validIds = new Set(collections.map((c) => c.id));
        const filtered = prev.filter((id) => validIds.has(id));
        return filtered.length !== prev.length ? filtered : prev;
      });
    }
  }, [collections]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      if (!question.trim() || loading) return;

      const userMessage = question.trim();

      const phiTypes = detectPotentialPhi(userMessage);
      if (phiTypes.length > 0) {
        const proceed = await confirm({
          title: 'Potential PHI detected',
          message: `Your query may contain sensitive information (${phiTypes.join(', ')}). PHI should not be entered in the chat. Do you want to continue anyway?`,
          confirmLabel: 'Send anyway',
          cancelLabel: 'Edit query',
          variant: 'danger',
        });
        if (!proceed) return;
      }

      setQuestion('');
      setFailedQuery(null);
      setConversation((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: 'user', content: userMessage },
      ]);
      setLoading(true);
      setStreamingText('');
      setStreamingSources([]);
      setStreamingConfidence(null);
      setStreamingTraceId(null);
      setStreamingProductImages([]);
      streamingTextRef.current = '';
      streamingSourcesRef.current = [];
      streamingConfidenceRef.current = null;
      streamingTraceIdRef.current = null;
      streamingProductImagesRef.current = [];

      const history = conversation.map((t) => ({ role: t.role, content: t.content }));

      await queryKnowledgeBaseStream(
        userMessage,
        selectedCollections.length > 0 ? selectedCollections : undefined,
        history.length > 0 ? history : undefined,
        (text) => {
          streamingTextRef.current += text;
          setStreamingText(streamingTextRef.current);
        },
        (sources) => {
          streamingSourcesRef.current = sources;
          setStreamingSources(sources);
        },
        (confidence) => {
          streamingConfidenceRef.current = confidence;
          setStreamingConfidence(confidence);
        },
        () => {
          const cleanText = stripConfidenceTag(streamingTextRef.current);
          const sources = streamingSourcesRef.current;
          const conf = streamingConfidenceRef.current;
          const tid = streamingTraceIdRef.current;
          const pImages = streamingProductImagesRef.current;
          setConversation((conv) => [
            ...conv,
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: cleanText,
              sources,
              confidence: conf || undefined,
              traceId: tid || undefined,
              productImages: pImages.length > 0 ? pImages : undefined,
            },
          ]);
          setStreamingText('');
          setStreamingSources([]);
          setStreamingConfidence(null);
          setStreamingTraceId(null);
          setStreamingProductImages([]);
          setLoading(false);
          inputRef.current?.focus();
        },
        (error) => {
          setConversation((prev) => [
            ...prev,
            { id: crypto.randomUUID(), role: 'assistant', content: `Error: ${error}`, isError: true },
          ]);
          setFailedQuery(userMessage);
          setStreamingText('');
          setStreamingSources([]);
          setStreamingConfidence(null);
          setStreamingTraceId(null);
          setLoading(false);
          inputRef.current?.focus();
        },
        (traceId) => {
          streamingTraceIdRef.current = traceId;
          setStreamingTraceId(traceId);
        },
        (images) => {
          streamingProductImagesRef.current = images;
          setStreamingProductImages(images);
        },
        responseStyle,
      );
    },
    [question, loading, conversation, selectedCollections, responseStyle, confirm],
  );

  const getQuestionForTurn = (turnIndex: number): string => {
    for (let i = turnIndex - 1; i >= 0; i--) {
      if (conversation[i].role === 'user') return conversation[i].content;
    }
    return '';
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleRetry = useCallback(() => {
    if (!failedQuery) return;
    setConversation((prev) =>
      prev.filter((_, i) => i < prev.length - 1 || prev[prev.length - 1].role !== 'assistant'),
    );
    setQuestion(failedQuery);
    setFailedQuery(null);
    setTimeout(() => {
      const form = document.querySelector('form');
      form?.requestSubmit();
    }, 50);
  }, [failedQuery]);

  const clearConversation = () => {
    setConversation([]);
    setStreamingText('');
    setStreamingSources([]);
    inputRef.current?.focus();
  };

  const toggleCollection = (id: string) => {
    setSelectedCollections((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  };

  const deduplicateSources = useCallback((sources: SourceCitation[]) => {
    const seen = new Map<string, SourceCitation[]>();
    for (const s of sources) {
      const key = s.documentName;
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key)!.push(s);
    }
    return Array.from(seen.entries());
  }, []);

  const deduplicatedStreamingSources = useMemo(
    () => deduplicateSources(streamingSources),
    [streamingSources, deduplicateSources],
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Top bar: collection filters + new chat */}
      <div className="flex min-h-[48px] flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-2.5 sm:px-7">
        <div className="flex flex-wrap items-center gap-2">
          {collections.length > 0 && (
            <>
              <SectionKicker>Collections</SectionKicker>
              {collections.map((col) => {
                const active = selectedCollections.includes(col.id);
                return (
                  <button
                    key={col.id}
                    onClick={() => toggleCollection(col.id)}
                    aria-label={`Filter by collection: ${col.name}`}
                    aria-pressed={active}
                    className={cn(
                      'rounded-sm border px-3 py-1 text-[12px] transition-colors',
                      active
                        ? 'border-accent bg-[var(--copper-soft)] text-foreground'
                        : 'border-border bg-card text-muted-foreground hover:bg-muted',
                    )}
                  >
                    {col.name}
                  </button>
                );
              })}
            </>
          )}
        </div>
        {conversation.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={clearConversation}
            aria-label="Start new chat conversation"
            className="gap-1.5"
          >
            <PlusIcon className="h-4 w-4" />
            New chat
          </Button>
        )}
      </div>

      {/* Messages */}
      <div
        role="log"
        aria-label="Chat messages"
        aria-live="polite"
        className="flex-1 overflow-y-auto px-4 pb-2 pt-6 sm:px-7"
      >
        {conversation.length === 0 && !loading && (
          <WelcomeScreen
            onSuggestion={(q) => {
              setQuestion(q);
              inputRef.current?.focus();
            }}
          />
        )}

        <div className="mx-auto max-w-4xl space-y-5">
          {conversation.map((turn, i) => (
            <MessageTurn
              key={turn.id}
              turn={turn}
              turnIndex={i}
              thumbsVoted={thumbsVoted}
              copiedIndex={copiedIndex}
              onSetThumbs={(traceId, v) => {
                if (!thumbsVoted[traceId]) {
                  submitTraceFeedback(traceId, v === 'up' ? 'thumbs_up' : 'thumbs_down').catch(
                    () => {},
                  );
                  setThumbsVoted((prev) => ({ ...prev, [traceId]: v }));
                }
              }}
              onCopy={() => {
                navigator.clipboard.writeText(turn.content).catch(() => {
                  /* clipboard not available */
                });
                setCopiedIndex(i);
                setTimeout(
                  () => setCopiedIndex((prev) => (prev === i ? null : prev)),
                  2000,
                );
              }}
              onFlag={() =>
                setFeedbackTarget({
                  question: getQuestionForTurn(i),
                  answer: turn.content,
                  sources: turn.sources || [],
                  traceId: turn.traceId,
                })
              }
              onSourceClick={(s) => setExpandedSource(s)}
              deduplicateSources={deduplicateSources}
            />
          ))}

          {/* Streaming response */}
          {loading && (
            <StreamingTurn
              streamingText={streamingText}
              streamingConfidence={streamingConfidence}
              streamingProductImages={streamingProductImages}
              deduplicatedStreamingSources={deduplicatedStreamingSources}
              onSourceClick={(s) => setExpandedSource(s)}
            />
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <form
        onSubmit={handleSubmit}
        role="search"
        aria-label="Ask a question"
        className="border-t border-border bg-card px-4 py-4 sm:px-7"
      >
        <div className="mx-auto max-w-4xl">
          {failedQuery && (
            <div
              role="alert"
              className="mb-3 flex items-center justify-between gap-3 rounded-sm border px-3 py-2 text-[13px]"
              style={{
                background: 'var(--warm-red-soft)',
                borderColor: 'var(--warm-red)',
                color: 'var(--warm-red)',
              }}
            >
              <span>Query failed.</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRetry}
                aria-label="Retry failed query"
                className="gap-1.5"
              >
                <ArrowPathIcon className="h-4 w-4" />
                Retry
              </Button>
            </div>
          )}

          <div className="rounded-sm border border-border bg-background focus-within:border-accent focus-within:ring-2 focus-within:ring-ring/40">
            <textarea
              ref={inputRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question about your documents…"
              rows={1}
              disabled={loading}
              aria-label="Question input — do not enter patient names or PHI"
              className="block min-h-[44px] w-full resize-none bg-transparent px-3 py-3 text-[14px] leading-relaxed text-foreground placeholder:text-muted-foreground focus:outline-none"
              style={{ maxHeight: 180 }}
            />

            <div className="flex items-center justify-between gap-2 border-t border-border px-2 py-2">
              <div className="inline-flex rounded-sm border border-border bg-card p-0.5">
                {(['concise', 'detailed', 'comprehensive'] as ResponseStyle[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setResponseStyle(s)}
                    aria-pressed={responseStyle === s}
                    title={
                      s === 'concise'
                        ? 'Short, direct answers (1-3 sentences)'
                        : s === 'detailed'
                          ? 'Balanced with supporting details'
                          : 'Thorough with full context and steps'
                    }
                    className={cn(
                      'rounded-sm px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors',
                      responseStyle === s
                        ? 'bg-foreground text-background'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {s === 'concise' ? 'Brief' : s === 'detailed' ? 'Detailed' : 'Full'}
                  </button>
                ))}
              </div>
              <Button
                type="submit"
                size="icon"
                disabled={loading || !question.trim()}
                aria-label="Send question"
                className="h-9 w-9 shrink-0"
              >
                <PaperAirplaneIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <p
            className="mt-1.5 text-center font-mono text-muted-foreground"
            style={{ fontSize: 10, letterSpacing: '0.04em' }}
          >
            PRESS ENTER TO SEND · SHIFT+ENTER FOR NEW LINE · DO NOT ENTER PATIENT NAMES OR PHI
          </p>
        </div>
      </form>

      {expandedSource && (
        <SourceViewer source={expandedSource} onClose={() => setExpandedSource(null)} />
      )}

      {feedbackTarget && (
        <FeedbackForm
          question={feedbackTarget.question}
          answer={feedbackTarget.answer}
          sources={feedbackTarget.sources}
          traceId={feedbackTarget.traceId}
          onClose={() => setFeedbackTarget(null)}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Sub-components
// ────────────────────────────────────────────────────────────

function WelcomeScreen({ onSuggestion }: { onSuggestion: (q: string) => void }) {
  const suggestions = [
    'What are our return policies?',
    'Summarize our Medicare guidelines',
    'What PPE do we carry?',
    'What are our shipping procedures?',
  ];
  return (
    <div className="mx-auto max-w-[620px] pt-10 text-center">
      <div
        aria-hidden="true"
        className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-sm"
        style={{ background: 'var(--copper-soft)', color: 'var(--accent)' }}
      >
        <SparklesIcon className="h-7 w-7" />
      </div>
      <SectionKicker>Knowledge base</SectionKicker>
      <h2
        className="mt-1 font-display font-medium text-foreground"
        style={{ fontSize: 24, lineHeight: 1.1, letterSpacing: '-0.4px' }}
      >
        Ask about company documents
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Policies, procedures, Medicare/LCD coverage, HCPCS codes, product catalog.
      </p>
      <p className="mt-1 text-[12px] text-muted-foreground">
        Answers are grounded in uploaded documents with source citations.
      </p>
      <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {suggestions.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onSuggestion(q)}
            className="rounded-sm border border-border bg-card px-3 py-2.5 text-left text-[13px] text-foreground hover:bg-muted"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

interface MessageTurnProps {
  turn: ConversationTurn;
  turnIndex: number;
  thumbsVoted: Record<string, 'up' | 'down'>;
  copiedIndex: number | null;
  onSetThumbs: (traceId: string, v: 'up' | 'down') => void;
  onCopy: () => void;
  onFlag: () => void;
  onSourceClick: (s: SourceCitation) => void;
  deduplicateSources: (sources: SourceCitation[]) => [string, SourceCitation[]][];
}

function MessageTurn({
  turn,
  turnIndex,
  thumbsVoted,
  copiedIndex,
  onSetThumbs,
  onCopy,
  onFlag,
  onSourceClick,
  deduplicateSources,
}: MessageTurnProps) {
  if (turn.role === 'user') {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[80%] rounded-sm border border-border bg-muted px-4 py-3"
          style={{ boxShadow: 'inset -2px 0 0 var(--accent)' }}
        >
          <SectionKicker>You</SectionKicker>
          <div
            // break-words wraps long URLs / unbroken tokens that would
            // otherwise overflow the narrow (420px) embed-mode drawer.
            className="mt-1 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-foreground"
          >
            {turn.content}
          </div>
        </div>
      </div>
    );
  }

  const isError = turn.isError;

  return (
    <div
      className="rounded-sm border bg-card px-4 py-3"
      style={{
        borderColor: isError ? 'var(--warm-red)' : 'var(--border)',
        background: isError ? 'var(--warm-red-soft)' : 'var(--card)',
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <SectionKicker>{isError ? 'Error' : 'Knowledge base'}</SectionKicker>
        {turn.confidence && <ConfidencePill level={turn.confidence} />}

        <div className="ml-auto flex items-center gap-1">
          {turn.traceId && (
            <>
              <IconButton
                onClick={() => onSetThumbs(turn.traceId!, 'up')}
                active={thumbsVoted[turn.traceId] === 'up'}
                title="Good answer"
                ariaLabel="Rate this answer as helpful"
              >
                <HandThumbUpIcon className="h-3.5 w-3.5" />
              </IconButton>
              <IconButton
                onClick={() => onSetThumbs(turn.traceId!, 'down')}
                active={thumbsVoted[turn.traceId] === 'down'}
                title="Bad answer"
                ariaLabel="Rate this answer as unhelpful"
              >
                <HandThumbDownIcon className="h-3.5 w-3.5" />
              </IconButton>
            </>
          )}
          <IconButton
            onClick={onCopy}
            title="Copy answer to clipboard"
            ariaLabel="Copy answer to clipboard"
          >
            {copiedIndex === turnIndex ? (
              <CheckIcon className="h-3.5 w-3.5" style={{ color: 'var(--sage)' }} />
            ) : (
              <ClipboardDocumentIcon className="h-3.5 w-3.5" />
            )}
          </IconButton>
          <IconButton
            onClick={onFlag}
            title="Flag this response for admin review"
            ariaLabel="Flag this response for admin review"
          >
            <FlagIcon className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>

      <div className="markdown-content prose prose-sm mt-2 max-w-none break-words overflow-x-auto text-foreground prose-p:text-foreground prose-strong:text-foreground prose-headings:text-foreground prose-code:text-foreground prose-code:bg-muted prose-code:rounded-sm prose-code:px-1 prose-a:text-[var(--accent)] prose-pre:max-w-full">
        <ReactMarkdown skipHtml>{turn.content}</ReactMarkdown>
      </div>

      {turn.productImages && turn.productImages.length > 0 && (
        <ProductImageGrid images={turn.productImages} />
      )}

      {turn.sources && turn.sources.length > 0 && (
        <SourcesRow
          sources={turn.sources}
          deduplicateSources={deduplicateSources}
          onClick={onSourceClick}
        />
      )}

      {turn.confidence === 'low' && (
        <div
          className="mt-3 rounded-sm border px-3 py-2 text-[12px] leading-relaxed"
          style={{
            background: 'var(--amber-soft)',
            borderColor: 'var(--amber)',
            color: 'var(--foreground)',
          }}
        >
          This answer may not be fully supported by company documents. Please verify with your
          supervisor or the relevant department before acting on this information.
        </div>
      )}
    </div>
  );
}

function IconButton({
  children,
  onClick,
  title,
  ariaLabel,
  active = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  ariaLabel: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={active}
      className={cn(
        'flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
        active && 'bg-[var(--copper-soft)] text-[var(--accent)]',
      )}
    >
      {children}
    </button>
  );
}

function StreamingTurn({
  streamingText,
  streamingConfidence,
  streamingProductImages,
  deduplicatedStreamingSources,
  onSourceClick,
}: {
  streamingText: string;
  streamingConfidence: 'high' | 'partial' | 'low' | null;
  streamingProductImages: ProductImageRef[];
  deduplicatedStreamingSources: [string, SourceCitation[]][];
  onSourceClick: (s: SourceCitation) => void;
}) {
  return (
    <div className="rounded-sm border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2">
        <SectionKicker>Knowledge base</SectionKicker>
        <span
          role="status"
          aria-label="Generating response"
          className="inline-block h-2 w-2 animate-pulse rounded-full"
          style={{ background: 'var(--accent)' }}
        />
        {streamingConfidence && <ConfidencePill level={streamingConfidence} />}
      </div>

      {streamingText ? (
        <div className="markdown-content prose prose-sm mt-2 max-w-none break-words overflow-x-auto text-foreground prose-p:text-foreground prose-strong:text-foreground prose-headings:text-foreground prose-code:text-foreground prose-code:bg-muted prose-code:rounded-sm prose-code:px-1 prose-a:text-[var(--accent)] prose-pre:max-w-full">
          <ReactMarkdown skipHtml>{streamingText}</ReactMarkdown>
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-2 py-1">
          <div className="h-3 w-full animate-pulse rounded-sm bg-muted" />
          <div className="h-3 w-[85%] animate-pulse rounded-sm bg-muted" />
          <div className="h-3 w-[60%] animate-pulse rounded-sm bg-muted" />
        </div>
      )}

      {streamingProductImages.length > 0 && <ProductImageGrid images={streamingProductImages} />}

      {deduplicatedStreamingSources.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <SectionKicker>Sources referenced</SectionKicker>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {deduplicatedStreamingSources.map(([docName, chunks]) => (
              <button
                key={docName}
                type="button"
                onClick={() => onSourceClick(chunks[0])}
                className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-muted px-2 py-1 text-[12px] text-foreground hover:bg-[var(--copper-soft)]"
              >
                <DocumentTextIcon className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="truncate">{docName}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SourcesRow({
  sources,
  deduplicateSources,
  onClick,
}: {
  sources: SourceCitation[];
  deduplicateSources: (sources: SourceCitation[]) => [string, SourceCitation[]][];
  onClick: (s: SourceCitation) => void;
}) {
  return (
    <div className="mt-3 border-t border-border pt-3">
      <SectionKicker>Sources referenced</SectionKicker>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {deduplicateSources(sources).map(([docName, chunks]) => {
          const first = chunks[0];
          const pct = Math.round(first.score * 100);
          return (
            <button
              key={docName}
              type="button"
              onClick={() => onClick(first)}
              title={`${chunks.length} passage(s) — click to view`}
              className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-muted px-2 py-1 text-[12px] text-foreground hover:bg-[var(--copper-soft)]"
            >
              <DocumentTextIcon className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="max-w-[200px] truncate">{docName}</span>
              {first.pageNumber !== null && first.pageNumber !== undefined && (
                <span className="font-mono text-[10px] text-muted-foreground">
                  p.{first.pageNumber}
                </span>
              )}
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                {pct}%
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ProductImageGrid({ images }: { images: ProductImageRef[] }) {
  return (
    <div className="mt-3 border-t border-border pt-3">
      <SectionKicker>Related products</SectionKicker>
      <div className="mt-2 flex flex-wrap gap-2">
        {images.map((img) => (
          <div
            key={img.hcpcsCode}
            className="flex w-[180px] flex-col overflow-hidden rounded-sm border border-border bg-card"
          >
            <img
              src={img.imageUrl}
              alt={img.productName}
              className="h-24 w-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
            <div className="flex flex-col gap-0.5 p-2">
              <span
                className="font-mono uppercase text-muted-foreground"
                style={{ fontSize: 10, letterSpacing: '0.06em' }}
              >
                {img.hcpcsCode}
              </span>
              <span className="truncate text-[12px] font-medium text-foreground">
                {img.productName}
              </span>
              {img.brochureUrl && (
                <a
                  href={img.brochureUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-0.5 text-[11px]"
                  style={{ color: 'var(--accent)' }}
                >
                  Brochure →
                </a>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
