import { useState } from 'react'
import { supabase } from '../supabase'
import { applyFix, type Entry } from '../lib/watchlist'

const LABEL = { js: 'Enable js: true', url: 'Use the new URL', ignore_robots: 'Set ignore_robots', selector: 'Use selector: auto' } as const

export function DiagnosisHint({ entry, onApplied }: { entry: Entry; onApplied: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const diagnosis = entry.diagnosis
  if (!diagnosis) return null
  const apply = async () => {
    const built = applyFix(entry.options ?? {}, entry.url, diagnosis.fix)
    if ('error' in built) return setError(built.error)
    setBusy(true)
    const { data, error: failed } = await supabase.from('watchlist_urls').update({ url: built.url, options: built.options }).eq('url', entry.url).select('url')
    setBusy(false)
    if (failed) return setError(failed.message)
    if (!data?.length) return setError('No change saved. Is the “admins update urls” policy missing (supabase/schema.sql)?')
    onApplied()
  }
  return (
    <div className="diagnosis">
      <span>💡 {diagnosis.text}</span>
      <button className="btn" type="button" disabled={busy} onClick={() => void apply()}>{LABEL[diagnosis.fix.type]}</button>
      {error && <span className="error"> {error}</span>}
    </div>
  )
}
