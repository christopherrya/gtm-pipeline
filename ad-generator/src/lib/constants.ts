import type { AdFormat, TemplateConfig, AdCopy } from '@/types/ad';

export const COLORS = {
  navy: '#0f172a',
  navyLight: '#1e293b',
  slate: '#334155',
  slateLight: '#64748b',
  amber: '#f59e0b',
  amberLight: '#fbbf24',
  cream: '#fef3c7',
  white: '#ffffff',
  offWhite: '#f8fafc',
  success: '#10b981',
} as const;

export const AD_FORMATS: AdFormat[] = [
  { id: 'square', label: 'Square (1080x1080)', width: 1080, height: 1080 },
  { id: 'landscape', label: 'Landscape (1200x628)', width: 1200, height: 628 },
  { id: 'story', label: 'Story (1080x1920)', width: 1080, height: 1920 },
];

export const TEMPLATES: TemplateConfig[] = [
  { id: 'hero', name: 'Hero', description: 'Bold headline with gradient accent', thumbnail: 'H' },
  { id: 'cta', name: 'CTA', description: 'Dark navy with glass card overlay', thumbnail: 'C' },
  { id: 'feature', name: 'Feature', description: 'Icon-driven feature highlight', thumbnail: 'F' },
  { id: 'testimonial', name: 'Testimonial', description: 'Quote-focused social proof', thumbnail: 'T' },
  { id: 'minimal', name: 'Minimal', description: 'Clean typography-first layout', thumbnail: 'M' },
  { id: 'stats', name: 'Stats', description: 'Data-driven with metric callouts', thumbnail: 'S' },
];

export const COPY_LIMITS = {
  headline: 40,
  primaryText: 125,
  description: 90,
  ctaText: 25,
} as const;

export const DEFAULT_COPY: AdCopy = {
  headline: 'Never miss a red flag.',
  primaryText: 'AI analyzes 150-page disclosure packets in 5 minutes. Every issue flagged, costs estimated.',
  description: 'Join 500+ California agents who close with confidence.',
  ctaText: 'Start Free Analysis',
};

export const VARIANT_COUNTS = [3, 5, 10] as const;
