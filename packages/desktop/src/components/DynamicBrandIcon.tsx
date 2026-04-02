import './DynamicBrandIcon.css';
export type { WeatherState } from '@tomekeep/shared';

interface Props {
  className?: string;
  size?: number | string;
}

export function DynamicBrandIcon({ className = '', size = 64 }: Props) {
  return (
    <div className={`dynamic-brand-icon ${className}`} style={{ width: size, height: size }}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 1024 1024"
        className="brand-svg"
      >
        {/* BOOK LAYER ONLY */}
        <g className="book-layer">
          <rect x="220" y="192" width="584" height="640" rx="60" className="book-fill stroke-main" />
          <line x1="360" y1="192" x2="360" y2="832" className="stroke-main" />
          <path d="M 460 192 L 640 192 L 640 552 L 550 472 L 460 552 Z" className="bookmark-fill" />
          <line x1="460" y1="672" x2="700" y2="672" className="stroke-main" />
          <line x1="460" y1="752" x2="600" y2="752" className="stroke-main" />
        </g>
      </svg>
    </div>
  );
}
