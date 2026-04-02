import { useEffect } from 'react'
import { createPortal } from 'react-dom'

type Props = {
  url: string
  alt?: string
  onClose: () => void
}

export function CoverLightbox({ url, alt = '', onClose }: Props) {
  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm"
      onClick={onClose}
    >
      <img
        src={url}
        alt={alt}
        className="h-[70vh] w-auto object-contain rounded-lg shadow-2xl"
        onClick={e => e.stopPropagation()}
        draggable={false}
      />
    </div>,
    document.body,
  )
}
