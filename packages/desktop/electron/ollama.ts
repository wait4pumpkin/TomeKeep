import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import type { PriceOffer } from '@tomekeep/shared'

const execFileAsync = promisify(execFile)

// Candidate paths for the ollama binary.  Checked in priority order so that
// the most specific / most likely path wins.  Falls back to bare 'ollama' for
// environments where it is on PATH (Linux, Windows Git Bash, etc.).
const OLLAMA_BIN_CANDIDATES = [
  '/usr/local/bin/ollama',        // macOS Intel Homebrew
  '/opt/homebrew/bin/ollama',     // macOS Apple Silicon Homebrew
  '/usr/bin/ollama',              // Linux package install
  '/usr/local/bin/ollama',        // Linux manual install
]

function resolveOllamaBin(): string {
  for (const p of OLLAMA_BIN_CANDIDATES) {
    if (existsSync(p)) return p
  }
  return 'ollama' // rely on PATH
}

const OLLAMA_BIN = resolveOllamaBin()
const MODEL = 'qwen2.5:3b'

// ---------------------------------------------------------------------------
// Bigram similarity fallback
// ---------------------------------------------------------------------------

function bigrams(s: string): Set<string> {
  const set = new Set<string>()
  const clean = s.toLowerCase().replace(/\s+/g, '')
  for (let i = 0; i < clean.length - 1; i++) {
    set.add(clean.slice(i, i + 2))
  }
  return set
}

function bigramSimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  const setA = bigrams(a)
  const setB = bigrams(b)
  if (setA.size === 0 || setB.size === 0) return 0
  let intersection = 0
  for (const bg of setA) {
    if (setB.has(bg)) intersection++
  }
  return (2 * intersection) / (setA.size + setB.size)
}

const BIGRAM_THRESHOLD = 0.3

function bigramFilter(offers: PriceOffer[], title: string, author?: string): PriceOffer[] {
  return offers.filter(o => {
    const offerTitle = o.title ?? ''
    const offerAuthor = o.author ?? ''
    const titleScore = bigramSimilarity(offerTitle, title)
    // Accept if title score passes threshold; also accept if author matches well
    if (titleScore >= BIGRAM_THRESHOLD) return true
    if (author) {
      const authorScore = bigramSimilarity(offerAuthor, author)
      return authorScore >= BIGRAM_THRESHOLD
    }
    return false
  })
}

// ---------------------------------------------------------------------------
// LLM filter via ollama
// ---------------------------------------------------------------------------

/**
 * Ask the local LLM to identify which candidate offers match the queried book.
 * Returns the subset of `offers` that the LLM considers relevant.
 *
 * The LLM is asked to return a JSON object `{ "matched": [<indices>] }` where
 * indices reference the zero-based position in `offers`. Any version of the
 * same book (different editions, publishers) is treated as a match.
 *
 * If the LLM call fails or times out, falls back to bigram similarity.
 */
export async function filterMatchingOffers(
  offers: PriceOffer[],
  title: string,
  author?: string,
): Promise<PriceOffer[]> {
  if (offers.length === 0) return []

  // Build a compact candidate list for the prompt
  const candidates = offers.map((o, i) => {
    const t = o.title ?? '(无标题)'
    const a = o.author ?? '(无作者)'
    return `${i}. 书名：${t}  作者：${a}`
  }).join('\n')

  const prompt =
    `你是书店比价助手。用户在查找书籍：\n` +
    `书名：${title}\n` +
    (author ? `作者：${author}\n` : '') +
    `\n以下是搜索结果候选列表（序号 0 起）：\n` +
    candidates +
    `\n\n请判断哪些候选是同一本书（包括不同版本/出版商均算匹配）。` +
    `只返回 JSON，格式：{"matched":[0,1,2]} 或 {"matched":[]}。不要解释，只输出 JSON。`

  try {
    const { stdout } = await execFileAsync(
      OLLAMA_BIN,
      ['run', MODEL, prompt],
      { timeout: 15_000 },
    )
    const jsonMatch = stdout.match(/\{[\s\S]*?"matched"[\s\S]*?\}/)
    if (!jsonMatch) throw new Error('no JSON in response')
    const parsed = JSON.parse(jsonMatch[0]) as { matched: unknown }
    if (!Array.isArray(parsed.matched)) throw new Error('matched is not array')
    const indices = (parsed.matched as unknown[])
      .map(n => typeof n === 'number' ? n : parseInt(String(n), 10))
      .filter(n => Number.isInteger(n) && n >= 0 && n < offers.length)
    return indices.map(i => offers[i])
  } catch (err) {
    console.warn('[ollama] LLM filter failed, falling back to bigram:', (err as Error).message)
    return bigramFilter(offers, title, author)
  }
}
