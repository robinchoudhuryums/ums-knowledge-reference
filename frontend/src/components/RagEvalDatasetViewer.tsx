import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { getEvalDataset, EvalDataset, GoldPair } from '../services/api';

/**
 * Admin read-only view of the gold-standard RAG evaluation dataset.
 * Not a runner — that lives in the CLI harness (scripts/evalRag.ts)
 * because running the full eval requires Bedrock credentials and a
 * populated index. This view answers "what are we measuring?" so
 * operators can reason about coverage and propose new questions.
 */
export function RagEvalDatasetViewer() {
  const [dataset, setDataset] = useState<EvalDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    getEvalDataset()
      .then((d) => {
        if (!cancelled) setDataset(d);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Failed to load dataset');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredPairs: GoldPair[] = useMemo(() => {
    if (!dataset) return [];
    const term = search.trim().toLowerCase();
    return dataset.pairs.filter((p) => {
      if (filterCategory !== 'all' && p.category !== filterCategory) return false;
      if (!term) return true;
      return (
        p.question.toLowerCase().includes(term) ||
        p.expectedKeywords.some((k) => k.toLowerCase().includes(term)) ||
        p.expectedCodes.some((c) => c.toLowerCase().includes(term))
      );
    });
  }, [dataset, filterCategory, search]);

  return (
    <div className="rounded-sm border border-border bg-card p-5 shadow-sm">
      <div className="mb-3">
        <h3 className="text-[14px] font-semibold text-foreground">
          RAG gold-standard dataset
        </h3>
        <p className="mt-1 max-w-[660px] text-[12px] leading-relaxed text-muted-foreground">
          Gold-standard Q&amp;A pairs used by <code className="font-mono">scripts/evalRag.ts</code> to
          measure recall@10 and MRR. Not run from this page — run the CLI against a
          populated index to produce <code className="font-mono">eval-output/junit.xml</code>.
        </p>
      </div>

      {loading && (
        <div className="py-5 text-center text-[13px] text-muted-foreground">
          Loading…
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-sm border px-3 py-2 text-[12px]"
          style={{
            background: 'var(--warm-red-soft)',
            borderColor: 'var(--warm-red)',
            color: 'var(--warm-red)',
          }}
        >
          {error}
        </div>
      )}

      {dataset && (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            <MetaChip>v{dataset.version}</MetaChip>
            <MetaChip>{dataset.totalPairs} pairs</MetaChip>
            <MetaChip>updated {dataset.lastUpdated}</MetaChip>
          </div>

          <div className="mb-3 flex flex-wrap gap-1.5">
            <CategoryChip
              active={filterCategory === 'all'}
              onClick={() => setFilterCategory('all')}
            >
              All ({dataset.totalPairs})
            </CategoryChip>
            {dataset.categories.map((c) => (
              <CategoryChip
                key={c.name}
                active={filterCategory === c.name}
                onClick={() => setFilterCategory(c.name)}
              >
                {c.name} ({c.count})
              </CategoryChip>
            ))}
          </div>

          <Input
            type="text"
            placeholder="Filter by question, keyword, or HCPCS…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-2"
          />

          <div className="mb-2 font-mono text-[11px] text-muted-foreground">
            Showing {filteredPairs.length} of {dataset.pairs.length}
          </div>

          <ul className="max-h-[420px] list-none overflow-y-auto rounded-sm border border-border">
            {filteredPairs.map((p, i) => (
              <li
                key={i}
                className="border-b border-border px-3 py-2.5 last:border-b-0"
              >
                <div className="mb-1 flex items-center gap-2.5">
                  <span
                    className="inline-flex items-center rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider"
                    style={{ background: 'var(--copper-soft)', color: 'var(--accent)' }}
                  >
                    {p.category}
                  </span>
                  <span className="text-[13px] text-foreground">{p.question}</span>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                  {p.expectedCodes.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1">
                      <strong className="font-mono uppercase tracking-wider">
                        codes
                      </strong>
                      {p.expectedCodes.map((c) => (
                        <code
                          key={c}
                          className="rounded-sm px-1.5 py-0.5 font-mono text-[11px]"
                          style={{
                            background: 'var(--copper-soft)',
                            color: 'var(--accent)',
                          }}
                        >
                          {c}
                        </code>
                      ))}
                    </div>
                  )}
                  {p.expectedKeywords.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1">
                      <strong className="font-mono uppercase tracking-wider">
                        keywords
                      </strong>
                      {p.expectedKeywords.map((k) => (
                        <span
                          key={k}
                          className="rounded-sm bg-muted px-1.5 py-0.5 text-[11px]"
                        >
                          {k}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {filteredPairs.length === 0 && (
            <div className="py-5 text-center text-[12px] italic text-muted-foreground">
              No pairs match the current filter.
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MetaChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-sm bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
      {children}
    </span>
  );
}

function CategoryChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-sm border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors',
        active
          ? 'border-foreground bg-foreground text-background'
          : 'border-border bg-card text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
