import { useRef, type ChangeEvent } from 'react';
import { PaperClipIcon, SparklesIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/button';

interface Props {
  selectedFile: File | null;
  extracting: boolean;
  templateName: string | undefined;
  onFileSelect: (file: File | null) => void;
  onExtract: () => void;
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

export function DocumentExtractorFileUpload({
  selectedFile,
  extracting,
  templateName,
  onFileSelect,
  onExtract,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    onFileSelect(file);
  };

  return (
    <div className="rounded-sm border border-border bg-card p-5">
      <SectionKicker>Step 2</SectionKicker>
      <h4
        className="mt-1 font-display font-medium text-foreground"
        style={{ fontSize: 16, lineHeight: 1.2 }}
      >
        Upload document
      </h4>

      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        <label>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.tiff,.tif,.docx,.txt"
            onChange={handleChange}
            className="hidden"
            disabled={extracting}
          />
          <span
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-[13px] text-foreground hover:bg-muted"
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileRef.current?.click();
              }
            }}
          >
            <PaperClipIcon className="h-4 w-4" />
            {selectedFile ? selectedFile.name : 'Choose file'}
          </span>
        </label>
        {selectedFile && (
          <span
            className="font-mono text-[11px] tabular-nums text-muted-foreground"
            style={{ letterSpacing: '0.04em' }}
          >
            {(selectedFile.size / 1024).toFixed(0)} KB
          </span>
        )}
      </div>

      {selectedFile && (
        <Button
          type="button"
          onClick={onExtract}
          disabled={extracting}
          className="mt-3 gap-1.5"
        >
          <SparklesIcon className="h-4 w-4" />
          {extracting ? 'Extracting…' : `Extract with ${templateName || 'template'}`}
        </Button>
      )}

      {extracting && (
        <>
          <div
            className="mt-3 h-1 w-full overflow-hidden rounded-full"
            style={{ background: 'var(--muted)' }}
          >
            <div
              className="h-full animate-pulse"
              style={{ width: '40%', background: 'var(--accent)' }}
            />
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">
            Analyzing document with Claude Sonnet — this may take 15-30 seconds for large
            documents.
          </p>
        </>
      )}
    </div>
  );
}
