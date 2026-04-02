export type NormalizedIsbn =
  | { kind: 'isbn13'; normalized: string }
  | { kind: 'isbn10'; normalized: string }

export type NormalizeIsbnResult =
  | { ok: true; value: NormalizedIsbn }
  | { ok: false; error: 'empty' | 'not_isbn' | 'invalid_checksum' }

export function normalizeIsbn(raw: string): NormalizeIsbnResult {
  const input = raw.trim()
  if (!input) return { ok: false, error: 'empty' }

  const digitsOnly = (input.match(/\d/g) ?? []).join('')
  const maybeIsbn10Chars = (input.toUpperCase().match(/[0-9X]/g) ?? []).join('')

  const isbn13Candidate =
    findIsbn13Candidate(digitsOnly) ??
    findIsbn13Candidate((input.match(/97[89]\d{10}/g) ?? [])[0] ?? '') ??
    null

  if (isbn13Candidate) {
    if (!isbn13Candidate.startsWith('978') && !isbn13Candidate.startsWith('979')) {
      return { ok: false, error: 'not_isbn' }
    }
    if (!isValidIsbn13(isbn13Candidate)) return { ok: false, error: 'invalid_checksum' }
    return { ok: true, value: { kind: 'isbn13', normalized: isbn13Candidate } }
  }

  const isbn10Candidate = findIsbn10Candidate(maybeIsbn10Chars)
  if (isbn10Candidate) {
    if (!isValidIsbn10(isbn10Candidate)) return { ok: false, error: 'invalid_checksum' }
    return { ok: true, value: { kind: 'isbn10', normalized: isbn10Candidate } }
  }

  return { ok: false, error: 'not_isbn' }
}

export function toIsbn13(value: NormalizedIsbn): string | null {
  if (value.kind === 'isbn13') return value.normalized
  return convertIsbn10ToIsbn13(value.normalized)
}

export function isValidIsbn13(isbn13: string): boolean {
  if (!/^\d{13}$/.test(isbn13)) return false
  const digits = isbn13.split('').map(d => Number(d))
  const checkDigit = digits[12]
  const sum = digits.slice(0, 12).reduce((acc, d, idx) => acc + d * (idx % 2 === 0 ? 1 : 3), 0)
  const expected = (10 - (sum % 10)) % 10
  return checkDigit === expected
}

export function isValidIsbn10(isbn10: string): boolean {
  if (!/^\d{9}[\dX]$/.test(isbn10)) return false
  const chars = isbn10.split('')
  const digits = chars.map((c, idx) => {
    if (idx === 9 && c === 'X') return 10
    return Number(c)
  })
  const sum = digits.reduce((acc, d, idx) => acc + d * (10 - idx), 0)
  return sum % 11 === 0
}

export function convertIsbn10ToIsbn13(isbn10: string): string | null {
  if (!isValidIsbn10(isbn10)) return null
  const core = `978${isbn10.slice(0, 9)}`
  const digits = core.split('').map(d => Number(d))
  const sum = digits.reduce((acc, d, idx) => acc + d * (idx % 2 === 0 ? 1 : 3), 0)
  const checkDigit = (10 - (sum % 10)) % 10
  return `${core}${checkDigit}`
}

/**
 * Semantic information derived from an ISBN registration group.
 * `region` is the publishing region/country (e.g. "中国大陆").
 * `language` is the primary language area (e.g. "中文").
 */
export type IsbnSemantics = {
  region: string
  language: string
}

/**
 * Registration group table for ISBN-13 (978/979 prefix).
 * Entries are matched longest-first against the digits after the 3-digit GS1 prefix.
 * Sources: International ISBN Agency registration group list.
 */
