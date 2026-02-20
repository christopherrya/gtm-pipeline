import React from 'react';
import type { AdFormat } from '@/types/ad';

interface TemplateWrapperProps {
  format: AdFormat;
  scale?: number;
  children: React.ReactNode;
  className?: string;
}

export const TemplateWrapper = ({ format, scale = 0.25, children, className }: TemplateWrapperProps) => {
  return (
    <div
      className={className}
      style={{
        width: format.width * scale,
        height: format.height * scale,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <div
        style={{
          width: format.width,
          height: format.height,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          position: 'absolute',
          top: 0,
          left: 0,
        }}
      >
        {children}
      </div>
    </div>
  );
};
