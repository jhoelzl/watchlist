import { useState } from 'react'
import { supabase } from '../supabase'

type Shots = { img_before: string | null; img_after: string | null }

export function ScreenshotCompare({ url }: { url: string }) {
  const [shots, setShots] = useState<Shots | null | 'none'>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = async () => {
    setBusy(true)
    const { data, error: failed } = await supabase.from('watchlist_screenshots').select('img_before, img_after').eq('url', url).maybeSingle()
    setBusy(false)
    if (failed) return setError(failed.message)
    setShots(data ? (data as Shots) : 'none')
  }
  if (shots === null) {
    return (
      <p>
        <button className="btn" type="button" disabled={busy} onClick={() => void load()}>{busy ? 'Loading …' : 'Compare screenshots'}</button>
        {error && <span className="error"> {error}</span>}
      </p>
    )
  }
  if (shots === 'none' || !shots.img_after) return <p className="muted">No screenshot stored yet.</p>
  const src = (b64: string) => `data:image/jpeg;base64,${b64}`
  return (
    <div className="shots">
      <figure>
        <figcaption>Before</figcaption>
        {shots.img_before ? <img src={src(shots.img_before)} alt="Screenshot before the change" /> : <p className="muted">No earlier screenshot (first capture).</p>}
      </figure>
      <figure>
        <figcaption>After</figcaption>
        <img src={src(shots.img_after)} alt="Screenshot after the change" />
      </figure>
    </div>
  )
}
