import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { downloadQueryLogCsv } from '../services/api';

export function QueryLogViewer() {
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  const handleDownload = async () => {
    setDownloading(true);
    setError('');
    try {
      await downloadQueryLogCsv(date);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="max-w-xl p-7">
      <div
        className="font-mono uppercase text-muted-foreground"
        style={{ fontSize: 10, letterSpacing: '0.14em' }}
      >
        Audit
      </div>
      <h2
        className="mt-1 font-display font-medium text-foreground"
        style={{ fontSize: 20, lineHeight: 1.15, letterSpacing: '-0.3px' }}
      >
        Query log export
      </h2>
      <p className="mt-2 mb-5 text-[13px] leading-relaxed text-muted-foreground">
        Download a CSV of all queries, responses, and confidence levels for a given
        date. Includes agent username, question, answer (truncated), confidence, and
        source documents.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-[12px] font-medium text-muted-foreground">
          Date
          <Input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-48"
          />
        </label>
        <Button type="button" onClick={handleDownload} disabled={downloading}>
          {downloading ? 'Downloading…' : 'Download CSV'}
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-sm border px-3 py-2 text-[13px]"
          style={{
            background: 'var(--warm-red-soft)',
            borderColor: 'var(--warm-red)',
            color: 'var(--warm-red)',
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
