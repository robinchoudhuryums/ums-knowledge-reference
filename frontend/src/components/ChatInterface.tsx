import { useState, useRef, useEffect, useCallback, FormEvent, KeyboardEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import { ConversationTurn, SourceCitation, Collection } from '../types';
import { queryKnowledgeBaseStream } from '../services/api';
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
  const [selectedCollections, setSelectedCollections] = useState<string[]>([]);
  const [expandedSource, setExpandedSource] = useState<SourceCitation | null>(null);
  const [feedbackTarget, setFeedbackTarget] = useState<{ question: string; answer: string; sources: SourceCitation[] } | null>(null);
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
    setConversation(prev => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);
    setStreamingText('');
    setStreamingSources([]);
    setStreamingConfidence(null);

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
              setConversation(conv => [
                ...conv,
                { role: 'assistant', content: cleanText, sources, confidence: conf || undefined },
              ]);
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
          { role: 'assistant', content: `Error: ${error}` },
        ]);
        setStreamingText('');
        setStreamingSources([]);
        setStreamingConfidence(null);
        setLoading(false);
        inputRef.current?.focus();
      }
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
                >
                  {col.name}
                </button>
              ))}
            </>
          )}
        </div>
        {conversation.length > 0 && (
          <button onClick={clearConversation} style={styles.clearButton}>
            New Chat
          </button>
        )}
      </div>

      {/* Messages */}
      <div style={styles.messages}>
        {conversation.length === 0 && !loading && (
          <div style={styles.welcome}>
            <div style={styles.welcomeIcon}>&#128218;</div>
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
              {turn.role === 'assistant' && (
                <button
                  onClick={() => setFeedbackTarget({
                    question: getQuestionForTurn(i),
                    answer: turn.content,
                    sources: turn.sources || [],
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
      <form onSubmit={handleSubmit} style={styles.inputArea}>
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
          />
          <button
            type="submit"
            disabled={loading || !question.trim()}
            style={{
              ...styles.sendButton,
              opacity: loading || !question.trim() ? 0.5 : 1,
            }}
          >
            &#9654;
          </button>
        </div>
        <div style={styles.inputHint}>Press Enter to send, Shift+Enter for new line</div>
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
          onClose={() => setFeedbackTarget(null)}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', flexDirection: 'column', height: '100%' },
  topBar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 16px', borderBottom: '1px solid #eee', minHeight: '44px' },
  filters: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  filterLabel: { fontSize: '13px', color: '#666', fontWeight: 500 },
  filterChip: { padding: '4px 12px', border: '1px solid #ddd', borderRadius: '16px', background: 'white', cursor: 'pointer', fontSize: '13px', transition: 'all 0.15s' },
  filterChipActive: { background: '#1a1a2e', color: 'white', borderColor: '#1a1a2e' },
  clearButton: { padding: '6px 14px', background: 'none', border: '1px solid #ddd', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', color: '#666', whiteSpace: 'nowrap' },

  messages: { flex: 1, overflowY: 'auto', padding: '16px 16px 0' },

  welcome: { textAlign: 'center', paddingTop: '48px', maxWidth: '600px', margin: '0 auto' },
  welcomeIcon: { fontSize: '48px', marginBottom: '8px' },
  welcomeTitle: { margin: '0 0 8px', fontSize: '24px', fontWeight: 700, color: '#1a1a2e' },
  welcomeText: { margin: '0 0 4px', fontSize: '15px', color: '#555' },
  welcomeHint: { margin: '0 0 24px', fontSize: '13px', color: '#999' },
  suggestionsGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', textAlign: 'left' },
  suggestion: { padding: '12px 14px', border: '1px solid #e0e0e0', borderRadius: '8px', background: 'white', cursor: 'pointer', fontSize: '13px', color: '#444', textAlign: 'left', transition: 'border-color 0.15s' },

  userMessage: { marginBottom: '12px', padding: '12px 16px', backgroundColor: '#e8f0fe', borderRadius: '12px', maxWidth: '85%', marginLeft: 'auto' },
  assistantMessage: { marginBottom: '12px', padding: '16px', backgroundColor: '#f7f8fa', borderRadius: '12px', border: '1px solid #eee' },
  messageHeader: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' },
  messageLabel: { fontWeight: 600, fontSize: '13px', color: '#1a1a2e' },
  confidenceBadge: { fontSize: '11px', padding: '2px 8px', borderRadius: '4px', fontWeight: 500 },
  confidenceHigh: { backgroundColor: '#e8f5e9', color: '#2e7d32', border: '1px solid #c8e6c9' },
  confidencePartial: { backgroundColor: '#fff3e0', color: '#e65100', border: '1px solid #ffe0b2' },
  confidenceLow: { backgroundColor: '#fce4ec', color: '#c62828', border: '1px solid #f8bbd0' },
  flagButton: { marginLeft: 'auto', padding: '2px 10px', background: 'none', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', color: '#888', transition: 'all 0.15s' },
  lowConfidenceWarning: { marginTop: '10px', padding: '10px 12px', background: '#fff8e1', border: '1px solid #fff0b3', borderRadius: '6px', fontSize: '13px', color: '#7a6200', lineHeight: '1.5' },
  streamingDot: { width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#4caf50', animation: 'pulse 1.2s ease-in-out infinite' },
  userText: { fontSize: '14px', lineHeight: '1.6', whiteSpace: 'pre-wrap' },
  markdownContent: { fontSize: '14px', lineHeight: '1.7' },
  thinkingText: { fontSize: '14px', color: '#999', fontStyle: 'italic' },

  sourcesSection: { marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #e5e5e5' },
  sourcesLabel: { fontSize: '12px', color: '#888', marginBottom: '6px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.5px' },
  sourcesRow: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
  sourceChip: { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 12px', border: '1px solid #d8d8d8', borderRadius: '6px', background: 'white', cursor: 'pointer', fontSize: '12px', color: '#444', transition: 'all 0.15s' },
  sourceIcon: { fontSize: '14px' },
  sourcePageBadge: { fontSize: '11px', color: '#888', background: '#f0f0f0', padding: '1px 6px', borderRadius: '4px' },
  sourceScore: { fontSize: '11px', color: '#888' },

  inputArea: { padding: '12px 16px', borderTop: '1px solid #eee' },
  inputWrapper: { display: 'flex', alignItems: 'flex-end', gap: '8px', background: '#f7f8fa', border: '1px solid #ddd', borderRadius: '12px', padding: '8px 12px', transition: 'border-color 0.15s' },
  textarea: { flex: 1, padding: '4px 0', border: 'none', background: 'transparent', fontSize: '14px', lineHeight: '1.5', resize: 'none', outline: 'none', fontFamily: 'inherit', minHeight: '24px', maxHeight: '120px' },
  sendButton: { padding: '8px 12px', backgroundColor: '#1a1a2e', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', lineHeight: '1', flexShrink: 0 },
  inputHint: { textAlign: 'center', fontSize: '11px', color: '#bbb', marginTop: '4px' },
};
