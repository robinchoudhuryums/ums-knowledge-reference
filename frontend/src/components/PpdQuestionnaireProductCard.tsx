/**
 * PpdQuestionnaireProductCard — Renders a single PMD recommendation result
 * (image + HCPCS + justification + copy buttons + preferred/status controls).
 */

import { Button } from '@/components/ui/button';
import { convertToPng, type Lang, type RecommendationProduct } from './PpdQuestionnaireShared';

export function PpdQuestionnaireProductCard({
  product,
  idx,
  lang,
  preferred,
  onPreferredChange,
  productStatus,
  onStatusChange,
  copiedId,
  onCopied,
}: {
  product: RecommendationProduct;
  idx: number;
  lang: Lang;
  preferred: string;
  onPreferredChange: (key: string) => void;
  productStatus: Record<string, string>;
  onStatusChange: (key: string, value: string) => void;
  copiedId: string;
  onCopied: (id: string) => void;
}) {
  const key = `${product.category}_${idx}`;
  const p = product;

  const copyImage = async () => {
    if (!p.imageUrl) return;
    try {
      const res = await fetch(p.imageUrl, { credentials: 'same-origin' });
      const blob = await res.blob();
      const pngBlob = blob.type === 'image/png' ? blob : await convertToPng(blob);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
    } catch {
      navigator.clipboard.writeText(p.imageUrl).catch(() => {});
    }
    onCopied(`img_${key}`);
  };

  return (
    <div className="mb-3 flex flex-col gap-4 rounded-sm border border-border bg-card p-4 shadow-sm transition-shadow hover:shadow-md sm:flex-row">
      {p.imageUrl && (
        <img
          src={p.imageUrl}
          alt={p.hcpcsCode}
          className="h-[150px] w-full flex-shrink-0 rounded-sm border border-border bg-muted object-contain sm:w-[150px]"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      )}
      <div className="min-w-0 flex-1">
        {p.brochureUrl ? (
          <a
            href={p.brochureUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[15px] font-semibold text-accent hover:underline"
          >
            {p.hcpcsCode}
          </a>
        ) : (
          <span className="font-mono text-[15px] font-semibold text-accent">{p.hcpcsCode}</span>
        )}

        {p.description && (
          <div className="mt-0.5 text-[14px] font-medium text-foreground">{p.description}</div>
        )}
        <p className="mt-1.5 text-[13px] text-muted-foreground">{p.justification}</p>

        {(p.seatDimensions || p.colors || p.leadTime || p.notes) && (
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[12px]">
            {p.seatDimensions && (
              <>
                <dt className="font-mono uppercase tracking-wider text-muted-foreground">Seat</dt>
                <dd className="text-foreground">{p.seatDimensions}</dd>
              </>
            )}
            {p.colors && (
              <>
                <dt className="font-mono uppercase tracking-wider text-muted-foreground">Colors</dt>
                <dd className="text-foreground">{p.colors}</dd>
              </>
            )}
            {p.leadTime && (
              <>
                <dt className="font-mono uppercase tracking-wider text-muted-foreground">Lead time</dt>
                <dd className="text-foreground">{p.leadTime}</dd>
              </>
            )}
            {p.notes && (
              <>
                <dt className="font-mono uppercase tracking-wider text-muted-foreground">Notes</dt>
                <dd className="text-foreground">{p.notes}</dd>
              </>
            )}
          </dl>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {p.imageUrl && (
            <Button type="button" variant="outline" size="sm" onClick={copyImage}>
              {copiedId === `img_${key}` ? 'Copied!' : lang === 'en' ? 'Copy image' : 'Copiar imagen'}
            </Button>
          )}
          {p.brochureUrl && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(p.brochureUrl!);
                onCopied(`pdf_${key}`);
              }}
            >
              {copiedId === `pdf_${key}`
                ? 'Copied!'
                : lang === 'en'
                  ? 'Copy brochure link'
                  : 'Copiar folleto'}
            </Button>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-[13px] text-foreground">
            <input
              type="radio"
              name="preferred_product"
              checked={preferred === key}
              onChange={() => onPreferredChange(key)}
              style={{ accentColor: 'var(--accent)' }}
            />
            {lang === 'en' ? 'Preferred' : 'Preferido'}
          </label>
          <select
            value={productStatus[key] || 'undecided'}
            onChange={(e) => onStatusChange(key, e.target.value)}
            className="h-8 rounded-md border border-border bg-background px-2 text-[12px] text-foreground"
          >
            <option value="undecided">{lang === 'en' ? 'Undecided' : 'Indeciso'}</option>
            <option value="accept">{lang === 'en' ? 'Accept' : 'Aceptar'}</option>
            <option value="reject">{lang === 'en' ? 'Reject' : 'Rechazar'}</option>
          </select>
        </div>
      </div>
    </div>
  );
}
