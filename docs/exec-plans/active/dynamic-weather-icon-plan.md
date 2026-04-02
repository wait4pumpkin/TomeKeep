# Execution Plan: Dynamic Weather Brand Icon

## Objective
Replace the current static application icon with a new, responsive, vector-based "Tome & Keep" design (a modern, substantial book with a shield/bookmark motif). Implement a dynamic, animated version of this icon within the React application that responds to real-time weather data based on the user's approximate location (IP-based). Finally, generate a pristine, full-bleed 1024x1024 PNG for the macOS application icon to resolve current visual artifacts ("white borders").

## Requirements
1.  **New Design Concept:** Modern, minimalist book + shield/bookmark ribbon.
2.  **macOS App Icon (`build/icon.png`):** Full-bleed, 1024x1024 PNG, Light mode fixed, no transparent padding.
3.  **App/Web Icon (`public/favicon.svg`):** Vector SVG, auto-adapting Light/Dark mode via CSS media queries (`prefers-color-scheme`).
4.  **In-App Dynamic Component (`src/components/DynamicBrandIcon.tsx`):** A React component based on the new SVG design that accepts weather states (e.g., `sunny`, `rainy`, `snowy`).
5.  **Weather Animations (CSS):** Smooth, subtle CSS animations for different weather states (rotating sun, falling rain/snow) within the React component.
6.  **Real-time Weather Integration (`src/lib/weather.ts`):** 
    *   Use IP-based location estimation (e.g., via `ipapi.co` or similar free service).
    *   Fetch real-time weather data using the free, no-key `OpenMeteo` API.
    *   Map OpenMeteo weather codes to our simplified internal states (`sunny`, `cloudy`, `rainy`, `snowy`).
7.  **Integration:** Replace the static logo/icon in the main application header/UI with the new `<DynamicBrandIcon />`.

## Steps

### Step 1: Asset Generation & Static Icons
1.  Create the base scalable vector graphic (SVG) representing the "Tome & Keep" concept.
2.  Embed `@media (prefers-color-scheme: dark)` styling within the SVG for automatic theme switching.
3.  Save this SVG to `public/favicon.svg`.
4.  Use a temporary Node.js script (with `canvas` or `sharp`) to render the Light version of the SVG into a 1024x1024 full-bleed PNG.
5.  Overwrite `build/icon.png` with this new, borderless image.

### Step 2: React Component & Animation (The Dynamic Icon)
1.  Create `src/components/DynamicBrandIcon.tsx`.
2.  Translate the SVG structure into React JSX, organizing it into logical layers (base book, background, weather layer).
3.  Define props: `weather: 'sunny' | 'cloudy' | 'rainy' | 'snowy' | 'none'`, `size: number`.
4.  Create corresponding CSS/Tailwind classes (or styled-components) to handle the weather animations (e.g., `.weather-sun-spin`, `.weather-rain-fall`).

### Step 3: Weather Data Fetching Logic
1.  Create `src/lib/weather.ts`.
2.  Implement `fetchApproximateLocation()`: A function to fetch latitude and longitude using a free IP geolocation API.
3.  Implement `fetchCurrentWeather(lat, lon)`: A function to call the `OpenMeteo` API (`api.open-meteo.com/v1/forecast?current_weather=true`).
4.  Implement `getWeatherState()`: Orchestrate the location and weather calls, mapping the WMO weather code from OpenMeteo to our specific state strings (`sunny`, `rainy`, etc.).

### Step 4: UI Integration
1.  Identify where the main application logo is displayed (likely in a `Header` component or `App.tsx`).
2.  Implement a `useEffect` hook to call `getWeatherState()` on initial load (and optionally set up a periodic refresh, e.g., every hour).
3.  Store the fetched weather state.
4.  Render `<DynamicBrandIcon weather={currentWeather} />` in place of the static logo.

## Open Questions / Considerations
*   **Rate Limits:** Free IP geolocation APIs often have rate limits. We need robust error handling (falling back to a default 'none' weather state or cached data) if the request fails. OpenMeteo is very generous, but IP location needs care.
*   **Caching:** Should we cache the location/weather data in `localStorage` for a short period (e.g., 30 minutes) to avoid spamming the APIs on rapid reloads? (Recommended: Yes).
*   **Electron Offline Mode:** If the app is launched offline, the icon should gracefully degrade to its base state without errors.

## Execution
This plan is ready for execution upon user approval of the implementation details.
