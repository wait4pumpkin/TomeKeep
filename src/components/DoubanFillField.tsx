import { useState } from 'react'
import type { BookMetadata } from '../lib/openLibrary'

type Status = { state: 'idle' | 'loading' | 'success' | 'error'; message?: string }

export function DoubanFillField(props: {
  onApply: (meta: BookMetadata) => void
}) {
  const { onApply } = props
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<Status>({ state: 'idle' })

  async function fill(raw: string) {
    setStatus({ state: 'loading' })
    const res = await window.meta.lookupDouban(raw)
    if (!res.ok) {
      const message =
        res.error === 'invalid_url' ? '豆瓣链接无效，请粘贴类似 https://book.douban.com/subject/38210549/ 的链接或输入 subject ID。' :
        res.error === 'not_found' ? '未找到对应豆瓣条目。' :
        res.error === 'timeout' ? '获取豆瓣页面超时，请稍后重试。' :
        res.error === 'bad_response' ? '解析豆瓣页面失败，可能页面结构已变化。' :
        '获取豆瓣元信息失败，请稍后重试。'
      setStatus({ state: 'error', message })
      return
    }

    onApply(res.value)
    setStatus({ state: 'success', message: '已从豆瓣填充元信息。' })
  }

  return (
    <div className="col-span-2">
      <label className="block text-sm font-medium text-gray-700 mb-1">Douban URL/ID</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => {
            setInput(e.target.value)
            setStatus({ state: 'idle' })
          }}
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
        <button
          type="button"
          onClick={() => {
            const raw = input.trim()
            if (!raw) return
            void fill(raw)
          }}
          className="px-3 py-2 bg-gray-100 text-gray-800 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:hover:bg-gray-100"
          disabled={!input.trim()}
        >
          Fill
        </button>
      </div>
      {status.state !== 'idle' && (
        <p className={`mt-2 text-sm ${status.state === 'error' ? 'text-red-600' : 'text-gray-600'}`}>
          {status.state === 'loading' ? '正在获取豆瓣元信息…' : status.message}
        </p>
      )}
    </div>
  )
}

