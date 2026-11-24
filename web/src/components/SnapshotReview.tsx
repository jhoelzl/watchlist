import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'
import type { Entry } from '../lib/watchlist'

type Review = { url: string; time: string; baseline?: string; rendered?: string; error?: string }

async function reviewKey(url: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(url))
  return 'review:' + Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

export function SnapshotReview({ entry, onClose, onApplied }: { entry: Entry; onClose: () => void; onApplied: () => void }) {
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [review, setReview] = useState<Review | null>(null)
  const [key, setKey] = useState('')
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    let stale = false
    void supabase.from('watchlist_snapshots').select('content').eq('url', entry.url).maybeSingle().then(({ data, error: failed }) => {
      if (stale) return
      if (failed) setError(`Could not load snapshot: ${failed.message}`)
      else if (!data) setError('No saved snapshot exists yet.')
      else setSnapshot(data.content as string)
      setLoading(false)
    })
    return () => { stale = true; mounted.current = false }
  }, [entry.url])

  const compare = async () => {
    setBusy(true)
    setError('')
    setReview(null)
    try {
      const k = await reviewKey(entry.url)
      setKey(k)
      const previous = await supabase.from('watchlist_state').select('updated_at').eq('key', k).maybeSingle()
      if (previous.error) throw new Error(previous.error.message)
      const { data, error: failed } = await supabase.functions.invoke('watchlist-trigger-check', { body: { action: 'review', url: entry.url } })
      if (failed || data?.error) {
        const body = await (failed as { context?: Response } | null)?.context?.json?.().catch(() => null)
        throw new Error(data?.error ?? body?.error ?? failed?.message ?? 'Could not start comparison.')
      }
      if (data?.action !== 'review') throw new Error('The trigger function needs to be redeployed before comparisons can run.')
      const deadline = Date.now() + 300_000
      while (mounted.current && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5000))
        if (!mounted.current) return
        const result = await supabase.from('watchlist_state').select('value, updated_at').eq('key', k).maybeSingle()
        if (result.error) throw new Error(result.error.message)
        if (result.data && result.data.updated_at !== previous.data?.updated_at) {
          const value = result.data.value as Review
          if (value.error) throw new Error(value.error)
          setReview(value)
          return
        }
        const run = await supabase.functions.invoke('watchlist-trigger-check', { body: { action: 'status' } })
        if (run.error || run.data?.error) throw new Error(run.data?.error ?? run.error?.message ?? 'Could not check workflow status.')
        if (run.data?.run?.id > data.baseline && run.data.run.status === 'completed') {
          throw new Error('Comparison ended without a result. Check the workflow run for details.')
        }
      }
      throw new Error('Comparison timed out. Check the workflow run and try again.')
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  const apply = async () => {
    if (!review) return
    setBusy(true)
    setError('')
    try {
      const { data, error: failed } = await supabase.functions.invoke('watchlist-trigger-check', { body: { action: 'apply-review', url: entry.url, key, time: review.time } })
      if (failed || data?.error) {
        const body = await (failed as { context?: Response } | null)?.context?.json?.().catch(() => null)
        throw new Error(data?.error ?? body?.error ?? failed?.message ?? 'Could not start adoption.')
      }
      if (data?.action !== 'apply-review') throw new Error('The trigger function needs to be redeployed before adoption can run.')
      const deadline = Date.now() + 300_000
      while (mounted.current && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 5000))
        if (!mounted.current) return
        const result = await supabase.from('watchlist_state').select('value').eq('key', key).maybeSingle()
        if (result.error) throw new Error(result.error.message)
        if (!result.data) return onApplied()
        const run = await supabase.functions.invoke('watchlist-trigger-check', { body: { action: 'status' } })
        if (run.error || run.data?.error) throw new Error(run.data?.error ?? run.error?.message ?? 'Could not check workflow status.')
        if (run.data?.run?.id > data.baseline && run.data.run.status === 'completed') {
          throw new Error('Could not adopt the comparison. Check the workflow run, then compare again.')
        }
      }
      throw new Error('Adoption timed out. Check the workflow run before trying again.')
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  return (
    <div className="panel snapshot-review">
      <strong>Saved content: {entry.name}</strong>
      {loading && <p className="muted">Loading snapshot …</p>}
      {snapshot !== null && <><p className="muted">{snapshot.length} characters. This is the text currently compared by the checker.</p><pre>{snapshot}</pre></>}
      {review?.rendered !== undefined && <>
        <p>Rendered with JavaScript ({review.rendered.length} characters). Review it before adopting it.</p>
        <pre>{review.rendered}</pre>
        {review.baseline !== snapshot && <p className="warn">The saved content changed since this panel opened. The comparison used the newer snapshot; reopen this panel to review it.</p>}
        <p className="muted">Enabling JavaScript replaces the saved baseline with this reviewed content without sending a change notification. Subsequent changes will be reported normally. The comparison expires after one hour.</p>
        <button className="btn primary" disabled={busy || review.baseline !== snapshot} onClick={() => void apply()}>Enable JavaScript and adopt baseline</button>
      </>}
      {error && <p className="error">{error}</p>}
      <div className="add-actions">
        {(entry.jsEnabled ?? (entry.options?.js === true)) === false && snapshot !== null && <button className="btn" disabled={busy} onClick={() => void compare()}>{busy ? 'Working …' : 'Compare with JavaScript'}</button>}
        <button className="btn" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
