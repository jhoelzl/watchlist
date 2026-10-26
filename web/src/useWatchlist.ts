import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { useToast } from './toast'
import { HEAT_WEEKS, HISTORY_LIMIT, exportUrls, parseImport, runPhase, toEntries, type Change, type DbUrl, type Entry, type GroupMeta, type RunInfo, type RunRecord, type UrlRow } from './lib/watchlist'

export type Data = { runs: RunRecord[]; freq: Record<string, string[]>; entries: Entry[]; changes: Change[]; updated: string | null; metas: GroupMeta[]; groupsReady: boolean }
export type Load = { state: 'loading' } | { state: 'denied' } | { state: 'error'; message: string } | { state: 'ready'; data: Data }

export type CheckState = { state: 'idle' | 'busy' | 'waiting' | 'running' | 'success' | 'failed' | 'timeout'; url?: string } | { state: 'error'; message: string }

async function load(): Promise<Load> {
  const admin = await supabase.from('watchlist_admins').select('user_id').maybeSingle()
  if (admin.error) return { state: 'error', message: admin.error.message }
  if (!admin.data) return { state: 'denied' }
  const since = new Date(Date.now() - HEAT_WEEKS * 7 * 86_400_000).toISOString()
  const [urls, status, history, groupRows, freqRows, runRows] = await Promise.all([
    supabase.from('watchlist_urls').select('url, name, grp, active, options').order('position').order('id'),
    supabase.from('watchlist_state').select('value, updated_at').eq('key', 'status').maybeSingle(),
    supabase.from('watchlist_history').select('id, name, url, grp, time, diff, extra, summary').order('id', { ascending: false }).limit(HISTORY_LIMIT),
    supabase.from('watchlist_groups').select('name, position, color, icon'),
    supabase.from('watchlist_history').select('url, time').gte('created_at', since).limit(5000),
    supabase.from('watchlist_state').select('value').eq('key', 'runs').maybeSingle(),
  ])
  const failed = urls.error ?? status.error ?? history.error
  if (failed) return { state: 'error', message: failed.message }
  return {
    state: 'ready',
    data: {
      entries: toEntries((urls.data ?? []) as UrlRow[], status.data?.value ?? {}),
      changes: (history.data ?? []) as Change[],
      updated: status.data?.updated_at ?? null,
      runs: Array.isArray(runRows.data?.value) ? (runRows.data.value as RunRecord[]) : [],
      freq: ((freqRows.data ?? []) as { url: string; time: string }[]).reduce<Record<string, string[]>>((acc, r) => { (acc[r.url] ??= []).push(r.time); return acc }, {}),
      metas: (groupRows.data ?? []) as GroupMeta[],
      groupsReady: !groupRows.error,
    },
  }
}

/** Loads the data and provides all actions with side effects (start check run, export, import, delete). */
export function useWatchlist() {
  const notify = useToast()
  const [result, setResult] = useState<Load>({ state: 'loading' })
  const [check, setCheck] = useState<CheckState>({ state: 'idle' })
  const [baseline, setBaseline] = useState<number | null>(null)
  const reload = () => { void load().then(setResult) }
  useEffect(reload, [])

  // Poll the run status every 5 s until the run is done (max. 10 minutes)
  useEffect(() => {
    if (baseline === null) return
    let stale = false
    const started = Date.now()
    const tick = async () => {
      if (stale) return
      if (Date.now() - started > 600_000) { setCheck({ state: 'timeout' }); return setBaseline(null) }
      const { data: res } = await supabase.functions.invoke('watchlist-trigger-check', { body: { action: 'status' } })
      if (stale) return
      const run = (res?.run ?? null) as RunInfo | null
      const phase = runPhase(run, baseline)
      if (phase === 'success' || phase === 'failed') {
        setCheck({ state: phase, url: run?.url })
        setBaseline(null)
        reload()
        return
      }
      setCheck({ state: phase, url: run?.url })
      timer = setTimeout(() => void tick(), 5000)
    }
    let timer = setTimeout(() => void tick(), 4000)
    return () => { stale = true; clearTimeout(timer) }
  }, [baseline])

  const checkNow = async (target?: { url?: string; group?: string }) => {
    setCheck({ state: 'busy' })
    const { data: res, error } = await supabase.functions.invoke('watchlist-trigger-check', { body: target ?? {} })
    if (error || res?.error) {
      const body = await (error as { context?: Response } | null)?.context?.json?.().catch(() => null)
      return setCheck({ state: 'error', message: res?.error ?? body?.error ?? error?.message ?? 'Unknown error' })
    }
    setBaseline(res?.baseline ?? 0)
    setCheck({ state: res?.status === 'running' ? 'running' : 'waiting', url: res?.run?.url })
  }

  const download = async (format: 'yaml' | 'json') => {
    const { data: rows, error } = await supabase.from('watchlist_urls').select('url, name, grp, options').order('position').order('id')
    if (error) return notify(`Export failed: ${error.message}`, { kind: 'error' })
    const blob = new Blob([exportUrls((rows ?? []) as DbUrl[], format)], { type: 'text/plain;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `watchlist-urls.${format}`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const upload = async (file: File | undefined) => {
    if (!file) return
    const { data: have, error } = await supabase.from('watchlist_urls').select('url')
    if (error) return notify(`Import failed: ${error.message}`, { kind: 'error' })
    const parsed = parseImport(await file.text(), (have ?? []).map((r) => r.url as string))
    const note = [`${parsed.rows.length} new, ${parsed.skipped} already present.`, ...parsed.errors.slice(0, 5)].join(' ')
    if (parsed.rows.length === 0) return notify(`Nothing to import. ${note}`)
    const { error: failed } = await supabase.from('watchlist_urls').insert(parsed.rows)
    if (failed) return notify(`Import failed: ${failed.message}`, { kind: 'error' })
    const urls = parsed.rows.map((r) => r.url)
    notify(`Imported: ${note}`, { action: { label: 'Undo', run: async () => {
      const { error: e } = await supabase.from('watchlist_urls').delete().in('url', urls)
      if (e) notify(`Undo failed: ${e.message}`, { kind: 'error' })
      setResult(await load())
    } } })
    setResult(await load())
  }

  // No confirmation dialog: the row is saved beforehand and can be restored via “Undo”.
  const remove = async (e: Entry) => {
    const { data: saved, error: readError } = await supabase.from('watchlist_urls').select('url, name, grp, active, position, options').eq('url', e.url).maybeSingle()
    if (readError || !saved) return notify(`Delete failed: ${readError?.message ?? 'URL not found'}`, { kind: 'error' })
    const { error } = await supabase.from('watchlist_urls').delete().eq('url', e.url)
    if (error) return notify(`Delete failed: ${error.message}`, { kind: 'error' })
    notify(`“${e.name}” deleted.`, { action: { label: 'Undo', run: async () => {
      const { error: restoreError } = await supabase.from('watchlist_urls').insert(saved)
      if (restoreError) notify(`Restore failed: ${restoreError.message}`, { kind: 'error' })
      setResult(await load())
    } } })
    setResult(await load())
  }

  return { result, check, reload, checkNow, download, upload, remove }
}
