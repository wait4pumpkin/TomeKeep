/**
 * author.ts
 *
 * Pure utilities for normalizing book author strings.
 * No side effects; safe to import from both renderer and main process.
 */

/**
 * Nationality-prefix pattern.
 *
 * Chinese book publishing convention wraps the author's nationality in brackets
 * before the name, e.g. `[美]阿瑟·克拉克` or `（英）道格拉斯·亚当斯`.
 * The brackets may be:
 *   - ASCII square brackets      [ ]
 *   - Fullwidth square brackets  【 】
 *   - ASCII parentheses          ( )
 *   - Fullwidth parentheses      （ ）
 *
 * The content is 1–6 CJK Unified Ideographs (国籍/地区).
 * After the closing bracket there should be exactly one space before the name,
 * but metadata sources frequently omit it.
 *
 * The regex captures:
 *   group 1 — the bracket + nationality content + closing bracket
 *   group 2 — optional whitespace between bracket and name
 *   group 3 — the rest of the string (the actual name)
 */
const NATIONALITY_PREFIX_RE = /^([\[【(（][\u4e00-\u9fff]{1,6}[\]】)）])(\s*)([\s\S]+)$/u

/**
 * Normalize a single author segment (no commas/slashes — call per-segment
 * when the full string contains multiple authors).
 *
 * Currently applied normalizations:
 *   1. Trim surrounding whitespace.
 *   2. Collapse internal runs of whitespace to a single space.
 *   3. Ensure exactly one space between a nationality prefix bracket and the name.
 */
function normalizeSegment(segment: string): string {
  // Collapse whitespace first so we work on a clean string
  const s = segment.replace(/\s+/g, ' ').trim()
  return s.replace(NATIONALITY_PREFIX_RE, (_, prefix, _ws, name) => `${prefix} ${name.trim()}`)
}

/**
 * Normalize an author string as stored in Book.author / WishlistItem.author.
 *
 * Multiple authors may be separated by `, ` (the format written by Douban/OpenLibrary
 * parsers). Each segment is individually normalized then re-joined.
 *
 * Returns the normalized string. If the input is empty/whitespace, returns `''`.
 */
export function normalizeAuthor(raw: string): string {
  if (!raw) return ''
  // Split on the canonical separator emitted by our parsers: ", "
  // Also handle "/" and "、" in case the value comes from manual entry.
  const parts = raw
    .split(/,\s*|\/|、/g)
    .map(normalizeSegment)
    .filter(Boolean)
  if (parts.length === 0) return ''
  return parts.join(', ')
}
