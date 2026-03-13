import type { AdFormat, AdCopy, ImageLayoutSide } from '@/types/ad';
import { COLORS } from '@/lib/constants';
import { AdLogo } from './AdLogo';

interface HeroTemplateProps {
  copy: AdCopy;
  format: AdFormat;
  backgroundImage?: string;
  overlayOpacity?: number;
  layoutSide?: ImageLayoutSide;
}

export const HeroTemplate = ({ copy, format, backgroundImage, layoutSide = 'default' }: HeroTemplateProps) => {
  const s = Math.min(format.width, format.height) / 1080;
  const isLandscape = format.width > format.height * 1.4;
  const isStory = format.height > format.width * 1.4;
  const flipped = layoutSide === 'flipped';

  // --- Image-integrated layout ---
  if (backgroundImage) {
    const imgFraction = isLandscape ? 0.48 : isStory ? 0.45 : 0.55;
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
      }}>
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&display=swap" rel="stylesheet" />

        {/* Image section */}
        <div style={{
          position: 'relative',
          ...(isLandscape
            ? { width: format.width * imgFraction, height: format.height }
            : { width: format.width, height: format.height * imgFraction }),
          flexShrink: 0, overflow: 'hidden',
        }}>
          <img src={backgroundImage} style={{
            width: '100%', height: '100%',
            objectFit: 'cover', display: 'block',
          }} />
          {/* Subtle gradient fade into copy section */}
          <div style={{
            position: 'absolute', inset: 0,
            background: isLandscape
              ? 'linear-gradient(to right, transparent 60%, rgba(250,248,245,0.6) 100%)'
              : 'linear-gradient(to bottom, transparent 55%, rgba(250,248,245,0.7) 100%)',
            pointerEvents: 'none',
          }} />
{/* No logo on image — logo is in the copy section */}
        </div>

        {/* Copy section */}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column',
          justifyContent: 'flex-start',
          padding: isLandscape
            ? `${32 * s}px ${40 * s}px`
            : `${28 * s}px ${44 * s}px`,
          background: 'linear-gradient(155deg, #faf8f5 0%, #fefcf9 40%, #fef3c720 100%)',
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}>
          {/* Logo — large like Mailchimp */}
          <div style={{ marginBottom: 16 * s }}>
            <AdLogo size={44 * s} />
          </div>

          <h1 style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: isLandscape ? 38 * s : isStory ? 50 * s : 44 * s,
            fontWeight: 700, color: COLORS.navy,
            lineHeight: 1.12, margin: 0, marginBottom: 16 * s,
            letterSpacing: '-0.02em',
          }}>
            {copy.headline}
          </h1>

          <p style={{
            fontSize: 17 * s, color: COLORS.slate,
            lineHeight: 1.55, margin: 0, marginBottom: 24 * s,
          }}>
            {copy.primaryText}
          </p>

          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 10 * s,
            backgroundColor: COLORS.navy, color: COLORS.white,
            padding: `${14 * s}px ${32 * s}px`,
            borderRadius: 12 * s, fontSize: 16 * s, fontWeight: 600,
            boxShadow: '0 8px 24px rgba(15,23,42,0.15)',
            alignSelf: 'flex-start',
          }}>
            {copy.ctaText}
            <span style={{ fontSize: 16 * s, opacity: 0.8 }}>&rarr;</span>
          </div>

          {/* Mini stats */}
          {!isLandscape && (
            <div style={{
              display: 'flex', gap: 24 * s, marginTop: 28 * s,
              paddingTop: 20 * s, borderTop: '1px solid rgba(15,23,42,0.06)',
            }}>
              {[
                { val: '~5 min', label: 'Analysis' },
                { val: '94%', label: 'Accuracy' },
              ].map((item, i) => (
                <div key={i}>
                  <div style={{ fontSize: 18 * s, fontWeight: 700, color: COLORS.navy }}>{item.val}</div>
                  <div style={{ fontSize: 11 * s, color: COLORS.slateLight, marginTop: 2 * s }}>{item.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- Original layout (no image) ---
  return (
    <div style={{
      width: format.width, height: format.height,
      background: 'linear-gradient(155deg, #faf8f5 0%, #fefcf9 40%, #fef3c730 70%, #faf8f5 100%)',
      position: 'relative', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      justifyContent: 'center',
      padding: isLandscape ? `${70 * s}px ${100 * s}px` : `${90 * s}px ${80 * s}px`,
      boxSizing: 'border-box', fontFamily: "'Geist', sans-serif",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&display=swap" rel="stylesheet" />

      <div style={{
        position: 'absolute', top: '-15%', right: '-18%',
        width: format.width * 0.65, height: format.width * 0.65,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(245,158,11,0.12) 0%, rgba(251,191,36,0.05) 45%, transparent 70%)',
        filter: 'blur(40px)', pointerEvents: 'none',
      }} />

      <div style={{
        position: 'absolute', bottom: '-10%', left: '-15%',
        width: format.width * 0.4, height: format.width * 0.4,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(15,23,42,0.04) 0%, transparent 65%)',
        filter: 'blur(30px)', pointerEvents: 'none',
      }} />

      <div style={{
        position: 'absolute', inset: 0, opacity: 0.3,
        backgroundImage: 'radial-gradient(circle, #0f172a08 1px, transparent 1px)',
        backgroundSize: `${24 * s}px ${24 * s}px`,
        pointerEvents: 'none',
      }} />

      <div style={{ position: 'relative', zIndex: 1, maxWidth: isLandscape ? '65%' : '100%' }}>
        <div style={{ marginBottom: 36 * s }}>
          <AdLogo size={28 * s} />
        </div>

        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8 * s,
          background: 'rgba(245,158,11,0.1)',
          border: '1px solid rgba(245,158,11,0.2)',
          padding: `${8 * s}px ${18 * s}px`,
          borderRadius: 100, marginBottom: 28 * s,
        }}>
          <span style={{ fontSize: 12 * s }}>&#9889;</span>
          <span style={{ fontSize: 14 * s, fontWeight: 600, color: '#b45309' }}>Trusted by 500+ California agents</span>
        </div>

        <h1 style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: isLandscape ? 52 * s : isStory ? 62 * s : 58 * s,
          fontWeight: 700, color: COLORS.navy,
          lineHeight: 1.12, margin: 0, marginBottom: 24 * s,
          letterSpacing: '-0.02em',
        }}>
          {copy.headline.split(' ').map((word, i, arr) => {
            if (i >= arr.length - 2) {
              return (
                <span key={i} style={{
                  background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
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
          fontSize: 21 * s, color: COLORS.slate,
          lineHeight: 1.65, margin: 0, marginBottom: 36 * s,
          maxWidth: isLandscape ? '85%' : '90%',
        }}>
          {copy.primaryText}
        </p>

        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 12 * s,
          backgroundColor: COLORS.navy, color: COLORS.white,
          padding: `${18 * s}px ${40 * s}px`,
          borderRadius: 14 * s, fontSize: 19 * s, fontWeight: 600,
          boxShadow: '0 12px 40px rgba(15,23,42,0.2), 0 4px 12px rgba(15,23,42,0.1)',
          letterSpacing: '0.01em',
        }}>
          {copy.ctaText}
          <span style={{ fontSize: 20 * s, opacity: 0.8 }}>&rarr;</span>
        </div>

        {!isLandscape && (
          <div style={{
            display: 'flex', gap: 32 * s, marginTop: 44 * s,
            paddingTop: 28 * s, borderTop: '1px solid rgba(15,23,42,0.06)',
          }}>
            {[
              { val: '~5 min', label: 'Analysis time' },
              { val: '94%', label: 'Detection rate' },
              { val: '40+', label: 'Hours saved/mo' },
            ].map((item, i) => (
              <div key={i}>
                <div style={{ fontSize: 22 * s, fontWeight: 700, color: COLORS.navy }}>{item.val}</div>
                <div style={{ fontSize: 13 * s, color: COLORS.slateLight, marginTop: 2 * s }}>{item.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {!isStory && (
        <div style={{
          position: 'absolute',
          ...(isLandscape
            ? { right: 60 * s, top: '50%', transform: 'translateY(-50%)' }
            : { right: -20 * s, bottom: 40 * s }),
        }}>
          <div style={{
            width: isLandscape ? 340 * s : 280 * s,
            backgroundColor: COLORS.white,
            borderRadius: 20 * s,
            boxShadow: '0 32px 80px rgba(15,23,42,0.12), 0 8px 24px rgba(15,23,42,0.06)',
            border: '1px solid rgba(15,23,42,0.04)',
            overflow: 'hidden',
          }}>
            <div style={{
              padding: `${10 * s}px ${14 * s}px`, display: 'flex',
              alignItems: 'center', gap: 6 * s,
              borderBottom: '1px solid rgba(15,23,42,0.04)',
            }}>
              <div style={{ width: 7 * s, height: 7 * s, borderRadius: '50%', background: '#ff5f57' }} />
              <div style={{ width: 7 * s, height: 7 * s, borderRadius: '50%', background: '#ffbd2e' }} />
              <div style={{ width: 7 * s, height: 7 * s, borderRadius: '50%', background: '#28c840' }} />
              <div style={{
                flex: 1, marginLeft: 8 * s, background: COLORS.offWhite,
                borderRadius: 6 * s, padding: `${4 * s}px ${10 * s}px`,
                fontSize: 8 * s, color: COLORS.slateLight,
              }}>
                app.discloser.co
              </div>
            </div>
            <div style={{ padding: 16 * s }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 * s, marginBottom: 14 * s }}>
                <AdLogo size={12 * s} />
                <span style={{
                  background: COLORS.amber, color: COLORS.navy,
                  fontSize: 7 * s, fontWeight: 800, padding: `${2 * s}px ${6 * s}px`,
                  borderRadius: 4 * s,
                }}>PRO</span>
              </div>
              {[
                { label: '123 Oak St', score: 92, color: '#10b981' },
                { label: '456 Pine Ave', score: 75, color: COLORS.amber },
                { label: '789 Cedar Ln', score: 58, color: '#ef4444' },
              ].map((row, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10 * s,
                  padding: `${8 * s}px 0`,
                  borderBottom: i < 2 ? '1px solid rgba(15,23,42,0.04)' : 'none',
                }}>
                  <span style={{ fontSize: 9 * s, color: COLORS.navy, fontWeight: 600, flex: 1 }}>{row.label}</span>
                  <div style={{
                    width: 60 * s, height: 6 * s, borderRadius: 3 * s,
                    background: '#f1f5f9', overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${row.score}%`, height: '100%',
                      borderRadius: 3 * s, background: row.color,
                    }} />
                  </div>
                  <span style={{ fontSize: 10 * s, fontWeight: 700, color: row.color, minWidth: 22 * s, textAlign: 'right' as const }}>{row.score}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
