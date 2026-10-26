import { useState } from 'react'
import { supabase } from '../supabase'
import { buildRow, type Entry, type Prefill } from '../lib/watchlist'
import { PreviewBox, usePreview } from './PreviewBox'

const EMPTY_FORM = { url: '', name: '', group: '', selector: 'auto', js: false }

export function AddUrl({ entries, open, setOpen, onAdded, prefill }: { entries: Entry[]; open: boolean; setOpen: (open: boolean) => void; onAdded: () => void; prefill?: Prefill | null }) {
  const [form, setForm] = useState(() => (prefill ? { ...EMPTY_FORM, ...prefill } : EMPTY_FORM))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const groups = [...new Set(entries.map((e) => e.group))]
  const preview = usePreview(form.url, form.selector, open)
  const set = (patch: Partial<typeof EMPTY_FORM>) => setForm((f) => ({ ...f, ...patch }))
  const submit = async () => {
    const built = buildRow(form, entries.map((e) => e.url), entries.length + 1)
    if ('error' in built) return setError(built.error)
    setBusy(true)
    const { error: failed } = await supabase.from('watchlist_urls').insert(built.row)
    setBusy(false)
    if (failed) return setError(failed.message)
    setForm(EMPTY_FORM)
    setError('')
    setOpen(false)
    onAdded()
  }
  if (!open) return null
  return (
    <form className="panel add-panel" onSubmit={(e) => { e.preventDefault(); void submit() }}>
      <label className="grow">URL<input type="url" placeholder="https://…" value={form.url} onChange={(e) => set({ url: e.target.value })} required autoFocus /></label>
      <label>Name (optional)<input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Page title" /></label>
      <label>Group<input list="groups" value={form.group} onChange={(e) => set({ group: e.target.value })} /></label>
      <datalist id="groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
      <label>Selector<input value={form.selector} onChange={(e) => set({ selector: e.target.value })} placeholder="auto = detect the matching area, empty = whole page" /></label>
      <label className="check"><input type="checkbox" checked={form.js} onChange={(e) => set({ js: e.target.checked })} />Render with JavaScript</label>
      <PreviewBox preview={preview} js={form.js} />
      <div className="add-actions">
        <button className="btn primary" type="submit" disabled={busy}>Save</button>
        <button className="btn" type="button" onClick={() => { setOpen(false); setError('') }}>Cancel</button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  )
}
