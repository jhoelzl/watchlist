import { useEffect, useMemo, useState } from 'react'
import { buildHash, pickView, readPrefs, writePrefs, matches, orderGroups, type Period, type Sort, type StatusFilter } from '../lib/watchlist'
import { useWatchlist } from '../useWatchlist'
import { ChangesTab } from './ChangesTab'
import { GroupsPanel } from './GroupsPanel'
import { UrlsTab } from './UrlsTab'

export function Dashboard() {
  const { result, check, reload, checkNow, download, upload, remove } = useWatchlist()
  const [prefs] = useState(readPrefs)
  const [initial] = useState(() => pickView(window.location.hash, prefs))
  const [mailTarget] = useState(() => /^#changes:(.+)$/.exec(window.location.hash))
  const [query, setQuery] = useState(initial.query)
  const [group, setGroup] = useState(initial.group)
  const [status, setStatus] = useState<StatusFilter>(initial.status)
  const [period, setPeriod] = useState<Period>(initial.period)
  const [adding, setAdding] = useState(false)
  const [sort, setSort] = useState<Sort>(initial.sort)
  const [pageUrl, setPageUrl] = useState<string | null>(null)
  const [tab, setTab] = useState<'urls' | 'changes' | 'groups'>(initial.tab)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(prefs?.collapsed))

  const data = result.state === 'ready' ? result.data : null
  const groups = useMemo(() => orderGroups(data?.entries ?? [], data?.metas ?? []), [data])
  const shown = useMemo(
    () => orderGroups((data?.entries ?? []).filter((e) => matches({ ...e, text: e.error }, query, group, status)), data?.metas ?? [], false),
    [data, query, group, status],
  )
  const showHistory = (url: string) => { setPageUrl(url); setPeriod(''); setQuery(''); setGroup(''); setTab('changes') }

  useEffect(() => {
    writePrefs({ view: { tab, group, status, period, query, sort }, collapsed: [...collapsed] })
  }, [tab, group, status, period, query, sort, collapsed])

  useEffect(() => {
    const hash = buildHash({ tab, group, status, period, query, sort })
    if (hash !== window.location.hash) history.replaceState(null, '', hash || window.location.pathname + window.location.search)
  }, [tab, group, status, period, query, sort])

  if (result.state === 'loading') return <p className="muted">Lade …</p>
  if (result.state === 'denied') {
    return <p className="error">Dieses Konto ist nicht für die Watchlist freigeschaltet. Siehe README, Abschnitt „Dashboard“.</p>
  }
  if (result.state === 'error') return <p className="error">Laden fehlgeschlagen: {result.message}</p>

  const total = data?.entries.length ?? 0
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
      {tab === 'groups' && <GroupsPanel entries={data?.entries ?? []} metas={data?.metas ?? []} groupsReady={data?.groupsReady ?? false} onChanged={() => reload()} />}
      {tab !== 'groups' && <div className="toolbar">
        <div className="search-field">
          <span aria-hidden="true">⌕</span>
          <input type="search" placeholder="Suchen (Name, URL, Text)" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select aria-label="Gruppe" value={group} onChange={(e) => setGroup(e.target.value)} style={{ width: 'auto' }}>
          <option value="">Alle Gruppen</option>
          {groups.map(([g]) => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>}      {data && tab === 'urls' && (
        <UrlsTab data={data} shown={shown} status={status} setStatus={setStatus} collapsed={collapsed} setCollapsed={setCollapsed} sort={sort} setSort={setSort} adding={adding} setAdding={setAdding} onShowHistory={showHistory} onReload={reload} onRemove={(e) => void remove(e)} />
      )}
      {data && tab === 'changes' && (
        <ChangesTab data={data} pageUrl={pageUrl} setPageUrl={setPageUrl} query={query} group={group} period={period} setPeriod={setPeriod} mailTarget={mailTarget} />
      )}
    </>
  )
}
