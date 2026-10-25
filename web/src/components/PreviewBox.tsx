import { useEffect, useState } from 'react'
import type { Preview } from '../../../supabase/functions/watchlist-preview/analyze.ts'
import { supabase } from '../supabase'

export type PreviewState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'feed' }
  | { state: 'ready'; data: Preview }

export function usePreview(url: string, selector: string, enabled: boolean): PreviewState {
  const [preview, setPreview] = useState<PreviewState>({ state: 'idle' })
  useEffect(() => {
    if (!enabled || !/^https?:\/\/[^\s/]+\.[^\s/]+/i.test(url.trim())) {
      setPreview({ state: 'idle' })
      return
    }
    let stale = false
    setPreview({ state: 'loading' })
    const timer = setTimeout(async () => {
      const { data, error } = await supabase.functions.invoke('watchlist-preview', { body: { url: url.trim(), selector } })
      if (stale) return
      if (error || data?.error) {
        const body = await (error as { context?: Response } | null)?.context?.json?.().catch(() => null)
        return setPreview({ state: 'error', message: data?.error ?? body?.error ?? error?.message ?? 'Unbekannter Fehler' })
      }
      setPreview(data?.feed ? { state: 'feed' } : { state: 'ready', data: data as Preview })
    }, 700)
    return () => { stale = true; clearTimeout(timer) }
  }, [url, selector, enabled])
  return preview
}

export function PreviewBox({ preview, js }: { preview: PreviewState; js: boolean }) {
  if (preview.state === 'idle') return null
  if (preview.state === 'loading') return <p className="preview muted">Vorschau wird geladen …</p>
  if (preview.state === 'error') return <p className="preview warn">Vorschau nicht möglich: {preview.message}</p>
  if (preview.state === 'feed') return <p className="preview ok">Feed erkannt: Einträge werden einzeln verglichen, kein Selector nötig.</p>
  const d = preview.data
  const share = d.total ? Math.round((d.chars / d.total) * 100) : 0
  const bad = !d.found || d.chars < 200
  return (
    <div className={`preview ${bad ? 'warn' : 'ok'}`}>
      <p>
        {d.mode === 'selector' && !d.found
          ? <>Selector <code>{d.selector}</code> wurde nicht gefunden.</>
          : <><strong>{d.title || 'Ohne Titel'}</strong>: {d.selector ? <>erkannter Bereich <code>{d.selector}</code></> : 'ganze Seite'}, {d.chars} Zeichen ({share} % der Seite)</>}
        {d.found && d.chars < 200 && ' – sehr wenig Text, Selector prüfen.'}
      </p>
      {d.sample && <p className="sample">{d.sample}{d.chars > 300 ? ' …' : ''}</p>}
      {d.candidates.length > 0 && (
        <p className="muted">Kandidaten: {d.candidates.map((c) => `${c.selector} (${c.chars})`).join(', ')}</p>
      )}
      {js && <p className="muted">Hinweis: Die Vorschau rendert kein JavaScript, bei „Mit JavaScript rendern“ kann das Ergebnis abweichen.</p>}
    </div>
  )
}
