import { Fragment, useEffect, useMemo, useState } from 'react'
import type { Preview } from '../../../supabase/functions/watchlist-preview/analyze.ts'
import { supabase } from '../supabase'
import { GroupsPanel } from './GroupsPanel'
import {
  HISTORY_LIMIT, PAGE_HISTORY_LIMIT, buildHash, dailyCounts, sparkBars, SPARK_DAYS, pickView, readPrefs, writePrefs, PERIODS, STATUS_LABEL, annotateDiff, applyEdit, buildRow, countLines, dayLabel, diffClass, exportUrls, fragmentUrl, parseImport, toEditForm, groupByDay, inPeriod, orderGroups, isHexColor, suggestIgnores, runStats, formatDuration, type RunRecord, sideBySide, nextSort, sortEntries, type Sort, type SortKey, isStuck, runPhase, type RunInfo, type GroupMeta, groupOf, matches, toEntries,
  type Change, type DbUrl, type EditForm, type Entry, type Period, type StatusFilter, type UrlRow,
} from '../lib/watchlist'

type Data = { runs: RunRecord[]; freq: Record<string, string[]>; entries: Entry[]; changes: Change[]; updated: string | null; metas: GroupMeta[]; groupsReady: boolean }
type Load = { state: 'loading' } | { state: 'denied' } | { state: 'error'; message: string } | { state: 'ready'; data: Data }

const SORT_COLUMNS: [SortKey, string][] = [['status', 'Status'], ['name', 'Seite'], ['checked', 'Zuletzt geprüft'], ['changed', 'Zuletzt geändert']]

const STATUS_FILTERS: [StatusFilter, string][] = [
  ['', 'Alle'], ['problem', 'Probleme'], ['stuck', 'Dauerhaft kaputt'], ['error', 'Fehler'], ['warn', 'Zu wenig Text'], ['new', 'Neu'], ['ok', 'OK'], ['pending', 'Offen'], ['paused', 'Pausiert'],
]

async function load(): Promise<Load> {
  const admin = await supabase.from('watchlist_admins').select('user_id').maybeSingle()
  if (admin.error) return { state: 'error', message: admin.error.message }
  if (!admin.data) return { state: 'denied' }
  const since = new Date(Date.now() - SPARK_DAYS * 86_400_000).toISOString()
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

function Segments({ segs }: { segs: { text: string; changed: boolean }[] }) {
  return <>{segs.map((s, n) => (s.changed ? <mark key={n}>{s.text}</mark> : s.text))}</>
}

function DiffView({ diff, extra }: { diff: string; extra: number }) {
  const [side, setSide] = useState(false)
  const [onlyChanged, setOnlyChanged] = useState(false)
  const lines = useMemo(() => diff.split('\n'), [diff])
  const rows = useMemo(() => (side ? sideBySide(lines) : []), [side, lines])
  const inline = useMemo(() => annotateDiff(lines).map((segs, i) => ({ segs, line: lines[i] })), [lines])
  const visible = onlyChanged ? inline.filter(({ line }) => line.startsWith('+') || line.startsWith('-')) : inline
  const visibleRows = onlyChanged ? rows.filter((r) => r.kind === 'chg') : rows
  return (
    <>
      <div className="diff-tools">
        <button className={`filter-pill${side ? '' : ' active'}`} onClick={() => setSide(false)}>Inline</button>
        <button className={`filter-pill${side ? ' active' : ''}`} onClick={() => setSide(true)}>Alt/Neu</button>
        <label className="check"><input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} /> nur geänderte Zeilen</label>
      </div>
      {side ? (
        <div className="side-diff">
          <div className="side-head">Alt</div>
          <div className="side-head">Neu</div>
          {visibleRows.map((r, i) =>
            r.kind === 'hunk' ? (
              <div key={i} className="side-hunk">{r.left?.map((x) => x.text).join('')}</div>
            ) : (
              <Fragment key={i}>
                <div className={`side-cell${r.left && r.kind === 'chg' ? ' del' : ''}${r.left ? '' : ' empty'}`}>{r.left ? <Segments segs={r.left} /> : ''}{' '}</div>
                <div className={`side-cell${r.right && r.kind === 'chg' ? ' add' : ''}${r.right ? '' : ' empty'}`}>{r.right ? <Segments segs={r.right} /> : ''}{' '}</div>
              </Fragment>
            ),
          )}
          {extra > 0 && <div className="side-hunk">… und {extra} weitere Zeilen</div>}
        </div>
      ) : (
        <pre>
          {visible.map(({ segs }, i) => (
            <div key={i} className={diffClass(segs.map((s) => s.text).join(''))}>
              <Segments segs={segs} />
              {segs.length === 0 || segs[0].text === '' ? ' ' : ''}
            </div>
          ))}
          {extra > 0 && <div className="muted">… und {extra} weitere Zeilen</div>}
        </pre>
      )}
    </>
  )
}

