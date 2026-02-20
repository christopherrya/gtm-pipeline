import { useAdGeneratorContext } from '@/context/AdGeneratorContext';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ImageIcon, Zap, Sparkles } from 'lucide-react';
import type { ImageModel } from '@/lib/ai';

const MODELS: { id: ImageModel; label: string; desc: string }[] = [
  {
    id: 'gemini-2.5-flash-image',
    label: 'Flash',
    desc: 'Fast (~5s each)',
  },
  {
    id: 'gemini-3-pro-image-preview',
    label: 'Pro',
    desc: 'Higher quality',
  },
];

const PROMPT_SUGGESTIONS = [
  'Luxury California real estate, aerial view of hillside mansion at golden hour',
  'Modern home interior with natural light, minimalist design, warm tones',
  'Silicon Valley skyline at sunset with rolling hills',
  'Abstract geometric pattern in navy blue and amber gold',
  'Professional real estate workspace with documents and laptop',
  'Coastal California landscape, Pacific Ocean cliffs at dusk',
];

export const ImageGenerator = () => {
  const {
    imagePrompt, setImagePrompt,
    imageModel, setImageModel,
    imageEnabled, setImageEnabled,
    generatingImages,
  } = useAdGeneratorContext();

  return (
    <div className="space-y-4">
      {/* Header with toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ImageIcon className="h-5 w-5 text-amber-500" />
          <h3 className="font-semibold">AI Image Generation</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {imageEnabled ? 'On' : 'Off'}
          </span>
          <Switch
            checked={imageEnabled}
            onCheckedChange={setImageEnabled}
          />
        </div>
      </div>

      {imageEnabled && (
        <>
          <p className="text-xs text-muted-foreground">
            Each variant will get a unique AI-generated image integrated into the ad creative.
            Images generate when you click "Generate All Variants" below.
          </p>

          {/* Prompt input */}
          <div className="space-y-2">
            <Label htmlFor="image-prompt">Image prompt</Label>
            <Textarea
              id="image-prompt"
              placeholder="e.g., Luxury California real estate, aerial view of mansion at golden hour..."
              value={imagePrompt}
              onChange={(e) => setImagePrompt(e.target.value)}
              rows={3}
              className="resize-none"
            />
          </div>

          {/* Quick prompts */}
          <div className="flex flex-wrap gap-1.5">
            {PROMPT_SUGGESTIONS.map((suggestion, i) => (
              <button
                key={i}
                onClick={() => setImagePrompt(suggestion)}
                className="text-xs px-2.5 py-1 rounded-full bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors truncate max-w-[200px]"
              >
                {suggestion.length > 40 ? suggestion.slice(0, 40) + '...' : suggestion}
              </button>
            ))}
          </div>

          {/* Model selector */}
          <div className="space-y-2">
            <Label>Model</Label>
            <div className="grid grid-cols-2 gap-2">
              {MODELS.map(model => (
                <button
                  key={model.id}
                  onClick={() => setImageModel(model.id)}
                  className={`flex flex-col items-start p-3 rounded-lg border text-left transition-colors ${
                    imageModel === model.id
                      ? 'border-amber-500 bg-amber-50'
                      : 'border-border hover:border-amber-300'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    {model.label === 'Flash' ? (
                      <Zap className="h-3.5 w-3.5 text-amber-500" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                    )}
                    <span className="font-medium text-sm">{model.label}</span>
                  </div>
                  <span className="text-xs text-muted-foreground mt-0.5">{model.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {generatingImages && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm">
              <div className="h-4 w-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
              Generating images for variants...
            </div>
          )}
        </>
      )}
    </div>
  );
};
