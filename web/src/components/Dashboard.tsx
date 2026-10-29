import { useEffect, useMemo, useRef, useState } from 'react'
import { bookmarkletCode, buildHash, parseAddHash, parseView, pickView, readPrefs, writePrefs, matches, orderGroups, type Period, type Sort, type StatusFilter, type Tab } from '../lib/watchlist'
import { useWatchlist } from '../useWatchlist'
import { ChangesTab } from './ChangesTab'
import { HealthTab } from './HealthTab'
import { GroupsPanel } from './GroupsPanel'
import { OverviewTab } from './OverviewTab'
import { UrlsTab } from './UrlsTab'

export function Dashboard({ homeRequest }: { homeRequest: number }) {
  const { result, check, reload, checkNow, download, upload, remove } = useWatchlist()
  const [prefs] = useState(readPrefs)
  const [prefill] = useState(() => parseAddHash(window.location.hash))
  const [initial] = useState(() => pickView(prefill ? '' : window.location.hash, prefs))
  const [target] = useState(initial.target)
  const [query, setQuery] = useState(initial.query)
  const [group, setGroup] = useState(initial.group)
  const [status, setStatus] = useState<StatusFilter>(initial.status)
  const [period, setPeriod] = useState<Period>(initial.period)
  const [adding, setAdding] = useState(prefill !== null)
  const [sort, setSort] = useState<Sort>(initial.sort)
  const [pageUrl, setPageUrl] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>(prefill ? 'urls' : initial.tab)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(prefs?.collapsed))
  const currentRoute = useRef({ tab, pageUrl })

  const bookmarklet = useRef<HTMLAnchorElement>(null)
  // React blocks javascript: URLs in href, so the attribute is set directly.
  useEffect(() => {
    bookmarklet.current?.setAttribute('href', bookmarkletCode(window.location.origin + window.location.pathname))
  })

  const data = result.state === 'ready' ? result.data : null
  const groups = useMemo(() => orderGroups(data?.entries ?? [], data?.metas ?? []), [data])
  const shown = useMemo(
    () => orderGroups((data?.entries ?? []).filter((e) => matches({ ...e, text: e.error }, query, group, status)), data?.metas ?? [], false),
    [data, query, group, status],
  )
  const showHistory = (url: string) => { setPageUrl(url); setPeriod(''); setQuery(''); setGroup(''); setTab('changes') }
  const openUrls = (filter: StatusFilter) => { setPageUrl(null); setQuery(''); setGroup(''); setStatus(filter); setTab('urls') }
  const openGroupChanges = (name: string) => { setPageUrl(null); setPeriod('7d'); setQuery(''); setGroup(name); setStatus(''); setTab('changes') }
  const openAddUrl = () => { setTab('urls'); setAdding(true) }

  useEffect(() => {
    if (!homeRequest) return
    setTab('overview')
    setPageUrl(null)
    setQuery('')
    setGroup('')
    setStatus('')
    setPeriod('')
    reload()
  }, [homeRequest, reload])

  useEffect(() => {
    writePrefs({ view: { tab, group, status, period, query, sort, target: '' }, collapsed: [...collapsed] })
  }, [tab, group, status, period, query, sort, collapsed])

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const state = event.state as { watchlist?: unknown; viewHash?: unknown; pageUrl?: unknown } | null
      const isWatchlistState = state?.watchlist === true
      const view = parseView(isWatchlistState && typeof state.viewHash === 'string' ? state.viewHash : window.location.hash)
      const restoredPageUrl = isWatchlistState && typeof state.pageUrl === 'string' ? state.pageUrl : null

      currentRoute.current = { tab: view.tab, pageUrl: restoredPageUrl }
      setTab(view.tab)
      setGroup(view.group)
      setStatus(view.status)
      setPeriod(view.period)
      setQuery(view.query)
      setSort(view.sort)
      setPageUrl(restoredPageUrl)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    const hash = buildHash({ tab, group, status, period, query, sort, target: tab === 'changes' && !pageUrl ? target : '' })
    // Section/detail navigation gets its own entry; filter and search changes stay in the current entry.
    const routeChanged = currentRoute.current.tab !== tab || currentRoute.current.pageUrl !== pageUrl
    if (hash !== window.location.hash || routeChanged) {
      const state = { watchlist: true, viewHash: hash, pageUrl }
      const url = hash || window.location.pathname + window.location.search
      if (routeChanged) history.pushState(state, '', url)
      else history.replaceState(state, '', url)
    }
    currentRoute.current = { tab, pageUrl }
  }, [tab, group, status, period, query, sort, pageUrl, target])

  if (result.state === 'loading') return <p className="muted">Loading …</p>
  if (result.state === 'denied') {
    return <p className="error">This account is not enabled for the watchlist. See the README, section “Dashboard”.</p>
  }
  if (result.state === 'error') return <p className="error">Loading failed: {result.message}</p>

  const total = data?.entries.length ?? 0
  return (
    <>
      <div className="dashboard-nav">
        <div className="dashboard-nav-inner">
          <div className="tabs" role="tablist" aria-label="Watchlist sections">
            <button role="tab" aria-selected={tab === 'overview'} className={`tab${tab === 'overview' ? ' active' : ''}`} onClick={() => setTab('overview')}>Overview</button>
            <button role="tab" aria-selected={tab === 'changes'} className={`tab${tab === 'changes' ? ' active' : ''}`} onClick={() => setTab('changes')}>Changes<span className="count">{data?.changes.length ?? 0}</span></button>
            <button role="tab" aria-selected={tab === 'urls'} className={`tab${tab === 'urls' ? ' active' : ''}`} onClick={() => setTab('urls')}>URLs<span className="count">{total}</span></button>
            <button role="tab" aria-selected={tab === 'groups'} className={`tab${tab === 'groups' ? ' active' : ''}`} onClick={() => setTab('groups')}>Groups<span className="count">{groups.length}</span></button>
            <button role="tab" aria-selected={tab === 'health'} className={`tab${tab === 'health' ? ' active' : ''}`} onClick={() => setTab('health')}>Health</button>
          </div>
          <div className="intro-actions">
            <button className="btn" onClick={openAddUrl}>Add URL</button>
            {tab !== 'overview' && (
              <button className="btn primary" onClick={() => void checkNow()} disabled={check.state === 'busy' || check.state === 'waiting' || check.state === 'running'}>
                {check.state === 'busy' ? 'Starting …' : check.state === 'waiting' || check.state === 'running' ? 'Check running …' : 'Check now'}
              </button>
            )}
          </div>
        </div>
      </div>
      {check.state === 'waiting' && <p className="muted">Check started, waiting for the run on GitHub …</p>}
      {check.state === 'running' && <p className="muted">Check running{check.url && <> (<a href={check.url} target="_blank" rel="noreferrer noopener">View run</a>)</>}. The view updates automatically.</p>}
      {check.state === 'success' && <p className="muted">Check finished, the view is up to date.</p>}
      {check.state === 'failed' && <p className="error">The check failed{check.url && <> (<a href={check.url} target="_blank" rel="noreferrer noopener">View run</a>)</>}.</p>}
      {check.state === 'timeout' && <p className="error">The run is taking unusually long. Please check GitHub.</p>}
      {check.state === 'error' && <p className="error">Check could not be started: {check.message}</p>}
      {tab === 'groups' && <GroupsPanel entries={data?.entries ?? []} metas={data?.metas ?? []} groupsReady={data?.groupsReady ?? false} onChanged={() => reload()} />}
      {tab === 'health' && data && <HealthTab data={data} onShowHistory={showHistory} />}
      {(tab === 'urls' || tab === 'changes') && <div className="toolbar">
        <div className="search-field">
          <span aria-hidden="true">⌕</span>
          <input type="search" placeholder="Search (name, URL, text)" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select aria-label="Group" value={group} onChange={(e) => setGroup(e.target.value)} style={{ width: 'auto' }}>
          <option value="">All groups</option>
          {groups.map(([g]) => <option key={g} value={g}>{g}</option>)}
        </select>
        {tab === 'urls' && (
          <details className="menu toolbar-menu">
            <summary className="btn">Import / Export</summary>
            <div className="menu-items">
              <button className="btn" onClick={() => void download('yaml')}>Export as YAML</button>
              <button className="btn" onClick={() => void download('json')}>Export as JSON</button>
              <a className="btn" ref={bookmarklet} href="#" onClick={(e) => e.preventDefault()} title="Drag this to your bookmarks bar">Bookmarklet: add page</a>
              <label className="btn">Import (YAML/JSON)<input type="file" accept=".yml,.yaml,.json,text/*" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = '' }} /></label>
            </div>
          </details>
        )}
      </div>}
      {data && tab === 'overview' && (
        <OverviewTab
          data={data}
          checking={['busy', 'waiting', 'running'].includes(check.state)}
          onCheckAll={() => void checkNow()}
          onCheckUrl={(url) => void checkNow({ url })}
          onAddUrl={openAddUrl}
          onShowHistory={showHistory}
          onOpenUrls={openUrls}
          onOpenChanges={() => setTab('changes')}
          onOpenGroupChanges={openGroupChanges}
        />
      )}
      {data && tab === 'urls' && (
        <UrlsTab prefill={prefill} data={data} shown={shown} status={status} setStatus={setStatus} collapsed={collapsed} setCollapsed={setCollapsed} sort={sort} setSort={setSort} adding={adding} setAdding={setAdding} onShowHistory={showHistory} onCheckUrl={(url) => void checkNow({ url })} onCheckGroup={(group) => void checkNow({ group })} onCheckUrls={(urls) => void checkNow({ urls })} checkBusy={['busy', 'waiting', 'running'].includes(check.state)} onReload={reload} onRemove={(e) => void remove(e)} />
      )}
      {data && tab === 'changes' && (
        <ChangesTab data={data} pageUrl={pageUrl} setPageUrl={setPageUrl} query={query} group={group} period={period} setPeriod={setPeriod} target={target} onReload={reload} />
      )}
    </>
  )
}
