import type { AdFormat, AdCopy } from '@/types/ad';
import { COLORS } from '@/lib/constants';
import { AdLogo } from './AdLogo';

interface MinimalTemplateProps {
  copy: AdCopy;
  format: AdFormat;
  backgroundImage?: string;
  overlayOpacity?: number;
}

export const MinimalTemplate = ({ copy, format, backgroundImage }: MinimalTemplateProps) => {
  const s = Math.min(format.width, format.height) / 1080;
  const isLandscape = format.width > format.height * 1.4;
  const isStory = format.height > format.width * 1.4;

  // --- Image-integrated layout: large image with clean text strip ---
  if (backgroundImage) {
    const imgFraction = isLandscape ? 0.55 : isStory ? 0.52 : 0.58;

    return (
      <div style={{
        width: format.width, height: format.height,
        display: 'flex',
        flexDirection: isLandscape ? 'row-reverse' : 'column',
        fontFamily: "'Geist', sans-serif",
        overflow: 'hidden',
        backgroundColor: COLORS.white,
      }}>
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&display=swap" rel="stylesheet" />

        {/* Image section - takes the majority */}
        <div style={{
          position: 'relative', overflow: 'hidden',
          ...(isLandscape
            ? { width: format.width * imgFraction, height: format.height }
            : { width: format.width, height: format.height * imgFraction }),
          flexShrink: 0,
        }}>
          <img src={backgroundImage} style={{
            width: '100%', height: '100%',
            objectFit: 'cover', display: 'block',
          }} />
        </div>

        {/* Clean text strip */}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          justifyContent: 'center', alignItems: 'center',
          textAlign: 'center',
          padding: isLandscape
            ? `${28 * s}px ${32 * s}px`
            : `${24 * s}px ${40 * s}px`,
          boxSizing: 'border-box',
          overflow: 'hidden',
          maxWidth: '100%',
        }}>
          <div style={{ marginBottom: 16 * s }}>
            <AdLogo size={40 * s} />
          </div>

          <h1 style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: isLandscape ? 30 * s : isStory ? 38 * s : 34 * s,
            fontWeight: 700, color: COLORS.navy,
            lineHeight: 1.12, margin: 0,
            letterSpacing: '-0.02em',
            maxWidth: '100%',
            wordWrap: 'break-word' as const,
          }}>
            {copy.headline}
          </h1>

          {/* Amber accent bar */}
          <div style={{
            width: 36 * s, height: 3 * s,
            background: 'linear-gradient(90deg, #f59e0b, #fbbf24)',
            borderRadius: 2, marginTop: 20 * s, marginBottom: 20 * s,
          }} />

          <p style={{
            fontSize: 15 * s, color: COLORS.slateLight,
            lineHeight: 1.55, margin: 0, marginBottom: 24 * s,
            maxWidth: '90%',
          }}>
            {copy.description}
          </p>

          {/* CTA link style */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6 * s,
            fontSize: 16 * s, fontWeight: 600, color: COLORS.navy,
            borderBottom: `2px solid ${COLORS.amber}`,
            paddingBottom: 4 * s,
          }}>
            {copy.ctaText}
            <span style={{ fontSize: 18 * s, color: COLORS.amber }}>&rarr;</span>
          </div>
        </div>
      </div>
    );
  }

  // --- Original layout (no image) ---
  return (
    <div style={{
      width: format.width, height: format.height,
      backgroundColor: COLORS.white,
      position: 'relative', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      justifyContent: 'center', alignItems: 'center',
      padding: `${100 * s}px ${90 * s}px`,
      boxSizing: 'border-box', fontFamily: "'Geist', sans-serif",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&display=swap" rel="stylesheet" />

      <div style={{
        position: 'absolute', inset: 0, opacity: 0.35,
        backgroundImage: `
          linear-gradient(rgba(15,23,42,0.02) 1px, transparent 1px),
          linear-gradient(90deg, rgba(15,23,42,0.02) 1px, transparent 1px)
        `,
        backgroundSize: `${40 * s}px ${40 * s}px`,
        pointerEvents: 'none',
      }} />

      <div style={{
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', textAlign: 'center',
        maxWidth: isLandscape ? '70%' : '85%',
        position: 'relative', zIndex: 1,
      }}>
        <div style={{ marginBottom: 48 * s }}>
          <AdLogo size={30 * s} />
        </div>

        <h1 style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: isLandscape ? 52 * s : 58 * s,
          fontWeight: 700, color: COLORS.navy,
          lineHeight: 1.1, margin: 0,
          letterSpacing: '-0.02em',
        }}>
          {copy.headline}
        </h1>

        <div style={{
          width: 48 * s, height: 3 * s,
          background: 'linear-gradient(90deg, #f59e0b, #fbbf24)',
          borderRadius: 2, marginTop: 36 * s, marginBottom: 36 * s,
        }} />

        <p style={{
          fontSize: 20 * s, color: COLORS.slateLight,
          lineHeight: 1.65, margin: 0, marginBottom: 44 * s,
          maxWidth: '92%',
        }}>
          {copy.description}
        </p>

        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8 * s,
          fontSize: 20 * s, fontWeight: 600, color: COLORS.navy,
          borderBottom: `2.5px solid ${COLORS.amber}`,
          paddingBottom: 5 * s,
          letterSpacing: '0.01em',
        }}>
          {copy.ctaText}
          <span style={{ fontSize: 22 * s, color: COLORS.amber }}>&rarr;</span>
        </div>
      </div>

      <div style={{
        position: 'absolute', top: 36 * s, right: 40 * s,
        width: 32 * s, height: 32 * s,
        border: `2px solid rgba(245,158,11,0.15)`,
        borderRadius: 8 * s,
        transform: 'rotate(12deg)',
      }} />
      <div style={{
        position: 'absolute', bottom: 44 * s, left: 44 * s,
        width: 24 * s, height: 24 * s,
        borderRadius: '50%',
        border: `2px solid rgba(15,23,42,0.06)`,
      }} />
    </div>
  );
};
