import { describe, expect, it } from 'vitest'
import { diffClass, groupEntries, groupOf, matches, toEntries, type Entry } from './watchlist'

const entry = (over: Partial<Entry>): Entry => ({
  url: 'https://a', name: 'A', group: 'G', checked: '', changed: '', status: 'ok', error: '', ...over,
})

describe('watchlist helpers', () => {
  it('uses a default group', () => {
    expect(groupOf('')).toBe('Allgemein')
    expect(groupOf(null)).toBe('Allgemein')
    expect(groupOf('Azure')).toBe('Azure')
  })

  it('turns the status document into entries', () => {
    const entries = toEntries({ 'https://a': { name: 'A', group: '', checked: 'x', changed: '', status: 'ok', error: '' } })
    expect(entries).toEqual([expect.objectContaining({ url: 'https://a', group: 'Allgemein' })])
  })

  it('filters by text, group and status', () => {
    const e = entry({ status: 'warn', error: 'wenig' })
    expect(matches({ ...e, text: e.error }, 'WENIG', '', '')).toBe(true)
    expect(matches(e, 'zzz', '', '')).toBe(false)
    expect(matches(e, '', 'Other', '')).toBe(false)
    expect(matches(e, '', 'G', 'problem')).toBe(true)
    expect(matches(entry({ status: 'ok' }), '', '', 'problem')).toBe(false)
    expect(matches(entry({ status: 'new' }), '', '', 'new')).toBe(true)
  })

  it('does not filter history items by status', () => {
    expect(matches({ url: 'https://a', group: 'G' }, '', '', 'error')).toBe(true)
  })

  it('groups entries in order of appearance', () => {
    const groups = groupEntries([entry({ group: 'B' }), entry({ group: 'A', url: 'x' }), entry({ group: 'B', url: 'y' })])
    expect(groups.map(([g, items]) => [g, items.length])).toEqual([['B', 2], ['A', 1]])
  })

  it('classifies diff lines', () => {
    expect(diffClass('+x')).toBe('add')
    expect(diffClass('-x')).toBe('del')
    expect(diffClass('@@ -1 +1 @@')).toBe('')
  })
})
