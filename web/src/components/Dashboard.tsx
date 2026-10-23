import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import {
  STATUS_LABEL, buildRow, diffClass, groupEntries, groupOf, matches, summarize, toEntries,
  type Change, type Entry, type StatusFilter, type UrlRow,
} from '../lib/watchlist'

type Data = { entries: Entry[]; changes: Change[]; updated: string | null }
type Load = { state: 'loading' } | { state: 'denied' } | { state: 'error'; message: string } | { state: 'ready'; data: Data }

const STATUS_FILTERS: [StatusFilter, string][] = [
  ['', 'Alle'], ['problem', 'Probleme'], ['error', 'Fehler'], ['warn', 'Zu wenig Text'], ['new', 'Neu'], ['ok', 'OK'], ['pending', 'Offen'],
]

async function load(): Promise<Load> {
  const admin = await supabase.from('watchlist_admins').select('user_id').maybeSingle()
  if (admin.error) return { state: 'error', message: admin.error.message }
  if (!admin.data) return { state: 'denied' }
  const [urls, status, history] = await Promise.all([
    supabase.from('watchlist_urls').select('url, name, grp').eq('active', true).order('position').order('id'),
    supabase.from('watchlist_state').select('value, updated_at').eq('key', 'status').maybeSingle(),
    supabase.from('watchlist_history').select('id, name, url, grp, time, diff, extra').order('id', { ascending: false }).limit(200),
  ])
  const failed = urls.error ?? status.error ?? history.error
  if (failed) return { state: 'error', message: failed.message }
  return {
    state: 'ready',
    data: {
      entries: toEntries((urls.data ?? []) as UrlRow[], status.data?.value ?? {}),
      changes: (history.data ?? []) as Change[],
      updated: status.data?.updated_at ?? null,
    },
  }
}

function countLines(diff: string, sign: '+' | '-'): number {
  return diff.split('\n').filter((l) => l.startsWith(sign) && !l.startsWith(sign.repeat(3))).length
}

const EMPTY_FORM = { url: '', name: '', group: '', selector: 'main', js: false }

