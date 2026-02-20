import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI } from '@google/genai';
import 'dotenv/config';

const app = express();
app.use(cors());
app.use(express.json());

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

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

app.post('/api/generate-image', async (req, res) => {
  try {
    const { prompt, model = 'gemini-2.5-flash-image', width = 1080, height = 1080 } = req.body;

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

    const fullPrompt = `You are a professional photographer. Generate a high-quality, editorial-style photograph.

CRITICAL RULES:
- This is a PHOTOGRAPH only. Absolutely NO text, words, letters, numbers, logos, watermarks, or typography of any kind anywhere in the image.
- No graphic design elements. No banners, buttons, overlays, or UI elements.
- The image must look like it was taken by a professional photographer with a DSLR camera.
- Do NOT generate anything that looks like an advertisement or marketing material.

Style: Clean, well-lit, natural. Shallow depth of field where appropriate. Premium editorial feel.
Composition: Leave some negative space — do not center the subject too tightly.

Subject: ${prompt}`;

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

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
});
