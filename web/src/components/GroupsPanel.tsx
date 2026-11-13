import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../toast'
import { GroupIcon, isImageIcon, resizeLogo } from './GroupIcon'
import { DEFAULT_GROUP, GROUP_COLORS, groupChange, isHexColor, moveGroup, orderGroups, sortGroupNames, type Entry, type GroupMeta } from '../lib/watchlist'

type Editing = { current: string | null; name: string; selected: Set<string> }

type Props = { entries: Entry[]; metas: GroupMeta[]; groupsReady: boolean; onChanged: () => void }

export function GroupsPanel({ entries, metas, groupsReady, onChanged }: Props) {
  const notify = useToast()
  const [editing, setEditing] = useState<Editing | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const editor = useRef<HTMLFormElement>(null)
  useEffect(() => { if (editing) editor.current?.scrollIntoView({ block: 'start' }) }, [editing?.current])
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
  const sortAll = (dir: 'asc' | 'desc') => {
    const order = sortGroupNames(groups.map(([n]) => n), dir)
    void saveMeta(order.map((n, i) => full(n, { position: i })))
  }
  const style = (name: string, patch: Partial<GroupMeta>) => {
    const position = metaOf(name)?.position ?? groups.findIndex(([n]) => n === name)
    void saveMeta([full(name, { position, ...patch })])
  }
  const uploadLogo = async (name: string, file: File | undefined) => {
    if (!file) return
    setBusy(true)
    try {
      const blob = await resizeLogo(file)
      const path = `${crypto.randomUUID()}.png`
      const { error: up } = await supabase.storage.from('group-icons').upload(path, blob, { contentType: 'image/png' })
      if (up) throw up
      style(name, { icon: supabase.storage.from('group-icons').getPublicUrl(path).data.publicUrl })
    } catch (err) {
      setError(`Logo upload failed: ${err instanceof Error ? err.message : String(err)} (run the group-icons block of supabase/schema.sql)`)
    } finally {
      setBusy(false)
    }
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
    <div className="groups-page">
      <div className="groups-intro">
        <div>
          <span className="eyebrow">YOUR COLLECTION</span>
          <h2>Groups</h2>
          <p>Organize your pages into collections that make sense to you.</p>
        </div>
        {!editing && <button className="btn primary groups-create" onClick={() => setEditing({ current: null, name: '', selected: new Set() })}><span aria-hidden="true">+</span> New group</button>}
      </div>
      {!groupsReady && <p className="muted">Order, colour, icon and empty groups need the <code>watchlist_groups</code> table (run the block at the end of <code>supabase/schema.sql</code> in the SQL editor).</p>}
      {editing && (
        <form ref={editor} className="groups-editor" onSubmit={(e) => { e.preventDefault(); void apply(editing.current, editing.name, editing.selected) }}>
          <div className="groups-editor-heading">
            <h3>{editing.current === null ? 'Create a group' : `Edit ${editing.current}`}</h3>
            <p>Choose a name and select the pages that belong in this group.</p>
          </div>
          <label>Group name<input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus required /></label>
          <fieldset>
            <legend>Pages <span>({editing.selected.size} selected)</span></legend>
            {!entries.length && <p className="muted">No pages yet. You can add them later.</p>}
            {entries.map((e) => (
              <label className="groups-page-option" key={e.url}>
                <input type="checkbox" checked={editing.selected.has(e.url)} onChange={() => toggle(e.url)} />
                <span>{e.name}<small>{e.group}</small></span>
              </label>
            ))}
          </fieldset>
          <div className="groups-editor-actions">
            <button className="btn" type="button" disabled={busy} onClick={() => { setEditing(null); setError('') }}>Cancel</button>
            <button className="btn primary" type="submit" disabled={busy}>{busy ? 'Saving …' : 'Save group'}</button>
          </div>
        </form>
      )}
      {error && <p className="error">{error}</p>}
      <div className="groups-list-heading">
        <span>{groups.length} {groups.length === 1 ? 'group' : 'groups'}</span>
        {groupsReady && groups.length > 1 && <div className="groups-sort">
          <span>Sort</span>
          <button className="link" disabled={busy} onClick={() => sortAll('asc')}>A–Z</button>
          <button className="link" disabled={busy} onClick={() => sortAll('desc')}>Z–A</button>
        </div>}
      </div>
      {!groups.length && <div className="groups-empty"><strong>No groups yet</strong><p>Create a group to keep related pages together.</p></div>}
      <div className="groups-grid">
        {groups.map(([name, items], index) => {
          const meta = metaOf(name)
          const paused = items.filter((entry) => entry.active === false).length
          return (
            <article className="group-card" key={name}>
              <div className="group-card-top">
                <div className="group-card-icon" style={isHexColor(meta?.color) ? { borderColor: meta.color } : undefined}>
                  {meta?.icon ? <GroupIcon icon={meta.icon} /> : <span aria-hidden="true">▦</span>}
                </div>
                <div className="group-card-title">
                  <h3>{name}</h3>
                  <p>{items.length} {items.length === 1 ? 'page' : 'pages'}{paused > 0 && <> · {paused} paused</>}</p>
                </div>
              </div>
              <div className="group-card-actions">
                <button className="btn group-edit" disabled={busy} onClick={() => { setError(''); setEditing({ current: name, name, selected: new Set(items.map((e) => e.url)) }) }}>Edit group</button>
                {items.length > 0 && (paused < items.length
                  ? <button className="btn" disabled={busy} onClick={() => void setActive(items, false)}>Pause all</button>
                  : <button className="btn" disabled={busy} onClick={() => void setActive(items, true)}>Resume all</button>)}
              </div>
              <details className="group-settings">
                <summary>Group settings</summary>
                <div className="group-settings-body">
                  {groupsReady && <>
                    <div className="group-setting-fields">
                      <label>Colour
                        <select aria-label={`Colour of ${name}`} value={meta?.color ?? ''} onChange={(e) => style(name, { color: e.target.value || null })}>
                          {GROUP_COLORS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </label>
                      <label>Emoji
                        <input key={meta?.icon ?? ''} aria-label={`Emoji of ${name}`} maxLength={4} placeholder="Emoji" defaultValue={isImageIcon(meta?.icon) ? '' : meta?.icon ?? ''} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== (meta?.icon ?? '')) style(name, { icon: v }) }} />
                      </label>
                    </div>
                    <div className="group-setting-actions">
                      <label className="btn group-logo-upload" title="Upload a logo (PNG, JPG, SVG, WebP)">Upload logo<input type="file" accept="image/*" hidden disabled={busy} onChange={(e) => { void uploadLogo(name, e.target.files?.[0]); e.target.value = '' }} /></label>
                      {meta?.icon && <button className="link" disabled={busy} onClick={() => style(name, { icon: null })}>Remove icon</button>}
                    </div>
                    <div className="group-setting-actions">
                      <span className="group-setting-label">Order</span>
                      <button className="btn" aria-label={`Move ${name} up`} disabled={busy || index === 0} onClick={() => move(name, -1)}>↑ Move up</button>
                      <button className="btn" aria-label={`Move ${name} down`} disabled={busy || index === groups.length - 1} onClick={() => move(name, 1)}>↓ Move down</button>
                    </div>
                  </>}
                  {name !== DEFAULT_GROUP && <div className="group-dissolve">
                    <button className="link danger" disabled={busy} onClick={() => void dissolve(name)}>Dissolve group</button>
                    <span>Pages are kept in General.</span>
                  </div>}
                  {!groupsReady && name === DEFAULT_GROUP && <p className="muted">Group appearance and ordering are not available.</p>}
                </div>
              </details>
            </article>
          )
        })}
      </div>
    </div>
  )
}
