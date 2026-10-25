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
    setError(error?.message ?? (signUp ? 'Please check your email in case a confirmation is required.' : ''))
  }
  return (
    <div className="auth-wrap">
      <form className="panel auth-card" onSubmit={(e) => { e.preventDefault(); void submit(false) }}>
        <div className="auth-head">
          <div>
            <h2>Welcome back</h2>
            <p>Sign in to see the watchlist.</p>
          </div>
        </div>
        <label>Email<input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Password<input type="password" placeholder="Your password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <button className="btn primary" type="submit">Sign in</button>
        <button className="link" type="button" onClick={() => void submit(true)}>Create account</button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  )
}
