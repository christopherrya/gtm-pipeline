interface AdLogoProps {
  size?: number;
  color?: string;
  dotColor?: string;
}

export const AdLogo = ({ size = 32, color = '#0f172a', dotColor = '#f59e0b' }: AdLogoProps) => {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: size * 0.25,
        lineHeight: 1,
      }}
    >
      <span
        style={{
          fontFamily: "'Playfair Display', serif",
          fontWeight: 700,
          fontSize: size,
          letterSpacing: '-0.03em',
          color,
          display: 'inline-flex',
          alignItems: 'baseline',
          lineHeight: 1,
        }}
      >
        D
        <span style={{ position: 'relative' }}>
          <span style={{ color }}>i</span>
          <span
            style={{
              position: 'absolute',
              top: '0.05em',
              left: '50%',
              transform: 'translateX(-50%)',
              width: '0.28em',
              height: '0.28em',
              backgroundColor: dotColor,
              borderRadius: '50%',
            }}
          />
        </span>
        scloser
      </span>
      <span
        style={{
          fontFamily: "'Geist', sans-serif",
          fontSize: size * 0.75,
          fontWeight: 500,
          color,
          opacity: 0.5,
          letterSpacing: '0.01em',
          lineHeight: 1,
          whiteSpace: 'nowrap',
        }}
      >
        | AI Real Estate Disclosure Analysis
      </span>
    </span>
  );
};
