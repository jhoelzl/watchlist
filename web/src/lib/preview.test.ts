import { describe, expect, it } from 'vitest'
import { analyze, type Doc } from '../../../supabase/functions/watchlist-preview/analyze.ts'

// Minimales DOM: Selector -> Text; "total" ist der Text der ganzen Seite.
function fakeDoc(total: string, nodes: Record<string, string>): Doc {
  const el = (text: string) => ({ textContent: text, remove() {} })
  return {
    title: ' Meine  Seite ',
    documentElement: el(total),
    querySelector: (sel: string) => {
      if (sel === 'kaputt[') throw new Error('invalid selector')
      return sel in nodes ? el(nodes[sel]) : null
    },
    querySelectorAll: () => [],
  }
}

const PAGE = 'x'.repeat(1000)

describe('analyze (Selector-Vorschau)', () => {
  it('auto nimmt den ersten ausreichend großen Kandidaten', () => {
    const p = analyze(fakeDoc(PAGE, { main: 'y'.repeat(500), article: 'z'.repeat(900) }), 'auto')
    expect(p).toMatchObject({ mode: 'auto', selector: 'main', chars: 500, title: 'Meine Seite' })
  })

  it('auto überspringt fast leere Kandidaten und fällt auf die ganze Seite zurück', () => {
    const p = analyze(fakeDoc(PAGE, { main: 'kurz' }), 'auto')
    expect(p).toMatchObject({ mode: 'auto', selector: null, chars: 1000 })
    expect(p.candidates).toEqual([{ selector: 'main', chars: 4 }])
  })

  it('eigener Selector: gefunden, nicht gefunden und ungültig', () => {
    expect(analyze(fakeDoc(PAGE, { '.inhalt': 'abc' }), '.inhalt')).toMatchObject({ found: true, chars: 3 })
    expect(analyze(fakeDoc(PAGE, {}), '.fehlt')).toMatchObject({ found: false, chars: 0 })
    expect(analyze(fakeDoc(PAGE, {}), 'kaputt[')).toMatchObject({ found: false })
  })

  it('leerer Selector bedeutet ganze Seite', () => {
    expect(analyze(fakeDoc(PAGE, {}), '')).toMatchObject({ mode: 'page', chars: 1000 })
  })
})
