import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Load copy-editing skills packet for the system prompt
let copyEditingSkills = '';
try {
  copyEditingSkills = readFileSync(join(__dirname, '..', 'skills', 'copy-editing.md'), 'utf-8');
} catch {
  console.warn('skills/copy-editing.md not found — running without copy-editing guidance');
}

app.post('/api/generate-copy', async (req, res) => {
  try {
    const { baseCopy, count = 3, prompt } = req.body;

    let content: string;

    if (prompt && prompt.trim()) {
      // User provided a prompt — it's the PRIMARY instruction
      content = `You are an expert Facebook ad copywriter for Discloser.

About Discloser: AI-powered real estate disclosure analysis tool for California real estate agents. Analyzes 150+ page disclosure packets in minutes, flags every issue, estimates repair costs. Trusted by 500+ agents.

THE USER WANTS ADS ABOUT THIS SPECIFIC ANGLE:
"""
${prompt.trim()}
"""

Write the ad copy to directly reflect the user's angle above. This is the most important thing — the copy MUST be built around their specific message and talking points.

Generate ${count} ad copy variants, each taking a slightly different creative approach to the user's angle.

${baseCopy ? `For tone/style reference only (do NOT copy this — use the user's angle above):
- Headline style: ${baseCopy.headline}
- CTA style: ${baseCopy.ctaText}` : ''}

Character limits: headline (40), primaryText (125), description (90), ctaText (25).

Respond with ONLY valid JSON array:
[{"headline":"...","primaryText":"...","description":"...","ctaText":"..."}]`;
    } else {
      // No prompt — use base copy as the anchor
      content = `You are an expert Facebook ad copywriter for Discloser, a real estate AI disclosure analysis tool for California real estate agents.

Based on this ad copy:
- Headline: ${baseCopy.headline}
- Primary Text: ${baseCopy.primaryText}
- Description: ${baseCopy.description}
- CTA: ${baseCopy.ctaText}

Generate ${count} compelling variant versions. Each variant should have a different angle/hook but maintain the same product focus.

Character limits: headline (40), primaryText (125), description (90), ctaText (25).

Respond with ONLY valid JSON array:
[{"headline":"...","primaryText":"...","description":"...","ctaText":"..."}]`;
    }

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      ...(copyEditingSkills ? { system: `You are an expert ad copywriter. Apply these copy-editing principles to every variant you generate:\n\n${copyEditingSkills}` } : {}),
      messages: [{ role: 'user', content }],
    });

    const responseBlock = message.content[0];
    if (responseBlock.type !== 'text') {
      throw new Error('Unexpected response type');
    }

    const variants = JSON.parse(responseBlock.text);
    res.json({ variants });
  } catch (error: any) {
    console.error('AI generation error:', error?.message || error);
    console.error('Full error:', JSON.stringify(error, null, 2));
    res.status(500).json({
      error: 'Failed to generate copy variants',
      detail: error?.message || String(error),
    });
  }
});

// ---------- Nano Banana Image Generation ----------

const genAI = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY || '' });

// Aspect-ratio-aware composition hints
function getCompositionHint(width: number, height: number): string {
  const ratio = width / height;
  if (ratio > 1.4) {
    return `Compose for a WIDE LANDSCAPE frame (${width}x${height}). Use a horizontal composition — spread visual weight across the width. Place the main subject off-center (rule of thirds). Include expansive negative space on one side for text overlay. Think cinematic widescreen framing.`;
  }
  if (ratio < 0.7) {
    return `Compose for a TALL VERTICAL/STORY frame (${width}x${height}). Use a vertical composition — stack visual elements top-to-bottom. Place the main subject in the upper or lower third, not dead center. Leave generous vertical negative space. Think mobile-first, portrait orientation.`;
  }
  return `Compose for a SQUARE frame (${width}x${height}). Use a centered or diagonal composition. The subject can be more centrally placed. Balance visual weight evenly. Think Instagram-style square crop.`;
}

