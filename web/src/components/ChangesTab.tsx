import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../supabase'
import { HISTORY_LIMIT, PAGE_HISTORY_LIMIT, PERIODS, countLines, dayLabel, fragmentUrl, groupByDay, groupOf, inPeriod, matches, type Change, type Period } from '../lib/watchlist'
import type { Data } from '../useWatchlist'
import { DiffView } from './DiffView'
import { Heatmap } from './Heatmap'
import { ScreenshotCompare } from './ScreenshotCompare'

type Props = {
  data: Data
  pageUrl: string | null
  setPageUrl: (url: string | null) => void
  query: string
  group: string
  period: Period
  setPeriod: (period: Period) => void
  mailTarget: RegExpExecArray | null
}

export function ChangesTab({ data, pageUrl, setPageUrl, query, group, period, setPeriod, mailTarget }: Props) {
  const [extra, setExtra] = useState<Change[]>([])
  const [noMore, setNoMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreError, setMoreError] = useState('')
  const [pageHistory, setPageHistory] = useState<Change[] | { error: string } | null>(null)
  const [day, setDay] = useState<string | null>(null)
  const scrolled = useRef(false)
  // History of a single page: loaded in full from the database instead of only the latest 100 overall
  useEffect(() => {
    if (!pageUrl) return setPageHistory(null)
    let stale = false
    setPageHistory(null)
    void supabase.from('watchlist_history').select('id, name, url, grp, time, diff, extra').eq('url', pageUrl).order('id', { ascending: false }).limit(PAGE_HISTORY_LIMIT)
      .then(({ data: rows, error }) => { if (!stale) setPageHistory(error ? { error: error.message } : ((rows ?? []) as Change[])) })
    return () => { stale = true }
  }, [pageUrl])
  const base = pageUrl ? (Array.isArray(pageHistory) ? pageHistory : []) : data.changes
  const baseLimit = pageUrl ? PAGE_HISTORY_LIMIT : HISTORY_LIMIT
  // Entries loaded later belong to the current base list and are discarded when new data arrives
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
  // Only the latest change of a page has matching before/after screenshots.
  const hasShots = (c: Change) => {
    const e = data.entries.find((x) => x.url === c.url)
    return e?.options?.screenshot === true && e.changed === c.time
  }
  const pageName = pageUrl ? (data.entries.find((e) => e.url === pageUrl)?.name ?? pageUrl) : ''

  const changes = useMemo(
    () => source.filter((c) => matches({ name: c.name, url: c.url, text: c.diff, group: groupOf(c.grp) }, query, group, '') && inPeriod(c.time, period) && (!day || c.time.startsWith(day))),
    [source, query, group, period, day],
  )
  const heatTimes = useMemo(() => {
    if (pageUrl) return data.freq[pageUrl] ?? []
    const urls = group ? data.entries.filter((e) => e.group === group).map((e) => e.url) : Object.keys(data.freq)
    return urls.flatMap((u) => data.freq[u] ?? [])
  }, [data, pageUrl, group])
  const days = useMemo(() => groupByDay(changes), [changes])

  // Mail link #changes:<URL> opens the matching entry (once, as soon as it is in the list)
  useEffect(() => {
    if (!mailTarget || scrolled.current) return
    const url = decodeURIComponent(mailTarget[1])
    const el = Array.from(document.querySelectorAll<HTMLDetailsElement>('details.change')).find((d) => d.dataset.url === url)
    if (el) {
      scrolled.current = true
      el.open = true
      el.scrollIntoView({ block: 'center' })
    }
  }, [days, mailTarget])

  return (
    <>
  {pageUrl && (
    <div className="page-filter">
      <span className="page-filter-label">
        <span className="page-filter-tag">Filter active</span>
        Only changes of <strong>{pageName}</strong>
      </span>
      <button className="btn" onClick={() => setPageUrl(null)} aria-label="Remove page filter and show all changes">✕ Remove filter · show all changes</button>
    </div>
  )}
  {pageUrl && !pageHistory && <p className="muted">Loading history …</p>}
  {pageUrl && pageHistory && !Array.isArray(pageHistory) && <p className="error">History could not be loaded: {pageHistory.error}</p>}
  <Heatmap times={heatTimes} selected={day} onSelect={setDay} />
  <div className="filter-bar">
    {PERIODS.map(([value, label]) => (
      <button key={value} className={`filter-pill${period === value ? ' active' : ''}`} onClick={() => setPeriod(value)}>{label}</button>
    ))}
    <span className="muted count-text">{changes.length} of {source.length}{canLoadMore ? '+' : ''}</span>
  </div>
  {changes.length === 0 && <p className="muted">{source.length ? 'No matches.' : pageUrl ? 'No change has been detected for this page yet.' : 'No changes detected yet.'}</p>}
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
              <> · <a href={fragmentUrl(c.url, c.diff)} target="_blank" rel="noreferrer noopener">to the changed spot</a></>
            )}
          </p>
          <DiffView diff={c.diff} extra={c.extra} />
          {hasShots(c) && <ScreenshotCompare url={c.url} />}
        </details>
      ))}
    </section>
  ))}
  {canLoadMore && (
    <p><button className="btn" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'Loading …' : 'Load older entries'}</button></p>
  )}
  {moreError && <p className="error">More entries could not be loaded: {moreError}</p>}
    </>
  )
}
