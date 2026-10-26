import { useEffect, useState } from 'react'
import { STATUS_LABEL, formatRelativeTime, isStuck, summarize, type StatusFilter } from '../lib/watchlist'
import type { Data } from '../useWatchlist'

type Props = {
  data: Data
  checking: boolean
  onCheckAll: () => void
  onCheckUrl: (url: string) => void
  onAddUrl: () => void
  onShowHistory: (url: string) => void
  onOpenUrls: (filter: StatusFilter) => void
  onOpenChanges: () => void
}

function displayTime(value: string): string {
  if (!value) return 'Not checked yet'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

export function OverviewTab({ data, checking, onCheckAll, onCheckUrl, onAddUrl, onShowHistory, onOpenUrls, onOpenChanges }: Props) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const summary = summarize(data.entries)
  const attention = data.entries
    .filter((entry) => entry.status === 'error' || entry.status === 'warn')
    .sort((a, b) => {
      const rank = (entry: typeof a) => entry.status === 'error' ? 0 : entry.status === 'warn' ? 1 : 2
      return rank(a) - rank(b) || (b.streak ?? 0) - (a.streak ?? 0)
    })
    .slice(0, 4)
  const recent = data.changes.slice(0, 4)

  return (
    <div className="overview">
      <section className={`overview-hero${summary.problems ? ' has-problems' : ''}`}>
        <div className="overview-hero-copy">
          <span className="eyebrow">YOUR WATCHLIST</span>
          <h2>
            {summary.problems
              ? `${summary.problems} page${summary.problems === 1 ? '' : 's'} need attention`
              : summary.total === 0
                ? 'Start your watchlist'
                : summary.pending > 0
                  ? `${summary.pending} page${summary.pending === 1 ? '' : 's'} not checked yet`
                  : 'Everything looks good'}
          </h2>
          <p>
            {summary.problems
              ? 'Review the latest issues below, or check your pages for fresh updates.'
              : summary.total === 0
                ? 'Add pages you want to keep an eye on, then check them anytime.'
                : summary.pending > 0
                  ? 'Run a check to establish a baseline for pages that have not been checked yet.'
                  : `${summary.ok} of ${summary.total} monitored pages are healthy.${data.updated ? ` Last updated ${formatRelativeTime(data.updated, now)}.` : ' No check has completed yet.'}`}
          </p>
          <div className="overview-actions">
            {summary.total === 0
              ? <button className="btn primary" onClick={onAddUrl}>Add your first URL</button>
              : <button className="btn primary" onClick={onCheckAll} disabled={checking}>{checking ? 'Check running …' : 'Check all pages'}</button>}
            {summary.problems > 0 && <button className="btn" onClick={() => onOpenUrls('problem')}>Review issues</button>}
          </div>
        </div>
        <div className="overview-hero-art" aria-hidden="true">
          <span className="overview-orbit orbit-one" />
          <span className="overview-orbit orbit-two" />
          <span className="overview-orbit orbit-three" />
          <span className="overview-pulse">{summary.problems ? '!' : '✓'}</span>
        </div>
      </section>

      <section className="overview-metrics" aria-label="Watchlist summary">
        <button className="overview-metric" onClick={() => onOpenUrls('')}>
          <span className="metric-icon">◎</span><span className="metric-value">{summary.total}</span><span className="metric-label">URLs tracked</span>
        </button>
        <button className="overview-metric good" onClick={() => onOpenUrls('ok')}>
          <span className="metric-icon">✓</span><span className="metric-value">{summary.ok}</span><span className="metric-label">Healthy</span>
        </button>
        <button className={`overview-metric${summary.problems ? ' attention' : ''}`} onClick={() => onOpenUrls('problem')}>
          <span className="metric-icon">!</span><span className="metric-value">{summary.problems}</span><span className="metric-label">Need attention</span>
        </button>
        <button className="overview-metric quiet" onClick={() => onOpenUrls('paused')}>
          <span className="metric-icon">Ⅱ</span><span className="metric-value">{summary.paused}</span><span className="metric-label">Paused</span>
        </button>
      </section>

      <div className="overview-columns">
        <section className="overview-card">
          <div className="overview-card-head">
            <div><span className="eyebrow">STAY ON TOP OF IT</span><h3>Needs attention</h3></div>
            {summary.problems > 0 && <button className="text-action" onClick={() => onOpenUrls('problem')}>View all <span aria-hidden="true">→</span></button>}
          </div>
          {attention.length ? (
            <div className="overview-list">
              {attention.map((entry) => (
                <article className="overview-list-row" key={entry.url}>
                  <span className={`overview-status ${entry.status}`} aria-hidden="true">{entry.status === 'error' ? '!' : entry.status === 'warn' ? '△' : '•'}</span>
                  <div className="overview-item-copy">
                    <button className="overview-item-title" onClick={() => onShowHistory(entry.url)}>{entry.name}</button>
                    <span className="overview-item-detail">{entry.error || `${entry.group} · ${STATUS_LABEL[entry.status]}${isStuck(entry) ? ` · ${entry.streak} checks failing` : ''}`}</span>
                  </div>
                  <button className="icon-btn overview-check" title={`Check ${entry.name} now`} aria-label={`Check ${entry.name} now`} disabled={checking} onClick={() => onCheckUrl(entry.url)}>↻</button>
                </article>
              ))}
            </div>
          ) : (
            <div className="overview-empty"><span aria-hidden="true">✓</span><div><strong>No issues to take care of</strong><p>Your pages are checking in normally.</p></div></div>
          )}
        </section>

        <section className="overview-card">
          <div className="overview-card-head">
            <div><span className="eyebrow">WHAT'S NEW</span><h3>Recent changes</h3></div>
            <button className="text-action" onClick={onOpenChanges}>See all <span aria-hidden="true">→</span></button>
          </div>
          {recent.length ? (
            <div className="overview-list">
              {recent.map((change) => (
                <button className="overview-change-row" key={change.id} onClick={() => onShowHistory(change.url)}>
                  <span className="change-dot" aria-hidden="true" />
                  <span className="overview-item-copy">
                    <strong className="overview-item-title">{change.summary || change.name || change.url}</strong>
                    <span className="overview-item-detail">{change.name && change.summary ? change.name : change.url} · {displayTime(change.time)}</span>
                  </span>
                  <span className="overview-arrow" aria-hidden="true">→</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="overview-empty"><span aria-hidden="true">◷</span><div><strong>No changes detected yet</strong><p>New updates from your pages will appear here.</p></div></div>
          )}
        </section>
      </div>
    </div>
  )
}
