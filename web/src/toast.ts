import { createContext, useContext } from 'react'

export type ToastAction = { label: string; run: () => void | Promise<void> }
export type ToastOptions = { kind?: 'info' | 'error'; action?: ToastAction }
export type Notify = (text: string, options?: ToastOptions) => void

export const ToastContext = createContext<Notify>(() => undefined)

/** Shows a notice bar at the bottom right; with `action` e.g. "Undo". */
export const useToast = () => useContext(ToastContext)
