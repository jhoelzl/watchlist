import { describe, expect, it } from 'vitest'
import { corsFor, isAllowedOrigin } from '../../../supabase/functions/_shared/cors'

describe('edge function CORS', () => {
  it.each(['capacitor://localhost', 'https://jhoelzl.github.io', 'http://localhost:5173'])('allows %s', (origin) => {
    const request = new Request('https://example.com', { headers: { Origin: origin } })
    expect(isAllowedOrigin(request)).toBe(true)
    expect(corsFor(request)['Access-Control-Allow-Origin']).toBe(origin)
    expect(corsFor(request)['Access-Control-Allow-Headers']).toContain('authorization')
  })

  it.each(['https://example.com', 'capacitor://localhost.evil.example', 'null'])('rejects %s', (origin) => {
    const request = new Request('https://example.com', { headers: { Origin: origin } })
    expect(isAllowedOrigin(request)).toBe(false)
    expect(corsFor(request)['Access-Control-Allow-Origin']).toBeUndefined()
  })

  it('continues to permit requests without an Origin header', () => {
    const request = new Request('https://example.com')
    expect(isAllowedOrigin(request)).toBe(true)
    expect(corsFor(request)['Access-Control-Allow-Origin']).toBeUndefined()
  })
})
