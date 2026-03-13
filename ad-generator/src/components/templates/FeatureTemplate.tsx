import type { AdFormat, AdCopy, ImageLayoutSide } from '@/types/ad';
import { COLORS } from '@/lib/constants';
import { AdLogo } from './AdLogo';

interface FeatureTemplateProps {
  copy: AdCopy;
  format: AdFormat;
  backgroundImage?: string;
  overlayOpacity?: number;
  layoutSide?: ImageLayoutSide;
}

export const FeatureTemplate = ({ copy, format, backgroundImage, layoutSide = 'default' }: FeatureTemplateProps) => {
  const s = Math.min(format.width, format.height) / 1080;
  const isLandscape = format.width > format.height * 1.4;
  const isStory = format.height > format.width * 1.4;
  const flipped = layoutSide === 'flipped';

  // --- Image-integrated layout: side-by-side or stacked ---
  if (backgroundImage) {
    const baseDirection = isLandscape ? 'row' : 'column';
    const flexDir = flipped
      ? (isLandscape ? 'row-reverse' : 'column-reverse')
      : baseDirection;

    return (
      <div style={{
        width: format.width, height: format.height,
        display: 'flex',
        flexDirection: flexDir as any,
        fontFamily: "'Geist', sans-serif",
        overflow: 'hidden',
        backgroundColor: '#fafafa',
      }}>
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&display=swap" rel="stylesheet" />

        {/* Copy section */}
        <div style={{
          ...(isLandscape
            ? { width: format.width * 0.52, height: format.height }
            : { width: format.width, height: format.height * 0.48 }),
          flexShrink: 0,
          display: 'flex', flexDirection: 'column',
          justifyContent: 'center',
          padding: isLandscape
            ? `${40 * s}px ${44 * s}px ${40 * s}px ${52 * s}px`
            : `${36 * s}px ${52 * s}px`,
          boxSizing: 'border-box',
          position: 'relative', zIndex: 1,
          overflow: 'hidden',
        }}>
          <div style={{ marginBottom: 20 * s }}>
            <AdLogo size={44 * s} />
          </div>

          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6 * s,
            background: 'rgba(245,158,11,0.08)',
            border: '1px solid rgba(245,158,11,0.15)',
            color: '#92400e',
            padding: `${6 * s}px ${14 * s}px`,
            borderRadius: 100, fontSize: 12 * s, fontWeight: 600,
            marginBottom: 18 * s, alignSelf: 'flex-start',
          }}>
            <span style={{ fontSize: 11 * s }}>&#9733;</span>
            {copy.description}
          </div>

          <h2 style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: isLandscape ? 36 * s : 42 * s,
            fontWeight: 700, color: COLORS.navy,
            lineHeight: 1.15, margin: 0, marginBottom: 14 * s,
            letterSpacing: '-0.01em',
          }}>
            {copy.headline}
          </h2>

          <p style={{
            fontSize: 16 * s, color: COLORS.slate,
            lineHeight: 1.55, margin: 0, marginBottom: 24 * s,
          }}>
            {copy.primaryText}
          </p>

          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8 * s,
            backgroundColor: COLORS.navy, color: COLORS.white,
            padding: `${12 * s}px ${28 * s}px`,
            borderRadius: 10 * s, fontSize: 15 * s, fontWeight: 600,
            boxShadow: '0 6px 20px rgba(15,23,42,0.12)',
            alignSelf: 'flex-start',
          }}>
            {copy.ctaText}
            <span style={{ opacity: 0.7, fontSize: 15 * s }}>&rarr;</span>
          </div>
        </div>

        {/* Image section */}
        <div style={{
          flex: 1, position: 'relative', overflow: 'hidden',
        }}>
          <img src={backgroundImage} style={{
            width: '100%', height: '100%',
            objectFit: 'cover', display: 'block',
          }} />
          {/* Soft edge blend */}
          <div style={{
            position: 'absolute', inset: 0,
            background: isLandscape
              ? 'linear-gradient(to right, rgba(250,250,250,0.5) 0%, transparent 20%)'
              : 'linear-gradient(to bottom, rgba(250,250,250,0.5) 0%, transparent 15%)',
            pointerEvents: 'none',
          }} />
        </div>
      </div>
    );
  }

  // --- Original layout (no image) ---
  return (
    <div style={{
      width: format.width, height: format.height,
      backgroundColor: '#fafafa',
      position: 'relative', overflow: 'hidden',
      display: 'flex', flexDirection: isLandscape ? 'row' : 'column',
      justifyContent: 'center', alignItems: isLandscape ? 'center' : 'center',
      padding: isLandscape ? `${60 * s}px ${80 * s}px` : `${80 * s}px ${72 * s}px`,
      boxSizing: 'border-box', fontFamily: "'Geist', sans-serif",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&display=swap" rel="stylesheet" />

      <div style={{
        position: 'absolute', top: 0, right: 0,
        width: '50%', height: '50%',
        background: `radial-gradient(circle at top right, ${COLORS.cream}50 0%, transparent 60%)`,
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: 0, left: 0,
        width: '40%', height: '40%',
        background: 'radial-gradient(circle at bottom left, rgba(14,165,233,0.03) 0%, transparent 60%)',
        pointerEvents: 'none',
      }} />

      <div style={{
        position: 'relative', zIndex: 1,
        flex: isLandscape ? '0 0 55%' : undefined,
        display: 'flex', flexDirection: 'column',
        alignItems: isLandscape ? 'flex-start' : 'center',
        textAlign: isLandscape ? 'left' : 'center',
      }}>
        <div style={{ marginBottom: 32 * s }}>
          <AdLogo size={24 * s} />
        </div>

        <div style={{
          width: 60 * s, height: 60 * s, borderRadius: 16 * s,
          background: 'linear-gradient(135deg, #fffbeb, #fef3c7)',
          border: '1.5px solid rgba(245,158,11,0.15)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 24 * s,
          boxShadow: '0 4px 16px rgba(245,158,11,0.08)',
        }}>
          <div style={{
            width: 24 * s, height: 24 * s, borderRadius: 8 * s,
            background: 'linear-gradient(135deg, #f59e0b, #d97706)',
          }} />
        </div>

        <h2 style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: isLandscape ? 42 * s : 48 * s,
          fontWeight: 700, color: COLORS.navy,
          lineHeight: 1.15, margin: 0, marginBottom: 18 * s,
          letterSpacing: '-0.01em',
        }}>
          {copy.headline}
        </h2>

        <p style={{
          fontSize: 19 * s, color: COLORS.slate,
          lineHeight: 1.65, margin: 0, marginBottom: 24 * s,
          maxWidth: isLandscape ? '95%' : '88%',
        }}>
          {copy.primaryText}
        </p>

        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8 * s,
          background: 'rgba(245,158,11,0.08)',
          border: '1px solid rgba(245,158,11,0.15)',
          color: '#92400e',
          padding: `${10 * s}px ${20 * s}px`,
          borderRadius: 100, fontSize: 15 * s, fontWeight: 600,
          marginBottom: 28 * s,
        }}>
          <span style={{ fontSize: 13 * s }}>&#9733;</span>
          {copy.description}
        </div>

        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 10 * s,
          backgroundColor: COLORS.navy, color: COLORS.white,
          padding: `${16 * s}px ${36 * s}px`,
          borderRadius: 12 * s, fontSize: 18 * s, fontWeight: 600,
          boxShadow: '0 8px 24px rgba(15,23,42,0.12)',
          alignSelf: isLandscape ? 'flex-start' : 'center',
        }}>
          {copy.ctaText}
          <span style={{ opacity: 0.7, fontSize: 18 * s }}>&rarr;</span>
        </div>
      </div>

      {!isStory && (
        <div style={{
          flex: isLandscape ? '0 0 42%' : undefined,
          display: 'flex', justifyContent: 'center', alignItems: 'center',
          marginTop: isLandscape ? 0 : 40 * s,
          paddingLeft: isLandscape ? 24 * s : 0,
        }}>
          <div style={{
            width: isLandscape ? 300 * s : 320 * s,
            background: COLORS.white,
            borderRadius: 20 * s,
            boxShadow: '0 24px 64px rgba(15,23,42,0.08), 0 8px 20px rgba(15,23,42,0.04)',
            border: '1px solid rgba(15,23,42,0.05)',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: `${14 * s}px ${18 * s}px`,
              borderBottom: '1px solid rgba(15,23,42,0.05)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 * s }}>
                <div style={{
                  width: 28 * s, height: 28 * s, borderRadius: 8 * s,
                  background: `linear-gradient(135deg, ${COLORS.offWhite}, ${COLORS.cream}40)`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14 * s,
                }}>
                  &#127968;
                </div>
                <div>
                  <div style={{ fontSize: 11 * s, fontWeight: 700, color: COLORS.navy }}>123 Oak Street</div>
                  <div style={{ fontSize: 9 * s, color: COLORS.slateLight }}>San Francisco, CA</div>
                </div>
              </div>
              <div style={{
                background: 'rgba(16,185,129,0.1)', color: '#10b981',
                fontSize: 10 * s, fontWeight: 700, padding: `${3 * s}px ${10 * s}px`,
                borderRadius: 100, textTransform: 'uppercase' as const,
              }}>Low Risk</div>
            </div>
            <div style={{ padding: `${18 * s}px ${18 * s}px` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 * s }}>
                <span style={{ fontSize: 10 * s, color: COLORS.slateLight, fontWeight: 500 }}>Property Score</span>
                <span style={{ fontSize: 24 * s, fontWeight: 800, color: '#10b981' }}>92</span>
              </div>
              <div style={{
                width: '100%', height: 8 * s, borderRadius: 4 * s,
                background: '#f1f5f9', overflow: 'hidden',
              }}>
                <div style={{
                  width: '92%', height: '100%', borderRadius: 4 * s,
                  background: 'linear-gradient(90deg, #10b981, #34d399)',
                }} />
              </div>
              <div style={{
                display: 'flex', justifyContent: 'space-between', marginTop: 12 * s,
                fontSize: 9 * s, color: COLORS.slateLight,
              }}>
                <span>12 issues found</span>
                <span>47 sec analysis</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
