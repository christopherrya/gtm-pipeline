export type TemplateId = 'hero' | 'cta' | 'feature' | 'testimonial' | 'minimal' | 'stats';

export interface AdFormat {
  id: string;
  label: string;
  width: number;
  height: number;
}

export interface AdCopy {
  headline: string;
  primaryText: string;
  description: string;
  ctaText: string;
}

export interface AdVariant {
  id: string;
  templateId: TemplateId;
  format: AdFormat;
  copy: AdCopy;
  copyVariantIndex: number; // which copy variant (0-based) this belongs to
  enabled: boolean;
  backgroundImage?: string; // base64 data URL from Nano Banana
}

export interface TemplateConfig {
  id: TemplateId;
  name: string;
  description: string;
  thumbnail: string;
}
