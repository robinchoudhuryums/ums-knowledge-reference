import type { ExtractionTemplateField } from '../services/api';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export type FieldValue = string | number | boolean | null;

interface Props {
  field: ExtractionTemplateField;
  value: FieldValue;
  onChange: (key: string, value: FieldValue) => void;
}

/**
 * Render a single extraction-template field. Branches by `field.type`
 * to produce the right control (input / textarea / select / date). All
 * inputs use shadcn primitives or hairline-bordered natives that pick
 * up the warm-paper tokens via `bg-background` / `border-border`.
 */
export function DocumentExtractorFieldRenderer({ field, value, onChange }: Props) {
  const displayValue = value === null ? '' : String(value);

  switch (field.type) {
    case 'textarea':
      return (
        <Textarea
          value={displayValue}
          onChange={(e) => onChange(field.key, e.target.value || null)}
          rows={3}
          placeholder={`Enter ${field.label.toLowerCase()}…`}
        />
      );

    case 'select':
      return (
        <select
          value={displayValue}
          onChange={(e) => onChange(field.key, e.target.value || null)}
          className="h-10 w-full rounded-md border border-border bg-background px-3 text-[13px] text-foreground"
        >
          <option value="">— Select —</option>
          {field.options?.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );

    case 'number':
      return (
        <Input
          type="number"
          value={displayValue}
          onChange={(e) => onChange(field.key, e.target.value ? Number(e.target.value) : null)}
          placeholder={`Enter ${field.label.toLowerCase()}…`}
        />
      );

    case 'boolean':
      return (
        <select
          value={value === null ? '' : String(value)}
          onChange={(e) => {
            const v = e.target.value;
            onChange(field.key, v === '' ? null : v === 'true');
          }}
          className="h-10 w-full rounded-md border border-border bg-background px-3 text-[13px] text-foreground"
        >
          <option value="">— Select —</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );

    case 'date':
      return (
        <Input
          type="date"
          value={displayValue}
          onChange={(e) => onChange(field.key, e.target.value || null)}
        />
      );

    default:
      return (
        <Input
          type="text"
          value={displayValue}
          onChange={(e) => onChange(field.key, e.target.value || null)}
          placeholder={`Enter ${field.label.toLowerCase()}…`}
        />
      );
  }
}
