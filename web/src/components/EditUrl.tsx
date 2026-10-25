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
    if (!data?.length) return setError('Keine Änderung gespeichert. Fehlt die Policy „admins update urls“ (supabase/schema.sql)?')
    onSaved()
  }
  return (
    <form className="panel add-panel edit-panel" onSubmit={(e) => { e.preventDefault(); void save() }}>
      <p className="grow edit-title">Bearbeiten: <a href={entry.url} target="_blank" rel="noreferrer noopener">{entry.url}</a></p>
      <label className="grow">Name<input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Seitentitel" /></label>
      <label>Gruppe<input value={form.group} onChange={(e) => set({ group: e.target.value })} /></label>
      <label className="grow">Selector<input value={form.selector} onChange={(e) => set({ selector: e.target.value })} placeholder="auto, CSS-Selector oder leer = ganze Seite" /></label>
      <label>Prüfung<select value={form.interval} onChange={(e) => set({ interval: e.target.value })}>
        <option value="">Bei jedem Lauf</option><option value="daily">Täglich</option><option value="weekly">Wöchentlich</option>
      </select></label>
      <label className="grow">Ignore (ein Regex pro Zeile)<textarea rows={3} value={form.ignore} onChange={(e) => set({ ignore: e.target.value })} placeholder="z. B. Last updated.*" /></label>
      {suggestions.length > 0 && (
        <div className="grow suggestions">
          <strong>Ignore-Vorschläge</strong> <span className="muted">(wiederkehrende Zeilen, die sich nur in Zahlen unterscheiden)</span>
          {suggestions.slice(0, 5).map((s) => (
            <div key={s.pattern} className="suggestion">
              <code>{s.pattern}</code>
              <span className="muted">z. B. „{s.example.slice(0, 60)}“, in {s.count} Änderungen</span>
              <button className="btn" type="button" onClick={() => set({ ignore: [...patterns, s.pattern].join('\n') })}>Übernehmen</button>
            </div>
          ))}
        </div>
      )}
      <label className="check"><input type="checkbox" checked={form.js} onChange={(e) => set({ js: e.target.checked })} />Mit JavaScript rendern</label>
      <label className="check"><input type="checkbox" checked={form.onlyAdded} onChange={(e) => set({ onlyAdded: e.target.checked })} />Nur Hinzugefügtes melden</label>
      <label className="check"><input type="checkbox" checked={form.paused} onChange={(e) => set({ paused: e.target.checked })} />Pausiert (wird nicht geprüft)</label>
      <PreviewBox preview={preview} js={form.js} />
      <div className="add-actions">
        <button className="btn primary" type="submit" disabled={busy}>Speichern</button>
        <button className="btn" type="button" onClick={onClose}>Abbrechen</button>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  )
}
