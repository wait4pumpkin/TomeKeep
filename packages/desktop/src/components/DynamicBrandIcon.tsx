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
        <defs>
          <linearGradient id="brand-gold" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#F5D87A" stopOpacity="1" />
            <stop offset="100%" stopColor="#B8860B" stopOpacity="1" />
          </linearGradient>
        </defs>

        {/* Sunrise rays */}
        <g stroke="url(#brand-gold)" strokeLinecap="round" opacity="0.9">
          <line x1="512" y1="580" x2="200" y2="310" strokeWidth="14"/>
          <line x1="512" y1="580" x2="240" y2="270" strokeWidth="12"/>
          <line x1="512" y1="580" x2="295" y2="240" strokeWidth="12"/>
          <line x1="512" y1="580" x2="355" y2="215" strokeWidth="12"/>
          <line x1="512" y1="580" x2="420" y2="200" strokeWidth="12"/>
          <line x1="512" y1="580" x2="470" y2="195" strokeWidth="13"/>
          <line x1="512" y1="580" x2="512" y2="192" strokeWidth="14"/>
          <line x1="512" y1="580" x2="554" y2="195" strokeWidth="13"/>
          <line x1="512" y1="580" x2="604" y2="200" strokeWidth="12"/>
          <line x1="512" y1="580" x2="669" y2="215" strokeWidth="12"/>
          <line x1="512" y1="580" x2="729" y2="240" strokeWidth="12"/>
          <line x1="512" y1="580" x2="784" y2="270" strokeWidth="12"/>
          <line x1="512" y1="580" x2="824" y2="310" strokeWidth="14"/>
        </g>

        {/* Sun semicircle */}
        <path d="M 230 580 A 282 282 0 0 1 794 580 Z" fill="url(#brand-gold)" opacity="0.95"/>

        {/* Book pages fan lines */}
        <g stroke="#7A5C10" strokeLinecap="round" strokeWidth="9" opacity="0.7">
          <line x1="512" y1="580" x2="370" y2="400"/>
          <line x1="512" y1="580" x2="390" y2="385"/>
          <line x1="512" y1="580" x2="415" y2="373"/>
          <line x1="512" y1="580" x2="442" y2="365"/>
          <line x1="512" y1="580" x2="470" y2="361"/>
          <line x1="512" y1="580" x2="512" y2="360"/>
          <line x1="512" y1="580" x2="554" y2="361"/>
          <line x1="512" y1="580" x2="582" y2="365"/>
          <line x1="512" y1="580" x2="609" y2="373"/>
          <line x1="512" y1="580" x2="634" y2="385"/>
          <line x1="512" y1="580" x2="654" y2="400"/>
        </g>

        {/* Open book - left page */}
        <path d="M 512 580 L 310 520 L 295 760 L 512 800 Z" fill="url(#brand-gold)"/>
        {/* Open book - right page */}
        <path d="M 512 580 L 714 520 L 729 760 L 512 800 Z" fill="url(#brand-gold)"/>
        {/* Book spine */}
        <line x1="512" y1="580" x2="512" y2="800" stroke="#7A5C10" strokeWidth="10" opacity="0.6"/>

        {/* 明 character - left page */}
        <text x="400" y="730" fontFamily="STHeiti, Heiti TC, serif" fontSize="140" fontWeight="bold"
              fill="#5C3D08" textAnchor="middle" opacity="0.85">明</text>

        {/* 開 character - right page */}
        <text x="624" y="730" fontFamily="STHeiti, Heiti TC, serif" fontSize="140" fontWeight="bold"
              fill="#5C3D08" textAnchor="middle" opacity="0.85">開</text>
      </svg>
    </div>
  );
}
