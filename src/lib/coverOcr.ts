/**
 * coverOcr.ts
 *
 * Wraps Tesseract.js to extract book metadata (title, author, publisher)
 * from a cover image data URL.
 *
 * The worker is lazily initialised on first call and reused across subsequent
 * calls to avoid the ~1-2 s cold-start overhead on every crop confirmation.
 *
 * Language packs: simplified Chinese (chi_sim) + English (eng).
 * Tesseract.js v7 downloads lang data from CDN by default (cached in
 * IndexedDB after the first download, so subsequent runs are instant).
 */

import { createWorker } from 'tesseract.js'

export type OcrResult = {
  title: string | null
  author: string | null
  publisher: string | null
}

// ---------------------------------------------------------------------------
// Worker singleton — lazily created, never terminated during the app session.
// ---------------------------------------------------------------------------

let workerPromise: Promise<Awaited<ReturnType<typeof createWorker>>> | null = null

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker(['chi_sim', 'eng'], undefined, {
      // Silence verbose Tesseract progress logs in the console
      logger: () => {},
    }).catch(err => {
      // Reset so the next call retries
      workerPromise = null
      throw err
    })
  }
  return workerPromise
}

// ---------------------------------------------------------------------------
// Keyword patterns for heuristic field classification
// ---------------------------------------------------------------------------

/** Author markers commonly found on Chinese book covers */
const AUTHOR_RE = /著|编著|编|译|撰|著译|主编|主撰|主译|\(著\)|\[著\]|（著）|【著】/

/** Publisher markers */
const PUBLISHER_RE = /出版社|出版集团|press|publishing|publisher|verlag|éditions/i

/** Lines that are almost certainly not useful (ISBN, URLs, prices, pure symbols) */
const JUNK_RE = /^[\d\s\-—–.·•*#@/\\|<>()（）【】\[\]{}]+$|isbn|http|www|\bCIP\b|定价|元|¥|\$/i

// ---------------------------------------------------------------------------
// Heuristic extraction
// ---------------------------------------------------------------------------

function cleanLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function isUsefulLine(line: string): boolean {
  if (line.length < 2) return false
  if (JUNK_RE.test(line)) return false
  return true
}

/**
 * Heuristically extract title / author / publisher from raw OCR text.
 *
 * Strategy:
 *  - Split into lines, clean whitespace
 *  - Publisher: first line matching PUBLISHER_RE
 *  - Author: first line matching AUTHOR_RE, stripped of the marker suffix
 *  - Title: longest remaining useful line (book titles are usually the
 *    most prominent / longest text on the cover)
 */
function extractFields(text: string): OcrResult {
  const lines = text
    .split('\n')
    .map(cleanLine)
    .filter(isUsefulLine)

  let publisher: string | null = null
  let author: string | null = null
  const remaining: string[] = []

  for (const line of lines) {
    if (!publisher && PUBLISHER_RE.test(line)) {
      publisher = line
      continue
    }
    if (!author && AUTHOR_RE.test(line)) {
      // Strip trailing author marker so we're left with just the name
      author = line.replace(/[　\s]*(著|编著|编|译|撰|著译|主编|主撰|主译|\(著\)|\[著\]|（著）|【著】)\s*$/, '').trim()
      if (!author) author = line  // fallback: keep original if stripping removes everything
      continue
    }
    remaining.push(line)
  }

  // Title = longest remaining line (covers tend to have big title text that
  // OCR outputs as a long contiguous string)
  const title = remaining.length > 0
    ? remaining.reduce((a, b) => a.length >= b.length ? a : b)
    : null

  return {
    title:     title     ? title.slice(0, 100)     : null,
    author:    author    ? author.slice(0, 80)      : null,
    publisher: publisher ? publisher.slice(0, 80)   : null,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run OCR on the given image data URL and return heuristically extracted
 * book metadata.  Never throws — returns all-null on any error.
 */
export async function extractCoverText(dataUrl: string): Promise<OcrResult> {
  const empty: OcrResult = { title: null, author: null, publisher: null }
  try {
    const worker = await getWorker()
    const { data } = await worker.recognize(dataUrl)
    return extractFields(data.text)
  } catch {
    return empty
  }
}
