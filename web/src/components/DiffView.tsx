import { Fragment, useMemo, useState } from 'react'
import { annotateDiff, diffClass, sideBySide } from '../lib/watchlist'

function Segments({ segs }: { segs: { text: string; changed: boolean }[] }) {
  return <>{segs.map((s, n) => (s.changed ? <mark key={n}>{s.text}</mark> : s.text))}</>
}

export function DiffView({ diff, extra }: { diff: string; extra: number }) {
  const [side, setSide] = useState(false)
  const [onlyChanged, setOnlyChanged] = useState(false)
  const lines = useMemo(() => diff.split('\n'), [diff])
  const rows = useMemo(() => (side ? sideBySide(lines) : []), [side, lines])
  const inline = useMemo(() => annotateDiff(lines).map((segs, i) => ({ segs, line: lines[i] })), [lines])
  const visible = onlyChanged ? inline.filter(({ line }) => line.startsWith('+') || line.startsWith('-')) : inline
  const visibleRows = onlyChanged ? rows.filter((r) => r.kind === 'chg') : rows
  return (
    <>
      <div className="diff-tools">
        <button className={`filter-pill${side ? '' : ' active'}`} onClick={() => setSide(false)}>Inline</button>
        <button className={`filter-pill${side ? ' active' : ''}`} onClick={() => setSide(true)}>Alt/Neu</button>
        <label className="check"><input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} /> nur geänderte Zeilen</label>
      </div>
      {side ? (
        <div className="side-diff">
          <div className="side-head">Alt</div>
          <div className="side-head">Neu</div>
          {visibleRows.map((r, i) =>
            r.kind === 'hunk' ? (
              <div key={i} className="side-hunk">{r.left?.map((x) => x.text).join('')}</div>
            ) : (
              <Fragment key={i}>
                <div className={`side-cell${r.left && r.kind === 'chg' ? ' del' : ''}${r.left ? '' : ' empty'}`}>{r.left ? <Segments segs={r.left} /> : ''}{' '}</div>
                <div className={`side-cell${r.right && r.kind === 'chg' ? ' add' : ''}${r.right ? '' : ' empty'}`}>{r.right ? <Segments segs={r.right} /> : ''}{' '}</div>
              </Fragment>
            ),
          )}
          {extra > 0 && <div className="side-hunk">… und {extra} weitere Zeilen</div>}
        </div>
      ) : (
        <pre>
          {visible.map(({ segs }, i) => (
            <div key={i} className={diffClass(segs.map((s) => s.text).join(''))}>
              <Segments segs={segs} />
              {segs.length === 0 || segs[0].text === '' ? ' ' : ''}
            </div>
          ))}
          {extra > 0 && <div className="muted">… und {extra} weitere Zeilen</div>}
        </pre>
      )}
    </>
  )
}
