export type WeatherState = 'sunny' | 'cloudy' | 'rainy' | 'snowy' | 'none';

export interface WeatherData {
  state: WeatherState;
  temperature?: number;
}

const CACHE_KEY = 'tomekeep_weather_cache';
const CACHE_DURATION = 1000 * 60 * 30; // 30 minutes

interface CachedWeather {
  timestamp: number;
  data: WeatherData;
}

export async function fetchWeather(): Promise<WeatherData> {
  try {
    const cachedStr = localStorage.getItem(CACHE_KEY);
    if (cachedStr) {
      const cached: CachedWeather = JSON.parse(cachedStr);
      if (Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached.data;
      }
    }

    // 1. Get approximate location via IP
    const locRes = await fetch('https://ipapi.co/json/');
    if (!locRes.ok) throw new Error('Location fetch failed');
    const locData = await locRes.json() as { latitude: number; longitude: number };
    const { latitude, longitude } = locData;

    // 2. Fetch current weather from OpenMeteo
    const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`);
    if (!weatherRes.ok) throw new Error('Weather fetch failed');
    const weatherData = await weatherRes.json() as { current_weather: { weathercode: number; temperature: number } };
    
    // WMO Weather interpretation codes
    // 0: Clear sky
    // 1, 2, 3: Mainly clear, partly cloudy, and overcast
    // 45, 48: Fog and depositing rime fog
    // 51, 53, 55: Drizzle: Light, moderate, and dense intensity
    // 56, 57: Freezing Drizzle: Light and dense intensity
    // 61, 63, 65: Rain: Slight, moderate and heavy intensity
    // 66, 67: Freezing Rain: Light and heavy intensity
    // 71, 73, 75: Snow fall: Slight, moderate, and heavy intensity
    // 77: Snow grains
    // 80, 81, 82: Rain showers: Slight, moderate, and violent
    // 85, 86: Snow showers slight and heavy
    // 95: Thunderstorm: Slight or moderate
    // 96, 99: Thunderstorm with slight and heavy hail

    const code = weatherData.current_weather.weathercode;
    let state: WeatherState = 'none';

    if (code === 0 || code === 1 || code === 2) {
      state = 'sunny';
    } else if (code === 3 || code === 45 || code === 48) {
      state = 'cloudy';
    } else if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code)) {
      state = 'rainy';
    } else if ([71, 73, 75, 77, 85, 86].includes(code)) {
      state = 'snowy';
    }

    const result: WeatherData = {
      state,
      temperature: weatherData.current_weather.temperature,
    };

    localStorage.setItem(CACHE_KEY, JSON.stringify({
      timestamp: Date.now(),
      data: result
    }));

    return result;
  } catch (err) {
    console.error('Failed to fetch dynamic weather:', err);
    return { state: 'none' };
  }
}
