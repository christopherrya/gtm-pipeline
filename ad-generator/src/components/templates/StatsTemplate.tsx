import React from 'react';
import type { AdFormat, AdCopy } from '@/types/ad';
import { COLORS } from '@/lib/constants';
import { AdLogo } from './AdLogo';

interface StatsTemplateProps {
  copy: AdCopy;
  format: AdFormat;
  backgroundImage?: string;
  overlayOpacity?: number;
}

const STATS = [
  { value: '150+', label: 'Pages Analyzed' },
  { value: '~5 min', label: 'Per Report' },
  { value: '500+', label: 'Agents Trust Us' },
];

export const StatsTemplate = ({ copy, format, backgroundImage }: StatsTemplateProps) => {
  const s = Math.min(format.width, format.height) / 1080;
  const isStory = format.height > format.width * 1.4;
  const isLandscape = format.width > format.height * 1.4;

  // --- Image-integrated layout: image hero with stats bar overlay ---
  if (backgroundImage) {
    const imgFraction = isLandscape ? 0.55 : isStory ? 0.45 : 0.52;

    return (
      <div style={{
        width: format.width, height: format.height,
        position: 'relative', overflow: 'hidden',
        fontFamily: "'Geist', sans-serif",
        background: '#0c1222',
      }}>
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&display=swap" rel="stylesheet" />

        {/* Image section - top */}
        <div style={{
          position: 'relative',
          width: format.width,
          height: format.height * imgFraction,
          overflow: 'hidden',
        }}>
          <img src={backgroundImage} style={{
            width: '100%', height: '100%',
            objectFit: 'cover', display: 'block',
          }} />
          {/* Gradient fade to dark */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(to bottom, rgba(12,18,34,0.2) 0%, rgba(12,18,34,0.5) 60%, rgba(12,18,34,1) 100%)',
            pointerEvents: 'none',
          }} />
{/* No logo on image — logo in copy section */}
        </div>

        {/* Content section - bottom dark */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          height: format.height * (1 - imgFraction + 0.08),
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          textAlign: 'center',
          padding: `${20 * s}px ${48 * s}px ${36 * s}px`,
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}>
          {/* Logo */}
          <div style={{ marginBottom: 18 * s }}>
            <AdLogo size={44 * s} color="rgba(255,255,255,0.95)" dotColor="#f59e0b" />
          </div>

          {/* Headline */}
          <h1 style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: isLandscape ? 34 * s : 38 * s,
            fontWeight: 700, color: COLORS.white,
            lineHeight: 1.15, margin: 0, marginBottom: 28 * s,
            letterSpacing: '-0.01em',
          }}>
            {copy.headline}
          </h1>

          {/* Stats row */}
          <div style={{
            display: 'flex',
            flexDirection: isStory ? 'column' : 'row',
            alignItems: 'center', justifyContent: 'center',
            width: '100%', marginBottom: 28 * s,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 16 * s,
            padding: `${20 * s}px ${12 * s}px`,
          }}>
            {STATS.map((stat, i) => (
              <React.Fragment key={i}>
                {i > 0 && (
                  <div style={{
                    width: isStory ? '50%' : 1,
                    height: isStory ? 1 : 44 * s,
                    backgroundColor: 'rgba(255,255,255,0.08)',
                    margin: isStory ? `${10 * s}px 0` : `0 ${4 * s}px`,
                  }} />
                )}
                <div style={{
                  flex: isStory ? undefined : 1,
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', gap: 4 * s,
                  padding: isStory ? `${8 * s}px 0` : `0 ${8 * s}px`,
                }}>
                  <span style={{
                    fontFamily: "'Playfair Display', serif",
                    fontSize: isLandscape ? 38 * s : 42 * s,
                    fontWeight: 700,
                    background: `linear-gradient(135deg, ${COLORS.amber}, ${COLORS.amberLight})`,
                    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                    lineHeight: 1.1,
                  }}>
                    {stat.value}
                  </span>
                  <span style={{
                    fontSize: 11 * s, color: 'rgba(255,255,255,0.5)',
                    fontWeight: 500, letterSpacing: '0.08em',
                    textTransform: 'uppercase' as const,
                  }}>
                    {stat.label}
                  </span>
                </div>
              </React.Fragment>
            ))}
          </div>

          {/* CTA */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8 * s,
            background: 'linear-gradient(135deg, #f59e0b, #fbbf24)',
            color: COLORS.navy,
            padding: `${14 * s}px ${36 * s}px`,
            borderRadius: 12 * s, fontSize: 16 * s, fontWeight: 700,
            boxShadow: '0 8px 28px rgba(245,158,11,0.25)',
          }}>
            {copy.ctaText}
          </div>
        </div>
      </div>
    );
  }

  // --- Original dark layout (no image) ---
  return (
    <div style={{
      width: format.width, height: format.height,
      background: `linear-gradient(160deg, #0c1222 0%, #0f172a 30%, #141d2f 60%, #0f172a 100%)`,
      position: 'relative', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      justifyContent: 'center', alignItems: 'center',
      padding: `${80 * s}px ${80 * s}px`,
      boxSizing: 'border-box', fontFamily: "'Geist', sans-serif",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&display=swap" rel="stylesheet" />

      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: `
          linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)
        `,
        backgroundSize: `${44 * s}px ${44 * s}px`,
        pointerEvents: 'none',
      }} />

      <div style={{
        position: 'absolute', top: '40%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: format.width * 0.5, height: format.width * 0.3,
        borderRadius: '50%',
        background: 'radial-gradient(ellipse, rgba(245,158,11,0.06) 0%, transparent 70%)',
        filter: 'blur(40px)', pointerEvents: 'none',
      }} />

      <div style={{
        position: 'relative', zIndex: 1,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', textAlign: 'center',
        width: '100%', maxWidth: isLandscape ? '90%' : '95%',
      }}>
        <div style={{ marginBottom: 28 * s }}>
          <AdLogo size={26 * s} color="rgba(255,255,255,0.8)" dotColor="#f59e0b" />
        </div>

        <h1 style={{
          fontFamily: "'Playfair Display', serif",
          fontSize: isLandscape ? 40 * s : 46 * s,
          fontWeight: 700, color: COLORS.white,
          lineHeight: 1.15, margin: 0, marginBottom: 48 * s,
          letterSpacing: '-0.01em',
        }}>
          {copy.headline}
        </h1>

        <div style={{
          display: 'flex',
          flexDirection: isStory ? 'column' : 'row',
          alignItems: 'center', justifyContent: 'center',
          width: '100%', marginBottom: 44 * s,
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.05)',
          borderRadius: 20 * s,
          padding: `${28 * s}px ${16 * s}px`,
        }}>
          {STATS.map((stat, i) => (
            <React.Fragment key={i}>
              {i > 0 && (
                <div style={{
                  width: isStory ? '50%' : 1,
                  height: isStory ? 1 : 56 * s,
                  backgroundColor: 'rgba(255,255,255,0.08)',
                  margin: isStory ? `${14 * s}px 0` : `0 ${4 * s}px`,
                }} />
              )}
              <div style={{
                flex: isStory ? undefined : 1,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', gap: 6 * s,
                padding: isStory ? `${12 * s}px 0` : `0 ${12 * s}px`,
              }}>
                <span style={{
                  fontFamily: "'Playfair Display', serif",
                  fontSize: isLandscape ? 46 * s : 52 * s,
                  fontWeight: 700,
                  background: `linear-gradient(135deg, ${COLORS.amber}, ${COLORS.amberLight})`,
                  WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                  lineHeight: 1.1, letterSpacing: '-0.02em',
                }}>
                  {stat.value}
                </span>
                <span style={{
                  fontSize: 13 * s, color: 'rgba(255,255,255,0.5)',
                  fontWeight: 500, letterSpacing: '0.08em',
                  textTransform: 'uppercase' as const,
                }}>
                  {stat.label}
                </span>
              </div>
            </React.Fragment>
          ))}
        </div>

        <p style={{
          fontSize: 18 * s, color: 'rgba(148,163,184,0.8)',
          lineHeight: 1.55, margin: 0, marginBottom: 36 * s,
          maxWidth: '78%',
        }}>
          {copy.description}
        </p>

        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 10 * s,
          background: 'linear-gradient(135deg, #f59e0b, #fbbf24)',
          color: COLORS.navy,
          padding: `${20 * s}px ${48 * s}px`,
          borderRadius: 14 * s, fontSize: 20 * s, fontWeight: 700,
          boxShadow: '0 12px 40px rgba(245,158,11,0.2), 0 4px 12px rgba(245,158,11,0.1)',
          letterSpacing: '0.01em',
        }}>
          {copy.ctaText}
        </div>
      </div>
    </div>
  );
};
