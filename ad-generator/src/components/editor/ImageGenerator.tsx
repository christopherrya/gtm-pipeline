import { useCallback, useRef } from 'react';
import { useAdGeneratorContext } from '@/context/AdGeneratorContext';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { ImageIcon, Zap, Sparkles, Upload, Camera, Monitor, Wand2 } from 'lucide-react';
import type { ImageModel } from '@/lib/ai';
import type { ImageMode } from '@/types/ad';

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

const IMAGE_MODES: { id: ImageMode; label: string; desc: string; icon: typeof Camera }[] = [
  {
    id: 'photograph',
    label: 'Photography',
    desc: 'Editorial-style photographs',
    icon: Camera,
  },
  {
    id: 'product-context',
    label: 'Product in Context',
    desc: 'Lifestyle shots with devices',
    icon: Monitor,
  },
];

// Direct-response ad image prompts organized by category
const PROMPT_CATEGORIES: { category: string; suggestions: string[] }[] = [
  {
    category: 'Problem-Aware',
    suggestions: [
      'Stressed real estate agent buried in paperwork at a messy desk, overwhelmed expression, stacks of documents',
      'Close-up of hands flipping through thick disclosure documents, reading glasses, late night desk lamp',
      'Agent on phone looking worried with a pile of unread disclosure packets on the table',
    ],
  },
  {
    category: 'Solution-Aware',
    suggestions: [
      'Confident agent on a tablet reviewing a property report in a bright modern office, calm and organized',
      'Professional woman smiling at her laptop in a sunlit workspace, clean desk, coffee nearby',
      'Agent showing a client a tablet screen during a home walkthrough, both looking pleased',
    ],
  },
  {
    category: 'Lifestyle',
    suggestions: [
      'Real estate agent leaving the office early, golden hour sunlight, car keys in hand, relaxed smile',
      'Agent enjoying coffee on a patio with a laptop, California hills in background, work-life balance',
      'Team of agents celebrating a closed deal in a modern office, high-five moment',
    ],
  },
  {
    category: 'Property & Setting',
    suggestions: [
      'Beautiful California craftsman home exterior at golden hour, manicured lawn, warm inviting light',
      'Modern Silicon Valley townhome with clean landscaping, blue sky, fresh and aspirational',
      'Aerial view of a coastal California neighborhood, Pacific Ocean in distance, real estate context',
    ],
  },
];

const PRODUCT_CONTEXT_SUGGESTIONS = [
  'Agent reviewing documents on a tablet at an open house, modern kitchen in background',
  'Hands typing on a laptop at a bright café, property listing printouts beside the keyboard',
  'Over-the-shoulder view of someone on a laptop in a home office, clean minimal workspace',
  'Agent at a desk with a laptop showing abstract charts, phone nearby, professional setting',
  'Two agents at a table discussing over a tablet, modern office with glass walls',
  'Close-up of hands holding a tablet in a staged living room during a showing',
];

