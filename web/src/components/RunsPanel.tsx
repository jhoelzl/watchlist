import { formatDuration, runStats, type RunRecord } from '../lib/watchlist'

export function RunsPanel({ runs }: { runs: RunRecord[] }) {
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
