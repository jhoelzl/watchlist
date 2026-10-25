import { createContext, useContext } from 'react'

export type ToastAction = { label: string; run: () => void | Promise<void> }
export type ToastOptions = { kind?: 'info' | 'error'; action?: ToastAction }
export type Notify = (text: string, options?: ToastOptions) => void

export const ToastContext = createContext<Notify>(() => undefined)

/** Zeigt eine Hinweisleiste unten rechts; mit `action` z. B. „Rückgängig“. */
export const useToast = () => useContext(ToastContext)
