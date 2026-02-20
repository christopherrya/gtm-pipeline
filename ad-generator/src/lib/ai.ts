import type { AdCopy } from '@/types/ad';

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
): Promise<string> {
  const response = await fetch('/api/generate-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, model, width, height }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.detail || `Image generation failed: ${response.statusText}`);
  }

  const data = await response.json();
  return data.image; // base64 data URL
}
