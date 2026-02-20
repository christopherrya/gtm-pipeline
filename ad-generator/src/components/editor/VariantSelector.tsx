import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TEMPLATES, AD_FORMATS, VARIANT_COUNTS } from '@/lib/constants';
import type { TemplateId } from '@/types/ad';
import { ImageIcon, Loader2, Sparkles } from 'lucide-react';

interface VariantSelectorProps {
  variantCount: number;
  onVariantCountChange: (n: number) => void;
  selectedTemplates: TemplateId[];
  onToggleTemplate: (id: TemplateId) => void;
  selectedFormats: string[];
  onToggleFormat: (id: string) => void;
  onGenerate: () => void;
  imageEnabled?: boolean;
  generatingImages?: boolean;
  generatingCopy?: boolean;
}

export const VariantSelector = ({
  variantCount,
  onVariantCountChange,
  selectedTemplates,
  onToggleTemplate,
  selectedFormats,
  onToggleFormat,
  onGenerate,
  imageEnabled = false,
  generatingImages = false,
  generatingCopy = false,
}: VariantSelectorProps) => {
  const totalAds = variantCount * selectedTemplates.length * selectedFormats.length;
  const isGenerating = generatingCopy || generatingImages;

  return (
    <div className="space-y-6">
      {/* Copy Variants */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Copy Variants</h3>
        <p className="text-xs text-muted-foreground">
          AI generates different copy angles from your base copy
        </p>
        <div className="flex gap-2">
          {VARIANT_COUNTS.map((count) => (
            <Button
              key={count}
              variant={variantCount === count ? 'default' : 'outline'}
              size="sm"
              onClick={() => onVariantCountChange(count)}
            >
              {count}
            </Button>
          ))}
        </div>
      </div>

      {/* Template Selection */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Templates</h3>
        <div className="flex flex-wrap gap-2">
          {TEMPLATES.map((template) => {
            const isSelected = selectedTemplates.includes(template.id);
            return (
              <Badge
                key={template.id}
                variant={isSelected ? 'default' : 'outline'}
                className="cursor-pointer select-none transition-colors"
                onClick={() => onToggleTemplate(template.id)}
              >
                {template.name}
              </Badge>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          {selectedTemplates.length} of {TEMPLATES.length} selected
        </p>
      </div>

      {/* Format Selection */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Formats</h3>
        <div className="flex flex-wrap gap-2">
          {AD_FORMATS.map((format) => {
            const isSelected = selectedFormats.includes(format.id);
            return (
              <Badge
                key={format.id}
                variant={isSelected ? 'default' : 'outline'}
                className="cursor-pointer select-none transition-colors"
                onClick={() => onToggleFormat(format.id)}
              >
                {format.label}
              </Badge>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          {selectedFormats.length} of {AD_FORMATS.length} selected
        </p>
      </div>

      {/* Summary + Generate Button */}
      <div className="pt-2 space-y-3">
        {totalAds > 0 && (
          <div className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3 space-y-1">
            <div className="font-medium text-foreground">Output breakdown</div>
            <div>{variantCount} copy variant{variantCount !== 1 ? 's' : ''} x {selectedTemplates.length} template{selectedTemplates.length !== 1 ? 's' : ''} x {selectedFormats.length} format{selectedFormats.length !== 1 ? 's' : ''} = <span className="font-semibold text-foreground">{totalAds} ads</span></div>
          </div>
        )}
        <Button
          onClick={onGenerate}
          className="w-full"
          disabled={selectedTemplates.length === 0 || selectedFormats.length === 0 || isGenerating}
        >
          {generatingCopy ? (
            <>
              <Sparkles className="h-4 w-4 mr-2 animate-pulse" />
              Generating Copy Variants...
            </>
          ) : generatingImages ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Generating Images...
            </>
          ) : (
            <>
              Generate All Variants
              {imageEnabled && <ImageIcon className="h-4 w-4 ml-1.5 opacity-60" />}
              {totalAds > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {totalAds}
                </Badge>
              )}
            </>
          )}
        </Button>
      </div>
    </div>
  );
};
