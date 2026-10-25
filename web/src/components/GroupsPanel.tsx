import { useState } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../toast'
import { DEFAULT_GROUP, GROUP_COLORS, groupChange, isHexColor, moveGroup, orderGroups, type Entry, type GroupMeta } from '../lib/watchlist'

type Editing = { current: string | null; name: string; selected: Set<string> }

type Props = { entries: Entry[]; metas: GroupMeta[]; groupsReady: boolean; onChanged: () => void }

export function GroupsPanel({ entries, metas, groupsReady, onChanged }: Props) {
  const notify = useToast()
  const [editing, setEditing] = useState<Editing | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const groups = orderGroups(entries, metas)
  const metaOf = (name: string) => metas.find((m) => m.name === name)

  const apply = async (current: string | null, name: string, selected: Set<string>) => {
    const { grp, assign, clear } = groupChange(entries, current, name, selected)
    if (current === null && !name.trim()) return setError('Please enter a name.')
    if (grp && groups.some(([g]) => g === grp) && grp !== current) return setError(`The group “${grp}” already exists.`)
    setBusy(true)
    const steps = [
      assign.length ? supabase.from('watchlist_urls').update({ grp }).in('url', assign) : null,
      clear.length ? supabase.from('watchlist_urls').update({ grp: null }).in('url', clear) : null,
    ]
    const results = await Promise.all(steps)
    const failed = results.find((r) => r?.error)?.error
    if (failed) { setBusy(false); return setError(failed.message) }
    if (groupsReady) {
      const old = current ?? ''
      const meta = metaOf(old)
      const q = !grp ? (current ? supabase.from('watchlist_groups').delete().eq('name', old) : null)
        : current === null ? supabase.from('watchlist_groups').upsert({ name: grp, position: metas.reduce((m, x) => Math.max(m, x.position + 1), groups.length) })
        : grp !== current && meta ? supabase.from('watchlist_groups').update({ name: grp }).eq('name', old)
        : null
      const res = q ? await q : null
      if (res?.error) { setBusy(false); return setError(res.error.message) }
    }
    setBusy(false)
    setError('')
    setEditing(null)
    onChanged()
  }

  // No confirmation dialog: “Undo” restores the assignment and group style.
  const dissolve = async (name: string) => {
    const urls = entries.filter((e) => e.group === name).map((e) => e.url)
    const meta = metaOf(name)
    await apply(name, name, new Set())
    if (groupsReady) await supabase.from('watchlist_groups').delete().eq('name', name)
    onChanged()
    notify(`Group “${name}” dissolved, ${urls.length} ${urls.length === 1 ? 'URL is' : 'URLs are'} now in “${DEFAULT_GROUP}”.`, { action: { label: 'Undo', run: async () => {
      const back = await supabase.from('watchlist_urls').update({ grp: name }).in('url', urls)
      const metaBack = meta && groupsReady ? await supabase.from('watchlist_groups').upsert(meta) : null
      const failed = back.error ?? metaBack?.error
      if (failed) notify(`Undo failed: ${failed.message}`, { kind: 'error' })
      onChanged()
    } } })
  }

  const saveMeta = async (rows: GroupMeta[]) => {
    const { error: e } = await supabase.from('watchlist_groups').upsert(rows)
    if (e) return setError(e.message)
    setError('')
    onChanged()
  }
  const full = (name: string, patch: Partial<GroupMeta> = {}): GroupMeta => ({ name, position: 0, color: null, icon: null, ...metaOf(name), ...patch })
  const move = (name: string, delta: -1 | 1) => {
    const order = moveGroup(groups.map(([n]) => n), name, delta)
    void saveMeta(order.map((n, i) => full(n, { position: i })))
  }
  const style = (name: string, patch: Partial<GroupMeta>) => {
    const position = metaOf(name)?.position ?? groups.findIndex(([n]) => n === name)
    void saveMeta([full(name, { position, ...patch })])
  }
  const setActive = async (items: Entry[], active: boolean) => {
    const urls = items.filter((e) => (e.active !== false) !== active).map((e) => e.url)
    if (!urls.length) return
    setBusy(true)
    const { error: e } = await supabase.from('watchlist_urls').update({ active }).in('url', urls).select('url')
    setBusy(false)
    if (e) return setError(e.message)
    setError('')
    onChanged()
  }

  const toggle = (url: string) => setEditing((s) => {
    if (!s) return s
    const selected = new Set(s.selected)
    if (!selected.delete(url)) selected.add(url)
    return { ...s, selected }
  })

  return (
    <>
      <p className="muted">Groups are labels on the URLs. All URLs are kept when renaming or dissolving a group.</p>
      {!groupsReady && <p className="muted">Order, colour, icon and empty groups need the <code>watchlist_groups</code> table (run the block at the end of <code>supabase/schema.sql</code> in the SQL editor).</p>}
      {!editing && <button className="btn primary" onClick={() => setEditing({ current: null, name: '', selected: new Set() })}>New group</button>}
      {editing && (
        <form className="panel add-panel" onSubmit={(e) => { e.preventDefault(); void apply(editing.current, editing.name, editing.selected) }}>
          <label className="grow">Name<input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus required /></label>
          <fieldset className="grow">
            <legend>URLs in this group</legend>
            {entries.map((e) => (
              <label className="check" key={e.url}>
                <input type="checkbox" checked={editing.selected.has(e.url)} onChange={() => toggle(e.url)} />
                {e.name} <span className="muted">({e.group})</span>
              </label>
            ))}
          </fieldset>
          <div className="add-actions">
            <button className="btn primary" type="submit" disabled={busy}>Save</button>
            <button className="btn" type="button" onClick={() => { setEditing(null); setError('') }}>Cancel</button>
          </div>
        </form>
      )}
      {error && <p className="error">{error}</p>}
      <table>
        <thead><tr><th>Group</th><th>URLs</th><th>Appearance</th><th></th></tr></thead>
        <tbody>
          {groups.map(([name, items]) => (
            <tr key={name}>
              <td>
                {groupsReady && <><button className="icon-btn" title="Move up" aria-label={`Move ${name} up`} disabled={busy} onClick={() => move(name, -1)}>↑</button><button className="icon-btn" title="Move down" aria-label={`Move ${name} down`} disabled={busy} onClick={() => move(name, 1)}>↓</button></>}{' '}
                <span style={isHexColor(metaOf(name)?.color) ? { borderLeft: `4px solid ${metaOf(name)?.color}`, paddingLeft: 8 } : undefined}>{metaOf(name)?.icon} {name}</span>
              </td>
              <td>{items.length}{items.some((e) => e.active === false) && <span className="muted"> ({items.filter((e) => e.active === false).length} paused)</span>}</td>
              <td>
                {groupsReady && <>
                  <select aria-label={`Colour of ${name}`} value={metaOf(name)?.color ?? ''} onChange={(e) => style(name, { color: e.target.value || null })} style={{ width: 'auto' }}>
                    {GROUP_COLORS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>{' '}
                  <input aria-label={`Icon of ${name}`} className="icon-input" maxLength={4} placeholder="Icon" defaultValue={metaOf(name)?.icon ?? ''} onBlur={(e) => { const v = e.target.value.trim(); if (v !== (metaOf(name)?.icon ?? '')) style(name, { icon: v || null }) }} />
                </>}
              </td>
              <td>
                {items.length > 0 && (items.some((e) => e.active !== false)
                  ? <button className="btn" disabled={busy} onClick={() => void setActive(items, false)}>Pause all</button>
                  : <button className="btn" disabled={busy} onClick={() => void setActive(items, true)}>Resume all</button>)}{' '}
                <button className="btn" onClick={() => setEditing({ current: name, name, selected: new Set(items.map((e) => e.url)) })}>Edit</button>{' '}
                {name !== DEFAULT_GROUP && <button className="btn" onClick={() => void dissolve(name)}>Dissolve</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
