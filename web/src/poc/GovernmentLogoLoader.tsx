import React, { useId } from 'react';

export interface GovernmentLogoLoaderProps {
  /** Sizing tier or custom pixel diameter */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'fullscreen' | number;
  /** Primary status message */
  label?: React.ReactNode;
  /** Subtitle / hint message */
  sublabel?: React.ReactNode;
  /** Full screen overlay mode with backdrop blur */
  fullscreen?: boolean;
  /** Inline display variant (horizontal layout) */
  inline?: boolean;
  /** Additional CSS class names */
  className?: string;
  /** Inline style overrides */
  style?: React.CSSProperties;
  /** Whether to show the central emblem (default true for sm and above) */
  showEmblem?: boolean;
}

interface SizeDimensions {
  outerSize: number;
  emblemSize: number;
  strokeWidth: number;
}

const SIZE_CONFIG: Record<string, SizeDimensions> = {
  xs: { outerSize: 20, emblemSize: 0, strokeWidth: 2.75 },
  sm: { outerSize: 46, emblemSize: 26, strokeWidth: 3.2 },
  md: { outerSize: 76, emblemSize: 44, strokeWidth: 3.8 },
  lg: { outerSize: 104, emblemSize: 62, strokeWidth: 4.2 },
  xl: { outerSize: 136, emblemSize: 82, strokeWidth: 4.8 },
  fullscreen: { outerSize: 116, emblemSize: 70, strokeWidth: 4.4 },
};

/**
 * GovernmentLogoLoader — Premium Round Animated Loading Symbol.
 * 
 * Styled with the official Tamil Nadu Government green (#006a4e)
 * and radiant temple gold (#f59e0b, #fbbf24) in a multi-layered circular
 * orbital animation with the state emblem centered inside.
 */
export const GovernmentLogoLoader: React.FC<GovernmentLogoLoaderProps> = ({
  size = 'md',
  label,
  sublabel,
  fullscreen = false,
  inline = false,
  className = '',
  style = {},
  showEmblem,
}) => {
  const reactId = useId();
  const gradId = `gov-grad-${reactId.replace(/:/g, '')}`;
  const glowId = `gov-glow-${reactId.replace(/:/g, '')}`;

  const isFullscreen = fullscreen || size === 'fullscreen';

  const dims: SizeDimensions = typeof size === 'number'
    ? {
        outerSize: size,
        emblemSize: Math.round(size * 0.58),
        strokeWidth: Math.max(2.4, Math.round(size * 0.045 * 10) / 10),
      }
    : (SIZE_CONFIG[size] || SIZE_CONFIG.md);

  const isMini = dims.outerSize <= 24;
  const renderEmblem = showEmblem ?? (!isMini && dims.emblemSize > 0);

  return (
    <div
      className={`gov-round-loader-container ${isFullscreen ? 'fullscreen' : ''} ${inline ? 'inline' : ''} ${className}`}
      style={style}
      role="status"
      aria-live="polite"
      aria-label={typeof label === 'string' ? label : 'Loading'}
    >
      <div
        className="gov-round-loader-wrapper"
        style={{ width: dims.outerSize, height: dims.outerSize }}
      >
        {/* Soft Radial Ambient Aura in Green & Golden Glow */}
        {!isMini && <div className="gov-round-loader-aura" />}

        {/* SVG Orbital Dual-Color Ring (Green & Gold) */}
        <svg
          className="gov-round-loader-svg"
          viewBox="0 0 100 100"
          style={{ width: dims.outerSize, height: dims.outerSize }}
        >
          <defs>
            {/* Vibrant Green-to-Gold Gradient */}
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#006a4e" />
              <stop offset="35%" stopColor="#10b981" />
              <stop offset="70%" stopColor="#fbbf24" />
              <stop offset="100%" stopColor="#f59e0b" />
            </linearGradient>

            {/* Glowing filter for orbital accents */}
            <filter id={glowId} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="1.8" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* Background Track Circle */}
          <circle
            cx="50"
            cy="50"
            r="43"
            fill="none"
            className="gov-ring-track"
            strokeWidth={dims.strokeWidth * (100 / dims.outerSize)}
          />

          {/* Delicate Counter-Rotating Golden Starlight Dashes (for sm and above) */}
          {!isMini && (
            <circle
              cx="50"
              cy="50"
              r="47"
              fill="none"
              className="gov-ring-counter-dash"
              stroke="#f59e0b"
              strokeWidth="1.2"
              strokeDasharray="4 8"
              opacity="0.65"
            />
          )}

          {/* Primary High-Speed Smooth Orbit Arc (Green & Gold) */}
          <circle
            cx="50"
            cy="50"
            r="43"
            fill="none"
            stroke={`url(#${gradId})`}
            strokeWidth={dims.strokeWidth * (100 / dims.outerSize)}
            strokeLinecap="round"
            className="gov-ring-spinner"
          />

          {/* Golden Orbit Accent Bead */}
          <circle
            cx="50"
            cy="7"
            r={isMini ? '3.5' : '3.8'}
            fill="#fbbf24"
            filter={`url(#${glowId})`}
            className="gov-ring-bead"
          />
        </svg>

        {/* Center Disc & State Emblem */}
        {renderEmblem && (
          <div
            className="gov-round-emblem-disc"
            style={{
              width: dims.emblemSize,
              height: dims.emblemSize,
            }}
          >
            <img
              src="/tn-gov-logo.png"
              alt="Government of Tamil Nadu Official Emblem"
              className="gov-round-emblem-img"
              style={{
                width: dims.emblemSize * 0.88,
                height: dims.emblemSize * 0.88,
              }}
              loading="eager"
              decoding="sync"
            />
          </div>
        )}
      </div>

      {/* Label and Sublabel Typography */}
      {(label || sublabel) && (
        <div className="gov-round-loader-text-group">
          {label && (
            <div className="gov-round-loader-label">
              <span>{label}</span>
              <span className="gov-loader-animated-dots">
                <i>.</i><i>.</i><i>.</i>
              </span>
            </div>
          )}
          {sublabel && <div className="gov-round-loader-sublabel">{sublabel}</div>}
        </div>
      )}
    </div>
  );
};

export default GovernmentLogoLoader;
