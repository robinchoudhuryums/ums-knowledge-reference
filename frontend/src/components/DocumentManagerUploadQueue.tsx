export interface UploadQueueItem {
  name: string;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
}

interface Props {
  items: UploadQueueItem[];
}

/**
 * Small status-dot list shown during multi-file uploads. Hidden when
 * the queue is empty; parent clears it 5s after the last file finishes.
 */
export function DocumentManagerUploadQueue({ items }: Props) {
  if (items.length === 0) return null;

  return (
    <div className="mb-4 rounded-sm border border-border bg-muted px-3.5 py-3">
      <div
        className="mb-1.5 font-mono uppercase text-muted-foreground"
        style={{ fontSize: 10, letterSpacing: '0.14em' }}
      >
        Upload queue
      </div>
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2 py-1 text-[13px]">
          <span
            aria-hidden="true"
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: statusColor(item.status) }}
          />
          <span className="flex-1 truncate font-medium text-foreground">{item.name}</span>
          <span className="text-[12px] text-muted-foreground">{statusLabel(item)}</span>
        </div>
      ))}
    </div>
  );
}

function statusColor(status: UploadQueueItem['status']): string {
  switch (status) {
    case 'done':
      return 'var(--sage)';
    case 'error':
      return 'var(--warm-red)';
    case 'uploading':
      return 'var(--accent)';
    default:
      return 'var(--muted-foreground)';
  }
}

function statusLabel(item: UploadQueueItem): string {
  switch (item.status) {
    case 'pending':
      return 'Waiting…';
    case 'uploading':
      return 'Processing…';
    case 'done':
      return 'Complete';
    case 'error':
      return `Error: ${item.error ?? 'Unknown'}`;
  }
}