const ISBN13_GROUP_TABLE: Array<{ prefix: string; region: string; language: string }> = [
  // ── 979 block ──────────────────────────────────────────────
  { prefix: '97910', region: '法国', language: '法语' },
  { prefix: '97911', region: '韩国', language: '韩语' },
  { prefix: '97912', region: '意大利', language: '意大利语' },
  { prefix: '9798',  region: '美国（自出版）', language: '英语' },

  // ── 978 block — 5-digit groups ─────────────────────────────
  { prefix: '97899937', region: '澳门', language: '中文' },

  // ── 978 block — 3-digit groups ─────────────────────────────
  { prefix: '978957', region: '台湾', language: '中文' },
  { prefix: '978986', region: '台湾', language: '中文' },
  { prefix: '978988', region: '香港', language: '中文' },
  { prefix: '978950', region: '阿根廷', language: '西班牙语' },
  { prefix: '978956', region: '智利', language: '西班牙语' },
  { prefix: '978958', region: '哥伦比亚', language: '西班牙语' },
  { prefix: '978968', region: '墨西哥', language: '西班牙语' },
  { prefix: '978972', region: '葡萄牙', language: '葡萄牙语' },

  // ── 978 block — 2-digit groups ─────────────────────────────
  { prefix: '97880', region: '捷克', language: '捷克语' },
  { prefix: '97881', region: '印度', language: '印地语/英语' },
  { prefix: '97882', region: '挪威', language: '挪威语' },
  { prefix: '97883', region: '波兰', language: '波兰语' },
  { prefix: '97884', region: '西班牙', language: '西班牙语' },
  { prefix: '97885', region: '巴西', language: '葡萄牙语' },
  { prefix: '97886', region: '塞尔维亚', language: '塞尔维亚语' },
  { prefix: '97887', region: '丹麦', language: '丹麦语' },
  { prefix: '97888', region: '意大利', language: '意大利语' },
  { prefix: '97889', region: '韩国', language: '韩语' },
  { prefix: '97890', region: '荷兰', language: '荷兰语' },
  { prefix: '97891', region: '瑞典', language: '瑞典语' },
  { prefix: '97892', region: '国际组织', language: '多语种' },
  { prefix: '97893', region: '印度', language: '印地语/英语' },
  { prefix: '97894', region: '荷兰', language: '荷兰语' },

  // ── 978 block — 1-digit groups ─────────────────────────────
  { prefix: '9780', region: '英语区', language: '英语' },
  { prefix: '9781', region: '英语区', language: '英语' },
  { prefix: '9782', region: '法语区', language: '法语' },
  { prefix: '9783', region: '德语区', language: '德语' },
  { prefix: '9784', region: '日本', language: '日语' },
  { prefix: '9785', region: '俄语区', language: '俄语' },
  { prefix: '9787', region: '中国大陆', language: '中文' },
]

/**
 * Parse semantic information (region and language) from a raw ISBN string.
 * Accepts both ISBN-13 and ISBN-10 (ISBN-10 is converted to ISBN-13 first).
 * Returns null if the ISBN cannot be parsed or the group is unrecognised.
 */
export function parseIsbnSemantics(raw: string): IsbnSemantics | null {
  const result = normalizeIsbn(raw)
  if (!result.ok) return null

  const isbn13 = toIsbn13(result.value)
  if (!isbn13) return null

  // Match longest prefix first (table is already ordered longest → shortest within blocks,
  // but we sort by prefix length descending to be safe).
  const sorted = [...ISBN13_GROUP_TABLE].sort((a, b) => b.prefix.length - a.prefix.length)
  for (const entry of sorted) {
    if (isbn13.startsWith(entry.prefix)) {
      return { region: entry.region, language: entry.language }
    }
  }
  return null
}

/**
 * Known publisher (registrant) prefixes for common publishers.
 * The prefix is the full ISBN-13 digits up to (and including) the registrant element.
 * Matched longest-first, same as the group table.
 *
 * Coverage focuses on China mainland (group 978-7) where publisher identification
 * is most valuable for this app's use-case. Other groups return null.
 *
 * Source: publicly documented ISBN registrant allocations for group 7.
 * Note: registrant boundaries within a group are only precisely determinable from
 * the ISBN Agency RangeMessage.xml. This table covers well-known large publishers
 * whose prefixes are publicly documented; smaller publishers will return null.
 */
