import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { generateCopyVariants } from '@/lib/ai';
import type { AdCopy } from '@/types/ad';
import { Sparkles, Loader2 } from 'lucide-react';

interface AIAssistantProps {
  onGenerateCopy: (copy: AdCopy) => void;
  currentCopy: AdCopy;
}

const QUICK_PROMPTS = [
  'Focus on saving time',
  'Emphasize risk reduction',
  'Target new agents',
  'Urgency / FOMO',
  'Social proof & trust',
  'Cost savings angle',
];

export const AIAssistant = ({ onGenerateCopy, currentCopy }: AIAssistantProps) => {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async (overridePrompt?: string) => {
    const direction = (overridePrompt ?? prompt).trim();
    if (!direction) return;

    setLoading(true);
    setError(null);
    try {
      const variants = await generateCopyVariants(
        currentCopy,
        1,
        direction,
      );
      if (variants.length > 0) {
        onGenerateCopy(variants[0]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate copy');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <Textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe your ad angle... e.g. 'ChatGPT can only handle 2-3 docs — Discloser bulk processes everything instantly' or 'Target luxury listing agents worried about liability'"
        rows={3}
        className="resize-none text-sm"
      />
      <div className="flex flex-wrap gap-1.5">
        {QUICK_PROMPTS.map((qp) => (
          <button
            key={qp}
            onClick={() => { setPrompt(qp); handleGenerate(qp); }}
            disabled={loading}
            className="text-xs px-2.5 py-1 rounded-full bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {qp}
          </button>
        ))}
      </div>
      <Button onClick={() => handleGenerate()} disabled={loading || !prompt.trim()} size="sm" className="w-full gap-2">
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Writing copy...
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" />
            Generate Ad Copy
          </>
        )}
      </Button>
      {error && (
        <p className="text-sm text-destructive">{error}</p>
      )}
    </div>
  );
};
