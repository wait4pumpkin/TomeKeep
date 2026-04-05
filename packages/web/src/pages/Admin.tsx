// src/pages/Admin.tsx
// Admin page: invite code management — list (paginated), generate, share link, copy, delete.

import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api.ts'
import { useLang } from '../lib/i18n.tsx'

interface InviteItem {
  code: string
  created_at: string
  used_by_username: string | null
  used_at: string | null
}

interface InvitesResponse {
  items: InviteItem[]
  total: number
  page: number
  pageSize: number
}

export function Admin() {
  const { t } = useLang()

  // ── Invite list state ────────────────────────────────────────────────────
  const [page, setPage] = useState(1)
  const [data, setData] = useState<InvitesResponse | null>(null)
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

  const loadInvites = useCallback(async (p: number) => {
    setListLoading(true)
    setListError(null)
    try {
      const res = await api.get<InvitesResponse>(`/auth/invites?page=${p}`)
      setData(res)
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err))
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadInvites(page)
  }, [page, loadInvites])

  // ── Generate ─────────────────────────────────────────────────────────────
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)

  async function handleGenerate() {
    setGenerating(true)
    setGenError(null)
    try {
      await api.post<{ code: string }>('/auth/invite', {})
      setPage(1)
      await loadInvites(1)
    } catch (err) {
      setGenError(err instanceof Error ? err.message : String(err))
    } finally {
      setGenerating(false)
    }
  }

  // ── Copy code ────────────────────────────────────────────────────────────
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  async function handleCopyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code)
      setCopiedCode(code)
      setTimeout(() => setCopiedCode(null), 2000)
    } catch { /* noop */ }
  }

  // ── Share link ───────────────────────────────────────────────────────────
  const [sharedCode, setSharedCode] = useState<string | null>(null)

  async function handleShareLink(code: string) {
    const url = `${window.location.origin}/register?invite=${encodeURIComponent(code)}`
    try {
      await navigator.clipboard.writeText(url)
      setSharedCode(code)
      setTimeout(() => setSharedCode(null), 2000)
    } catch { /* noop */ }
  }

  // ── Delete ───────────────────────────────────────────────────────────────
  const [deletingCode, setDeletingCode] = useState<string | null>(null)

  async function handleDelete(code: string) {
    setDeletingCode(code)
    try {
      await api.delete(`/auth/invites/${encodeURIComponent(code)}`)
      // Optimistically remove from local state; reload if list becomes empty
      setData(prev => {
        if (!prev) return prev
        const items = prev.items.filter(i => i.code !== code)
        const total = prev.total - 1
        // If we emptied the current page and it's not page 1, go back
        if (items.length === 0 && prev.page > 1) {
          void loadInvites(prev.page - 1)
          setPage(prev.page - 1)
          return prev
        }
        return { ...prev, items, total }
      })
    } catch { /* noop – could show error, keep simple */ }
    finally {
      setDeletingCode(null)
    }
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / (data.pageSize || 10))) : 1

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-6">
        {t('admin_invite_section')}
      </h1>

      {/* Generate button */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => { void handleGenerate() }}
          disabled={generating}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
        >
          {generating ? t('admin_generating') : t('admin_generate_invite')}
        </button>
        {genError && (
          <span className="text-sm text-red-500 dark:text-red-400">
            {t('admin_invite_error', { error: genError })}
          </span>
        )}
      </div>

      {/* Invite list */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 px-4 py-2 border-b border-gray-200 dark:border-gray-700 text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wide">
          <span>{t('admin_col_code')}</span>
          <span className="text-right">{t('admin_col_created')}</span>
          <span className="text-right">{t('admin_col_used_by')}</span>
          {/* actions column — no header */}
          <span />
        </div>

        {/* Loading */}
        {listLoading && (
          <div className="px-4 py-8 text-center text-sm text-gray-400">
            {t('admin_loading')}
          </div>
        )}
        {/* Error */}
        {!listLoading && listError && (
          <div className="px-4 py-8 text-center text-sm text-red-500">
            {t('admin_load_error', { error: listError })}
          </div>
        )}
        {/* Empty */}
        {!listLoading && !listError && data && data.items.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-gray-400">
            {t('admin_empty_invites')}
          </div>
        )}

        {/* Rows */}
        {!listLoading && data && data.items.map((item, idx) => {
          const used = Boolean(item.used_by_username)
          const isDeleting = deletingCode === item.code
          return (
            <div
              key={item.code}
              className={`grid grid-cols-[1fr_auto_auto_auto] gap-x-3 items-center px-4 py-3 text-sm ${
                idx < data.items.length - 1 ? 'border-b border-gray-100 dark:border-gray-700/60' : ''
              }`}
            >
              {/* Code */}
              <code className="font-mono text-gray-900 dark:text-gray-100 tracking-wide text-sm">
                {item.code}
              </code>

              {/* Created at */}
              <span className="text-right text-xs text-gray-400 tabular-nums whitespace-nowrap">
                {formatDate(item.created_at)}
              </span>

              {/* Used by */}
              <span className={`text-right text-xs whitespace-nowrap ${used ? 'text-gray-500 dark:text-gray-400' : 'text-gray-300 dark:text-gray-600'}`}>
                {used
                  ? `${item.used_by_username}${item.used_at ? ` · ${formatDate(item.used_at)}` : ''}`
                  : t('admin_unused')}
              </span>

              {/* Action buttons — only for unused codes */}
              <div className="flex items-center justify-end gap-1">
                {!used && (
                  <>
                    {/* Copy code */}
                    <ActionButton
                      title={copiedCode === item.code ? t('admin_invite_copied') : t('admin_invite_copy')}
                      active={copiedCode === item.code}
                      onClick={() => { void handleCopyCode(item.code) }}
                    >
                      {copiedCode === item.code
                        ? <CheckIcon />
                        : <CopyIcon />
                      }
                    </ActionButton>

                    {/* Share register link */}
                    <ActionButton
                      title={sharedCode === item.code ? t('admin_invite_share_copied') : t('admin_invite_share')}
                      active={sharedCode === item.code}
                      onClick={() => { void handleShareLink(item.code) }}
                    >
                      {sharedCode === item.code
                        ? <CheckIcon />
                        : <LinkIcon />
                      }
                    </ActionButton>

                    {/* Delete */}
                    <ActionButton
                      title={t('admin_invite_delete')}
                      danger
                      disabled={isDeleting}
                      onClick={() => { void handleDelete(item.code) }}
                    >
                      <TrashIcon />
                    </ActionButton>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Pagination */}
      {data && totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-500 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30 transition-colors"
          >
            {t('admin_page_prev')}
          </button>
          <span className="text-xs text-gray-400">
            {t('admin_page_info', { page, total: totalPages })}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-500 hover:text-gray-700 dark:hover:text-gray-200 disabled:opacity-30 transition-colors"
          >
            {t('admin_page_next')}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Small reusable icon button ───────────────────────────────────────────────

function ActionButton({
  children,
  title,
  active = false,
  danger = false,
  disabled = false,
  onClick,
}: {
  children: React.ReactNode
  title: string
  active?: boolean
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  const base = 'p-1.5 rounded-lg transition-colors disabled:opacity-40'
  const color = danger
    ? 'text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20'
    : active
      ? 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20'
      : 'text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
  return (
    <button title={title} disabled={disabled} onClick={onClick} className={`${base} ${color}`}>
      {children}
    </button>
  )
}

// ── Micro icons (16 × 16) ────────────────────────────────────────────────────

function CopyIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
    </svg>
  )
}

function LinkIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  )
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Format an ISO/SQLite datetime string to a short local date. */
function formatDate(raw: string): string {
  if (!raw) return '—'
  const d = new Date(raw.endsWith('Z') ? raw : raw + 'Z')
  if (isNaN(d.getTime())) return raw
  return d.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' })
}
