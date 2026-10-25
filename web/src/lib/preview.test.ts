import { describe, expect, it } from 'vitest'
import { analyze, type Doc } from '../../../supabase/functions/watchlist-preview/analyze.ts'

// Minimal DOM: selector -> text; "total" is the text of the whole page.
function fakeDoc(total: string, nodes: Record<string, string>): Doc {
  const el = (text: string) => ({ textContent: text, remove() {} })
  return {
    title: ' My  Page ',
    documentElement: el(total),
    querySelector: (sel: string) => {
      if (sel === 'broken[') throw new Error('invalid selector')
      return sel in nodes ? el(nodes[sel]) : null
    },
    querySelectorAll: () => [],
  }
}

const PAGE = 'x'.repeat(1000)

describe('analyze (selector preview)', () => {
  it('auto picks the first sufficiently large candidate', () => {
    const p = analyze(fakeDoc(PAGE, { main: 'y'.repeat(500), article: 'z'.repeat(900) }), 'auto')
    expect(p).toMatchObject({ mode: 'auto', selector: 'main', chars: 500, title: 'My Page' })
  })

  it('auto skips almost empty candidates and falls back to the whole page', () => {
    const p = analyze(fakeDoc(PAGE, { main: 'short' }), 'auto')
    expect(p).toMatchObject({ mode: 'auto', selector: null, chars: 1000 })
    expect(p.candidates).toEqual([{ selector: 'main', chars: 5 }])
  })

  it('custom selector: found, not found and invalid', () => {
    expect(analyze(fakeDoc(PAGE, { '.content': 'abc' }), '.content')).toMatchObject({ found: true, chars: 3 })
    expect(analyze(fakeDoc(PAGE, {}), '.missing')).toMatchObject({ found: false, chars: 0 })
    expect(analyze(fakeDoc(PAGE, {}), 'broken[')).toMatchObject({ found: false })
  })

  it('empty selector means whole page', () => {
    expect(analyze(fakeDoc(PAGE, {}), '')).toMatchObject({ mode: 'page', chars: 1000 })
  })
})
