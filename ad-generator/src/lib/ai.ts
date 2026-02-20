import type { AdCopy, ImageMode } from '@/types/ad';

export async function generateCopyVariants(baseCopy: AdCopy, count: number = 3, prompt?: string): Promise<AdCopy[]> {
  const response = await fetch('/api/generate-copy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ baseCopy, count, prompt }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || `AI generation failed: ${response.statusText}`);
  }

  const data = await response.json();
  return data.variants;
}

export type ImageModel = 'gemini-2.5-flash-image' | 'gemini-3-pro-image-preview';

export async function generateAdImage(
  prompt: string,
  model: ImageModel = 'gemini-2.5-flash-image',
  width: number = 1080,
  height: number = 1080,
  mode: ImageMode = 'photograph',
): Promise<string> {
  const response = await fetch('/api/generate-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, model, width, height, mode }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || `Image generation failed: ${response.statusText}`);
  }

  const data = await response.json();
  return data.image; // base64 data URL
}

export async function generateImagePrompts(
  copyVariants: AdCopy[],
  count: number = 1,
  mode: ImageMode = 'photograph',
): Promise<string[][]> {
  const response = await fetch('/api/generate-image-prompts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ copyVariants, count, mode }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || `Image prompt generation failed: ${response.statusText}`);
  }

  const data = await response.json();
  return data.prompts; // string[][] — one sub-array of prompts per copy variant
}
