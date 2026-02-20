import { useState } from 'react';
import type { AdVariant } from '@/types/ad';
import { TemplateWrapper } from '@/components/templates';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { TEMPLATES } from '@/lib/constants';
import { renderTemplate } from './renderTemplate';
import { FlipHorizontal, RefreshCw, Loader2 } from 'lucide-react';

interface AdPreviewProps {
  variant: AdVariant;
  onToggle: (id: string) => void;
  onToggleLayout?: (id: string) => void;
  onRegenerateImage?: (id: string, prompt: string) => Promise<void>;
  renderRef?: (el: HTMLDivElement | null) => void;
  overlayOpacity?: number;
}

export const AdPreview = ({ variant, onToggle, onToggleLayout, onRegenerateImage, renderRef, overlayOpacity = 0.45 }: AdPreviewProps) => {
  const [expanded, setExpanded] = useState(false);
  const [regenPrompt, setRegenPrompt] = useState('');
  const [regenerating, setRegenerating] = useState(false);
  const [showRegen, setShowRegen] = useState(false);
  const templateConfig = TEMPLATES.find(t => t.id === variant.templateId);

  const handleRegenerate = async () => {
    if (!onRegenerateImage || !regenPrompt.trim()) return;
    setRegenerating(true);
    try {
      await onRegenerateImage(variant.id, regenPrompt.trim());
      setShowRegen(false);
      setRegenPrompt('');
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <>
      <div className={`rounded-lg border bg-card p-3 transition-opacity ${variant.enabled ? 'opacity-100' : 'opacity-40'}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">{templateConfig?.name}</Badge>
            <Badge variant="secondary" className="text-xs">{variant.format.label.split(' ')[0]}</Badge>
          </div>
          <div className="flex items-center gap-1.5">
            {/* Layout flip button (only if variant has an image) */}
            {variant.backgroundImage && onToggleLayout && (
              <button
                onClick={() => onToggleLayout(variant.id)}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Flip layout"
              >
                <FlipHorizontal className="h-3.5 w-3.5" />
              </button>
            )}
            {/* Regenerate image button */}
            {variant.backgroundImage && onRegenerateImage && (
              <button
                onClick={() => setShowRegen(!showRegen)}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Regenerate image"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            )}
            <Switch checked={variant.enabled} onCheckedChange={() => onToggle(variant.id)} />
          </div>
        </div>

        {/* Image regeneration inline */}
        {showRegen && (
          <div className="mb-2 space-y-1.5">
            <Textarea
              value={regenPrompt}
              onChange={e => setRegenPrompt(e.target.value)}
              placeholder="New image prompt... e.g. 'same scene but warmer tones'"
              rows={2}
              className="resize-none text-xs"
            />
            <Button
              size="sm"
              className="w-full gap-1.5 text-xs"
              disabled={regenerating || !regenPrompt.trim()}
              onClick={handleRegenerate}
            >
              {regenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              {regenerating ? 'Generating...' : 'Regenerate Image'}
            </Button>
          </div>
        )}

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