function AddUrl({ entries, onAdded }: { entries: Entry[]; onAdded: () => void }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const groups = [...new Set(entries.map((e) => e.group))]
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
  if (!open) return <button className="btn primary" onClick={() => setOpen(true)}>URL hinzufügen</button>
  return (
    <form className="panel add-panel" onSubmit={(e) => { e.preventDefault(); void submit() }}>
      <label className="grow">URL<input type="url" placeholder="https://…" value={form.url} onChange={(e) => set({ url: e.target.value })} required autoFocus /></label>
      <label>Name (optional)<input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Seitentitel" /></label>
      <label>Gruppe<input list="groups" value={form.group} onChange={(e) => set({ group: e.target.value })} /></label>
      <datalist id="groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
      <label>Selector<input value={form.selector} onChange={(e) => set({ selector: e.target.value })} placeholder="leer = ganze Seite" /></label>
      <label className="check"><input type="checkbox" checked={form.js} onChange={(e) => set({ js: e.target.checked })} />Mit JavaScript rendern</label>
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
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('')
  const [status, setStatus] = useState<StatusFilter>('')
  const [check, setCheck] = useState<{ state: 'idle' | 'busy' | 'started' | 'running' } | { state: 'error'; message: string }>({ state: 'idle' })
  const [tab, setTab] = useState<'urls' | 'changes'>('urls')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  useEffect(() => { void load().then(setResult) }, [])

  const data = result.state === 'ready' ? result.data : null
  const groups = useMemo(() => groupEntries(data?.entries ?? []), [data])
  const shown = useMemo(
    () => groupEntries((data?.entries ?? []).filter((e) => matches({ ...e, text: e.error }, query, group, status))),
    [data, query, group, status],
  )
  const changes = useMemo(
    () => (data?.changes ?? []).filter((c) => matches({ name: c.name, url: c.url, text: c.diff, group: groupOf(c.grp) }, query, group, '')),
    [data, query, group],
  )

  const checkNow = async () => {
    setCheck({ state: 'busy' })
    const { data: res, error } = await supabase.functions.invoke('watchlist-trigger-check')
    if (error || res?.error) {
      return setCheck({ state: 'error', message: res?.error ?? error?.message ?? 'Unbekannter Fehler' })
    }
    setCheck({ state: res?.status === 'running' ? 'running' : 'started' })
    setTimeout(() => void load().then(setResult), 90_000)
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
  const sum = summarize(data?.entries ?? [])
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
          <button className="btn primary" onClick={() => void checkNow()} disabled={check.state === 'busy'}>
            {check.state === 'busy' ? 'Starte …' : 'Jetzt prüfen'}
          </button>
          <button className="btn" onClick={() => void load().then(setResult)}>Aktualisieren</button>
        </div>
      </div>
      {check.state === 'started' && <p className="muted">Prüfung gestartet. Sie dauert etwa eine Minute, die Ansicht aktualisiert sich nach 90 Sekunden (oder „Aktualisieren“).</p>}
      {check.state === 'running' && <p className="muted">Es läuft bereits eine Prüfung.</p>}
      {check.state === 'error' && <p className="error">Prüfung konnte nicht gestartet werden: {check.message}</p>}
      <div className="summary">
        <div className="stat"><b>{sum.total}</b><span>URLs</span></div>
        <div className="stat"><b>{sum.ok}</b><span>OK</span></div>
        <div className={`stat${sum.problems ? ' bad' : ''}`}><b>{sum.problems}</b><span>Probleme</span></div>
        <div className="stat"><b>{sum.new}</b><span>Neu</span></div>
        <div className="stat"><b>{sum.pending}</b><span>Offen</span></div>
        <div className="stat"><b>{data?.changes.length ?? 0}</b><span>Änderungen (letzte {data?.changes.length === 200 ? '200' : 'alle'})</span></div>
        <div className="stat"><b>{groups.length}</b><span>Gruppen</span></div>
      </div>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'urls'} className={`tab${tab === 'urls' ? ' active' : ''}`} onClick={() => setTab('urls')}>URLs<span className="count">{total}</span></button>
        <button role="tab" aria-selected={tab === 'changes'} className={`tab${tab === 'changes' ? ' active' : ''}`} onClick={() => setTab('changes')}>Letzte Änderungen<span className="count">{data?.changes.length ?? 0}</span></button>
      </div>
      <div className="toolbar">
        <div className="search-field">
          <span aria-hidden="true">⌕</span>
          <input type="search" placeholder="Suchen (Name, URL, Text)" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select aria-label="Gruppe" value={group} onChange={(e) => setGroup(e.target.value)} style={{ width: 'auto' }}>
          <option value="">Alle Gruppen</option>
          {groups.map(([g]) => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>
      {tab === 'urls' && (
        <>
      <AddUrl entries={data?.entries ?? []} onAdded={() => void load().then(setResult)} />
      <div className="filter-bar">
        {STATUS_FILTERS.map(([value, label]) => (
          <button key={value} className={`filter-pill${status === value ? ' active' : ''}`} onClick={() => setStatus(value)}>{label}</button>
        ))}
        <button className="filter-pill" onClick={() => setCollapsed(allOpen ? new Set(shown.map(([n]) => n)) : new Set())}>
          {allOpen ? 'Alle zuklappen' : 'Alle aufklappen'}
        </button>
        <span className="muted count-text">{count} von {total}</span>
      </div>
      <div className="composer-list">
        {shown.map(([name, items]) => (
          <section className="composer-section" key={name}>
            <button className="section-heading" aria-expanded={!collapsed.has(name)} onClick={() => toggle(name)}>
              <h3>
                <span className="chevron">{collapsed.has(name) ? '▸' : '▾'}</span>{name}<span className="count">{items.length}</span>
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
              <thead><tr><th>Status</th><th>Seite</th><th>Zuletzt geprüft</th><th>Zuletzt geändert</th><th></th></tr></thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.url}>
                    <td><span className={`badge ${e.status}`}>{STATUS_LABEL[e.status] ?? e.status}</span></td>
                    <td>
                      <a href={e.url} target="_blank" rel="noreferrer noopener">{e.name}</a>
                      {e.error && <div className="muted">{e.error}</div>}
                    </td>
                    <td>{e.checked || '-'}</td>
                    <td>{e.changed || '-'}</td>
                    <td><button className="btn" onClick={() => void remove(e)}>Löschen</button></td>
                  </tr>
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
      {changes.length === 0 && <p className="muted">{data?.changes.length ? 'Keine Treffer.' : 'Noch keine Änderungen erkannt.'}</p>}
      {changes.map((c) => (
        <details className="change" key={c.id}>
          <summary>{c.time} – {c.name ?? c.url}<span className="diff-stat"><span className="plus">+{countLines(c.diff, '+')}</span> <span className="minus">−{countLines(c.diff, '-')}</span></span></summary>
          <p><a href={c.url} target="_blank" rel="noreferrer noopener">{c.url}</a></p>
          <pre>
            {c.diff.split('\n').map((line, i) => <div key={i} className={diffClass(line)}>{line || ' '}</div>)}
            {c.extra > 0 && <div className="muted">… und {c.extra} weitere Zeilen</div>}
          </pre>
        </details>
      ))}
        </>
      )}
    </>
  )
}
