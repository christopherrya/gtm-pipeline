import { cn } from '@/lib/utils';

interface LogoProps {
  className?: string;
}

export const Logo = ({ className }: LogoProps) => {
  return (
    <div className={cn("flex items-baseline", className)}>
      <span
        style={{
          fontFamily: "'Playfair Display', serif",
          fontWeight: 700,
          letterSpacing: '-0.03em',
          color: '#0f172a',
          display: 'inline-flex',
          alignItems: 'baseline',
        }}
        className="text-3xl md:text-4xl"
      >
        D
        <span style={{ position: 'relative' }}>
          <span style={{ color: '#0f172a' }}>i</span>
          <span
            style={{
              position: 'absolute',
              top: '0.05em',
              left: '50%',
              transform: 'translateX(-50%)',
              width: '0.28em',
              height: '0.28em',
              backgroundColor: '#f59e0b',
              borderRadius: '50%',
            }}
          />
        </span>
        scloser
      </span>
    </div>
  );
};