// Build the system prompt based on image mode
function buildImagePrompt(prompt: string, mode: string, width: number, height: number): string {
  const compositionHint = getCompositionHint(width, height);

  if (mode === 'product-context') {
    return `You are a product photographer specializing in tech and SaaS lifestyle shots. Generate a high-quality photograph showing a real-world context where someone would use a digital product.

CRITICAL RULES:
- This is a PHOTOGRAPH only. Absolutely NO readable text, words, letters, numbers, logos, watermarks, or typography.
- You CAN include devices (laptops, tablets, phones) as props in the scene, but any screens must show blurred/abstract UI — no readable content.
- The image should feel like a candid lifestyle photograph, not a staged product shot.
- Natural lighting, real environments (offices, homes, coffee shops, open houses).
- Show human context — hands, over-the-shoulder angles, workspace setups.

${compositionHint}

Style: Warm, authentic, editorial lifestyle photography. Shallow depth of field on device/workspace. Premium but approachable.

Subject/Context: ${prompt}`;
  }

  // Default: photograph mode
  return `You are a professional photographer. Generate a high-quality, editorial-style photograph.

CRITICAL RULES:
- This is a PHOTOGRAPH only. Absolutely NO text, words, letters, numbers, logos, watermarks, or typography of any kind anywhere in the image.
- No graphic design elements. No banners, buttons, overlays, or UI elements.
- The image must look like it was taken by a professional photographer with a DSLR camera.
- Do NOT generate anything that looks like an advertisement or marketing material.

${compositionHint}

Style: Clean, well-lit, natural. Shallow depth of field where appropriate. Premium editorial feel.

Subject: ${prompt}`;
}

app.post('/api/generate-image', async (req, res) => {
  try {
    const {
      prompt,
      model = 'gemini-2.5-flash-image',
      width = 1080,
      height = 1080,
      mode = 'photograph',
    } = req.body;

    if (!process.env.GOOGLE_AI_API_KEY) {
      throw new Error('GOOGLE_AI_API_KEY not configured');
    }

    // Map dimensions to aspect ratio
    const ratio = width / height;
    let aspectRatio = '1:1';
    if (ratio > 1.6) aspectRatio = '16:9';
    else if (ratio > 1.2) aspectRatio = '4:3';
    else if (ratio < 0.7) aspectRatio = '9:16';
    else if (ratio < 0.85) aspectRatio = '3:4';

    const fullPrompt = buildImagePrompt(prompt, mode, width, height);

    const response = await genAI.models.generateContent({
      model,
      contents: fullPrompt,
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageGenerationConfig: {
          aspectRatio,
        },
      },
    });

    // Find the image part in the response
    const parts = response.candidates?.[0]?.content?.parts;
    if (!parts) {
      throw new Error('No response parts returned');
    }

    const imagePart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'));
    if (!imagePart || !imagePart.inlineData) {
      throw new Error('No image returned in response');
    }

    res.json({
      image: `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`,
      mimeType: imagePart.inlineData.mimeType,
    });
  } catch (error: any) {
    console.error('Image generation error:', error?.message || error);
    res.status(500).json({
      error: 'Failed to generate image',
      detail: error?.message || String(error),
    });
  }
});

// ---------- Image-Copy Alignment: Generate image prompts from ad copy ----------

app.post('/api/generate-image-prompts', async (req, res) => {
  try {
    const { copyVariants, count = 1, mode = 'photograph' } = req.body;

    const modeGuidance = mode === 'product-context'
      ? `Generate prompts describing LIFESTYLE SCENES showing someone using a tech product in a real-world context.
Focus on: hands on a laptop, tablet on a desk at an open house, an agent reviewing documents in a modern office, someone working in a bright café, over-the-shoulder view of a device screen.
The prompts should describe the SETTING and ACTIVITY, not the product UI.`
      : `Generate prompts describing professional PHOTOGRAPHS that would pair well with each ad's message.
Focus on: emotions, settings, and visual metaphors that reinforce the ad copy's angle.
Think like a creative director pairing stock photography with ad concepts.`;

    const content = `You are a creative director for Facebook ads. Given these ad copy variants, generate ${count} image prompt(s) for EACH variant. The image prompts should describe photographs that visually reinforce each ad's specific message and emotional angle.

${modeGuidance}

RULES:
- Each prompt should be 1-2 sentences, focused and specific
- Describe the SCENE, not design elements
- Never mention text, logos, typography, or UI overlays
- Each prompt for the same variant should describe a meaningfully different visual concept
- Prompts should be diverse — avoid repeating the same scene across different variants

Ad copy variants:
${JSON.stringify(copyVariants, null, 2)}

Respond with ONLY valid JSON array of arrays (one sub-array of ${count} prompt(s) per copy variant):
[["prompt for variant 1 image 1", "prompt for variant 1 image 2"], ["prompt for variant 2 image 1", "prompt for variant 2 image 2"]]`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{ role: 'user', content }],
    });

    const responseBlock = message.content[0];
    if (responseBlock.type !== 'text') {
      throw new Error('Unexpected response type');
    }

    const prompts = JSON.parse(responseBlock.text);
    res.json({ prompts });
  } catch (error: any) {
    console.error('Image prompt generation error:', error?.message || error);
    res.status(500).json({
      error: 'Failed to generate image prompts',
      detail: error?.message || String(error),
    });
  }
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});
