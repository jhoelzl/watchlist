import { describe, expect, it } from 'vitest'
import { dayLabel, fragmentUrl, groupByDay, inPeriod, parseStamp, annotateDiff, countLines, summarize, buildRow, diffClass, groupEntries, groupOf, matches, toEntries, type Entry } from './watchlist'

const entry = (over: Partial<Entry>): Entry => ({
  url: 'https://a', name: 'A', group: 'G', checked: '', changed: '', status: 'ok', error: '', ...over,
})

describe('watchlist helpers', () => {
  it('uses a default group', () => {
    expect(groupOf('')).toBe('Allgemein')
    expect(groupOf(null)).toBe('Allgemein')
    expect(groupOf('Azure')).toBe('Azure')
  })

  it('lists configured urls and merges the status', () => {
    const entries = toEntries(
      [{ url: 'https://a', name: null, grp: '' }, { url: 'https://b', name: 'B', grp: 'G' }],
      { 'https://a': { name: 'Titel A', checked: 'x', status: 'ok' } },
    )
    expect(entries[0]).toMatchObject({ url: 'https://a', name: 'Titel A', group: 'Allgemein', status: 'ok', checked: 'x' })
    expect(entries[1]).toMatchObject({ name: 'B', group: 'G', status: 'pending', checked: '' })
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

describe('buildRow', () => {
  const form = { url: ' https://a.example/x ', name: '', group: 'G', selector: 'main', js: false }

  it('builds a row from the form', () => {
    expect(buildRow(form, [], 5)).toEqual({
      row: { url: 'https://a.example/x', name: null, grp: 'G', options: { selector: 'main' }, position: 5 },
    })
    expect(buildRow({ ...form, selector: '', js: true }, [], 1)).toMatchObject({ row: { options: { js: true } } })
  })

  it('rejects invalid, non-http and duplicate urls', () => {
    expect(buildRow({ ...form, url: 'abc' }, [], 1)).toHaveProperty('error')
    expect(buildRow({ ...form, url: 'ftp://a/b' }, [], 1)).toHaveProperty('error')
    expect(buildRow(form, ['https://a.example/x'], 1)).toEqual({ error: 'Diese URL ist schon vorhanden.' })
  })
})

describe('summarize', () => {
  it('counts statuses and problems', () => {
    const e = (status: Entry['status']) => ({ url: status, name: status, group: 'G', checked: '', changed: '', error: '', status }) as Entry
    expect(summarize([e('ok'), e('ok'), e('error'), e('warn'), e('pending')])).toEqual({
      total: 5, problems: 2, ok: 2, new: 0, error: 1, warn: 1, pending: 1,
    })
  })
})

describe('annotateDiff', () => {
  it('marks only the changed words in replaced lines', () => {
    const [header, del, add, plain] = annotateDiff(['@@ -1 +1 @@', '-Preis: 10 Euro', '+Preis: 12 Euro', '-gelöscht'])
    expect(header).toEqual([{ text: '@@ -1 +1 @@', changed: false }])
    expect(del.filter((s) => s.changed)).toEqual([{ text: '10', changed: true }])
    expect(add.filter((s) => s.changed)).toEqual([{ text: '12', changed: true }])
    expect(del.map((s) => s.text).join('')).toBe('-Preis: 10 Euro')
    expect(plain).toEqual([{ text: '-gelöscht', changed: false }])
  })

  it('leaves completely different lines unmarked', () => {
    const [del, add] = annotateDiff(['-alt komplett', '+ganz anders hier'])
    expect(del).toEqual([{ text: '-alt komplett', changed: false }])
    expect(add).toEqual([{ text: '+ganz anders hier', changed: false }])
  })

  it('counts added and removed lines', () => {
    expect(countLines('+a\n+b\n-c\n+++x', '+')).toBe(2)
    expect(countLines('+a\n-c', '-')).toBe(1)
  })
})

describe('period and days', () => {
  const now = new Date('2026-10-25T12:00:00Z')

  it('parses stamps', () => {
    expect(parseStamp('2026-10-23 06:00 UTC')?.toISOString()).toBe('2026-10-23T06:00:00.000Z')
    expect(parseStamp('kaputt')).toBeNull()
  })

  it('filters by period', () => {
    expect(inPeriod('2026-10-25 06:00 UTC', 'today', now)).toBe(true)
    expect(inPeriod('2026-10-24 06:00 UTC', 'today', now)).toBe(false)
    expect(inPeriod('2026-10-20 06:00 UTC', '7d', now)).toBe(true)
    expect(inPeriod('2026-10-10 06:00 UTC', '7d', now)).toBe(false)
    expect(inPeriod('2026-10-10 06:00 UTC', '30d', now)).toBe(true)
    expect(inPeriod('2020-01-01 00:00 UTC', '', now)).toBe(true)
  })

  it('groups by day keeping order', () => {
    const items = [{ time: '2026-10-25 18:00 UTC' }, { time: '2026-10-25 06:00 UTC' }, { time: '2026-10-24 18:00 UTC' }]
    expect(groupByDay(items).map(([d, l]) => [d, l.length])).toEqual([['2026-10-25', 2], ['2026-10-24', 1]])
    expect(dayLabel('2026-10-25')).toContain('2026')
  })
})

describe('fragmentUrl', () => {
  it('points to the first added line', () => {
    expect(fragmentUrl('https://a/x', '@@\n-alt\n+Neue Preise ab 12-Euro, sofort & jetzt')).toBe(
      'https://a/x#:~:text=Neue%20Preise%20ab%2012%2DEuro%2C%20sofort%20%26%20jetzt',
    )
    expect(fragmentUrl('https://a/x#top', '+Ein langer neuer Satz')).toContain('https://a/x#top:~:text=')
    expect(fragmentUrl('https://a/x', '-nur weg\n+kurz')).toBe('https://a/x')
  })
})
