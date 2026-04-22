/**
 * LoadingSkeleton — animated placeholder bars shown while content is loading.
 *
 * Usage:
 *   <LoadingSkeleton rows={5} />                           // 5 rows, default widths
 *   <LoadingSkeleton rows={3} widths={[100, 60, 80]} />    // custom widths
 */

interface Props {
  /** Number of skeleton rows to render */
  rows?: number;
  /** Width percentage for each row (cycles if fewer than rows) */
  widths?: number[];
}

const DEFAULT_WIDTHS = [100, 85, 92, 70, 88];

export function LoadingSkeleton({ rows = 4, widths = DEFAULT_WIDTHS }: Props) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex flex-col gap-3 p-4"
    >
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="h-4 animate-pulse rounded-sm bg-muted"
          style={{
            width: `${widths[i % widths.length]}%`,
            animationDelay: `${i * 0.1}s`,
          }}
        />
      ))}
    </div>
  );
}
