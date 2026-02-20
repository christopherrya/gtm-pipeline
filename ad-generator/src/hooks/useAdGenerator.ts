import { useState, useCallback, useRef } from 'react';
import type { AdCopy, AdVariant, TemplateId, ImageMode, ImageLayoutSide } from '@/types/ad';
import { DEFAULT_COPY, AD_FORMATS } from '@/lib/constants';
import { generateAdImage, generateCopyVariants, generateImagePrompts, type ImageModel } from '@/lib/ai';

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
  const [imageMode, setImageMode] = useState<ImageMode>('photograph');
  const [imageSource, setImageSource] = useState<'ai' | 'upload'>('ai');
  const [uploadedImages, setUploadedImages] = useState<string[]>([]);
  const [imagesPerFormat, setImagesPerFormat] = useState(1);
  const [autoAlignImages, setAutoAlignImages] = useState(false);
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
      copyVariants = Array.from({ length: variantCount }, () => ({ ...copy }));
    }
    setGeneratingCopy(false);

    // Step 2: Create variants = copyVariants × templates × formats
    // Assign image indices for diversity: rotate through available images
    const newVariants: AdVariant[] = [];
    let imgIdx = 0;
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
            imageIndex: imgIdx % Math.max(imagesPerFormat, 1),
          });
          imgIdx++;
        }
      }
    }

    setVariants(newVariants);

    // Step 3: If images are enabled, generate or apply them
    if (!imageEnabled) return;

    // --- Upload mode: distribute uploaded images across variants ---
    if (imageSource === 'upload' && uploadedImages.length > 0) {
      setVariants(prev =>
        prev.map((v, i) => ({
          ...v,
          backgroundImage: uploadedImages[i % uploadedImages.length],
        }))
      );
      return;
    }

    // --- AI generation mode ---
    if (imageSource !== 'ai') return;

    setGeneratingImages(true);
    abortRef.current = false;

    // Step 3a: If auto-align is on, generate image prompts from copy variants
    let perVariantPrompts: string[][] | null = null;
    if (autoAlignImages) {
      try {
        perVariantPrompts = await generateImagePrompts(
          copyVariants,
          imagesPerFormat,
          imageMode,
        );
      } catch (err) {
        console.error('Image prompt alignment failed, falling back to manual prompt:', err);
      }
    }

    // Step 3b: Generate images
    // Strategy: generate `imagesPerFormat` images per unique (format × prompt) combination
    // For auto-align: one set of images per copy variant per format
    // For manual: one set of images per format (shared across all copy variants)

    // imagePool[formatId][imageIndex] = base64 data URL
    const imagePool = new Map<string, Map<number, string>>();

    for (const format of formats) {
      if (abortRef.current) break;
      imagePool.set(format.id, new Map());

      if (autoAlignImages && perVariantPrompts) {
        // Auto-aligned: generate images keyed by (copyVariantIndex, formatId)
        // For each copy variant, generate imagesPerFormat images for this format
        for (let ci = 0; ci < copyVariants.length; ci++) {
          if (abortRef.current) break;
          const prompts = perVariantPrompts[ci] || [imagePrompt.trim() || 'professional real estate photography'];

          for (let pi = 0; pi < Math.min(prompts.length, imagesPerFormat); pi++) {
            if (abortRef.current) break;
            const poolKey = `${format.id}__cv${ci}__img${pi}`;
            try {
              const image = await generateAdImage(
                prompts[pi],
                imageModel,
                format.width,
                format.height,
                imageMode,
              );
              // Store in a composite key pool
              imagePool.set(poolKey, new Map([[0, image]]));

              // Apply to matching variants immediately for progressive loading
              setVariants(prev =>
                prev.map(v => {
                  if (v.format.id === format.id && v.copyVariantIndex === ci && (v.imageIndex ?? 0) === pi) {
                    return { ...v, backgroundImage: image };
                  }
                  return v;
                })
              );
            } catch (err) {
              console.error(`Image generation failed for format ${format.id}, variant ${ci}, image ${pi}:`, err);
            }
          }
        }
      } else {
        // Manual prompt: generate imagesPerFormat images per format, distribute across variants
        const basePrompt = imagePrompt.trim() || 'professional real estate photography';
        const formatImages: string[] = [];

        for (let pi = 0; pi < imagesPerFormat; pi++) {
          if (abortRef.current) break;
          try {
            const image = await generateAdImage(
              basePrompt,
              imageModel,
              format.width,
              format.height,
              imageMode,
            );
            formatImages.push(image);
            imagePool.get(format.id)!.set(pi, image);

            // Apply progressively: assign this image to variants that want imageIndex === pi
            setVariants(prev =>
              prev.map(v => {
                if (v.format.id === format.id && (v.imageIndex ?? 0) === pi) {
                  return { ...v, backgroundImage: image };
                }
                return v;
              })
            );
          } catch (err) {
            console.error(`Image generation failed for format ${format.id}, image ${pi}:`, err);
          }
        }

        // Fill any variants that didn't get an image (if fewer images generated than expected)
        if (formatImages.length > 0) {
          setVariants(prev =>
            prev.map(v => {
              if (v.format.id === format.id && !v.backgroundImage) {
                return { ...v, backgroundImage: formatImages[(v.imageIndex ?? 0) % formatImages.length] };
              }
              return v;
            })
          );
        }
      }
    }

    setGeneratingImages(false);
  }, [copy, variantCount, selectedTemplates, selectedFormats, imageEnabled, imagePrompt, imageModel, imageMode, imageSource, uploadedImages, imagesPerFormat, autoAlignImages]);

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

  // Regenerate a single variant's image with a new prompt
  const regenerateVariantImage = useCallback(async (variantId: string, newPrompt: string) => {
    const variant = variants.find(v => v.id === variantId);
    if (!variant) return;

    try {
      const image = await generateAdImage(
        newPrompt,
        imageModel,
        variant.format.width,
        variant.format.height,
        imageMode,
      );
      setVariants(prev =>
        prev.map(v => v.id === variantId ? { ...v, backgroundImage: image } : v)
      );
    } catch (err) {
      console.error(`Image regeneration failed for variant ${variantId}:`, err);
    }
  }, [variants, imageModel, imageMode]);

  // Flip the layout direction of a variant
  const toggleVariantLayout = useCallback((id: string) => {
    setVariants(prev =>
      prev.map(v => v.id === id ? { ...v, layoutSide: v.layoutSide === 'flipped' ? 'default' : 'flipped' } : v)
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
    imageMode, setImageMode,
    imageSource, setImageSource,
    uploadedImages, setUploadedImages,
    imagesPerFormat, setImagesPerFormat,
    autoAlignImages, setAutoAlignImages,
    generatingImages,
    generatingCopy,
    regenerateVariantImage,
    toggleVariantLayout,
  };
}
