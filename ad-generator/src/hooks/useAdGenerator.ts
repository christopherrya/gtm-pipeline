import { useState, useCallback, useRef } from 'react';
import type { AdCopy, AdVariant, TemplateId } from '@/types/ad';
import { DEFAULT_COPY, AD_FORMATS } from '@/lib/constants';
import { generateAdImage, generateCopyVariants, type ImageModel } from '@/lib/ai';

let variantIdCounter = 0;

export function useAdGenerator() {
  const [copy, setCopy] = useState<AdCopy>(DEFAULT_COPY);
  const [variants, setVariants] = useState<AdVariant[]>([]);
  const [selectedTemplates, setSelectedTemplates] = useState<TemplateId[]>(['hero', 'cta']);
  const [selectedFormats, setSelectedFormats] = useState<string[]>(['square']);
  const [variantCount, setVariantCount] = useState(3);
  const [formatFilter, setFormatFilter] = useState('all');
  const [overlayOpacity, setOverlayOpacity] = useState(0.45);

  // Image generation state
  const [imagePrompt, setImagePrompt] = useState('');
  const [imageModel, setImageModel] = useState<ImageModel>('gemini-2.5-flash-image');
  const [imageEnabled, setImageEnabled] = useState(false);
  const [generatingImages, setGeneratingImages] = useState(false);
  const [generatingCopy, setGeneratingCopy] = useState(false);
  const abortRef = useRef(false);

  const toggleTemplate = useCallback((id: TemplateId) => {
    setSelectedTemplates(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    );
  }, []);

  const toggleFormat = useCallback((id: string) => {
    setSelectedFormats(prev =>
      prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]
    );
  }, []);

  const generateVariants = useCallback(async () => {
    const formats = AD_FORMATS.filter(f => selectedFormats.includes(f.id));

    // Step 1: Generate copy variants from Claude
    setGeneratingCopy(true);
    let copyVariants: AdCopy[];
    try {
      copyVariants = await generateCopyVariants(copy, variantCount);
    } catch (err) {
      console.error('Copy variant generation failed:', err);
      // Fallback: use the base copy repeated
      copyVariants = Array.from({ length: variantCount }, () => ({ ...copy }));
    }
    setGeneratingCopy(false);

    // Step 2: Create variants = copyVariants × templates × formats
    const newVariants: AdVariant[] = [];
    for (let ci = 0; ci < copyVariants.length; ci++) {
      for (const templateId of selectedTemplates) {
        for (const format of formats) {
          newVariants.push({
            id: `variant-${++variantIdCounter}`,
            templateId,
            format,
            copy: copyVariants[ci],
            copyVariantIndex: ci,
            enabled: true,
          });
        }
      }
    }

    setVariants(newVariants);

    // Step 3: If image generation is enabled, generate images
    if (imageEnabled && imagePrompt.trim()) {
      setGeneratingImages(true);
      abortRef.current = false;

      // Generate one image per unique format (reuse across same-format variants)
      const uniqueFormats = formats.map(f => ({ ...f }));
      const imageCache = new Map<string, string>();

      for (const format of uniqueFormats) {
        if (abortRef.current) break;
        try {
          const image = await generateAdImage(
            imagePrompt.trim(),
            imageModel,
            format.width,
            format.height,
          );
          imageCache.set(format.id, image);
          // Apply to all variants with this format
          setVariants(prev =>
            prev.map(v => v.format.id === format.id ? { ...v, backgroundImage: image } : v)
          );
        } catch (err) {
          console.error(`Image generation failed for format ${format.id}:`, err);
        }
      }

      setGeneratingImages(false);
    }
  }, [copy, variantCount, selectedTemplates, selectedFormats, imageEnabled, imagePrompt, imageModel]);

  const toggleVariant = useCallback((id: string) => {
    setVariants(prev =>
      prev.map(v => v.id === id ? { ...v, enabled: !v.enabled } : v)
    );
  }, []);

  const setVariantBackground = useCallback((id: string, backgroundImage: string | undefined) => {
    setVariants(prev =>
      prev.map(v => v.id === id ? { ...v, backgroundImage } : v)
    );
  }, []);

  const setAllBackgrounds = useCallback((backgroundImage: string | undefined) => {
    setVariants(prev =>
      prev.map(v => v.enabled ? { ...v, backgroundImage } : v)
    );
  }, []);

  return {
    copy, setCopy,
    variants, setVariants,
    selectedTemplates, toggleTemplate,
    selectedFormats, toggleFormat,
    variantCount, setVariantCount,
    formatFilter, setFormatFilter,
    generateVariants,
    toggleVariant,
    setVariantBackground,
    setAllBackgrounds,
    overlayOpacity, setOverlayOpacity,
    // Image generation
    imagePrompt, setImagePrompt,
    imageModel, setImageModel,
    imageEnabled, setImageEnabled,
    generatingImages,
    generatingCopy,
  };
}
