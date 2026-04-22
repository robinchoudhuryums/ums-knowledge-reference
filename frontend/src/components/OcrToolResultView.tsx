import { ClipboardDocumentIcon, CheckIcon } from '@heroicons/react/24/outline';
import type { OcrResponse } from '../services/api';
import { Button } from '@/components/ui/button';

interface Props {
  result: OcrResponse;
  copied: boolean;
  onCopy: () => void;
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

function MetaBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-sm border border-border bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
      {children}
    </span>
  );
}

export function OcrToolResultView({ result, copied, onCopy }: Props) {
  return (
    <div className="rounded-sm border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <SectionKicker>OCR result</SectionKicker>
          <h4
            className="mt-1 truncate font-display font-medium text-foreground"
            style={{ fontSize: 16, lineHeight: 1.15 }}
          >
            {result.filename}
          </h4>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <MetaBadge>
              {result.pageCount} page{result.pageCount !== 1 ? 's' : ''}
            </MetaBadge>
            <MetaBadge>{Math.round(result.confidence)}% confidence</MetaBadge>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCopy}
          className="gap-1.5"
        >
          {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <ClipboardDocumentIcon className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy text'}
        </Button>
      </div>
      <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-sm bg-muted px-4 py-3 font-mono text-[12px] leading-relaxed text-foreground">
        {result.text}
      </pre>
    </div>
  );
}
