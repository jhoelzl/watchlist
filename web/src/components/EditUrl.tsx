import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../supabase'
import { applyEdit, suggestIgnores, toEditForm, type EditForm, type Entry } from '../lib/watchlist'
import { PreviewBox, usePreview } from './PreviewBox'

export function EditUrl({ entry, onClose, onSaved }: { entry: Entry; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<EditForm>(() => toEditForm(entry))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const preview = usePreview(entry.url, form.selector, true)
  const [diffs, setDiffs] = useState<string[]>([])
  useEffect(() => {
    let stale = false
    void supabase.from('watchlist_history').select('diff').eq('url', entry.url).order('id', { ascending: false }).limit(50)
      .then(({ data: rows }) => { if (!stale) setDiffs((rows ?? []).map((r) => r.diff as string)) })
    return () => { stale = true }
  }, [entry.url])
  const patterns = form.ignore.split('\n').map((l) => l.trim()).filter(Boolean)
  const suggestions = useMemo(() => suggestIgnores(diffs, patterns), [diffs, form.ignore])
  const set = (patch: Partial<EditForm>) => setForm((f) => ({ ...f, ...patch }))
  const save = async () => {
    const built = applyEdit(entry.options ?? {}, form)
    if ('error' in built) return setError(built.error)
    setBusy(true)
    const { data, error: failed } = await supabase
      .from('watchlist_urls')
      .update({ name: form.name.trim() || null, grp: form.group.trim() || null, options: built.options, active: !form.paused })
      .eq('url', entry.url)
      .select('url')
    setBusy(false)
    if (failed) return setError(failed.message)
    if (!data?.length) return setError('No change saved. Is the “admins update urls” policy missing (supabase/schema.sql)?')
    onSaved()
  }
  return (
    <form className="panel add-panel edit-panel" onSubmit={(e) => { e.preventDefault(); void save() }}>
      <p className="grow edit-title">Edit: <a href={entry.url} target="_blank" rel="noreferrer noopener">{entry.url}</a></p>
      <label className="grow">Name<input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Page title" /></label>
      <label>Group<input value={form.group} onChange={(e) => set({ group: e.target.value })} /></label>
      <label className="grow">Selector<input value={form.selector} onChange={(e) => set({ selector: e.target.value })} placeholder="auto, CSS selector or empty = whole page" /></label>
      <label>Check<select value={form.interval} onChange={(e) => set({ interval: e.target.value })}>
        <option value="">On every run</option><option value="daily">Daily</option><option value="weekly">Weekly</option>
      </select></label>
      <label className="grow">Ignore (one regex per line)<textarea rows={3} value={form.ignore} onChange={(e) => set({ ignore: e.target.value })} placeholder="e.g. Last updated.*" /></label>
      {suggestions.length > 0 && (
        <div className="grow suggestions">
          <strong>Ignore suggestions</strong> <span className="muted">(recurring lines that differ only in numbers)</span>
          {suggestions.slice(0, 5).map((s) => (
            <div key={s.pattern} className="suggestion">
              <code>{s.pattern}</code>
              <span className="muted">e.g. “{s.example.slice(0, 60)}”, in {s.count} changes</span>
              <button className="btn" type="button" onClick={() => set({ ignore: [...patterns, s.pattern].join('\n') })}>Apply</button>
            </div>
          ))}
        </div>
      )}
      <label className="check"><input type="checkbox" checked={form.js} onChange={(e) => set({ js: e.target.checked })} />Render with JavaScript</label>
      <label className="check"><input type="checkbox" checked={form.onlyAdded} onChange={(e) => set({ onlyAdded: e.target.checked })} />Report additions only</label>
      <label className="check"><input type="checkbox" checked={form.paused} onChange={(e) => set({ paused: e.target.checked })} />Paused (not checked)</label>
      <PreviewBox preview={preview} js={form.js} />
      <div className="add-actions">
        <button className="btn primary" type="submit" disabled={busy}>Save</button>
        <button className="btn" type="button" onClick={onClose}>Cancel</button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  )
}
