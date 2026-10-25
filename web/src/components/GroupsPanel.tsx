import { useState } from 'react'
import { supabase } from '../supabase'
import { DEFAULT_GROUP, groupChange, groupEntries, type Entry } from '../lib/watchlist'

type Editing = { current: string | null; name: string; selected: Set<string> }

export function GroupsPanel({ entries, onChanged }: { entries: Entry[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<Editing | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const groups = groupEntries(entries)

  const apply = async (current: string | null, name: string, selected: Set<string>) => {
    const { grp, assign, clear } = groupChange(entries, current, name, selected)
    if (current === null && !name.trim()) return setError('Bitte einen Namen angeben.')
    if (grp && groups.some(([g]) => g === grp) && grp !== current) return setError(`Die Gruppe „${grp}“ gibt es schon.`)
    setBusy(true)
    const steps = [
      assign.length ? supabase.from('watchlist_urls').update({ grp }).in('url', assign) : null,
      clear.length ? supabase.from('watchlist_urls').update({ grp: null }).in('url', clear) : null,
    ]
    const results = await Promise.all(steps)
    setBusy(false)
    const failed = results.find((r) => r?.error)?.error
    if (failed) return setError(failed.message)
    setError('')
    setEditing(null)
    onChanged()
  }

  const dissolve = async (name: string) => {
    const n = entries.filter((e) => e.group === name).length
    if (!window.confirm(`Gruppe „${name}“ auflösen? Die ${n} URLs bleiben erhalten und wandern nach „${DEFAULT_GROUP}“.`)) return
    await apply(name, name, new Set())
  }

  const toggle = (url: string) => setEditing((s) => {
    if (!s) return s
    const selected = new Set(s.selected)
    if (!selected.delete(url)) selected.add(url)
    return { ...s, selected }
  })

  return (
    <>
      <p className="muted">Gruppen sind Bezeichnungen an den URLs. Beim Umbenennen oder Auflösen bleiben alle URLs erhalten.</p>
      {!editing && <button className="btn primary" onClick={() => setEditing({ current: null, name: '', selected: new Set() })}>Neue Gruppe</button>}
      {editing && (
        <form className="panel add-panel" onSubmit={(e) => { e.preventDefault(); void apply(editing.current, editing.name, editing.selected) }}>
          <label className="grow">Name<input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus required /></label>
          <fieldset className="grow">
            <legend>URLs in dieser Gruppe</legend>
            {entries.map((e) => (
              <label className="check" key={e.url}>
                <input type="checkbox" checked={editing.selected.has(e.url)} onChange={() => toggle(e.url)} />
                {e.name} <span className="muted">({e.group})</span>
              </label>
            ))}
          </fieldset>
          <div className="add-actions">
            <button className="btn primary" type="submit" disabled={busy}>Speichern</button>
            <button className="btn" type="button" onClick={() => { setEditing(null); setError('') }}>Abbrechen</button>
          </div>
        </form>
      )}
      {error && <p className="error">{error}</p>}
      <table>
        <thead><tr><th>Gruppe</th><th>URLs</th><th></th></tr></thead>
        <tbody>
          {groups.map(([name, items]) => (
            <tr key={name}>
              <td>{name}</td>
              <td>{items.length}</td>
              <td>
                <button className="btn" onClick={() => setEditing({ current: name, name, selected: new Set(items.map((e) => e.url)) })}>Bearbeiten</button>{' '}
                {name !== DEFAULT_GROUP && <button className="btn" onClick={() => void dissolve(name)}>Auflösen</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
