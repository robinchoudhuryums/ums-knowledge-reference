import { useState, useRef } from 'react';
import {
  MagnifyingGlassIcon,
  DocumentTextIcon,
  ChevronRightIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline';
import type { Collection } from '../types';
import { searchDocuments, type DocumentSearchResult } from '../services/api';
import { LoadingSkeleton } from './LoadingSkeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Props {
  collections: Collection[];
}

function SectionKicker({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="font-mono uppercase text-muted-foreground"
      style={{ fontSize: 10, letterSpacing: '0.14em' }}
    >
      {children}
    </div>
  );
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

  const highlightMatch = (text: string, q: string) => {
    const terms = q.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
    if (terms.length === 0) return text;
    const textLower = text.toLowerCase();
    let earliest = text.length;
    for (const term of terms) {
      const idx = textLower.indexOf(term);
      if (idx !== -1 && idx < earliest) earliest = idx;
    }
    const start = Math.max(0, earliest - 80);
    const end = Math.min(text.length, earliest + 300);
    return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
  };

  return (
    <div className="min-h-full bg-background">
      {/* App bar breadcrumb */}
      <div className="flex items-center gap-3 border-b border-border bg-card px-4 py-3 sm:px-7">
        <span
          className="font-mono uppercase text-muted-foreground"
          style={{ fontSize: 11, letterSpacing: '0.04em' }}
        >
          UMS Knowledge › Documents › <span className="text-foreground">Search</span>
        </span>
      </div>

      {/* Page header */}
      <header className="border-b border-border bg-background px-4 pb-4 pt-6 sm:px-7">
        <SectionKicker>Full-text</SectionKicker>
        <h2
          className="mt-1 font-display font-medium text-foreground"
          style={{ fontSize: 22, lineHeight: 1.15, letterSpacing: '-0.4px' }}
        >
          Search documents
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Search directly through document content by keyword.
        </p>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-7">
        <form onSubmit={handleSearch} className="mb-6 flex flex-wrap gap-2">
          <Input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search document contents…"
            className="min-w-[240px] flex-1"
            aria-label="Search query"
          />
          {collections.length > 0 && (
            <select
              value={collectionFilter}
              onChange={(e) => setCollectionFilter(e.target.value)}
              className="min-w-[180px] rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground"
              aria-label="Filter by collection"
            >
              <option value="">All collections</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <Button type="submit" disabled={loading || !query.trim()}>
            {loading ? 'Searching…' : 'Search'}
          </Button>
        </form>

        {loading && (
          <div className="py-6">
            <LoadingSkeleton rows={5} />
          </div>
        )}

        {!loading && !searched && results.length === 0 && (
          <EmptyState
            title="Search your documents"
            hint="Enter a keyword or phrase above to find matching passages across all uploaded documents."
          />
        )}

        {!loading && searched && results.length === 0 && (
          <EmptyState
            title="No matching passages found"
            hint="Try different keywords or check that relevant documents have been uploaded."
          />
        )}

        {!loading &&
          results.map((result) => {
            const isOpen = expandedDoc === result.documentId;
            return (
              <div
                key={result.documentId}
                className="mb-2.5 overflow-hidden rounded-sm border border-border bg-card"
              >
                <button
                  type="button"
                  onClick={() => setExpandedDoc(isOpen ? null : result.documentId)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-2.5 px-4 py-3 text-left hover:bg-muted"
                >
                  <DocumentTextIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate text-[14px] font-medium text-foreground">
                    {result.documentName}
                  </span>
                  <span
                    className="font-mono text-[11px] text-muted-foreground"
                    style={{ letterSpacing: '0.04em' }}
                  >
                    {result.matches.length} match{result.matches.length !== 1 ? 'es' : ''}
                  </span>
                  {isOpen ? (
                    <ChevronDownIcon className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronRightIcon className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>

                {isOpen && (
                  <div className="border-t border-border">
                    {result.matches.map((match, i) => (
                      <div
                        key={i}
                        className="border-b border-border px-4 py-3 last:border-b-0"
                      >
                        <div className="mb-2 flex flex-wrap gap-1.5">
                          {match.pageNumber !== null && match.pageNumber !== undefined && (
                            <MatchBadge>Page {match.pageNumber}</MatchBadge>
                          )}
                          <MatchBadge>Chunk {match.chunkIndex + 1}</MatchBadge>
                        </div>
                        <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">
                          {highlightMatch(match.text, query)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

function MatchBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-sm border border-border bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
      {children}
    </span>
  );
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div
        aria-hidden="true"
        className="mb-4 flex h-12 w-12 items-center justify-center rounded-sm"
        style={{ background: 'var(--copper-soft)', color: 'var(--accent)' }}
      >
        <MagnifyingGlassIcon className="h-6 w-6" />
      </div>
      <p className="mb-1 text-[15px] font-medium text-foreground">{title}</p>
      <p className="max-w-[400px] text-[13px] leading-relaxed text-muted-foreground">{hint}</p>
    </div>
  );
}
