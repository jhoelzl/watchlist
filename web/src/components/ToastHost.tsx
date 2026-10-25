import { useCallback, useRef, useState, type ReactNode } from 'react'
import { ToastContext, type Notify, type ToastAction } from '../toast'

type Toast = { id: number; text: string; kind: 'info' | 'error'; action?: ToastAction }

const SHOW_MS = { info: 8000, error: 12000 }

export function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const next = useRef(0)
  const dismiss = (id: number) => setToasts((all) => all.filter((t) => t.id !== id))
  const notify = useCallback<Notify>((text, options = {}) => {
    const kind = options.kind ?? 'info'
    const id = next.current++
    setToasts((all) => [...all.slice(-3), { id, text, kind, action: options.action }])
    setTimeout(() => dismiss(id), SHOW_MS[kind])
  }, [])
  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.kind === 'error' ? ' error' : ''}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <span>{t.text}</span>
            {t.action && <button className="link" onClick={() => { dismiss(t.id); void t.action?.run() }}>{t.action.label}</button>}
            <button className="link" aria-label="Close" onClick={() => dismiss(t.id)}>✕</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
