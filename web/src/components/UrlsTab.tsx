import { Fragment, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { SPARK_DAYS, STATUS_LABEL, dailyCounts, isHexColor, isStuck, matches, nextSort, orderGroups, sortEntries, sparkBars, type Entry, type Sort, type SortKey, type StatusFilter } from '../lib/watchlist'
import type { Data } from '../useWatchlist'
import { AddUrl } from './AddUrl'
import { EditUrl } from './EditUrl'
import { RunsPanel } from './RunsPanel'

function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    return u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname.replace(/\/$/, ''))
  } catch {
    return url
  }
}

const SORT_COLUMNS: [SortKey, string][] = [['status', 'Status'], ['name', 'Seite'], ['checked', 'Zuletzt geprüft'], ['changed', 'Zuletzt geändert']]

const STATUS_FILTERS: [StatusFilter, string][] = [
  ['', 'Alle'], ['problem', 'Probleme'], ['stuck', 'Dauerhaft kaputt'], ['error', 'Fehler'], ['warn', 'Zu wenig Text'], ['new', 'Neu'], ['ok', 'OK'], ['pending', 'Offen'], ['paused', 'Pausiert'],
]

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

type Props = {
  data: Data
  shown: ReturnType<typeof orderGroups>
  status: StatusFilter
  setStatus: (status: StatusFilter) => void
  collapsed: Set<string>
  setCollapsed: Dispatch<SetStateAction<Set<string>>>
  sort: Sort
  setSort: (sort: Sort) => void
  adding: boolean
  setAdding: (open: boolean) => void
  onShowHistory: (url: string) => void
  onCheckUrl: (url: string) => void
  checkBusy: boolean
  onReload: () => void
  onRemove: (entry: Entry) => void
}

export function UrlsTab({ data, shown, status, setStatus, collapsed, setCollapsed, sort, setSort, adding, setAdding, onShowHistory, onCheckUrl, checkBusy, onReload, onRemove }: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const total = data.entries.length
  const allOpen = shown.length > 0 && shown.every(([name]) => !collapsed.has(name))
  const toggle = (name: string) => setCollapsed((c) => { const n = new Set(c); if (!n.delete(name)) n.add(name); return n })
  const count = shown.reduce((n, [, items]) => n + items.length, 0)
  const metaOf = (name: string) => data.metas.find((m) => m.name === name)
  return (
    <>
  <RunsPanel runs={data.runs ?? []} />
  <AddUrl entries={data.entries ?? []} open={adding} setOpen={setAdding} onAdded={() => onReload()} />
  <div className="filter-bar">
    {STATUS_FILTERS.map(([value, label]) => (
      <button key={value} className={`filter-pill${status === value ? ' active' : ''}`} onClick={() => setStatus(value)}>
        {label}<span className="pill-count">{(data.entries ?? []).filter((e) => matches({ ...e, text: e.error }, '', '', value)).length}</span>
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
                  {e.name === e.url
                    ? <><a href={e.url} target="_blank" rel="noreferrer noopener">{shortUrl(e.url)}</a><div className="muted">Titel folgt nach der ersten Prüfung</div></>
                    : <a href={e.url} target="_blank" rel="noreferrer noopener">{e.name}</a>}
                  {e.error && <div className="muted">{e.error}</div>}
                  {(e.status === 'error' || e.status === 'warn') && (e.streak ?? 0) > 1 && (
                    <span className={`badge ${isStuck(e) ? 'error' : 'warn'}`} title={isStuck(e) ? 'Seit mehreren Tagen dauerhaft kaputt' : undefined}>{isStuck(e) ? 'Dauerhaft kaputt, ' : ''}{e.streak} Läufe in Folge</span>
                  )}
                </td>
                <td>{e.checked || '-'}</td>
                <td>{e.changed || '-'}</td>
                <td><Spark times={data.freq[e.url] ?? []} /></td>
                <td className="row-actions">
                  <button className="icon-btn" title="Nur diese Seite jetzt prüfen" aria-label={`${e.name} jetzt prüfen`} disabled={checkBusy} onClick={() => onCheckUrl(e.url)}>↻</button>
                  <button className="icon-btn" title="Verlauf dieser Seite" aria-label={`Verlauf von ${e.name}`} onClick={() => onShowHistory(e.url)}>⏱</button>
                  <button className="icon-btn" title="Bearbeiten" aria-label={`${e.name} bearbeiten`} onClick={() => setEditing(editing === e.url ? null : e.url)}><span className="flip">✎</span></button>
                  <button className="icon-btn" title="Löschen" aria-label={`${e.name} löschen`} onClick={() => onRemove(e)}>×</button>
                </td>
              </tr>
              {editing === e.url && (
                <tr className="edit-row"><td colSpan={6}><EditUrl entry={e} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); onReload() }} /></td></tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>}
      </section>
    ))}
  </div>
    </>
  )
}
