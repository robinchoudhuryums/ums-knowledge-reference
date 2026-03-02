import { useState, useRef } from 'react';
import { Collection } from '../types';
import { searchDocuments, DocumentSearchResult } from '../services/api';

interface Props {
  collections: Collection[];
}

export function DocumentSearch({ collections }: Props) {
  const [query, setQuery] = useState('');
  const [collectionFilter, setCollectionFilter] = useState('');
  const [results, setResults] = useState<DocumentSearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [expandedDoc, setExpandedDoc] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setSearched(true);
    try {
      const res = await searchDocuments(query.trim(), collectionFilter || undefined);
      setResults(res.results);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const highlightMatch = (text: string, query: string) => {
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
    if (terms.length === 0) return text;

    // Find first occurrence of any term and show context around it
    const textLower = text.toLowerCase();
    let earliest = text.length;
    for (const term of terms) {
      const idx = textLower.indexOf(term);
      if (idx !== -1 && idx < earliest) earliest = idx;
    }

    const start = Math.max(0, earliest - 80);
    const end = Math.min(text.length, earliest + 300);
    let snippet = (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');

    return snippet;
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>Search Documents</h2>
        <p style={styles.subtitle}>Search directly through document content by keyword</p>
      </div>

      <form onSubmit={handleSearch} style={styles.searchForm}>
        <div style={styles.searchRow}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search document contents..."
            style={styles.searchInput}
          />
          {collections.length > 0 && (
            <select
              value={collectionFilter}
              onChange={e => setCollectionFilter(e.target.value)}
              style={styles.collectionSelect}
            >
              <option value="">All Collections</option>
              {collections.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          <button type="submit" disabled={loading || !query.trim()} style={styles.searchButton}>
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </form>

      <div style={styles.results}>
        {searched && results.length === 0 && !loading && (
          <div style={styles.noResults}>
            No matching passages found for "{query}"
          </div>
        )}

        {results.map(result => (
          <div key={result.documentId} style={styles.resultCard}>
            <button
              onClick={() => setExpandedDoc(expandedDoc === result.documentId ? null : result.documentId)}
              style={styles.resultHeader}
            >
              <span style={styles.docIcon}>&#128196;</span>
              <span style={styles.docName}>{result.documentName}</span>
              <span style={styles.matchCount}>{result.matches.length} match{result.matches.length !== 1 ? 'es' : ''}</span>
              <span style={styles.expandArrow}>{expandedDoc === result.documentId ? '&#9660;' : '&#9654;'}</span>
            </button>

            {expandedDoc === result.documentId && (
              <div style={styles.matchesList}>
                {result.matches.map((match, i) => (
                  <div key={i} style={styles.matchItem}>
                    <div style={styles.matchMeta}>
                      {match.pageNumber != null && <span style={styles.matchBadge}>Page {match.pageNumber}</span>}
                      <span style={styles.matchBadge}>Chunk {match.chunkIndex + 1}</span>
                    </div>
                    <div style={styles.matchText}>
                      {highlightMatch(match.text, query)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: '24px', height: '100%', overflowY: 'auto' },
  header: { marginBottom: '20px' },
  title: { margin: '0 0 4px', fontSize: '20px', fontWeight: 600 },
  subtitle: { margin: 0, fontSize: '14px', color: '#666' },

  searchForm: { marginBottom: '20px' },
  searchRow: { display: 'flex', gap: '8px' },
  searchInput: { flex: 1, padding: '10px 14px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', outline: 'none' },
  collectionSelect: { padding: '10px 12px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '13px', background: 'white', outline: 'none', minWidth: '160px' },
  searchButton: { padding: '10px 20px', backgroundColor: '#1a1a2e', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', whiteSpace: 'nowrap' },

  results: {},
  noResults: { textAlign: 'center', color: '#999', padding: '40px', fontSize: '14px' },

  resultCard: { border: '1px solid #eee', borderRadius: '8px', marginBottom: '8px', overflow: 'hidden' },
  resultHeader: { display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '12px 16px', border: 'none', background: 'white', cursor: 'pointer', fontSize: '14px', textAlign: 'left' },
  docIcon: { fontSize: '18px', flexShrink: 0 },
  docName: { flex: 1, fontWeight: 500 },
  matchCount: { fontSize: '12px', color: '#888', background: '#f0f0f0', padding: '2px 8px', borderRadius: '4px' },
  expandArrow: { fontSize: '12px', color: '#888' },

  matchesList: { borderTop: '1px solid #eee' },
  matchItem: { padding: '12px 16px', borderBottom: '1px solid #f5f5f5' },
  matchMeta: { display: 'flex', gap: '6px', marginBottom: '6px' },
  matchBadge: { fontSize: '11px', color: '#666', border: '1px solid #ddd', borderRadius: '4px', padding: '1px 6px' },
  matchText: { fontSize: '13px', lineHeight: '1.6', color: '#444', whiteSpace: 'pre-wrap' },
};
