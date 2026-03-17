import type { ReactNode } from 'react'

export function AddFormCard(props: {
  title: string
  onSubmit: (e: React.FormEvent) => void
  onCancel: () => void
  submitLabel: string
  cancelLabel: string
  children: ReactNode
}) {
  const { title, onSubmit, onCancel, submitLabel, cancelLabel, children } = props

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
      <h3 className="text-lg font-semibold mb-4">{title}</h3>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          {children}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            {cancelLabel}
          </button>
          <button
            type="submit"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  )
}

