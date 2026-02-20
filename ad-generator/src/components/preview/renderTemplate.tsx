import type { AdVariant } from '@/types/ad';
import { HeroTemplate, CTATemplate, FeatureTemplate, TestimonialTemplate, MinimalTemplate, StatsTemplate } from '@/components/templates';

export function renderTemplate(variant: AdVariant, overlayOpacity: number = 0.45) {
  const props = {
    copy: variant.copy,
    format: variant.format,
    backgroundImage: variant.backgroundImage,
    overlayOpacity,
    layoutSide: variant.layoutSide,
  };

  switch (variant.templateId) {
    case 'hero': return <HeroTemplate {...props} />;
    case 'cta': return <CTATemplate {...props} />;
    case 'feature': return <FeatureTemplate {...props} />;
    case 'testimonial': return <TestimonialTemplate {...props} />;
    case 'minimal': return <MinimalTemplate {...props} />;
    case 'stats': return <StatsTemplate {...props} />;
    default: return <div>Unknown template</div>;
  }
}
