import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import {
  STATUS_LABEL, diffClass, groupEntries, groupOf, matches, toEntries,
  type Change, type Entry, type StatusFilter,
} from '../lib/watchlist'

type Data = { entries: Entry[]; changes: Change[]; updated: string | null }
type Load = { state: 'loading' } | { state: 'denied' } | { state: 'error'; message: string } | { state: 'ready'; data: Data }

const STATUS_FILTERS: [StatusFilter, string][] = [
  ['', 'Alle'], ['problem', 'Probleme'], ['error', 'Fehler'], ['warn', 'Zu wenig Text'], ['new', 'Neu'], ['ok', 'OK'],
]

async function load(): Promise<Load> {
  const admin = await supabase.from('watchlist_admins').select('user_id').maybeSingle()
  if (admin.error) return { state: 'error', message: admin.error.message }
  if (!admin.data) return { state: 'denied' }
  const [status, history] = await Promise.all([
    supabase.from('watchlist_state').select('value, updated_at').eq('key', 'status').maybeSingle(),
    supabase.from('watchlist_history').select('id, name, url, grp, time, diff, extra').order('id', { ascending: false }).limit(50),
  ])
  const failed = status.error ?? history.error
  if (failed) return { state: 'error', message: failed.message }
  return {
    state: 'ready',
    data: {
      entries: toEntries(status.data?.value ?? {}),
      changes: (history.data ?? []) as Change[],
      updated: status.data?.updated_at ?? null,
    },
  }
}

export function Dashboard() {
  const [result, setResult] = useState<Load>({ state: 'loading' })
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('')
  const [status, setStatus] = useState<StatusFilter>('')
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

  if (result.state === 'loading') return <p className="muted">Lade …</p>
  if (result.state === 'denied') {
    return <p className="error">Dieses Konto ist nicht für die Watchlist freigeschaltet. Siehe README, Abschnitt „Dashboard“.</p>
  }
  if (result.state === 'error') return <p className="error">Laden fehlgeschlagen: {result.message}</p>

  const total = data?.entries.length ?? 0
  const count = shown.reduce((n, [, items]) => n + items.length, 0)
  return (
    <>
      <div className="library-intro">
        <div>
          <h2>Watchlist</h2>
          <p>{data?.updated ? `Zuletzt aktualisiert: ${new Date(data.updated).toLocaleString('de-AT')}` : 'Noch kein Lauf'}</p>
        </div>
        <button className="btn" onClick={() => void load().then(setResult)}>Aktualisieren</button>
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
      <div className="filter-bar">
        {STATUS_FILTERS.map(([value, label]) => (
          <button key={value} className={`filter-pill${status === value ? ' active' : ''}`} onClick={() => setStatus(value)}>{label}</button>
        ))}
        <span className="muted count-text">{count} von {total}</span>
      </div>
      <div className="composer-list">
        {shown.map(([name, items]) => (
          <section className="composer-section" key={name}>
            <div className="section-heading"><h3>{name}<span className="count">{items.length}</span></h3></div>
            <table>
              <thead><tr><th>Status</th><th>Seite</th><th>Zuletzt geprüft</th><th>Zuletzt geändert</th></tr></thead>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
      <h2 className="section-title">Änderungsverlauf</h2>
      {changes.length === 0 && <p className="muted">{data?.changes.length ? 'Keine Treffer.' : 'Noch keine Änderungen erkannt.'}</p>}
      {changes.map((c) => (
        <details className="change" key={c.id}>
          <summary>{c.time} – {c.name ?? c.url}</summary>
          <p><a href={c.url} target="_blank" rel="noreferrer noopener">{c.url}</a></p>
          <pre>
            {c.diff.split('\n').map((line, i) => <div key={i} className={diffClass(line)}>{line || ' '}</div>)}
            {c.extra > 0 && <div className="muted">… und {c.extra} weitere Zeilen</div>}
          </pre>
        </details>
      ))}
    </>
  )
}
