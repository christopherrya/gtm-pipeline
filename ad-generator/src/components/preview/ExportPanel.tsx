import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { useAdGeneratorContext } from '@/context/AdGeneratorContext';
import { exportBulkZip } from '@/lib/export';
import { Download, Loader2 } from 'lucide-react';
import { TemplateWrapper } from '@/components/templates';
import { renderTemplate } from './renderTemplate';

export const ExportPanel = () => {
  const { variants, overlayOpacity } = useAdGeneratorContext();
  const [exporting, setExporting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const enabledVariants = variants.filter(v => v.enabled);

  const handleExport = useCallback(async () => {
    if (!containerRef.current || enabledVariants.length === 0) return;
    setExporting(true);

    try {
      // Wait for fonts to load
      await document.fonts.ready;

      const elements: { element: HTMLElement; filename: string }[] = [];
      const container = containerRef.current;

      // Render each variant at full resolution
      for (const variant of enabledVariants) {
        const el = container.querySelector(`[data-variant-id="${variant.id}"]`) as HTMLElement;
        if (el) {
          elements.push({
            element: el,
            filename: `discloser-${variant.templateId}-${variant.format.id}-${variant.id}.png`,
          });
        }
      }

      await exportBulkZip(elements);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  }, [enabledVariants]);

  return (
    <>
      <div className="flex items-center gap-3 p-4 border rounded-lg bg-card">
        <Button
          onClick={handleExport}
          disabled={exporting || enabledVariants.length === 0}
          className="gap-2"
        >
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {exporting ? 'Exporting...' : `Export ${enabledVariants.length} variant${enabledVariants.length !== 1 ? 's' : ''} as ZIP`}
        </Button>
        <span className="text-sm text-muted-foreground">
          {enabledVariants.length} of {variants.length} selected
        </span>
      </div>

      {/* Hidden off-screen container for full-res rendering */}
      <div
        ref={containerRef}
        style={{ position: 'absolute', left: '-99999px', top: 0 }}
        aria-hidden="true"
      >
        {enabledVariants.map(variant => (
          <div key={variant.id} data-variant-id={variant.id}>
            <TemplateWrapper format={variant.format} scale={1}>
              {renderTemplate(variant, overlayOpacity)}
            </TemplateWrapper>
          </div>
        ))}
      </div>
    </>
  );
};
