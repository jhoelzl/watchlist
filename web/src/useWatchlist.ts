import { useEffect, useState } from 'react'
import { supabase } from './supabase'
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
    supabase.from('watchlist_history').select('id, name, url, grp, time, diff, extra').order('id', { ascending: false }).limit(HISTORY_LIMIT),
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

/** Laden der Daten und alle Aktionen mit Seiteneffekt (Prüflauf starten, Export, Import, Löschen). */
export function useWatchlist() {
  const [result, setResult] = useState<Load>({ state: 'loading' })
  const [check, setCheck] = useState<CheckState>({ state: 'idle' })
  const [baseline, setBaseline] = useState<number | null>(null)
  const reload = () => { void load().then(setResult) }
  useEffect(reload, [])

  // Lauf-Status alle 5 s abfragen, bis der Lauf fertig ist (max. 10 Minuten)
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

  const checkNow = async (url?: string) => {
    setCheck({ state: 'busy' })
    const { data: res, error } = await supabase.functions.invoke('watchlist-trigger-check', { body: url ? { url } : {} })
    if (error || res?.error) {
      const body = await (error as { context?: Response } | null)?.context?.json?.().catch(() => null)
      return setCheck({ state: 'error', message: res?.error ?? body?.error ?? error?.message ?? 'Unbekannter Fehler' })
    }
    setBaseline(res?.baseline ?? 0)
    setCheck({ state: res?.status === 'running' ? 'running' : 'waiting', url: res?.run?.url })
  }

  const download = async (format: 'yaml' | 'json') => {
    const { data: rows, error } = await supabase.from('watchlist_urls').select('url, name, grp, options').order('position').order('id')
    if (error) return window.alert(`Export fehlgeschlagen: ${error.message}`)
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
    if (error) return window.alert(`Import fehlgeschlagen: ${error.message}`)
    const parsed = parseImport(await file.text(), (have ?? []).map((r) => r.url as string))
    const note = [`${parsed.rows.length} neu, ${parsed.skipped} schon vorhanden.`, ...parsed.errors.slice(0, 5)].join('\n')
    if (parsed.rows.length === 0) return window.alert(`Nichts zu importieren.\n${note}`)
    if (!window.confirm(`Importieren?\n${note}`)) return
    const { error: failed } = await supabase.from('watchlist_urls').insert(parsed.rows)
    if (failed) return window.alert(`Import fehlgeschlagen: ${failed.message}`)
    setResult(await load())
  }

  const remove = async (e: Entry) => {
    if (!window.confirm(`„${e.name}“ wirklich löschen?\n${e.url}`)) return
    const { error } = await supabase.from('watchlist_urls').delete().eq('url', e.url)
    if (error) return window.alert(`Löschen fehlgeschlagen: ${error.message}`)
    setResult(await load())
  }

  return { result, check, reload, checkNow, download, upload, remove }
}