function RunsPanel({ runs }: { runs: RunRecord[] }) {
  if (!runs.length) return null
  const stats = runStats(runs)
  const maxSeconds = Math.max(...runs.map((r) => r.seconds), 1)
  const recent = [...runs].reverse()
  return (
    <details className="runs">
      <summary>
        Läufe: {runs.length} · Ø {formatDuration(stats.avgSeconds)} · Fehlerquote {(stats.errorRate * 100).toFixed(1).replace('.', ',')} %
        {stats.failedRuns > 0 && <> · <span className="badge error">{stats.failedRuns} fehlgeschlagen</span></>}
      </summary>
      <table>
        <thead><tr><th>Zeit</th><th>Dauer</th><th>URLs</th><th>Fehler</th><th>Warnungen</th><th>Änderungen</th></tr></thead>
        <tbody>
          {recent.map((r) => (
            <tr key={r.time}>
              <td>{r.time}{!r.ok && ' ⚠'}</td>
              <td><span className="run-bar" style={{ width: `${Math.max(4, (r.seconds / maxSeconds) * 60)}px` }} /> {formatDuration(r.seconds)}</td>
              <td>{r.total}</td>
              <td>{r.errors || '-'}</td>
              <td>{r.warns || '-'}</td>
              <td>{r.changes || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}

function Spark({ times }: { times: string[] }) {
  const counts = useMemo(() => dailyCounts(times), [times])
  const total = counts.reduce((a, b) => a + b, 0)
  if (!total) return <span className="muted">-</span>
  return (
    <svg className="spark" width="90" height="18" role="img" aria-label={`${total} Änderungen in ${SPARK_DAYS} Tagen`}>
      <title>{total} Änderungen in {SPARK_DAYS} Tagen</title>
      {sparkBars(counts).map((b) => <rect key={b.x} x={b.x} y={b.y} width={b.w} height={b.h} rx="1" />)}
    </svg>
  )
}

type PreviewState =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'feed' }
  | { state: 'ready'; data: Preview }

function usePreview(url: string, selector: string, enabled: boolean): PreviewState {
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

function PreviewBox({ preview, js }: { preview: PreviewState; js: boolean }) {
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

function EditUrl({ entry, onClose, onSaved }: { entry: Entry; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<EditForm>(() => toEditForm(entry))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const preview = usePreview(entry.url, form.selector, true)
  const [diffs, setDiffs] = useState<string[]>([])
  useEffect(() => {
    let stale = false
    void supabase.from('watchlist_history').select('diff').eq('url', entry.url).order('id', { ascending: false }).limit(50)
      .then(({ data: rows }) => { if (!stale) setDiffs((rows ?? []).map((r) => r.diff as string)) })
    return () => { stale = true }
  }, [entry.url])
  const patterns = form.ignore.split('\n').map((l) => l.trim()).filter(Boolean)
  const suggestions = useMemo(() => suggestIgnores(diffs, patterns), [diffs, form.ignore])
  const set = (patch: Partial<EditForm>) => setForm((f) => ({ ...f, ...patch }))
  const save = async () => {
    const built = applyEdit(entry.options ?? {}, form)
    if ('error' in built) return setError(built.error)
    setBusy(true)
    const { data, error: failed } = await supabase
      .from('watchlist_urls')
      .update({ name: form.name.trim() || null, grp: form.group.trim() || null, options: built.options, active: !form.paused })
      .eq('url', entry.url)
      .select('url')
    setBusy(false)
    if (failed) return setError(failed.message)
    if (!data?.length) return setError('Keine Änderung gespeichert. Fehlt die Policy „admins update urls“ (supabase/schema.sql)?')
    onSaved()
  }
  return (
    <form className="panel add-panel edit-panel" onSubmit={(e) => { e.preventDefault(); void save() }}>
      <p className="grow edit-title">Bearbeiten: <a href={entry.url} target="_blank" rel="noreferrer noopener">{entry.url}</a></p>
      <label className="grow">Name<input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Seitentitel" /></label>
      <label>Gruppe<input value={form.group} onChange={(e) => set({ group: e.target.value })} /></label>
      <label className="grow">Selector<input value={form.selector} onChange={(e) => set({ selector: e.target.value })} placeholder="auto, CSS-Selector oder leer = ganze Seite" /></label>
      <label className="grow">Ignore (ein Regex pro Zeile)<textarea rows={3} value={form.ignore} onChange={(e) => set({ ignore: e.target.value })} placeholder="z. B. Last updated.*" /></label>
      {suggestions.length > 0 && (
        <div className="grow suggestions">
          <strong>Ignore-Vorschläge</strong> <span className="muted">(wiederkehrende Zeilen, die sich nur in Zahlen unterscheiden)</span>
          {suggestions.slice(0, 5).map((s) => (
            <div key={s.pattern} className="suggestion">
              <code>{s.pattern}</code>
              <span className="muted">z. B. „{s.example.slice(0, 60)}“, in {s.count} Änderungen</span>
              <button className="btn" type="button" onClick={() => set({ ignore: [...patterns, s.pattern].join('\n') })}>Übernehmen</button>
            </div>
          ))}
        </div>
      )}
      <label className="check"><input type="checkbox" checked={form.js} onChange={(e) => set({ js: e.target.checked })} />Mit JavaScript rendern</label>
      <label className="check"><input type="checkbox" checked={form.onlyAdded} onChange={(e) => set({ onlyAdded: e.target.checked })} />Nur Hinzugefügtes melden</label>
      <label className="check"><input type="checkbox" checked={form.paused} onChange={(e) => set({ paused: e.target.checked })} />Pausiert (wird nicht geprüft)</label>
      <PreviewBox preview={preview} js={form.js} />
      <div className="add-actions">
        <button className="btn primary" type="submit" disabled={busy}>Speichern</button>
        <button className="btn" type="button" onClick={onClose}>Abbrechen</button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  )
}

const EMPTY_FORM = { url: '', name: '', group: '', selector: 'auto', js: false }

function AddUrl({ entries, open, setOpen, onAdded }: { entries: Entry[]; open: boolean; setOpen: (open: boolean) => void; onAdded: () => void }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const groups = [...new Set(entries.map((e) => e.group))]
  const preview = usePreview(form.url, form.selector, open)
  const set = (patch: Partial<typeof EMPTY_FORM>) => setForm((f) => ({ ...f, ...patch }))
  const submit = async () => {
    const built = buildRow(form, entries.map((e) => e.url), entries.length + 1)
    if ('error' in built) return setError(built.error)
    setBusy(true)
    const { error: failed } = await supabase.from('watchlist_urls').insert(built.row)
    setBusy(false)
    if (failed) return setError(failed.message)
    setForm(EMPTY_FORM)
    setError('')
    setOpen(false)
    onAdded()
  }
  if (!open) return null
  return (
    <form className="panel add-panel" onSubmit={(e) => { e.preventDefault(); void submit() }}>
      <label className="grow">URL<input type="url" placeholder="https://…" value={form.url} onChange={(e) => set({ url: e.target.value })} required autoFocus /></label>
      <label>Name (optional)<input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Seitentitel" /></label>
      <label>Gruppe<input list="groups" value={form.group} onChange={(e) => set({ group: e.target.value })} /></label>
      <datalist id="groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
      <label>Selector<input value={form.selector} onChange={(e) => set({ selector: e.target.value })} placeholder="auto = passenden Bereich erkennen, leer = ganze Seite" /></label>
      <label className="check"><input type="checkbox" checked={form.js} onChange={(e) => set({ js: e.target.checked })} />Mit JavaScript rendern</label>
      <PreviewBox preview={preview} js={form.js} />
      <div className="add-actions">
        <button className="btn primary" type="submit" disabled={busy}>Speichern</button>
        <button className="btn" type="button" onClick={() => { setOpen(false); setError('') }}>Abbrechen</button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  )
}

export function Dashboard() {
  const [result, setResult] = useState<Load>({ state: 'loading' })
  const [prefs] = useState(readPrefs)
  const [initial] = useState(() => pickView(window.location.hash, prefs))
  const [mailTarget] = useState(() => /^#changes:(.+)$/.exec(window.location.hash))
  const [query, setQuery] = useState(initial.query)
  const [group, setGroup] = useState(initial.group)
  const [status, setStatus] = useState<StatusFilter>(initial.status)
  const [check, setCheck] = useState<{ state: 'idle' | 'busy' | 'waiting' | 'running' | 'success' | 'failed' | 'timeout'; url?: string } | { state: 'error'; message: string }>({ state: 'idle' })
  const [baseline, setBaseline] = useState<number | null>(null)
  const [period, setPeriod] = useState<Period>(initial.period)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [sort, setSort] = useState<Sort>(initial.sort)
  const [pageUrl, setPageUrl] = useState<string | null>(null)
  const [extra, setExtra] = useState<Change[]>([])
  const [noMore, setNoMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState('')
  const [pageHistory, setPageHistory] = useState<Change[] | { error: string } | null>(null)
  const [tab, setTab] = useState<'urls' | 'changes' | 'groups'>(initial.tab)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(prefs?.collapsed))
  useEffect(() => { void load().then(setResult) }, [])

  const data = result.state === 'ready' ? result.data : null
  const groups = useMemo(() => orderGroups(data?.entries ?? [], data?.metas ?? []), [data])
  const metaOf = (name: string) => data?.metas.find((m) => m.name === name)
  const shown = useMemo(
    () => orderGroups((data?.entries ?? []).filter((e) => matches({ ...e, text: e.error }, query, group, status)), data?.metas ?? [], false),
    [data, query, group, status],
  )
  // Verlauf einer einzelnen Seite: komplett aus der Datenbank statt nur aus den letzten 100 insgesamt
  useEffect(() => {
    if (!pageUrl) return setPageHistory(null)
    let stale = false
    setPageHistory(null)
    void supabase.from('watchlist_history').select('id, name, url, grp, time, diff, extra').eq('url', pageUrl).order('id', { ascending: false }).limit(PAGE_HISTORY_LIMIT)
      .then(({ data: rows, error }) => { if (!stale) setPageHistory(error ? { error: error.message } : ((rows ?? []) as Change[])) })
    return () => { stale = true }
  }, [pageUrl])
  const base = pageUrl ? (Array.isArray(pageHistory) ? pageHistory : []) : (data?.changes ?? [])
  const baseLimit = pageUrl ? PAGE_HISTORY_LIMIT : HISTORY_LIMIT
  // Nachgeladene Einträge gehören zur aktuellen Basisliste und werden bei neuen Daten verworfen
  useEffect(() => { setExtra([]); setNoMore(false); setMoreError('') }, [pageUrl, data])
  const source = useMemo(() => [...base, ...extra], [base, extra])
  const canLoadMore = !noMore && base.length >= baseLimit
  const loadMore = async () => {
    const lastId = source[source.length - 1]?.id
    if (lastId === undefined) return
    setLoadingMore(true)
    setMoreError('')
    let q = supabase.from('watchlist_history').select('id, name, url, grp, time, diff, extra').lt('id', lastId).order('id', { ascending: false }).limit(HISTORY_LIMIT)
    if (pageUrl) q = q.eq('url', pageUrl)
    const { data: rows, error } = await q
    setLoadingMore(false)
    if (error) return setMoreError(error.message)
    const more = (rows ?? []) as Change[]
    setExtra((cur) => [...cur, ...more])
    if (more.length < HISTORY_LIMIT) setNoMore(true)
  }
  const pageName = pageUrl ? (data?.entries.find((e) => e.url === pageUrl)?.name ?? pageUrl) : ''
  const showHistory = (url: string) => { setPageUrl(url); setPeriod(''); setQuery(''); setGroup(''); setTab('changes') }

  const changes = useMemo(
    () => source.filter((c) => matches({ name: c.name, url: c.url, text: c.diff, group: groupOf(c.grp) }, query, group, '') && inPeriod(c.time, period)),
    [source, query, group, period],
  )
  const days = useMemo(() => groupByDay(changes), [changes])

  // Mail-Link #changes:<URL> öffnet den passenden Eintrag
  useEffect(() => {
    const m = mailTarget
    if (!m || !data) return
    const url = decodeURIComponent(m[1])
    const el = Array.from(document.querySelectorAll<HTMLDetailsElement>('details.change')).find((d) => d.dataset.url === url)
    if (el) {
      el.open = true
      el.scrollIntoView({ block: 'center' })
    }
  }, [data, mailTarget])

  useEffect(() => {
    writePrefs({ view: { tab, group, status, period, query, sort }, collapsed: [...collapsed] })
  }, [tab, group, status, period, query, sort, collapsed])

  useEffect(() => {
    const hash = buildHash({ tab, group, status, period, query, sort })
    if (hash !== window.location.hash) history.replaceState(null, '', hash || window.location.pathname + window.location.search)
  }, [tab, group, status, period, query, sort])

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
        void load().then(setResult)
        return
      }
      setCheck({ state: phase, url: run?.url })
      timer = setTimeout(() => void tick(), 5000)
    }
    let timer = setTimeout(() => void tick(), 4000)
    return () => { stale = true; clearTimeout(timer) }
  }, [baseline])

  const checkNow = async () => {
    setCheck({ state: 'busy' })
    const { data: res, error } = await supabase.functions.invoke('watchlist-trigger-check')
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

  if (result.state === 'loading') return <p className="muted">Lade …</p>
  if (result.state === 'denied') {
    return <p className="error">Dieses Konto ist nicht für die Watchlist freigeschaltet. Siehe README, Abschnitt „Dashboard“.</p>
  }
  if (result.state === 'error') return <p className="error">Laden fehlgeschlagen: {result.message}</p>

  const total = data?.entries.length ?? 0
  const allOpen = shown.length > 0 && shown.every(([name]) => !collapsed.has(name))
  const toggle = (name: string) => setCollapsed((c) => { const n = new Set(c); if (!n.delete(name)) n.add(name); return n })
  const count = shown.reduce((n, [, items]) => n + items.length, 0)
  return (
    <>
      <div className="library-intro">
        <div>
          <h2>Watchlist</h2>
          <p>{data?.updated ? `Zuletzt aktualisiert: ${new Date(data.updated).toLocaleString('de-AT')}` : 'Noch kein Lauf'}</p>
        </div>
        <div className="intro-actions">
          <button className="btn" onClick={() => { setTab('urls'); setAdding(true) }}>URL hinzufügen</button>
          <details className="menu">
            <summary className="btn">Import / Export</summary>
            <div className="menu-items">
              <button className="btn" onClick={() => void download('yaml')}>Export als YAML</button>
              <button className="btn" onClick={() => void download('json')}>Export als JSON</button>
              <label className="btn">Import (YAML/JSON)<input type="file" accept=".yml,.yaml,.json,text/*" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = '' }} /></label>
            </div>
          </details>
          <button className="btn primary" onClick={() => void checkNow()} disabled={check.state === 'busy' || check.state === 'waiting' || check.state === 'running'}>
            {check.state === 'busy' ? 'Starte …' : check.state === 'waiting' || check.state === 'running' ? 'Prüfung läuft …' : 'Jetzt prüfen'}
          </button>
        </div>
      </div>
      {check.state === 'waiting' && <p className="muted">Prüfung gestartet, warte auf den Lauf bei GitHub …</p>}
      {check.state === 'running' && <p className="muted">Prüfung läuft{check.url && <> (<a href={check.url} target="_blank" rel="noreferrer noopener">Lauf ansehen</a>)</>}. Die Ansicht aktualisiert sich automatisch.</p>}
      {check.state === 'success' && <p className="muted">Prüfung fertig, die Ansicht ist aktualisiert.</p>}
      {check.state === 'failed' && <p className="error">Die Prüfung ist fehlgeschlagen{check.url && <> (<a href={check.url} target="_blank" rel="noreferrer noopener">Lauf ansehen</a>)</>}.</p>}
      {check.state === 'timeout' && <p className="error">Der Lauf dauert ungewöhnlich lange. Bitte bei GitHub nachsehen.</p>}
      {check.state === 'error' && <p className="error">Prüfung konnte nicht gestartet werden: {check.message}</p>}
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'urls'} className={`tab${tab === 'urls' ? ' active' : ''}`} onClick={() => setTab('urls')}>URLs<span className="count">{total}</span></button>
        <button role="tab" aria-selected={tab === 'changes'} className={`tab${tab === 'changes' ? ' active' : ''}`} onClick={() => setTab('changes')}>Letzte Änderungen<span className="count">{data?.changes.length ?? 0}</span></button>
        <button role="tab" aria-selected={tab === 'groups'} className={`tab${tab === 'groups' ? ' active' : ''}`} onClick={() => setTab('groups')}>Gruppen<span className="count">{groups.length}</span></button>
      </div>
      {tab === 'groups' && <GroupsPanel entries={data?.entries ?? []} metas={data?.metas ?? []} groupsReady={data?.groupsReady ?? false} onChanged={() => void load().then(setResult)} />}
      {tab !== 'groups' && <div className="toolbar">
        <div className="search-field">
          <span aria-hidden="true">⌕</span>
          <input type="search" placeholder="Suchen (Name, URL, Text)" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select aria-label="Gruppe" value={group} onChange={(e) => setGroup(e.target.value)} style={{ width: 'auto' }}>
          <option value="">Alle Gruppen</option>
          {groups.map(([g]) => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>}
      {tab === 'urls' && (
        <>
      <RunsPanel runs={data?.runs ?? []} />
      <AddUrl entries={data?.entries ?? []} open={adding} setOpen={setAdding} onAdded={() => void load().then(setResult)} />
      <div className="filter-bar">
        {STATUS_FILTERS.map(([value, label]) => (
          <button key={value} className={`filter-pill${status === value ? ' active' : ''}`} onClick={() => setStatus(value)}>
            {label}<span className="pill-count">{(data?.entries ?? []).filter((e) => matches({ ...e, text: e.error }, '', '', value)).length}</span>
          </button>
        ))}
        <button className="filter-pill" onClick={() => setCollapsed(allOpen ? new Set(shown.map(([n]) => n)) : new Set())}>
          {allOpen ? 'Alle zuklappen' : 'Alle aufklappen'}
        </button>
        <span className="muted count-text">{count} von {total}</span>
      </div>
      <div className="composer-list">
        {shown.map(([name, items]) => (
          <section className="composer-section" key={name} style={isHexColor(metaOf(name)?.color) ? { borderLeft: `4px solid ${metaOf(name)?.color}` } : undefined}>
            <button className="section-heading" aria-expanded={!collapsed.has(name)} onClick={() => toggle(name)}>
              <h3>
                <span className="chevron">{collapsed.has(name) ? '▸' : '▾'}</span>{metaOf(name)?.icon && <span className="group-icon">{metaOf(name)?.icon}</span>}{name}<span className="count">{items.length}</span>
              </h3>
              <span className="group-stats">
                {items.some((e) => e.status === 'error' || e.status === 'warn') && (
                  <span className="badge error">{items.filter((e) => e.status === 'error' || e.status === 'warn').length} Probleme</span>
                )}
                {items.some((e) => e.status === 'new') && <span className="badge new">{items.filter((e) => e.status === 'new').length} neu</span>}
                {items.some((e) => e.status === 'pending') && <span className="muted">{items.filter((e) => e.status === 'pending').length} offen</span>}
              </span>
            </button>
            {!collapsed.has(name) && <table>
              <thead><tr>{SORT_COLUMNS.map(([key, label]) => (
                <th key={key} aria-sort={sort.key === key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
                  <button className="sort-btn" onClick={() => setSort(nextSort(sort, key))}>{label}{sort.key === key ? (sort.desc ? ' ▼' : ' ▲') : ''}</button>
                </th>
              ))}<th>Letzte {SPARK_DAYS} Tage</th><th></th></tr></thead>
              <tbody>
                {sortEntries(items, sort).map((e) => (
                  <Fragment key={e.url}>
                  <tr className={e.active === false ? 'paused' : ''}>
                    <td><span className={`badge ${e.status}`}>{STATUS_LABEL[e.status] ?? e.status}</span></td>
                    <td>
                      <a href={e.url} target="_blank" rel="noreferrer noopener">{e.name}</a>
                      {e.error && <div className="muted">{e.error}</div>}
                      {(e.status === 'error' || e.status === 'warn') && (e.streak ?? 0) > 1 && (
                        <span className={`badge ${isStuck(e) ? 'error' : 'warn'}`} title={isStuck(e) ? 'Seit mehreren Tagen dauerhaft kaputt' : undefined}>{isStuck(e) ? 'Dauerhaft kaputt, ' : ''}{e.streak} Läufe in Folge</span>
                      )}
                    </td>
                    <td>{e.checked || '-'}</td>
                    <td>{e.changed || '-'}</td>
                    <td><Spark times={data?.freq[e.url] ?? []} /></td>
                    <td className="row-actions">
                      <button className="icon-btn" title="Verlauf dieser Seite" aria-label={`Verlauf von ${e.name}`} onClick={() => showHistory(e.url)}>⏱</button>
                      <button className="icon-btn" title="Bearbeiten" aria-label={`${e.name} bearbeiten`} onClick={() => setEditing(editing === e.url ? null : e.url)}><span className="flip">✎</span></button>
                      <button className="icon-btn" title="Löschen" aria-label={`${e.name} löschen`} onClick={() => void remove(e)}>×</button>
                    </td>
                  </tr>
                  {editing === e.url && (
                    <tr className="edit-row"><td colSpan={6}><EditUrl entry={e} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load().then(setResult) }} /></td></tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>}
          </section>
        ))}
      </div>
        </>
      )}
      {tab === 'changes' && (
        <>
      {pageUrl && (
        <div className="page-filter">
          <span>Verlauf von <strong>{pageName}</strong></span>
          <button className="btn" onClick={() => setPageUrl(null)}>Alle Seiten anzeigen</button>
        </div>
      )}
      {pageUrl && !pageHistory && <p className="muted">Lade Verlauf …</p>}
      {pageUrl && pageHistory && !Array.isArray(pageHistory) && <p className="error">Verlauf konnte nicht geladen werden: {pageHistory.error}</p>}
      <div className="filter-bar">
        {PERIODS.map(([value, label]) => (
          <button key={value} className={`filter-pill${period === value ? ' active' : ''}`} onClick={() => setPeriod(value)}>{label}</button>
        ))}
        <span className="muted count-text">{changes.length} von {source.length}{canLoadMore ? '+' : ''}</span>
      </div>
      {changes.length === 0 && <p className="muted">{source.length ? 'Keine Treffer.' : pageUrl ? 'Für diese Seite wurde noch keine Änderung erkannt.' : 'Noch keine Änderungen erkannt.'}</p>}
      {days.map(([day, items]) => (
        <section key={day}>
          <h3 className="day-heading">{dayLabel(day)}<span className="count">{items.length}</span></h3>
          {items.map((c) => (
            <details className="change" key={c.id} data-url={c.url}>
              <summary>
                {c.time.slice(11)} – {c.name ?? c.url}
                <span className="diff-stat"><span className="plus">+{countLines(c.diff, '+')}</span> <span className="minus">−{countLines(c.diff, '-')}</span></span>
              </summary>
              <p>
                <a href={c.url} target="_blank" rel="noreferrer noopener">{c.url}</a>
                {fragmentUrl(c.url, c.diff) !== c.url && (
                  <> · <a href={fragmentUrl(c.url, c.diff)} target="_blank" rel="noreferrer noopener">zur geänderten Stelle</a></>
                )}
              </p>
              <DiffView diff={c.diff} extra={c.extra} />
            </details>
          ))}
        </section>
      ))}
      {canLoadMore && (
        <p><button className="btn" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'Lade …' : 'Ältere Einträge laden'}</button></p>
      )}
      {moreError && <p className="error">Weitere Einträge konnten nicht geladen werden: {moreError}</p>}
        </>
      )}
    </>
  )
}
