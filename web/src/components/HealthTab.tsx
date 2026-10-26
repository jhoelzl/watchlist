import { useMemo } from 'react'
import { STATUS_LABEL, STUCK_AFTER, formatDuration, formatMs, healthRows, healthSummary, noisyUrls, runStats } from '../lib/watchlist'
import type { Data } from '../useWatchlist'

const LABEL: Record<string, string> = { o: 'OK', w: 'Too little text', e: 'Error' }

export function HealthTab({ data, onShowHistory }: { data: Data; onShowHistory: (url: string) => void }) {
  const noisy = useMemo(() => new Set(noisyUrls(data.changes, data.entries).keys()), [data.changes, data.entries])
  const rows = useMemo(() => healthRows(data.entries, data.health, noisy), [data.entries, data.health, noisy])
  const sum = healthSummary(rows)
  const runs = runStats(data.runs)
  if (!rows.length) return <p className="muted">No URLs yet.</p>
  return (
    <>
      <div className="health-cards">
        <div className="health-card"><strong>{sum.uptime === null ? '-' : `${sum.uptime.toFixed(1)}%`}</strong><span>Uptime (all URLs)</span></div>
        <div className="health-card"><strong>{formatMs(sum.avgMs)}</strong><span>Avg fetch time</span></div>
        <div className={`health-card${sum.stuck ? ' bad' : ''}`}><strong>{sum.stuck}</strong><span>Stuck ({STUCK_AFTER}+ runs failing)</span></div>
        <div className={`health-card${sum.noisy ? ' warn' : ''}`}><strong>{sum.noisy}</strong><span>Noisy pages</span></div>
        {data.runs.length > 0 && <div className="health-card"><strong>{formatDuration(runs.avgSeconds)}</strong><span>Avg run time ({data.runs.length} runs)</span></div>}
      </div>
      <table className="health-table">
        <thead><tr><th>Page</th><th>Last checks</th><th>Uptime</th><th>Avg fetch</th><th>Flags</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.entry.url}>
              <td><button className="link" onClick={() => onShowHistory(r.entry.url)}>{r.entry.name}</button><div className="muted small">{r.entry.group || 'General'}</div></td>
              <td>
                {r.checks ? (
                  <span className="health-strip" aria-label={`${r.checks} checks`}>
                    {[...r.results].map((c, i) => <span key={i} className={`health-cell ${c}`} title={LABEL[c] ?? c} />)}
                  </span>
                ) : <span className="muted">No data yet</span>}
              </td>
              <td className={r.uptime !== null && r.uptime < 90 ? 'health-bad' : ''}>{r.uptime === null ? '-' : `${r.uptime.toFixed(0)}%`}</td>
              <td>{formatMs(r.avgMs)}</td>
              <td>
                {r.stuck && <span className="badge error">Stuck</span>}{' '}
                {r.noisy && <span className="badge warn">Noisy</span>}{' '}
                {!r.stuck && (r.entry.status === 'error' || r.entry.status === 'warn') && <span className="badge warn">{STATUS_LABEL[r.entry.status]}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
