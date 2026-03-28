import type { BookMetadata } from './openLibrary'

export type IsbnSearchResult =
  | { ok: true; value: BookMetadata }
  | { ok: false; error: 'not_found' | 'bad_response' }

/**
 * Returns true if the given URL is a known isbndb placeholder cover.
 *
 * isbndb CDN has two URL formats:
 *   - Real cover:   https://images.isbndb.com/covers/<numericId>.jpg
 *   - Placeholder:  https://images.isbndb.com/covers/XX/YY/<isbn>.jpg
 *
 * The placeholder is served with HTTP 200 for any ISBN that has no cover
 * in isbndb's database — it must never be saved as a real cover image.
 */
export function isIsbndbPlaceholderUrl(url: string): boolean {
  // Placeholder pattern: /covers/<twoChars>/<twoChars>/<isbn>.jpg
  return /images\.isbndb\.com\/covers\/[^/]{1,4}\/[^/]{1,4}\//.test(url)
}

/**
 * Parse isbnsearch.org HTML for a given ISBN.
 *
 * Expected structure (plain HTML, no JS rendering):
 *   <div id="book">
 *     <div class="image"><img src="https://images.isbndb.com/covers/..." /></div>
 *     <div class="bookinfo">
 *       <h1>Title</h1>
 *       <p>Author: John Doe</p>
 *       <p>Publisher: Some Publisher, 2020</p>
 *       ...
 *     </div>
 *   </div>
 */
export function parseIsbnSearchHtml(isbn13: string, html: string): IsbnSearchResult {
  // Title: first <h1> inside #book .bookinfo
  const titleMatch = html.match(/<div[^>]+class="bookinfo"[^>]*>[\s\S]*?<h1[^>]*>([\s\S]*?)<\/h1>/i)
  const title = titleMatch ? stripTags(titleMatch[1]).trim() : undefined

  if (!title) return { ok: false, error: 'not_found' }

  // Author: <p> line containing "Author:"
  const authorMatch = html.match(/Author:\s*<\/(?:b|strong)>\s*([\s\S]*?)<\/p>/i)
    ?? html.match(/Author:\s*([\s\S]*?)<\/p>/i)
  const author = authorMatch ? stripTags(authorMatch[1]).trim() : undefined

  // Publisher: <p> line containing "Publisher:"
  const publisherMatch = html.match(/Publisher:\s*<\/(?:b|strong)>\s*([\s\S]*?)<\/p>/i)
    ?? html.match(/Publisher:\s*([\s\S]*?)<\/p>/i)
  // Publisher field often contains ", YYYY" at the end — strip trailing year/comma
  const publisherRaw = publisherMatch ? stripTags(publisherMatch[1]).trim() : undefined
  const publisher = publisherRaw ? publisherRaw.replace(/,\s*\d{4}.*$/, '').trim() : undefined

  // Cover: img src inside #book .image (handles double or single-quoted src)
  const coverMatch =
    html.match(/<div[^>]+class=["']image["'][^>]*>[\s\S]*?<img[^>]+src="([^"]+)"/i) ??
    html.match(/<div[^>]+class=["']image["'][^>]*>[\s\S]*?<img[^>]+src='([^']+)'/i)
  let coverUrl = coverMatch ? coverMatch[1].trim() : undefined

  // Fallback: scan the entire HTML for a numeric-ID isbndb cover URL
  // (real covers use /covers/<numericId>.jpg, NOT /covers/XX/YY/<isbn>.jpg)
  if (!coverUrl) {
    const fallbackMatch = html.match(/https:\/\/images\.isbndb\.com\/covers\/(\d+)\.jpg/i)
    if (fallbackMatch) coverUrl = fallbackMatch[0].trim()
  }

  // Reject placeholder URLs — they look like real covers but serve a generic
  // "not available" image. Treat them as absent so callers don't persist garbage.
  if (coverUrl && isIsbndbPlaceholderUrl(coverUrl)) coverUrl = undefined

  return {
    ok: true,
    value: {
      isbn13,
      title,
      author: author || undefined,
      publisher: publisher || undefined,
      coverUrl: coverUrl || undefined,
    },
  }
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
}
