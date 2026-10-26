import { useMemo } from 'react'
import { dayLabel, heatmap } from '../lib/watchlist'

type Props = { times: string[]; selected: string | null; onSelect: (day: string | null) => void }

const WEEKDAYS = ['Mo', '', 'We', '', 'Fr', '', 'Su']

export function Heatmap({ times, selected, onSelect }: Props) {
  const { columns, total, months } = useMemo(() => heatmap(times), [times])
  return (
    <div className="heatmap">
      <div className="heatmap-head">
        <strong>{total} {total === 1 ? 'change' : 'changes'}</strong> in the last 6 months
        {selected && <button className="btn" onClick={() => onSelect(null)}>Reset day {selected}</button>}
      </div>
      <div className="heatmap-body">
        <div className="heatmap-weekdays" aria-hidden="true">{WEEKDAYS.map((d, i) => <span key={i} style={{ gridRow: i + 2 }}>{d}</span>)}</div>
        <div className="heatmap-grid" style={{ gridTemplateColumns: `repeat(${columns.length}, 1fr)` }}>
          {months.map((m, i) => <span className="heatmap-month" key={`m${i}`} style={{ gridColumn: i + 1, gridRow: 1 }}>{m}</span>)}
          {columns.map((col, w) => col.map((cell, d) => cell
            ? (
              <button
                key={cell.day}
                className={`heat-cell level-${cell.level}${selected === cell.day ? ' selected' : ''}`}
                style={{ gridColumn: w + 1, gridRow: d + 2 }}
                title={`${dayLabel(cell.day)}: ${cell.count} ${cell.count === 1 ? 'change' : 'changes'}`}
                aria-label={`${dayLabel(cell.day)}: ${cell.count} ${cell.count === 1 ? 'change' : 'changes'}`}
                aria-pressed={selected === cell.day}
                onClick={() => onSelect(selected === cell.day ? null : cell.day)}
              />
            )
            : null))}
        </div>
      </div>
      <div className="heatmap-legend" aria-hidden="true">less {[0, 1, 2, 3, 4].map((l) => <span key={l} className={`heat-cell level-${l}`} />)} more</div>
    </div>
  )
}
