import { useState } from 'react'
import { supabase } from '../supabase'

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const submit = async (signUp: boolean) => {
    const creds = { email, password }
    const { error } = signUp
      ? await supabase.auth.signUp(creds)
      : await supabase.auth.signInWithPassword(creds)
    setError(error?.message ?? (signUp ? 'Bitte E-Mail prüfen, falls eine Bestätigung nötig ist.' : ''))
  }
  return (
    <div className="auth-wrap">
      <form className="panel auth-card" onSubmit={(e) => { e.preventDefault(); void submit(false) }}>
        <div className="auth-head">
          <div>
            <h2>Willkommen zurück</h2>
            <p>Melde dich an, um die Watchlist zu sehen.</p>
          </div>
        </div>
        <label>E-Mail<input type="email" placeholder="du@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Passwort<input type="password" placeholder="Dein Passwort" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <button className="btn primary" type="submit">Anmelden</button>
        <button className="link" type="button" onClick={() => void submit(true)}>Konto erstellen</button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  )
}
