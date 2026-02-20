import type { AdFormat, AdCopy, ImageLayoutSide } from '@/types/ad';
import { COLORS } from '@/lib/constants';
import { AdLogo } from './AdLogo';

interface CTATemplateProps {
  copy: AdCopy;
  format: AdFormat;
  backgroundImage?: string;
  overlayOpacity?: number;
  layoutSide?: ImageLayoutSide;
}

export const CTATemplate = ({ copy, format, backgroundImage, layoutSide = 'default' }: CTATemplateProps) => {
  const s = Math.min(format.width, format.height) / 1080;
  const isLandscape = format.width > format.height * 1.4;
  const isStory = format.height > format.width * 1.4;
  const flipped = layoutSide === 'flipped';

  // --- Image-integrated layout: dark copy section + separate image section ---
  if (backgroundImage) {
    const imgFraction = isLandscape ? 0.50 : isStory ? 0.48 : 0.52;
    const baseDirection = isLandscape ? 'row-reverse' : 'column';
    const flexDir = flipped
      ? (isLandscape ? 'row' : 'column-reverse')
      : baseDirection;

    return (
      <div style={{
        width: format.width, height: format.height,
        display: 'flex',
        flexDirection: flexDir as any,
        fontFamily: "'Geist', sans-serif",
        overflow: 'hidden',
      }}>
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&display=swap" rel="stylesheet" />

        {/* Image section — completely separate, no text on it */}
        <div style={{
          ...(isLandscape
            ? { width: format.width * imgFraction, height: format.height }
            : { width: format.width, height: format.height * imgFraction }),
          flexShrink: 0, overflow: 'hidden', position: 'relative',
        }}>
          <img src={backgroundImage} style={{
            width: '100%', height: '100%',
            objectFit: 'cover', display: 'block',
          }} />
        </div>

        {/* Dark copy section — all text here */}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          justifyContent: 'center', alignItems: 'center',
          textAlign: 'center',
          background: 'linear-gradient(160deg, #0c1222 0%, #0f172a 50%, #141d2f 100%)',
          padding: isLandscape
            ? `${32 * s}px ${40 * s}px`
            : `${32 * s}px ${48 * s}px`,
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}>
          {/* Logo — large and prominent */}
          <div style={{ marginBottom: 24 * s }}>
            <AdLogo size={48 * s} color="rgba(255,255,255,0.95)" dotColor="#f59e0b" />
          </div>

          <h1 style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: isLandscape ? 34 * s : 38 * s,
            fontWeight: 700, color: COLORS.white,
            lineHeight: 1.15, margin: 0, marginBottom: 14 * s,
            maxWidth: '95%',
          }}>
            {copy.headline.split(' ').map((word, i, arr) => {
              if (i >= arr.length - 2) {
                return (
                  <span key={i} style={{
                    background: 'linear-gradient(135deg, #f59e0b, #fbbf24)',
                    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                  }}>
                    {word}{i < arr.length - 1 ? ' ' : ''}
                  </span>
                );
              }
              return <span key={i}>{word} </span>;
            })}
          </h1>

          <p style={{
            fontSize: 15 * s, color: 'rgba(203,213,225,0.85)',
            lineHeight: 1.5, margin: 0, marginBottom: 22 * s,
            maxWidth: '90%',
          }}>
            {copy.primaryText}
          </p>

          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8 * s,
            background: 'linear-gradient(135deg, #f59e0b, #fbbf24)',
            color: COLORS.navy,
            padding: `${14 * s}px ${36 * s}px`,
            borderRadius: 12 * s, fontSize: 16 * s, fontWeight: 700,
            boxShadow: '0 8px 28px rgba(245,158,11,0.25)',
            marginBottom: 16 * s,
          }}>
            {copy.ctaText}
          </div>

          <div style={{
            display: 'flex', gap: 16 * s, flexWrap: 'wrap', justifyContent: 'center',
          }}>
            {['No credit card', 'Free first analysis'].map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 * s }}>
                <span style={{ color: '#34d399', fontSize: 10 * s, fontWeight: 700 }}>&#10003;</span>
                <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11 * s, fontWeight: 500 }}>{item}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // --- Original dark layout (no image) ---
  return (
    <div style={{
      width: format.width, height: format.height,
      background: 'linear-gradient(160deg, #0c1222 0%, #0f172a 30%, #162033 60%, #0f172a 100%)',
      position: 'relative', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      justifyContent: 'center', alignItems: 'center',
      padding: `${80 * s}px ${80 * s}px`,
      boxSizing: 'border-box', fontFamily: "'Geist', sans-serif",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&display=swap" rel="stylesheet" />

      <div style={{
        position: 'absolute', top: '20%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: format.width * 0.7, height: format.width * 0.7,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(245,158,11,0.07) 0%, rgba(245,158,11,0.02) 40%, transparent 70%)',
        filter: 'blur(60px)', pointerEvents: 'none',
      }} />

      <div style={{
        position: 'relative', width: '100%',
        maxWidth: isLandscape ? '80%' : '92%',
        background: 'linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 28 * s,
        padding: isStory ? `${72 * s}px ${48 * s}px` : `${56 * s}px ${52 * s}px`,
        boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
        boxShadow: '0 32px 80px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)',
      }}>
        <div style={{ marginBottom: 32 * s }}>
          <AdLogo size={48 * s} color="rgba(255,255,255,0.9)" dotColor="#f59e0b" />
        </div>

        <h1 style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: isLandscape ? 46 * s : 52 * s,
          fontWeight: 700, color: COLORS.white,
          lineHeight: 1.15, margin: 0, marginBottom: 22 * s,
          maxWidth: '95%',
        }}>
          {copy.headline.split(' ').map((word, i, arr) => {
            if (i >= arr.length - 2) {
              return (
                <span key={i} style={{
                  background: 'linear-gradient(135deg, #f59e0b, #fbbf24)',
                  WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                }}>
                  {word}{i < arr.length - 1 ? ' ' : ''}
                </span>
              );
            }
            return <span key={i}>{word} </span>;
          })}
        </h1>

        <p style={{
          fontSize: 20 * s, color: 'rgba(203,213,225,0.9)',
          lineHeight: 1.65, margin: 0, marginBottom: 36 * s,
          maxWidth: '88%',
        }}>
          {copy.primaryText}
        </p>

        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 10 * s,
          background: 'linear-gradient(135deg, #f59e0b, #fbbf24)',
          color: COLORS.navy,
          padding: `${20 * s}px ${48 * s}px`,
          borderRadius: 14 * s, fontSize: 20 * s, fontWeight: 700,
          boxShadow: '0 12px 40px rgba(245,158,11,0.25)',
        }}>
          {copy.ctaText}
        </div>

        <p style={{
          fontSize: 15 * s, color: 'rgba(148,163,184,0.7)',
          margin: 0, marginTop: 20 * s,
        }}>
          {copy.description}
        </p>
      </div>
    </div>
  );
};
