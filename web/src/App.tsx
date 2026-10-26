import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import './App.css'
import { Dashboard } from './components/Dashboard'
import { Login } from './components/Login'
import { ToastHost } from './components/ToastHost'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const [homeRequest, setHomeRequest] = useState(0)
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true) })
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])
  if (!ready) return null
  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="header-inner">
          <h1 className="brand-heading">
            <button className="brand" aria-label="Go to Watchlist overview and refresh data" disabled={!session} onClick={() => setHomeRequest((request) => request + 1)}>
              <span className="brand-mark" aria-hidden="true">◎</span><span className="brand-name">Watchlist</span>
            </button>
          </h1>
          {session && <button className="link" onClick={() => void supabase.auth.signOut()}>Sign out</button>}
        </div>
      </header>
      <ToastHost>
        <main>{session ? <Dashboard homeRequest={homeRequest} /> : <Login />}</main>
      </ToastHost>
    </div>
  )
}