export const ImageGenerator = () => {
  const {
    imagePrompt, setImagePrompt,
    imageModel, setImageModel,
    imageEnabled, setImageEnabled,
    imageMode, setImageMode,
    imageSource, setImageSource,
    uploadedImages, setUploadedImages,
    imagesPerFormat, setImagesPerFormat,
    autoAlignImages, setAutoAlignImages,
    generatingImages,
  } = useAdGeneratorContext();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        setUploadedImages((prev: string[]) => [...prev, dataUrl]);
      };
      reader.readAsDataURL(file);
    });

    // Reset input so same file can be re-selected
    e.target.value = '';
  }, [setUploadedImages]);

  const removeUploadedImage = useCallback((index: number) => {
    setUploadedImages((prev: string[]) => prev.filter((_: string, i: number) => i !== index));
  }, [setUploadedImages]);

  const activeSuggestions = imageMode === 'product-context'
    ? [{ category: 'Product in Context', suggestions: PRODUCT_CONTEXT_SUGGESTIONS }]
    : PROMPT_CATEGORIES;

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
            Images are generated for each variant when you click "Generate All Variants" below.
          </p>

          {/* Image Source: AI Generate vs Upload */}
          <div className="space-y-2">
            <Label>Image Source</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setImageSource('ai')}
                className={`flex items-center gap-2 p-3 rounded-lg border text-left transition-colors ${
                  imageSource === 'ai'
                    ? 'border-amber-500 bg-amber-50'
                    : 'border-border hover:border-amber-300'
                }`}
              >
                <Sparkles className="h-4 w-4 text-amber-500" />
                <div>
                  <div className="font-medium text-sm">AI Generate</div>
                  <div className="text-xs text-muted-foreground">Create with Gemini</div>
                </div>
              </button>
              <button
                onClick={() => setImageSource('upload')}
                className={`flex items-center gap-2 p-3 rounded-lg border text-left transition-colors ${
                  imageSource === 'upload'
                    ? 'border-amber-500 bg-amber-50'
                    : 'border-border hover:border-amber-300'
                }`}
              >
                <Upload className="h-4 w-4 text-amber-500" />
                <div>
                  <div className="font-medium text-sm">Upload</div>
                  <div className="text-xs text-muted-foreground">Use your own images</div>
                </div>
              </button>
            </div>
          </div>

          {/* Upload section */}
          {imageSource === 'upload' && (
            <div className="space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileUpload}
                className="hidden"
              />
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4" />
                Upload Images
              </Button>
              {uploadedImages.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {uploadedImages.map((img: string, i: number) => (
                    <div key={i} className="relative group rounded-lg overflow-hidden border">
                      <img src={img} className="w-full h-20 object-cover" />
                      <button
                        onClick={() => removeUploadedImage(i)}
                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Upload {uploadedImages.length > 0 ? 'more images' : 'images'} to distribute across your ad variants.
                Images will be auto-cropped to fit each format.
              </p>
            </div>
          )}

          {/* AI Generation settings */}
          {imageSource === 'ai' && (
            <>
              {/* Image Mode: Photograph vs Product Context */}
              <div className="space-y-2">
                <Label>Image Style</Label>
                <div className="grid grid-cols-2 gap-2">
                  {IMAGE_MODES.map(mode => {
                    const Icon = mode.icon;
                    return (
                      <button
                        key={mode.id}
                        onClick={() => setImageMode(mode.id)}
                        className={`flex flex-col items-start p-3 rounded-lg border text-left transition-colors ${
                          imageMode === mode.id
                            ? 'border-amber-500 bg-amber-50'
                            : 'border-border hover:border-amber-300'
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <Icon className="h-3.5 w-3.5 text-amber-500" />
                          <span className="font-medium text-sm">{mode.label}</span>
                        </div>
                        <span className="text-xs text-muted-foreground mt-0.5">{mode.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Auto-align toggle */}
              <div className="flex items-center justify-between p-3 rounded-lg border">
                <div className="flex items-center gap-2">
                  <Wand2 className="h-4 w-4 text-amber-500" />
                  <div>
                    <div className="text-sm font-medium">Auto-align images to copy</div>
                    <div className="text-xs text-muted-foreground">AI generates image prompts that match each copy variant's angle</div>
                  </div>
                </div>
                <Switch
                  checked={autoAlignImages}
                  onCheckedChange={setAutoAlignImages}
                />
              </div>

              {/* Manual prompt input (shown when auto-align is off) */}
              {!autoAlignImages && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="image-prompt">Image prompt</Label>
                    <Textarea
                      id="image-prompt"
                      placeholder={imageMode === 'product-context'
                        ? 'e.g., Agent reviewing documents on a tablet at an open house...'
                        : 'e.g., Confident real estate agent in a modern office, reviewing property documents...'}
                      value={imagePrompt}
                      onChange={(e) => setImagePrompt(e.target.value)}
                      rows={3}
                      className="resize-none"
                    />
                  </div>

                  {/* Category-organized quick prompts */}
                  <div className="space-y-2">
                    {activeSuggestions.map((cat) => (
                      <div key={cat.category}>
                        <div className="text-xs font-medium text-muted-foreground mb-1">{cat.category}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {cat.suggestions.map((suggestion, i) => (
                            <button
                              key={i}
                              onClick={() => setImagePrompt(suggestion)}
                              className="text-xs px-2.5 py-1 rounded-full bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors truncate max-w-[220px]"
                            >
                              {suggestion.length > 45 ? suggestion.slice(0, 45) + '...' : suggestion}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Images per format */}
              <div className="space-y-2">
                <Label>Images per format</Label>
                <p className="text-xs text-muted-foreground">
                  More images = more visual diversity across variants (each takes ~5s)
                </p>
                <div className="flex gap-2">
                  {[1, 2, 3].map(n => (
                    <Button
                      key={n}
                      variant={imagesPerFormat === n ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setImagesPerFormat(n)}
                    >
                      {n}
                    </Button>
                  ))}
                </div>
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
            </>
          )}

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