const ISBN_PUBLISHER_TABLE: Array<{ prefix: string; publisher: string }> = [
  // ── Group 7 (China mainland) — 2-digit registrant (large national publishers) ──
  { prefix: '978700', publisher: '中国大百科全书出版社' },
  { prefix: '978701', publisher: '人民出版社' },
  { prefix: '978702', publisher: '人民文学出版社' },
  { prefix: '978703', publisher: '科学出版社' },
  { prefix: '978704', publisher: '高等教育出版社' },
  { prefix: '978705', publisher: '商务印书馆' },
  { prefix: '978706', publisher: '中华书局' },
  { prefix: '978707', publisher: '文物出版社' },
  { prefix: '978708', publisher: '中国财政经济出版社' },
  { prefix: '978709', publisher: '中国国际广播出版社' },
  { prefix: '978710', publisher: '外语教学与研究出版社' },
  { prefix: '978711', publisher: '北京大学出版社' },
  { prefix: '978712', publisher: '中国人民大学出版社' },
  { prefix: '978713', publisher: '高等教育出版社' },
  { prefix: '978714', publisher: '作家出版社' },
  { prefix: '978715', publisher: '中国青年出版社' },
  { prefix: '978716', publisher: '新华出版社' },
  { prefix: '978717', publisher: '人民音乐出版社' },
  { prefix: '978718', publisher: '中国建筑工业出版社' },
  { prefix: '978719', publisher: '中国画报出版社' },
  { prefix: '978720', publisher: '法律出版社' },
  { prefix: '978721', publisher: '光明日报出版社' },
  { prefix: '978722', publisher: '中国电影出版社' },
  { prefix: '978723', publisher: '中国农业出版社' },
  { prefix: '978724', publisher: '中国水利水电出版社' },
  { prefix: '978725', publisher: '中国社会科学出版社' },
  { prefix: '978726', publisher: '上海人民出版社' },
  { prefix: '978727', publisher: '知识产权出版社' },
  { prefix: '978728', publisher: '中国林业出版社' },
  { prefix: '978729', publisher: '中国标准出版社' },
  // ── Group 7 — 3-digit registrant (medium publishers) ──
  { prefix: '9787100', publisher: '商务印书馆' },
  { prefix: '9787101', publisher: '中华书局' },
  { prefix: '9787102', publisher: '农业出版社' },
  { prefix: '9787103', publisher: '人民音乐出版社' },
  { prefix: '9787104', publisher: '中国戏剧出版社' },
  { prefix: '9787105', publisher: '中国广播电视出版社' },
  { prefix: '9787106', publisher: '中国电影出版社' },
  { prefix: '9787107', publisher: '人民教育出版社' },
  { prefix: '9787108', publisher: '三联书店' },
  { prefix: '9787109', publisher: '中国农业出版社' },
  { prefix: '9787111', publisher: '机械工业出版社' },
  { prefix: '9787112', publisher: '中国建筑工业出版社' },
  { prefix: '9787113', publisher: '中国铁道出版社' },
  { prefix: '9787114', publisher: '人民交通出版社' },
  { prefix: '9787115', publisher: '人民邮电出版社' },
  { prefix: '9787117', publisher: '人民卫生出版社' },
  { prefix: '9787119', publisher: '外文出版社' },
  { prefix: '9787121', publisher: '电子工业出版社' },
  { prefix: '9787122', publisher: '化学工业出版社' },
  { prefix: '9787123', publisher: '中国文联出版社' },
  { prefix: '9787200', publisher: '北京出版社' },
  { prefix: '9787201', publisher: '天津人民出版社' },
  { prefix: '9787208', publisher: '上海人民出版社' },
  { prefix: '9787213', publisher: '浙江人民出版社' },
  { prefix: '9787214', publisher: '江苏人民出版社' },
  { prefix: '9787218', publisher: '广东人民出版社' },
  { prefix: '9787220', publisher: '四川人民出版社' },
  { prefix: '9787224', publisher: '陕西人民出版社' },
  { prefix: '9787229', publisher: '重庆出版社' },
  { prefix: '9787230', publisher: '甘肃人民出版社' },
  { prefix: '9787301', publisher: '北京大学出版社' },
  { prefix: '9787302', publisher: '清华大学出版社' },
  { prefix: '9787305', publisher: '南京大学出版社' },
  { prefix: '9787307', publisher: '武汉大学出版社' },
  { prefix: '9787308', publisher: '浙江大学出版社' },
  { prefix: '9787309', publisher: '复旦大学出版社' },
  { prefix: '9787310', publisher: '南开大学出版社' },
  { prefix: '9787312', publisher: '中国科学技术大学出版社' },
  { prefix: '9787313', publisher: '上海交通大学出版社' },
  { prefix: '9787316', publisher: '北京航空航天大学出版社' },
  { prefix: '9787500', publisher: '中国社会科学出版社' },
  { prefix: '9787501', publisher: '新华出版社' },
  { prefix: '9787503', publisher: '文化艺术出版社' },
  { prefix: '9787505', publisher: '中国文史出版社' },
  { prefix: '9787506', publisher: '作家出版社' },
  { prefix: '9787507', publisher: '华文出版社' },
  { prefix: '9787508', publisher: '中信出版社' },
  { prefix: '9787509', publisher: '社会科学文献出版社' },
  { prefix: '9787510', publisher: '世界知识出版社' },
  { prefix: '9787511', publisher: '法律出版社' },
  { prefix: '9787512', publisher: '国际文化出版公司' },
  { prefix: '9787513', publisher: '新星出版社' },
  { prefix: '9787514', publisher: '中国书店' },
  { prefix: '9787516', publisher: '中国国际广播出版社' },
  { prefix: '9787517', publisher: '中国言实出版社' },
  { prefix: '9787519', publisher: '光明日报出版社' },
  { prefix: '9787520', publisher: '中国文联出版社' },
  { prefix: '9787521', publisher: '中国法制出版社' },
  { prefix: '9787539', publisher: '江西人民出版社' },
  { prefix: '9787540', publisher: '湖南人民出版社' },
  { prefix: '9787544', publisher: '上海译文出版社' },
  { prefix: '9787545', publisher: '天地出版社' },
  { prefix: '9787550', publisher: '北京联合出版公司' },
  { prefix: '9787552', publisher: '上海社会科学院出版社' },
  { prefix: '9787559', publisher: '北京联合出版公司' },
  { prefix: '9787561', publisher: '北京语言大学出版社' },
  { prefix: '9787564', publisher: '北京体育大学出版社' },
]

/**
 * Parse the publisher name from a raw ISBN string.
 * Returns a publisher name string if the registrant prefix matches a known entry,
 * or null if unrecognised.
 *
 * Currently covers major publishers in China mainland (group 978-7).
 * Other regions return null (region/language info available via parseIsbnSemantics).
 */
export function parseIsbnPublisher(raw: string): string | null {
  const result = normalizeIsbn(raw)
  if (!result.ok) return null
  const isbn13 = toIsbn13(result.value)
  if (!isbn13) return null

  const sorted = [...ISBN_PUBLISHER_TABLE].sort((a, b) => b.prefix.length - a.prefix.length)
  for (const entry of sorted) {
    if (isbn13.startsWith(entry.prefix)) return entry.publisher
  }
  return null
}

function findIsbn13Candidate(digitsOnly: string): string | null {
  if (/^\d{13}$/.test(digitsOnly)) return digitsOnly
  const match = digitsOnly.match(/97[89]\d{10}/)
  return match?.[0] ?? null
}

function findIsbn10Candidate(chars: string): string | null {
  if (/^\d{9}[\dX]$/.test(chars)) return chars
  const match = chars.match(/\d{9}[\dX]/)
  return match?.[0] ?? null
}
