/**
 * Deterministic tag color palette.
 *
 * Each tag string is hashed to one of TAG_PALETTES, so the same tag always
 * renders with the same color regardless of where it appears (filter bar,
 * edit panel, card badge).
 *
 * Each palette entry exposes three sets of Tailwind classes:
 *   - `badge`   — bg + text + border for a filled badge (tag editor / card)
 *   - `active`  — bg + text + border for an active filter button
 *   - `hover`   — hover text + hover border for an inactive filter button
 */

export type TagColorPalette = {
  badge: string
  active: string
  hover: string
}

const PALETTES: TagColorPalette[] = [
  {
    badge:  'bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-700',
    active: 'bg-violet-500 border-violet-500 text-white',
    hover:  'hover:border-violet-400 hover:text-violet-600 dark:hover:text-violet-400',
  },
  {
    badge:  'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-700',
    active: 'bg-blue-500 border-blue-500 text-white',
    hover:  'hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400',
  },
  {
    badge:  'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-700',
    active: 'bg-emerald-500 border-emerald-500 text-white',
    hover:  'hover:border-emerald-400 hover:text-emerald-600 dark:hover:text-emerald-400',
  },
  {
    badge:  'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-700',
    active: 'bg-amber-500 border-amber-500 text-white',
    hover:  'hover:border-amber-400 hover:text-amber-600 dark:hover:text-amber-400',
  },
  {
    badge:  'bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-700',
    active: 'bg-rose-500 border-rose-500 text-white',
    hover:  'hover:border-rose-400 hover:text-rose-600 dark:hover:text-rose-400',
  },
  {
    badge:  'bg-sky-50 dark:bg-sky-900/30 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-700',
    active: 'bg-sky-500 border-sky-500 text-white',
    hover:  'hover:border-sky-400 hover:text-sky-600 dark:hover:text-sky-400',
  },
  {
    badge:  'bg-fuchsia-50 dark:bg-fuchsia-900/30 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-200 dark:border-fuchsia-700',
    active: 'bg-fuchsia-500 border-fuchsia-500 text-white',
    hover:  'hover:border-fuchsia-400 hover:text-fuchsia-600 dark:hover:text-fuchsia-400',
  },
  {
    badge:  'bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-700',
    active: 'bg-teal-500 border-teal-500 text-white',
    hover:  'hover:border-teal-400 hover:text-teal-600 dark:hover:text-teal-400',
  },
]

/** Simple djb2-style hash that fits in a 32-bit integer. */
function hashTag(tag: string): number {
  let h = 5381
  for (let i = 0; i < tag.length; i++) {
    h = ((h << 5) + h) ^ tag.charCodeAt(i)
    h = h >>> 0 // keep unsigned 32-bit
  }
  return h
}

/** Return the deterministic color palette for a given tag string. */
export function tagColor(tag: string): TagColorPalette {
  return PALETTES[hashTag(tag) % PALETTES.length]
}
