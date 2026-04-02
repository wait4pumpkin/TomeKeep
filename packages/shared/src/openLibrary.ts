export type BookMetadata = {
  isbn13?: string
  title?: string
  author?: string
  publisher?: string
  coverUrl?: string
}

export type OpenLibraryLookupResult =
  | { ok: true; value: BookMetadata }
  | { ok: false; error: 'not_found' | 'bad_response' }

export function parseOpenLibraryBooksApiResponse(isbn13: string, data: unknown): OpenLibraryLookupResult {
  if (!data || typeof data !== 'object') return { ok: false, error: 'bad_response' }

  const key = `ISBN:${isbn13}`
  const record = (data as Record<string, unknown>)[key]
  if (!record) return { ok: false, error: 'not_found' }
  if (typeof record !== 'object') return { ok: false, error: 'bad_response' }

  const title = readString((record as Record<string, unknown>)['title'])

  const authors = (record as Record<string, unknown>)['authors']
  const author = readFirstNameFromList(authors)

  const publishers = (record as Record<string, unknown>)['publishers']
  const publisher = readFirstNameFromList(publishers)

  const cover = (record as Record<string, unknown>)['cover']
  const coverUrl =
    cover && typeof cover === 'object'
      ? readString((cover as Record<string, unknown>)['large']) ??
        readString((cover as Record<string, unknown>)['medium']) ??
        readString((cover as Record<string, unknown>)['small'])
      : undefined

  return {
    ok: true,
    value: {
      isbn13,
      title: title ?? undefined,
      author: author ?? undefined,
      publisher: publisher ?? undefined,
      coverUrl: coverUrl ?? undefined,
    },
  }
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  return v ? v : null
}

function readFirstNameFromList(value: unknown): string | null {
  if (!Array.isArray(value)) return null
  const names = value
    .map(item => {
      if (!item || typeof item !== 'object') return null
      return readString((item as Record<string, unknown>)['name'])
    })
    .filter((x): x is string => Boolean(x))

  if (names.length === 0) return null
  if (names.length === 1) return names[0]
  return names.join(', ')
}
