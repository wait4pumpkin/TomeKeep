import type { BookMetadata } from './openLibrary'
import { toSimplified } from './hanzi'

export type BookDraft = {
  title?: string
  author?: string
  publisher?: string
  coverUrl?: string
  isbn?: string
}

export function mergeBookDraftWithMetadata(draft: BookDraft, meta: BookMetadata): BookDraft {
  return {
    ...draft,
    isbn: draft.isbn ?? meta.isbn13,
    title: toSimplified(draft.title?.trim() ? draft.title : meta.title ?? draft.title ?? ''),
    author: toSimplified(draft.author?.trim() ? draft.author : meta.author ?? draft.author ?? ''),
    publisher: draft.publisher?.trim() ? draft.publisher : meta.publisher ?? draft.publisher,
    coverUrl: draft.coverUrl?.trim() ? draft.coverUrl : meta.coverUrl ?? draft.coverUrl,
  }
}
