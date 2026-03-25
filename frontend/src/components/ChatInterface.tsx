import { useState, useRef, useEffect, useCallback, FormEvent, KeyboardEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import { ConversationTurn, SourceCitation, Collection } from '../types';
import { queryKnowledgeBaseStream, submitTraceFeedback } from '../services/api';
import { SourceViewer } from './SourceViewer';
import { FeedbackForm } from './FeedbackForm';

interface Props {
  collections: Collection[];
}

// Strip the [CONFIDENCE: ...] tag from streamed text before display
function stripConfidenceTag(text: string): string {
  return text.replace(/\[CONFIDENCE:\s*(?:HIGH|PARTIAL|LOW)\]\s*$/i, '').trimEnd();
}

export function ChatInterface({ collections }: Props) {
  const [conversation, setConversation] = useState<ConversationTurn[]>([]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [streamingSources, setStreamingSources] = useState<SourceCitation[]>([]);
  const [streamingConfidence, setStreamingConfidence] = useState<'high' | 'partial' | 'low' | null>(null);
  const [, setStreamingTraceId] = useState<string | null>(null);
  const [selectedCollections, setSelectedCollections] = useState<string[]>([]);
  const [expandedSource, setExpandedSource] = useState<SourceCitation | null>(null);
  const [feedbackTarget, setFeedbackTarget] = useState<{ question: string; answer: string; sources: SourceCitation[]; traceId?: string } | null>(null);
  const [thumbsVoted, setThumbsVoted] = useState<Record<string, 'up' | 'down'>>({});
  const [failedQuery, setFailedQuery] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation, streamingText]);

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(async (e?: FormEvent) => {
    e?.preventDefault();
    if (!question.trim() || loading) return;

    const userMessage = question.trim();
    setQuestion('');
    setFailedQuery(null);
    setConversation(prev => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);
    setStreamingText('');
    setStreamingSources([]);
    setStreamingConfidence(null);
    setStreamingTraceId(null);

    const history = conversation.map(t => ({ role: t.role, content: t.content }));

    await queryKnowledgeBaseStream(
      userMessage,
      selectedCollections.length > 0 ? selectedCollections : undefined,
      history.length > 0 ? history : undefined,
      // onText
      (text) => {
        setStreamingText(prev => prev + text);
      },
      // onSources
      (sources) => {
        setStreamingSources(sources);
      },
      // onConfidence
      (confidence) => {
        setStreamingConfidence(confidence);
      },
      // onDone
      () => {
        setStreamingText(prev => {
          const cleanText = stripConfidenceTag(prev);
          setStreamingSources(sources => {
            setStreamingConfidence(conf => {
              setStreamingTraceId(tid => {
                setConversation(conv => [
                  ...conv,
                  { role: 'assistant', content: cleanText, sources, confidence: conf || undefined, traceId: tid || undefined },
                ]);
                return null;
              });
              return null;
            });
            return [];
          });
          return '';
        });
        setLoading(false);
        inputRef.current?.focus();
      },
      // onError
      (error) => {
        setConversation(prev => [
          ...prev,
          { role: 'assistant', content: `Error: ${error}`, isError: true } as ConversationTurn,
        ]);
        setFailedQuery(userMessage);
        setStreamingText('');
        setStreamingSources([]);
        setStreamingConfidence(null);
        setStreamingTraceId(null);
        setLoading(false);
        inputRef.current?.focus();
      },
      // onTraceId
      (traceId) => {
        setStreamingTraceId(traceId);
      },
    );
  }, [question, loading, conversation, selectedCollections]);

  // Find the user question that preceded a given assistant turn index
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
    // Remove the error message from conversation
    setConversation(prev => prev.filter((_, i) => i < prev.length - 1 || prev[prev.length - 1].role !== 'assistant'));
    setQuestion(failedQuery);
    setFailedQuery(null);
    // Auto-submit after a tick
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
    setSelectedCollections(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  // Deduplicate sources by document name for compact display
  const deduplicateSources = (sources: SourceCitation[]) => {
    const seen = new Map<string, SourceCitation[]>();
    for (const s of sources) {
      const key = s.documentName;
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key)!.push(s);
    }
    return Array.from(seen.entries());
  };

  return (
    <div style={styles.container}>
      {/* Top bar with collection filters and clear */}
      <div style={styles.topBar}>
        <div style={styles.filters}>
          {collections.length > 0 && (
            <>
              <span style={styles.filterLabel}>Collections:</span>
              {collections.map(col => (
                <button
                  key={col.id}
                  onClick={() => toggleCollection(col.id)}
                  style={{
                    ...styles.filterChip,
                    ...(selectedCollections.includes(col.id) ? styles.filterChipActive : {}),
                  }}
                  aria-label={`Filter by collection: ${col.name}`}
                  aria-pressed={selectedCollections.includes(col.id)}
                >
                  {col.name}
                </button>
              ))}
            </>
          )}
        </div>
        {conversation.length > 0 && (
          <button onClick={clearConversation} style={styles.clearButton} aria-label="Start new chat conversation">
            + New Chat
          </button>
        )}
      </div>

      {/* Messages */}
      <div style={styles.messages} className="hex-pattern" role="log" aria-label="Chat messages" aria-live="polite">
        {conversation.length === 0 && !loading && (
          <div style={styles.welcome}>
            <div style={styles.welcomeIconBg}>
              <span style={styles.welcomeIcon}>&#128218;</span>
            </div>
            <h2 style={styles.welcomeTitle}>UMS Knowledge Base</h2>
            <p style={styles.welcomeText}>Ask questions about your company documents, policies, and procedures.</p>
            <p style={styles.welcomeHint}>Answers are grounded in uploaded documents with source citations.</p>
            <div style={styles.suggestionsGrid}>
              {['What are our return policies?', 'Summarize our Medicare guidelines', 'What PPE do we carry?', 'What are our shipping procedures?'].map(q => (
                <button
                  key={q}
                  onClick={() => { setQuestion(q); inputRef.current?.focus(); }}
                  style={styles.suggestion}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {conversation.map((turn, i) => (
          <div key={i} style={turn.role === 'user' ? styles.userMessage : styles.assistantMessage}>
            <div style={styles.messageHeader}>
              <span style={styles.messageLabel}>
                {turn.role === 'user' ? 'You' : 'Knowledge Base'}
              </span>
              {turn.role === 'assistant' && turn.confidence && (
                <span style={{
                  ...styles.confidenceBadge,
                  ...(turn.confidence === 'high' ? styles.confidenceHigh :
                    turn.confidence === 'partial' ? styles.confidencePartial :
                    styles.confidenceLow),
                }}>
                  {turn.confidence === 'high' ? 'Verified in docs' :
                   turn.confidence === 'partial' ? 'Partially covered' :
                   'Not found in docs'}
                </span>
              )}
              {turn.role === 'assistant' && turn.traceId && (
                <div style={styles.thumbsRow}>
                  <button
                    onClick={() => {
                      if (!thumbsVoted[turn.traceId!]) {
                        submitTraceFeedback(turn.traceId!, 'thumbs_up').catch(() => {});
                        setThumbsVoted(prev => ({ ...prev, [turn.traceId!]: 'up' }));
                      }
                    }}
                    style={thumbsVoted[turn.traceId] === 'up' ? styles.thumbsActive : styles.thumbsButton}
                    title="Good answer"
                  >
                    &#x1F44D;
                  </button>
                  <button
                    onClick={() => {
                      if (!thumbsVoted[turn.traceId!]) {
                        submitTraceFeedback(turn.traceId!, 'thumbs_down').catch(() => {});
                        setThumbsVoted(prev => ({ ...prev, [turn.traceId!]: 'down' }));
                      }
                    }}
                    style={thumbsVoted[turn.traceId] === 'down' ? styles.thumbsActive : styles.thumbsButton}
                    title="Bad answer"
                  >
                    &#x1F44E;
                  </button>
                </div>
              )}
              {turn.role === 'assistant' && (
                <button
                  onClick={() => setFeedbackTarget({
                    question: getQuestionForTurn(i),
                    answer: turn.content,
                    sources: turn.sources || [],
                    traceId: turn.traceId,
                  })}
                  style={styles.flagButton}
                  title="Flag this response for admin review"
                >
                  &#9872; Flag
                </button>
              )}
            </div>
            {turn.role === 'user' ? (
              <div style={styles.userText}>{turn.content}</div>
            ) : (
              <div className="markdown-content" style={styles.markdownContent}>
                <ReactMarkdown>{turn.content}</ReactMarkdown>
              </div>
            )}
            {turn.sources && turn.sources.length > 0 && (
              <div style={styles.sourcesSection}>
                <div style={styles.sourcesLabel}>Sources referenced:</div>
                <div style={styles.sourcesRow}>
                  {deduplicateSources(turn.sources).map(([docName, chunks]) => (
                    <button
                      key={docName}
                      onClick={() => setExpandedSource(chunks[0])}
                      style={styles.sourceChip}
                      title={`${chunks.length} passage(s) — click to view`}
                    >
                      <span style={styles.sourceIcon}>&#128196;</span>
                      {docName}
                      {chunks[0].pageNumber != null && (
                        <span style={styles.sourcePageBadge}>p.{chunks[0].pageNumber}</span>
                      )}
                      <span style={styles.sourceScore}>{Math.round(chunks[0].score * 100)}%</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {turn.role === 'assistant' && turn.confidence === 'low' && (
              <div style={styles.lowConfidenceWarning}>
                This answer may not be fully supported by company documents. Please verify with your supervisor or the relevant department before acting on this information.
              </div>
            )}
          </div>
        ))}

        {/* Streaming response */}
        {loading && (
          <div style={styles.assistantMessage}>
            <div style={styles.messageHeader}>
              <span style={styles.messageLabel}>Knowledge Base</span>
              <span style={styles.streamingDot} />
              {streamingConfidence && (
                <span style={{
                  ...styles.confidenceBadge,
                  ...(streamingConfidence === 'high' ? styles.confidenceHigh :
                    streamingConfidence === 'partial' ? styles.confidencePartial :
                    styles.confidenceLow),
                }}>
                  {streamingConfidence === 'high' ? 'Verified in docs' :
                   streamingConfidence === 'partial' ? 'Partially covered' :
                   'Not found in docs'}
                </span>
              )}
            </div>
            {streamingText ? (
              <div className="markdown-content" style={styles.markdownContent}>
                <ReactMarkdown>{streamingText}</ReactMarkdown>
              </div>
            ) : (
              <div style={styles.thinkingText}>Searching documents...</div>
            )}
            {streamingSources.length > 0 && (
              <div style={styles.sourcesSection}>
                <div style={styles.sourcesLabel}>Sources referenced:</div>
                <div style={styles.sourcesRow}>
                  {deduplicateSources(streamingSources).map(([docName, chunks]) => (
                    <button
                      key={docName}
                      onClick={() => setExpandedSource(chunks[0])}
                      style={styles.sourceChip}
                    >
                      <span style={styles.sourceIcon}>&#128196;</span>
                      {docName}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} style={styles.inputArea} role="search" aria-label="Ask a question">
        {failedQuery && (
          <div style={styles.retryBar} role="alert">
            <span style={styles.retryText}>Query failed.</span>
            <button onClick={handleRetry} style={styles.retryButton} aria-label="Retry failed query">
              &#8635; Retry
            </button>
          </div>
        )}
        <div style={styles.inputWrapper}>
          <textarea
            ref={inputRef}
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about your documents..."
            style={styles.textarea}
            disabled={loading}
            rows={1}
            aria-label="Question input — do not enter patient names or PHI"
          />
          <button
            type="submit"
            disabled={loading || !question.trim()}
            style={{
              ...styles.sendButton,
              opacity: loading || !question.trim() ? 0.4 : 1,
            }}
            aria-label="Send question"
          >
            &#9654;
          </button>
        </div>
        <div style={styles.inputHint}>Press Enter to send, Shift+Enter for new line &mdash; Do not enter patient names or PHI</div>
      </form>

      {/* Source viewer modal */}
      {expandedSource && (
        <SourceViewer source={expandedSource} onClose={() => setExpandedSource(null)} />
      )}

      {/* Feedback modal */}
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

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', flexDirection: 'column', height: '100%', background: '#ffffff' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px', borderBottom: '1px solid #E8EFF5', minHeight: '48px', background: '#F0F7FF' },
  filters: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  filterLabel: { fontSize: '13px', color: '#6B8299', fontWeight: 500 },
  filterChip: { padding: '5px 14px', border: '1px solid #D6E4F0', borderRadius: '20px', background: 'white', cursor: 'pointer', fontSize: '13px', color: '#4A6274', transition: 'all 0.15s' },
  filterChipActive: { background: 'linear-gradient(135deg, #1B6FC9, #1565C0)', color: 'white', borderColor: '#1B6FC9', boxShadow: '0 2px 6px rgba(27, 111, 201, 0.25)' },
  clearButton: { padding: '6px 16px', background: 'white', border: '1px solid #D6E4F0', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', color: '#1B6FC9', whiteSpace: 'nowrap', fontWeight: 500 },

  messages: { flex: 1, overflowY: 'auto', padding: '20px 20px 0' },

  welcome: { textAlign: 'center', paddingTop: '56px', maxWidth: '620px', margin: '0 auto' },
  welcomeIconBg: {
    width: '76px',
    height: '76px',
    borderRadius: '22px',
    background: 'linear-gradient(135deg, #E3F2FD 0%, #BBDEFB 50%, #90CAF9 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 20px',
    boxShadow: '0 8px 24px rgba(27, 111, 201, 0.12)',
  },
  welcomeIcon: { fontSize: '36px' },
  welcomeTitle: { margin: '0 0 8px', fontSize: '26px', fontWeight: 700, color: '#0D2137', letterSpacing: '-0.5px' },
  welcomeText: { margin: '0 0 4px', fontSize: '15px', color: '#4A6274', lineHeight: '1.5' },
  welcomeHint: { margin: '0 0 32px', fontSize: '13px', color: '#5F7A8F' },
  suggestionsGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', textAlign: 'left' },
  suggestion: { padding: '14px 16px', border: '1px solid #D6E4F0', borderRadius: '12px', background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(4px)', cursor: 'pointer', fontSize: '13px', color: '#4A6274', textAlign: 'left', transition: 'all 0.2s ease', boxShadow: '0 1px 4px rgba(0,0,0,0.04)', lineHeight: '1.4' },

  userMessage: { marginBottom: '16px', padding: '14px 18px', background: 'linear-gradient(135deg, #E3F2FD, #D6EBFF)', borderRadius: '16px 16px 4px 16px', maxWidth: '85%', marginLeft: 'auto', border: '1px solid rgba(144, 202, 249, 0.6)', boxShadow: '0 1px 4px rgba(27, 111, 201, 0.06)' },
  assistantMessage: { marginBottom: '16px', padding: '18px', backgroundColor: 'rgba(240, 247, 255, 0.7)', borderRadius: '16px', border: '1px solid #E8EFF5', boxShadow: '0 1px 4px rgba(0,0,0,0.03)' },
  messageHeader: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' },
  messageLabel: { fontWeight: 600, fontSize: '13px', color: '#0D2137' },
  confidenceBadge: { fontSize: '11px', padding: '3px 10px', borderRadius: '6px', fontWeight: 500 },
  confidenceHigh: { backgroundColor: '#dcfce7', color: '#166534', border: '1px solid #bbf7d0' },
  confidencePartial: { backgroundColor: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa' },
  confidenceLow: { backgroundColor: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' },
  thumbsRow: { display: 'flex', gap: '2px', marginLeft: 'auto' },
  thumbsButton: { padding: '3px 6px', background: 'none', border: '1px solid #E8EFF5', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', opacity: 0.5, transition: 'all 0.15s' },
  thumbsActive: { padding: '3px 6px', background: '#E3F2FD', border: '1px solid #1B6FC9', borderRadius: '6px', cursor: 'default', fontSize: '14px', opacity: 1 },
  flagButton: { padding: '3px 10px', background: 'none', border: '1px solid #D6E4F0', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: '#5F7A8F', transition: 'all 0.15s' },
  lowConfidenceWarning: { marginTop: '12px', padding: '12px 14px', background: '#fffbeb', border: '1px solid #fef3c7', borderRadius: '10px', fontSize: '13px', color: '#92400e', lineHeight: '1.5' },
  streamingDot: { width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#1B6FC9', animation: 'pulse 1.2s ease-in-out infinite' },
  userText: { fontSize: '14px', lineHeight: '1.6', whiteSpace: 'pre-wrap', color: '#1A2B3C' },
  markdownContent: { fontSize: '14px', lineHeight: '1.7' },
  thinkingText: { fontSize: '14px', color: '#5F7A8F', fontStyle: 'italic' },

  sourcesSection: { marginTop: '14px', paddingTop: '12px', borderTop: '1px solid #E8EFF5' },
  sourcesLabel: { fontSize: '11px', color: '#5F7A8F', marginBottom: '8px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' },
  sourcesRow: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
  sourceChip: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', border: '1px solid #D6E4F0', borderRadius: '8px', background: 'white', cursor: 'pointer', fontSize: '12px', color: '#4A6274', transition: 'all 0.15s', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' },
  sourceIcon: { fontSize: '13px' },
  sourcePageBadge: { fontSize: '10px', color: '#6B8299', background: '#E8EFF5', padding: '2px 6px', borderRadius: '4px', fontWeight: 500 },
  sourceScore: { fontSize: '10px', color: '#5F7A8F', fontWeight: 500 },

  retryBar: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 14px', marginBottom: '8px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px' },
  retryText: { fontSize: '13px', color: '#b91c1c', flex: 1 },
  retryButton: { padding: '6px 14px', background: '#dc2626', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 500 },
  inputArea: { padding: '14px 20px 12px', borderTop: '1px solid #E8EFF5', background: 'linear-gradient(180deg, #F0F7FF, #E8F1FB)' },
  inputWrapper: { display: 'flex', alignItems: 'flex-end', gap: '10px', background: 'rgba(255,255,255,0.95)', border: '1px solid #D6E4F0', borderRadius: '14px', padding: '10px 14px', transition: 'all 0.2s ease', boxShadow: '0 2px 12px rgba(0,0,0,0.04)', backdropFilter: 'blur(8px)' },
  textarea: { flex: 1, padding: '4px 0', border: 'none', background: 'transparent', fontSize: '14px', lineHeight: '1.5', resize: 'none', outline: 'none', fontFamily: 'inherit', minHeight: '24px', maxHeight: '120px', color: '#1A2B3C' },
  sendButton: { padding: '8px 14px', background: 'linear-gradient(135deg, #1B6FC9, #1565C0)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '14px', lineHeight: '1', flexShrink: 0, boxShadow: '0 2px 6px rgba(27, 111, 201, 0.25)' },
  inputHint: { textAlign: 'center', fontSize: '11px', color: '#B0C4D8', marginTop: '6px' },
};
