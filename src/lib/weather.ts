export type WeatherCondition =
  | 'clear'
  | 'partly-cloudy'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'thunderstorm'
  | 'unknown'

export interface WeatherState {
  condition: WeatherCondition
  isDay: boolean
}

/** Map WMO weather interpretation code → WeatherCondition */
function wmoToCondition(code: number): WeatherCondition {
  if (code === 0) return 'clear'
  if (code <= 3) return 'partly-cloudy'
  if (code <= 19) return 'cloudy'
  if (code <= 29) return 'fog' // 10-19 mist/fog; 20-29 past weather
  if (code <= 39) return 'fog' // 30-39 duststorm / fog variants
  if (code <= 49) return 'fog' // 40-49 fog
  if (code <= 59) return 'drizzle' // 50-59 drizzle
  if (code <= 69) return 'rain' // 60-69 rain
  if (code <= 79) return 'snow' // 70-79 snow
  if (code <= 84) return 'rain' // 80-84 rain showers
  if (code <= 86) return 'snow' // 85-86 snow showers
  if (code <= 94) return 'thunderstorm' // 87-94 hail / thunderstorm vicinity
  if (code <= 99) return 'thunderstorm' // 95-99 thunderstorm
  return 'unknown'
}

/** Fetch current weather using browser geolocation + Open-Meteo (no API key). */
export async function fetchWeather(): Promise<WeatherState> {
  const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
    navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 8000 }),
  )

  const { latitude, longitude } = pos.coords
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${latitude.toFixed(4)}&longitude=${longitude.toFixed(4)}` +
    `&current_weather=true`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Open-Meteo error ${res.status}`)

  const json = (await res.json()) as {
    current_weather?: { weathercode: number; is_day: number }
  }

  const cw = json.current_weather
  if (!cw) throw new Error('No current_weather in response')

  return {
    condition: wmoToCondition(cw.weathercode),
    isDay: cw.is_day !== 0,
  }
}
