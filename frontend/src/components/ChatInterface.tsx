import { useState, useRef, useEffect, FormEvent } from 'react';
import { ConversationTurn, SourceCitation, Collection } from '../types';
import { queryKnowledgeBase } from '../services/api';
import { SourceViewer } from './SourceViewer';

interface Props {
  collections: Collection[];
}

export function ChatInterface({ collections }: Props) {
  const [conversation, setConversation] = useState<ConversationTurn[]>([]);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedCollections, setSelectedCollections] = useState<string[]>([]);
  const [expandedSource, setExpandedSource] = useState<SourceCitation | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!question.trim() || loading) return;

    const userMessage = question.trim();
    setQuestion('');
    setConversation(prev => [...prev, { role: 'user', content: userMessage }]);
    setLoading(true);

    try {
      const history = conversation.map(t => ({ role: t.role, content: t.content }));
      const result = await queryKnowledgeBase(
        userMessage,
        selectedCollections.length > 0 ? selectedCollections : undefined,
        history
      );

      setConversation(prev => [
        ...prev,
        { role: 'assistant', content: result.answer, sources: result.sources },
      ]);
    } catch (err) {
      setConversation(prev => [
        ...prev,
        { role: 'assistant', content: `Error: ${err instanceof Error ? err.message : 'Query failed'}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const toggleCollection = (id: string) => {
    setSelectedCollections(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  return (
    <div style={styles.container}>
      {/* Collection filter */}
      {collections.length > 0 && (
        <div style={styles.filters}>
          <span style={styles.filterLabel}>Filter by collection:</span>
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
        </div>
      )}

      {/* Messages */}
      <div style={styles.messages}>
        {conversation.length === 0 && (
          <div style={styles.welcome}>
            <h2>UMS Knowledge Base</h2>
            <p>Ask questions about your company documents, policies, and procedures.</p>
            <p style={styles.hint}>Your answers will be grounded in uploaded documents with source citations.</p>
          </div>
        )}

        {conversation.map((turn, i) => (
          <div key={i} style={turn.role === 'user' ? styles.userMessage : styles.assistantMessage}>
            <div style={styles.messageLabel}>{turn.role === 'user' ? 'You' : 'Knowledge Base'}</div>
            <div style={styles.messageContent}>{turn.content}</div>
            {turn.sources && turn.sources.length > 0 && (
              <div style={styles.sourcesSection}>
                <div style={styles.sourcesLabel}>Sources:</div>
                {turn.sources.map((source, j) => (
                  <button
                    key={j}
                    onClick={() => setExpandedSource(source)}
                    style={styles.sourceChip}
                  >
                    {source.documentName}
                    {source.pageNumber && ` (p.${source.pageNumber})`}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div style={styles.assistantMessage}>
            <div style={styles.messageLabel}>Knowledge Base</div>
            <div style={styles.messageContent}>Searching documents and generating answer...</div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} style={styles.inputArea}>
        <input
          type="text"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="Ask a question about your documents..."
          style={styles.input}
          disabled={loading}
        />
        <button type="submit" disabled={loading || !question.trim()} style={styles.sendButton}>
          Send
        </button>
      </form>

      {/* Source viewer modal */}
      {expandedSource && (
        <SourceViewer source={expandedSource} onClose={() => setExpandedSource(null)} />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', flexDirection: 'column', height: '100%' },
  filters: { padding: '12px 16px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  filterLabel: { fontSize: '13px', color: '#666' },
  filterChip: { padding: '4px 12px', border: '1px solid #ddd', borderRadius: '16px', background: 'white', cursor: 'pointer', fontSize: '13px' },
  filterChipActive: { background: '#1a1a2e', color: 'white', borderColor: '#1a1a2e' },
  messages: { flex: 1, overflowY: 'auto', padding: '16px' },
  welcome: { textAlign: 'center', color: '#666', paddingTop: '60px' },
  hint: { fontSize: '14px', color: '#999' },
  userMessage: { marginBottom: '16px', padding: '12px', backgroundColor: '#e8f4f8', borderRadius: '8px' },
  assistantMessage: { marginBottom: '16px', padding: '12px', backgroundColor: '#f8f9fa', borderRadius: '8px' },
  messageLabel: { fontWeight: 600, fontSize: '13px', color: '#1a1a2e', marginBottom: '4px' },
  messageContent: { fontSize: '14px', lineHeight: '1.6', whiteSpace: 'pre-wrap' },
  sourcesSection: { marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #ddd' },
  sourcesLabel: { fontSize: '12px', color: '#666', marginBottom: '4px' },
  sourceChip: { padding: '3px 10px', margin: '2px 4px 2px 0', border: '1px solid #ccc', borderRadius: '12px', background: 'white', cursor: 'pointer', fontSize: '12px' },
  inputArea: { display: 'flex', gap: '8px', padding: '16px', borderTop: '1px solid #eee' },
  input: { flex: 1, padding: '12px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '14px' },
  sendButton: { padding: '12px 24px', backgroundColor: '#1a1a2e', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' },
};
