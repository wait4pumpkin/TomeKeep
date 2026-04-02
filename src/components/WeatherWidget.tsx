import './WeatherWidget.css';
import type { WeatherState } from './DynamicBrandIcon';

interface Props {
  weather?: WeatherState;
  className?: string;
  size?: number | string;
}

export function WeatherWidget({ weather = 'none', className = '', size = 24 }: Props) {
  if (weather === 'none') return null;

  return (
    <div className={`weather-widget ${className}`} style={{ width: size, height: size }} title={`Current weather: ${weather}`}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 100 100"
        className="weather-svg"
      >
        {weather === 'sunny' && (
          <g>
            <circle cx="50" cy="50" r="20" className="w-sun-body" />
            <g className="w-sun-rays">
              <line x1="50" y1="12" x2="50" y2="20" />
              <line x1="50" y1="80" x2="50" y2="88" />
              <line x1="12" y1="50" x2="20" y2="50" />
              <line x1="80" y1="50" x2="88" y2="50" />
              <line x1="23.1" y1="23.1" x2="28.8" y2="28.8" />
              <line x1="71.2" y1="71.2" x2="76.9" y2="76.9" />
              <line x1="23.1" y1="76.9" x2="28.8" y2="71.2" />
              <line x1="71.2" y1="28.8" x2="76.9" y2="23.1" />
            </g>
          </g>
        )}

        {weather === 'cloudy' && (
          <g>
            <g className="w-cloud-back" transform="scale(0.8) translate(30, -10)">
              <circle cx="35" cy="55" r="15" />
              <circle cx="55" cy="45" r="20" />
              <circle cx="75" cy="55" r="15" />
              <rect x="35" y="50" width="40" height="20" rx="10" />
            </g>
            <g className="w-cloud-front">
              <circle cx="35" cy="55" r="15" />
              <circle cx="55" cy="45" r="20" />
              <circle cx="75" cy="55" r="15" />
              <rect x="35" y="50" width="40" height="20" rx="10" />
            </g>
          </g>
        )}

        {weather === 'rainy' && (
          <g>
            <g className="w-cloud-back" transform="translate(0, -15)">
              <circle cx="35" cy="55" r="15" />
              <circle cx="55" cy="45" r="20" />
              <circle cx="75" cy="55" r="15" />
              <rect x="35" y="50" width="40" height="20" rx="10" />
            </g>
            <line x1="35" y1="65" x2="25" y2="85" className="w-rain-drop w-rain-1" />
            <line x1="55" y1="60" x2="45" y2="80" className="w-rain-drop w-rain-2" />
            <line x1="75" y1="65" x2="65" y2="85" className="w-rain-drop w-rain-3" />
          </g>
        )}

        {weather === 'snowy' && (
          <g>
            <g className="w-cloud-back" transform="translate(0, -15)">
              <circle cx="35" cy="55" r="15" />
              <circle cx="55" cy="45" r="20" />
              <circle cx="75" cy="55" r="15" />
              <rect x="35" y="50" width="40" height="20" rx="10" />
            </g>
            <circle cx="30" cy="75" r="4" className="w-snow-flake w-snow-1" />
            <circle cx="55" cy="70" r="5" className="w-snow-flake w-snow-2" />
            <circle cx="80" cy="75" r="4" className="w-snow-flake w-snow-3" />
          </g>
        )}
      </svg>
    </div>
  );
}
