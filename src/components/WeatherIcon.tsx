import { useEffect, useRef, useState } from 'react'
import { fetchWeather } from '../lib/weather'
import type { WeatherCondition, WeatherState } from '../lib/weather'

// ---------------------------------------------------------------------------
// CSS keyframe animations injected once into <head>
// ---------------------------------------------------------------------------
const STYLE_ID = 'weather-icon-keyframes'
function injectStyles() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
    @keyframes wi-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    @keyframes wi-pulse { 0%,100% { opacity:1; } 50% { opacity:0.45; } }
    @keyframes wi-sway  {
      0%,100% { transform: rotate(-8deg); }
      50%      { transform: rotate(8deg);  }
    }
    @keyframes wi-fall {
      0%   { transform: translateY(0);    opacity:1;   }
      100% { transform: translateY(5px);  opacity:0.2; }
    }
    @keyframes wi-flash {
      0%,90%,100% { opacity:1; }
      95%          { opacity:0; }
    }
  `
  document.head.appendChild(style)
}

// ---------------------------------------------------------------------------
// Individual icon shapes
// ---------------------------------------------------------------------------

function SunIcon() {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      {/* Rays — spinning slowly */}
      <g style={{ transformOrigin: '16px 16px', animation: 'wi-spin 12s linear infinite' }}>
        {[0,45,90,135,180,225,270,315].map((deg) => (
          <line
            key={deg}
            x1="16" y1="4" x2="16" y2="7"
            stroke="#FBBF24" strokeWidth="2" strokeLinecap="round"
            style={{ transformOrigin: '16px 16px', transform: `rotate(${deg}deg)` }}
          />
        ))}
      </g>
      {/* Disk */}
      <circle cx="16" cy="16" r="6" fill="#FCD34D" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      <path
        d="M20 9a9 9 0 1 1-9 9 7 7 0 0 0 9-9z"
        fill="#93C5FD"
        style={{ animation: 'wi-pulse 4s ease-in-out infinite' }}
      />
    </svg>
  )
}

function CloudIcon({ color = '#CBD5E1' }: { color?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      <ellipse cx="16" cy="19" rx="10" ry="6" fill={color} />
      <circle cx="12" cy="17" r="5" fill={color} />
      <circle cx="19" cy="16" r="4" fill={color} />
    </svg>
  )
}

function PartlyCloudyIcon({ isDay }: { isDay: boolean }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      {/* Sun or moon behind cloud */}
      {isDay ? (
        <circle cx="11" cy="12" r="5" fill="#FCD34D" />
      ) : (
        <path d="M14 7a6 6 0 1 1-6 6 5 5 0 0 0 6-6z" fill="#93C5FD" />
      )}
      {/* Cloud foreground — sways */}
      <g style={{ animation: 'wi-sway 5s ease-in-out infinite', transformOrigin: '18px 20px' }}>
        <ellipse cx="18" cy="21" rx="9" ry="5.5" fill="#CBD5E1" />
        <circle cx="14" cy="19" r="4.5" fill="#CBD5E1" />
        <circle cx="20" cy="18" r="3.5" fill="#CBD5E1" />
      </g>
    </svg>
  )
}

function FogIcon() {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      {[10, 16, 22].map((y, i) => (
        <line
          key={y}
          x1="5" y1={y} x2="27" y2={y}
          stroke="#94A3B8" strokeWidth="2.5" strokeLinecap="round"
          style={{ animation: `wi-pulse ${2.5 + i * 0.4}s ease-in-out infinite` }}
        />
      ))}
    </svg>
  )
}

function DrizzleIcon() {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      <ellipse cx="16" cy="11" rx="9" ry="5.5" fill="#94A3B8" />
      <circle cx="12" cy="10" r="4.5" fill="#94A3B8" />
      <circle cx="19" cy="9" r="3.5" fill="#94A3B8" />
      {[10, 16, 22].map((x, i) => (
        <line
          key={x}
          x1={x} y1="19" x2={x - 2} y2="25"
          stroke="#60A5FA" strokeWidth="1.8" strokeLinecap="round"
          style={{ animation: `wi-fall 1.2s ${i * 0.3}s ease-in infinite` }}
        />
      ))}
    </svg>
  )
}

function RainIcon() {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      <ellipse cx="16" cy="11" rx="9" ry="5.5" fill="#64748B" />
      <circle cx="12" cy="10" r="4.5" fill="#64748B" />
      <circle cx="19" cy="9" r="3.5" fill="#64748B" />
      {[9, 14, 19, 24].map((x, i) => (
        <line
          key={x}
          x1={x} y1="18" x2={x - 3} y2="26"
          stroke="#3B82F6" strokeWidth="2" strokeLinecap="round"
          style={{ animation: `wi-fall 0.9s ${i * 0.2}s ease-in infinite` }}
        />
      ))}
    </svg>
  )
}

function SnowIcon() {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      <ellipse cx="16" cy="11" rx="9" ry="5.5" fill="#94A3B8" />
      <circle cx="12" cy="10" r="4.5" fill="#94A3B8" />
      <circle cx="19" cy="9" r="3.5" fill="#94A3B8" />
      {[10, 16, 22].map((x, i) => (
        <circle
          key={x}
          cx={x} cy="23" r="1.5"
          fill="#BAE6FD"
          style={{ animation: `wi-fall 1.4s ${i * 0.35}s ease-in infinite` }}
        />
      ))}
    </svg>
  )
}

function ThunderstormIcon() {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      <ellipse cx="16" cy="10" rx="9" ry="5.5" fill="#475569" />
      <circle cx="12" cy="9" r="4.5" fill="#475569" />
      <circle cx="19" cy="8" r="3.5" fill="#475569" />
      {/* Lightning bolt */}
      <path
        d="M18 17 L14 23 L17 23 L13 30 L20 21 L17 21 Z"
        fill="#FDE047"
        style={{ animation: 'wi-flash 2.5s ease-in-out infinite' }}
      />
      {[9, 24].map((x, i) => (
        <line
          key={x}
          x1={x} y1="18" x2={x - 2} y2="23"
          stroke="#3B82F6" strokeWidth="1.8" strokeLinecap="round"
          style={{ animation: `wi-fall 0.9s ${i * 0.3}s ease-in infinite` }}
        />
      ))}
    </svg>
  )
}

function UnknownIcon() {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
      <circle cx="16" cy="16" r="11" fill="none" stroke="#94A3B8" strokeWidth="2" />
      <text x="16" y="21" textAnchor="middle" fontSize="12" fill="#94A3B8">?</text>
    </svg>
  )
}

function conditionIcon(condition: WeatherCondition, isDay: boolean) {
  switch (condition) {
    case 'clear':        return isDay ? <SunIcon /> : <MoonIcon />
    case 'partly-cloudy':return <PartlyCloudyIcon isDay={isDay} />
    case 'cloudy':       return <CloudIcon color="#94A3B8" />
    case 'fog':          return <FogIcon />
    case 'drizzle':      return <DrizzleIcon />
    case 'rain':         return <RainIcon />
    case 'snow':         return <SnowIcon />
    case 'thunderstorm': return <ThunderstormIcon />
    default:             return <UnknownIcon />
  }
}

// ---------------------------------------------------------------------------
// Public component
// ---------------------------------------------------------------------------

/** Small animated weather icon that self-fetches from Open-Meteo. */
export function WeatherIcon({ className = 'w-8 h-8' }: { className?: string }) {
  const [weather, setWeather] = useState<WeatherState | null>(null)
  const [error, setError] = useState(false)
  const fetched = useRef(false)

  useEffect(() => {
    injectStyles()
    if (fetched.current) return
    fetched.current = true
    fetchWeather()
      .then(setWeather)
      .catch(() => setError(true))
  }, [])

  if (error || (!weather && !error)) {
    // Loading: show a muted pulsing circle; error: show nothing (don't clutter UI)
    if (error) return null
    return (
      <div className={`${className} flex items-center justify-center`}>
        <div className="w-4 h-4 rounded-full bg-gray-300 dark:bg-gray-600"
          style={{ animation: 'wi-pulse 1.5s ease-in-out infinite' }} />
      </div>
    )
  }

  return (
    <div className={className} title={weather!.condition}>
      {conditionIcon(weather!.condition, weather!.isDay)}
    </div>
  )
}
