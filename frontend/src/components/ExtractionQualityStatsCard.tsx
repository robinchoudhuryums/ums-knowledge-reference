import { useEffect, useState } from 'react';
import { getExtractionQualityStats, ExtractionQualityStats } from '../services/api';

/**
 * Compact admin card showing aggregate extraction accuracy from reviewer
 * corrections. Complements the per-template extraction UI by giving a
 * top-level view of "how often is the model getting it right?".
 */

// Quality tones map to warm-paper confidence aliases so the breakdown
// bars read as the same "good/meh/bad" gradient used elsewhere in the app.
function colorFor(quality: string): string {
  if (quality === 'correct') return 'var(--sage)';
  if (quality === 'minor_errors') return 'var(--amber)';
  if (quality === 'major_errors') return 'var(--warm-red)';
  return 'var(--warm-red)';
}

export function ExtractionQualityStatsCard() {
  const [stats, setStats] = useState<ExtractionQualityStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getExtractionQualityStats()
      .then((res) => {
        if (!cancelled) setStats(res.stats);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Failed to load stats');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="rounded-sm border border-border bg-card p-5 shadow-sm">
      <div className="mb-3">
        <h3 className="text-[14px] font-semibold text-foreground">
          Extraction accuracy (reviewer feedback)
        </h3>
        <p className="mt-1 max-w-[620px] text-[12px] leading-relaxed text-muted-foreground">
          Aggregate quality across all reviewer-submitted corrections. Reviewers
          rate each extraction after editing; the LLM's self-reported "confidence"
          is compared against the reviewer's verdict.
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

      {stats && stats.total === 0 && (
        <div className="py-5 text-center text-[12px] italic text-muted-foreground">
          No reviewer feedback yet. Use the "Submit correction" panel on the
          extraction page after editing a result to start building this baseline.
        </div>
      )}

      {stats && stats.total > 0 && (
        <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
          <div className="rounded-sm border border-border bg-background p-3 text-center">
            <div className="text-[28px] font-bold tabular-nums text-foreground">
              {(stats.accuracyRate * 100).toFixed(0)}%
            </div>
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              accuracy
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              {stats.byActualQuality.correct} of {stats.total} rated "correct"
            </div>
          </div>
          <div className="rounded-sm border border-border bg-background p-3 text-center">
            <div
              className="text-[28px] font-bold tabular-nums"
              style={{
                color:
                  stats.overconfidenceRate > 0.15
                    ? 'var(--warm-red)'
                    : 'var(--sage)',
              }}
            >
              {(stats.overconfidenceRate * 100).toFixed(0)}%
            </div>
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              overconfidence
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              reported high but wasn't correct
            </div>
          </div>
          <div className="rounded-sm border border-border bg-background p-3 text-center">
            <div className="text-[28px] font-bold tabular-nums text-foreground">
              {stats.totalFieldsCorrected}
            </div>
            <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              fields corrected
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              total edits across all extractions
            </div>
          </div>
        </div>
      )}

      {stats && stats.total > 0 && (
        <div className="mt-2">
          <div className="mb-1.5 text-[12px] font-semibold text-foreground">
            Quality breakdown
          </div>
          {(['correct', 'minor_errors', 'major_errors', 'unusable'] as const).map(
            (q) => {
              const count = stats.byActualQuality[q] || 0;
              const pct = stats.total > 0 ? (count / stats.total) * 100 : 0;
              return (
                <div
                  key={q}
                  className="mb-1 grid grid-cols-[120px_1fr_40px] items-center gap-2"
                >
                  <span className="text-[12px] capitalize text-foreground">
                    {q.replace('_', ' ')}
                  </span>
                  <div className="h-2 overflow-hidden rounded-sm bg-muted">
                    <div
                      className="h-full transition-all duration-300"
                      style={{ width: `${pct}%`, background: colorFor(q) }}
                    />
                  </div>
                  <span className="text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                    {count}
                  </span>
                </div>
              );
            },
          )}
        </div>
      )}
    </div>
  );
}
