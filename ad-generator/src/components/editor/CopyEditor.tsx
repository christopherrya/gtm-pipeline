import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { COPY_LIMITS } from '@/lib/constants';
import type { AdCopy } from '@/types/ad';

interface CopyEditorProps {
  copy: AdCopy;
  onChange: (copy: AdCopy) => void;
}

function CharCount({ current, max }: { current: number; max: number }) {
  const ratio = current / max;
  const isWarning = ratio >= 0.85;
  const isOver = current > max;

  return (
    <span
      className={`text-xs tabular-nums ${
        isOver
          ? 'text-destructive font-semibold'
          : isWarning
            ? 'text-amber-500'
            : 'text-muted-foreground'
      }`}
    >
      {current}/{max}
    </span>
  );
}

export const CopyEditor = ({ copy, onChange }: CopyEditorProps) => {
  const updateField = (field: keyof AdCopy, value: string) => {
    onChange({ ...copy, [field]: value });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="headline">Headline</Label>
          <CharCount current={copy.headline.length} max={COPY_LIMITS.headline} />
        </div>
        <Input
          id="headline"
          value={copy.headline}
          onChange={(e) => updateField('headline', e.target.value)}
          placeholder="Enter headline..."
          maxLength={COPY_LIMITS.headline}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="primaryText">Primary Text</Label>
          <CharCount current={copy.primaryText.length} max={COPY_LIMITS.primaryText} />
        </div>
        <Textarea
          id="primaryText"
          value={copy.primaryText}
          onChange={(e) => updateField('primaryText', e.target.value)}
          placeholder="Enter primary text..."
          maxLength={COPY_LIMITS.primaryText}
          rows={3}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="description">Description</Label>
          <CharCount current={copy.description.length} max={COPY_LIMITS.description} />
        </div>
        <Textarea
          id="description"
          value={copy.description}
          onChange={(e) => updateField('description', e.target.value)}
          placeholder="Enter description..."
          maxLength={COPY_LIMITS.description}
          rows={2}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="ctaText">CTA Text</Label>
          <CharCount current={copy.ctaText.length} max={COPY_LIMITS.ctaText} />
        </div>
        <Input
          id="ctaText"
          value={copy.ctaText}
          onChange={(e) => updateField('ctaText', e.target.value)}
          placeholder="Enter CTA text..."
          maxLength={COPY_LIMITS.ctaText}
        />
      </div>
    </div>
  );
};
