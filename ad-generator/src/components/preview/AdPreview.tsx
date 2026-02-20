import { useState } from 'react';
import type { AdVariant } from '@/types/ad';
import { TemplateWrapper } from '@/components/templates';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { TEMPLATES } from '@/lib/constants';
import { renderTemplate } from './renderTemplate';

interface AdPreviewProps {
  variant: AdVariant;
  onToggle: (id: string) => void;
  renderRef?: (el: HTMLDivElement | null) => void;
  overlayOpacity?: number;
}

export const AdPreview = ({ variant, onToggle, renderRef, overlayOpacity = 0.45 }: AdPreviewProps) => {
  const [expanded, setExpanded] = useState(false);
  const templateConfig = TEMPLATES.find(t => t.id === variant.templateId);

  return (
    <>
      <div className={`rounded-lg border bg-card p-3 transition-opacity ${variant.enabled ? 'opacity-100' : 'opacity-40'}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">{templateConfig?.name}</Badge>
            <Badge variant="secondary" className="text-xs">{variant.format.label.split(' ')[0]}</Badge>
          </div>
          <Switch checked={variant.enabled} onCheckedChange={() => onToggle(variant.id)} />
        </div>

        <div
          className="cursor-pointer rounded overflow-hidden bg-muted"
          onClick={() => setExpanded(true)}
        >
          <TemplateWrapper format={variant.format} scale={0.3}>
            {renderTemplate(variant, overlayOpacity)}
          </TemplateWrapper>
        </div>
      </div>

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="max-w-[90vw] max-h-[90vh] overflow-auto">
          <DialogTitle>{templateConfig?.name} - {variant.format.label}</DialogTitle>
          <DialogDescription>Preview at 50% scale. Export for full resolution.</DialogDescription>
          <div className="flex justify-center overflow-auto">
            <TemplateWrapper format={variant.format} scale={0.5}>
              {renderTemplate(variant, overlayOpacity)}
            </TemplateWrapper>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};
