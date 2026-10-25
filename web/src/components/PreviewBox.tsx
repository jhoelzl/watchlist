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
        return setPreview({ state: 'error', message: data?.error ?? body?.error ?? error?.message ?? 'Unknown error' })
      }
      setPreview(data?.feed ? { state: 'feed' } : { state: 'ready', data: data as Preview })
    }, 700)
    return () => { stale = true; clearTimeout(timer) }
  }, [url, selector, enabled])
  return preview
}

export function PreviewBox({ preview, js }: { preview: PreviewState; js: boolean }) {
  if (preview.state === 'idle') return null
  if (preview.state === 'loading') return <p className="preview muted">Loading preview …</p>
  if (preview.state === 'error') return <p className="preview warn">Preview not possible: {preview.message}</p>
  if (preview.state === 'feed') return <p className="preview ok">Feed detected: entries are compared individually, no selector needed.</p>
  const d = preview.data
  const share = d.total ? Math.round((d.chars / d.total) * 100) : 0
  const bad = !d.found || d.chars < 200
  return (
    <div className={`preview ${bad ? 'warn' : 'ok'}`}>
      <p>
        {d.mode === 'selector' && !d.found
          ? <>Selector <code>{d.selector}</code> was not found.</>
          : <><strong>{d.title || 'Untitled'}</strong>: {d.selector ? <>detected area <code>{d.selector}</code></> : 'whole page'}, {d.chars} characters ({share}% of the page)</>}
        {d.found && d.chars < 200 && ' – very little text, check the selector.'}
      </p>
      {d.sample && <p className="sample">{d.sample}{d.chars > 300 ? ' …' : ''}</p>}
      {d.candidates.length > 0 && (
        <p className="muted">Candidates: {d.candidates.map((c) => `${c.selector} (${c.chars})`).join(', ')}</p>
      )}
      {js && <p className="muted">Note: the preview does not render JavaScript, so with “Render with JavaScript” the result may differ.</p>}
    </div>
  )
}
