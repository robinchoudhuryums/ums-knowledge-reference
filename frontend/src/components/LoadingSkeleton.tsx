/**
 * LoadingSkeleton — animated placeholder bars shown while content is loading.
 * Replaces raw spinners with a more polished shimmer effect.
 *
 * Usage:
 *   <LoadingSkeleton rows={5} />                // 5 rows, default widths
 *   <LoadingSkeleton rows={3} widths={[100, 60, 80]} />  // custom widths
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
    <div style={styles.container} role="status" aria-label="Loading...">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          style={{
            ...styles.row,
            width: `${widths[i % widths.length]}%`,
            animationDelay: `${i * 0.1}s`,
          }}
        />
      ))}
    </div>
  );
}

const shimmerKeyframes = `
@keyframes ums-skeleton-shimmer {
  0% { background-position: -200px 0; }
  100% { background-position: calc(200px + 100%) 0; }
}
`;

// Inject keyframes into document head once
if (typeof document !== 'undefined') {
  const existing = document.getElementById('ums-skeleton-style');
  if (!existing) {
    const style = document.createElement('style');
    style.id = 'ums-skeleton-style';
    style.textContent = shimmerKeyframes;
    document.head.appendChild(style);
  }
}

const styles = {
  container: {
    padding: '16px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '12px',
  },
  row: {
    height: '16px',
    borderRadius: '4px',
    background: 'linear-gradient(90deg, #e8ecf1 25%, #f0f4f8 50%, #e8ecf1 75%)',
    backgroundSize: '200px 100%',
    animation: 'ums-skeleton-shimmer 1.5s ease-in-out infinite',
  },
};
