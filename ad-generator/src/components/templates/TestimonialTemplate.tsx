import type { AdFormat, AdCopy } from '@/types/ad';
import { COLORS } from '@/lib/constants';
import { AdLogo } from './AdLogo';

interface TestimonialTemplateProps {
  copy: AdCopy;
  format: AdFormat;
  backgroundImage?: string;
  overlayOpacity?: number;
}

export const TestimonialTemplate = ({ copy, format, backgroundImage }: TestimonialTemplateProps) => {
  const s = Math.min(format.width, format.height) / 1080;
  const isLandscape = format.width > format.height * 1.4;
  const isStory = format.height > format.width * 1.4;

  // --- Image-integrated layout: image top, quote card overlapping ---
  if (backgroundImage) {
    const imgFraction = isLandscape ? 0.55 : isStory ? 0.40 : 0.48;

    return (
      <div style={{
        width: format.width, height: format.height,
        position: 'relative', overflow: 'hidden',
        fontFamily: "'Geist', sans-serif",
        backgroundColor: '#fefcf9',
      }}>
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,700;1,600;1,700&display=swap" rel="stylesheet" />

        {/* Image section - top portion */}
        <div style={{
          ...(isLandscape
            ? { position: 'absolute' as const, left: 0, top: 0, width: format.width * imgFraction, height: format.height }
            : { position: 'relative' as const, width: format.width, height: format.height * imgFraction }),
          overflow: 'hidden',
        }}>
          <img src={backgroundImage} style={{
            width: '100%', height: '100%',
            objectFit: 'cover', display: 'block',
          }} />
          {/* Gradient fade */}
          <div style={{
            position: 'absolute', inset: 0,
            background: isLandscape
              ? 'linear-gradient(to right, transparent 50%, rgba(254,252,249,0.8) 100%)'
              : 'linear-gradient(to bottom, transparent 40%, rgba(254,252,249,0.9) 100%)',
            pointerEvents: 'none',
          }} />
{/* No logo on image — logo is in quote card */}
        </div>

        {/* Quote card - overlapping image boundary */}
        <div style={{
          ...(isLandscape
            ? {
                position: 'absolute' as const,
                right: 32 * s, top: '50%', transform: 'translateY(-50%)',
                width: format.width * 0.48,
              }
            : {
                position: 'relative' as const,
                marginTop: -60 * s,
                marginLeft: 32 * s, marginRight: 32 * s,
              }),
          backgroundColor: 'rgba(255,255,255,0.95)',
          border: '1px solid rgba(245,158,11,0.1)',
          borderRadius: 20 * s,
          padding: `${32 * s}px ${36 * s}px`,
          boxSizing: 'border-box' as const,
          boxShadow: '0 20px 60px rgba(15,23,42,0.08), 0 4px 16px rgba(15,23,42,0.04)',
          overflow: 'hidden',
          zIndex: 2,
        }}>
          {/* Amber accent */}
          <div style={{
            position: 'absolute', top: 0, left: 0,
            width: 3 * s, height: 48 * s,
            background: 'linear-gradient(to bottom, #f59e0b, transparent)',
            borderRadius: `${20 * s}px 0 0 0`,
          }} />

          {/* Logo */}
          <div style={{ marginBottom: 14 * s }}>
            <AdLogo size={36 * s} />
          </div>

          <div style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: 56 * s, fontWeight: 700,
            color: COLORS.amber, lineHeight: 0.5,
            marginBottom: 10 * s, opacity: 0.35,
            userSelect: 'none' as const,
          }}>
            &ldquo;
          </div>

          <blockquote style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: isLandscape ? 22 * s : 26 * s,
            fontWeight: 600, fontStyle: 'italic',
            color: COLORS.navy, lineHeight: 1.4,
            margin: 0, marginBottom: 20 * s,
          }}>
            {copy.primaryText}
          </blockquote>

          <div style={{ display: 'flex', gap: 2 * s, marginBottom: 16 * s }}>
            {[...Array(5)].map((_, i) => (
              <span key={i} style={{ color: COLORS.amber, fontSize: 16 * s, lineHeight: 1 }}>&#9733;</span>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 * s }}>
            <div style={{
              width: 40 * s, height: 40 * s, borderRadius: '50%',
              background: `linear-gradient(135deg, ${COLORS.navy}, #1e40af)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: COLORS.white, fontSize: 16 * s, fontWeight: 700,
            }}>
              {copy.headline.charAt(0).toUpperCase()}
            </div>
            <div>
              <div style={{ fontSize: 15 * s, fontWeight: 700, color: COLORS.navy }}>{copy.headline}</div>
              <div style={{ fontSize: 12 * s, color: COLORS.slateLight }}>{copy.description}</div>
            </div>
          </div>
        </div>

        {/* CTA below quote */}
        <div style={{
          ...(isLandscape
            ? { position: 'absolute' as const, bottom: 32 * s, right: 32 * s + (format.width * 0.48) / 2, transform: 'translateX(50%)' }
            : { display: 'flex', justifyContent: 'center', marginTop: 24 * s }),
          zIndex: 2,
        }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8 * s,
            backgroundColor: COLORS.navy, color: COLORS.white,
            padding: `${14 * s}px ${32 * s}px`,
            borderRadius: 10 * s, fontSize: 16 * s, fontWeight: 600,
            boxShadow: '0 6px 24px rgba(15,23,42,0.15)',
          }}>
            {copy.ctaText}
            <span style={{ fontSize: 16 * s, opacity: 0.7 }}>&rarr;</span>
          </div>
        </div>
      </div>
    );
  }

  // --- Original layout (no image) ---
  return (
    <div style={{
      width: format.width, height: format.height,
      background: `linear-gradient(155deg, #fefcf9 0%, #fef9ee 30%, #fef3c720 60%, #faf8f5 100%)`,
      position: 'relative', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      justifyContent: 'center', alignItems: 'center',
      padding: `${70 * s}px ${72 * s}px`,
      boxSizing: 'border-box', fontFamily: "'Geist', sans-serif",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,700;1,600;1,700&display=swap" rel="stylesheet" />

      <div style={{
        position: 'absolute', inset: 0, opacity: 0.25,
        backgroundImage: 'radial-gradient(circle, #92400e08 1px, transparent 1px)',
        backgroundSize: `${20 * s}px ${20 * s}px`,
        pointerEvents: 'none',
      }} />

      <div style={{ position: 'absolute', top: 40 * s, left: 48 * s }}>
        <AdLogo size={24 * s} />
      </div>

      <div style={{
        backgroundColor: 'rgba(255,255,255,0.8)',
        border: '1px solid rgba(245,158,11,0.1)',
        borderRadius: 24 * s,
        padding: `${44 * s}px ${48 * s}px`,
        boxSizing: 'border-box',
        maxWidth: isLandscape ? '78%' : '100%',
        width: '100%',
        position: 'relative',
        boxShadow: '0 16px 48px rgba(15,23,42,0.04), 0 4px 12px rgba(15,23,42,0.02)',
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0,
          width: 4 * s, height: 60 * s,
          background: 'linear-gradient(to bottom, #f59e0b, transparent)',
          borderRadius: `${24 * s}px 0 0 0`,
        }} />

        <div style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: 72 * s, fontWeight: 700,
          color: COLORS.amber, lineHeight: 0.5,
          marginBottom: 12 * s, opacity: 0.4,
          userSelect: 'none' as const,
        }}>
          &ldquo;
        </div>

        <blockquote style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: isLandscape ? 26 * s : 30 * s,
          fontWeight: 600, fontStyle: 'italic',
          color: COLORS.navy, lineHeight: 1.45,
          margin: 0, marginBottom: 28 * s,
          letterSpacing: '-0.01em',
        }}>
          {copy.primaryText}
        </blockquote>

        <div style={{ display: 'flex', gap: 3 * s, marginBottom: 20 * s }}>
          {[...Array(5)].map((_, i) => (
            <span key={i} style={{ color: COLORS.amber, fontSize: 20 * s, lineHeight: 1 }}>&#9733;</span>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 * s }}>
          <div style={{
            width: 48 * s, height: 48 * s, borderRadius: '50%',
            background: `linear-gradient(135deg, ${COLORS.navy}, #1e40af)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: COLORS.white, fontSize: 18 * s, fontWeight: 700,
            boxShadow: '0 4px 12px rgba(15,23,42,0.15)',
          }}>
            {copy.headline.charAt(0).toUpperCase()}
          </div>
          <div>
            <div style={{ fontSize: 18 * s, fontWeight: 700, color: COLORS.navy }}>{copy.headline}</div>
            <div style={{ fontSize: 14 * s, color: COLORS.slateLight }}>{copy.description}</div>
          </div>
        </div>
      </div>

      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 10 * s,
        backgroundColor: COLORS.navy, color: COLORS.white,
        padding: `${16 * s}px ${40 * s}px`,
        borderRadius: 12 * s, fontSize: 18 * s, fontWeight: 600,
        marginTop: 32 * s,
        boxShadow: '0 8px 28px rgba(15,23,42,0.15)',
      }}>
        {copy.ctaText}
        <span style={{ fontSize: 20 * s, opacity: 0.7 }}>&rarr;</span>
      </div>
    </div>
  );
};
