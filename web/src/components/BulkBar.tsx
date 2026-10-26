import { useState } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../toast'
import { BULK_OPTIONS, applyBulkOption, type Entry } from '../lib/watchlist'

type Props = {
  selected: Entry[]
  groups: string[]
  checkBusy: boolean
  onCheck: (urls: string[]) => void
  onClear: () => void
  onChanged: () => void
}

export function BulkBar({ selected, groups, checkBusy, onCheck, onClear, onChanged }: Props) {
  const notify = useToast()
  const [group, setGroup] = useState('')
  const [option, setOption] = useState('')
  const [busy, setBusy] = useState(false)
  if (!selected.length) return null
  const urls = selected.map((e) => e.url)

  const run = async (what: string, work: () => Promise<string | null>) => {
    setBusy(true)
    const error = await work()
    setBusy(false)
    if (error) return notify(`${what} failed: ${error}`, { kind: 'error' })
    notify(`${what}: ${selected.length} ${selected.length === 1 ? 'URL' : 'URLs'}.`)
    onChanged()
  }
  const setActive = (active: boolean) =>
    run(active ? 'Resume' : 'Pause', async () => {
      const { data, error } = await supabase.from('watchlist_urls').update({ active }).in('url', urls).select('url')
      return error?.message ?? (data?.length ? null : 'No change saved (policy “admins update urls” missing?)')
    })
  const move = () =>
    run(`Move to “${group.trim() || 'General'}”`, async () => {
      const { data, error } = await supabase.from('watchlist_urls').update({ grp: group.trim() || null }).in('url', urls).select('url')
      if (!error) setGroup('')
      return error?.message ?? (data?.length ? null : 'No change saved')
    })
  const setOpt = () => {
    const opt = BULK_OPTIONS.find((o) => o.id === option)
    if (!opt) return
    return run(opt.label, async () => {
      const results = await Promise.all(selected.map((e) => supabase.from('watchlist_urls').update({ options: applyBulkOption(e.options ?? {}, opt) }).eq('url', e.url).select('url')))
      const failed = results.find((r) => r.error || !r.data?.length)
      if (!failed) setOption('')
      return failed ? (failed.error?.message ?? 'No change saved') : null
    })
  }

  return (
    <div className="bulk-bar" role="region" aria-label="Bulk actions">
      <strong>{selected.length} selected</strong>
      <button className="btn" disabled={checkBusy} onClick={() => onCheck(urls)}>↻ Check now</button>
      <button className="btn" disabled={busy} onClick={() => void setActive(false)}>Pause</button>
      <button className="btn" disabled={busy} onClick={() => void setActive(true)}>Resume</button>
      <span className="bulk-field">
        <input list="bulk-groups" value={group} onChange={(e) => setGroup(e.target.value)} placeholder="Group (empty = General)" aria-label="Target group" />
        <datalist id="bulk-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
        <button className="btn" disabled={busy} onClick={() => void move()}>Move</button>
      </span>
      <span className="bulk-field">
        <select value={option} onChange={(e) => setOption(e.target.value)} aria-label="Option to set" style={{ width: 'auto' }}>
          <option value="">Set option …</option>
          {BULK_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <button className="btn" disabled={busy || !option} onClick={() => void setOpt()}>Apply</button>
      </span>
      <button className="btn" onClick={onClear}>Clear selection</button>
    </div>
  )
}
