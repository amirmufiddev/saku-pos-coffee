import React from 'react';

interface SakuPosLogoProps {
  className?: string;
  height?: number | string;
  variant?: 'light' | 'dark';
}

export const SakuPosLogo: React.FC<SakuPosLogoProps> = ({
  className = '',
  height = 32,
  variant = 'light',
}) => {
  const strokeColor = variant === 'dark' ? '#ffffff' : '#1F2E23';
  const fillColor = variant === 'dark' ? '#1F2E23' : '#ffffff';
  const textColor = variant === 'dark' ? '#ffffff' : '#1F2E23';
  const accentColor = variant === 'dark' ? '#B69A60' : '#203B2D';

  return (
    <div className={`inline-flex items-center ${className}`}>
      <svg
        viewBox="0 0 300 60"
        style={{ height }}
        className="w-auto select-none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="SakuPOS - Coffee"
      >
        {/* Outer Box */}
        <rect
          x="2"
          y="2"
          width="296"
          height="56"
          rx="4"
          stroke={strokeColor}
          strokeWidth="3.5"
          fill={fillColor}
        />
        {/* Brand Accent Badge */}
        <rect
          x="2"
          y="2"
          width="162"
          height="56"
          rx="3"
          fill={accentColor}
        />
        {/* SAKUPOS */}
        <text
          x="83"
          y="39"
          fontFamily="'Inter', 'Arial Black', -apple-system, sans-serif"
          fontWeight="900"
          fontSize="24"
          fill="#ffffff"
          textAnchor="middle"
          letterSpacing="1.5"
        >
          SAKUPOS
        </text>
        {/* COFFEE */}
        <text
          x="231"
          y="39"
          fontFamily="'Inter', 'Arial Black', -apple-system, sans-serif"
          fontWeight="900"
          fontSize="22"
          fill={textColor}
          textAnchor="middle"
          letterSpacing="1.5"
        >
          COFFEE
        </text>
      </svg>
    </div>
  );
};
