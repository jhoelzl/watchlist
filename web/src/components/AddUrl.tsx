import { useState } from 'react'
import { supabase } from '../supabase'
import { buildRow, type Entry } from '../lib/watchlist'
import { PreviewBox, usePreview } from './PreviewBox'

const EMPTY_FORM = { url: '', name: '', group: '', selector: 'auto', js: false }

export function AddUrl({ entries, open, setOpen, onAdded }: { entries: Entry[]; open: boolean; setOpen: (open: boolean) => void; onAdded: () => void }) {
  const [form, setForm] = useState(EMPTY_FORM)
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
      <label>Name (optional)<input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Seitentitel" /></label>
      <label>Gruppe<input list="groups" value={form.group} onChange={(e) => set({ group: e.target.value })} /></label>
      <datalist id="groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
      <label>Selector<input value={form.selector} onChange={(e) => set({ selector: e.target.value })} placeholder="auto = passenden Bereich erkennen, leer = ganze Seite" /></label>
      <label className="check"><input type="checkbox" checked={form.js} onChange={(e) => set({ js: e.target.checked })} />Mit JavaScript rendern</label>
      <PreviewBox preview={preview} js={form.js} />
      <div className="add-actions">
        <button className="btn primary" type="submit" disabled={busy}>Speichern</button>
        <button className="btn" type="button" onClick={() => { setOpen(false); setError('') }}>Abbrechen</button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  )
}
