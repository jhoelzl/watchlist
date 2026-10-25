import { describe, expect, it } from 'vitest'
import { groupChange, dayLabel, fragmentUrl, groupByDay, inPeriod, parseStamp, annotateDiff, countLines, summarize, buildRow, diffClass, groupEntries, groupOf, matches, toEntries, exportUrls, parseImport, applyEdit, toEditForm, buildHash, parseView, orderGroups, moveGroup, isHexColor, runPhase, isStuck, suggestIgnores, runStats, formatDuration, sideBySide, sortEntries, nextSort, pickView, dailyCounts, sparkBars, heatmap, type Entry } from './watchlist'

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

  it('gesetzter Name hat Vorrang vor dem Seitentitel aus dem Status', () => {
    const e = toEntries([{ url: 'https://a', name: 'Mein Name', grp: '' }], { 'https://a': { name: 'Seitentitel', status: 'ok' } })
    expect(e[0].name).toBe('Mein Name')
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

  it('groups entries sorted ascending by name', () => {
    const groups = groupEntries([entry({ group: 'B' }), entry({ group: 'A', url: 'x' }), entry({ group: 'B', url: 'y' })])
    expect(groups.map(([g, items]) => [g, items.length])).toEqual([['A', 1], ['B', 2]])
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
      total: 5, problems: 2, ok: 2, new: 0, error: 1, warn: 1, pending: 1, paused: 0,
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

describe('groupChange', () => {
  const e = (url: string, group: string) => ({ url, group }) as Entry
  const entries = [e('a', 'X'), e('b', 'X'), e('c', 'Allgemein')]

  it('renames and moves members', () => {
    const r = groupChange(entries, 'X', ' Neu ', new Set(['a', 'c']))
    expect(r.grp).toBe('Neu')
    expect(r.assign.sort()).toEqual(['a', 'c'])
    expect(r.clear).toEqual(['b'])
  })

  it('maps Allgemein to null and empty selection clears all', () => {
    expect(groupChange(entries, 'X', 'Allgemein', new Set(['a'])).grp).toBeNull()
    expect(groupChange(entries, 'X', 'X', new Set()).clear.sort()).toEqual(['a', 'b'])
  })
})

describe('fragmentUrl Auswahl', () => {
  it('bevorzugt die längste schlichte Zeile und bei Feeds den Eintragslink', () => {
    expect(fragmentUrl('https://a', '+Kurz & knapp <b>\n+Eine schlichte Zeile mit Text\n+Noch eine deutlich längere schlichte Zeile hier'))
      .toBe('https://a#:~:text=Noch%20eine%20deutlich%20l%C3%A4ngere%20schlichte%20Zeile%20hier')
    expect(fragmentUrl('https://a', '+Ganz langer Satz mit & vielen <Sonderzeichen> hier\n+Schlicht aber kurz')).toContain('text=Schlicht%20aber%20kurz')
    expect(fragmentUrl('https://a/feed', '+2026-01-01 | Neuer Beitrag | https://a/post/1 | Zusammenfassung')).toBe('https://a/post/1')
  })
})

describe('Export/Import', () => {
  const rows = [
    { url: 'https://a/x', name: 'A', grp: 'Azure', options: { selector: 'main', js: true } },
    { url: 'https://b', name: null, grp: null, options: null },
  ]
  it('exportiert im urls.yml-Format und liest es wieder ein', () => {
    for (const format of ['yaml', 'json'] as const) {
      const out = parseImport(exportUrls(rows, format), [])
      expect(out.errors).toEqual([])
      expect(out.rows.map((r) => [r.url, r.name, r.grp, r.options])).toEqual([
        ['https://a/x', 'A', 'Azure', { selector: 'main', js: true }],
        ['https://b', null, null, {}],
      ])
    }
  })
  it('überspringt vorhandene URLs und meldet Fehler', () => {
    const out = parseImport('- https://a/x\n- ftp://c\n- {name: ohne}\n- https://neu', ['https://a/x'])
    expect(out.skipped).toBe(1)
    expect(out.rows.map((r) => r.url)).toEqual(['https://neu'])
    expect(out.errors).toHaveLength(2)
  })
  it('akzeptiert Listen, lehnt Unbrauchbares ab', () => {
    expect(parseImport('[', []).errors[0]).toContain('nicht lesbar')
    expect(parseImport('foo: 1', []).errors).toHaveLength(1)
  })
})

describe('URLs bearbeiten', () => {
  const entry = toEntries([{ url: 'https://a', name: 'A', grp: 'G', active: true, options: { selector: 'main', ignore: ['x.*'], min_ratio: 0.5 } }], {})[0]
  it('füllt das Formular aus den Optionen', () => {
    expect(toEditForm(entry)).toMatchObject({ name: 'A', group: 'G', selector: 'main', ignore: 'x.*', js: false, paused: false })
  })
  it('übernimmt Änderungen und behält unbekannte Optionen', () => {
    const form = { ...toEditForm(entry), selector: '', js: true, onlyAdded: true, ignore: ' a+ \n\nb' }
    expect(applyEdit(entry.options ?? {}, form)).toEqual({ options: { ignore: ['a+', 'b'], min_ratio: 0.5, js: true, only_added: true } })
  })
  it('lehnt ungültige Regex ab', () => {
    expect('error' in applyEdit({}, { ...toEditForm(entry), ignore: '(' })).toBe(true)
    expect(applyEdit({}, { ...toEditForm(entry), selector: '', ignore: '', interval: 'weekly' })).toEqual({ options: { interval: 'weekly' } })
    expect(applyEdit({ interval: 'daily' }, { ...toEditForm(entry), selector: '', ignore: '', interval: '' })).toEqual({ options: {} })
  })
  it('pausierte URLs bekommen den Status "paused"', () => {
    expect(toEntries([{ url: 'https://a', name: null, grp: null, active: false }], { 'https://a': { status: 'ok' } })[0].status).toBe('paused')
  })
})

describe('view hash', () => {
  it('roundtrip', () => {
    const v = { tab: 'changes' as const, group: 'Azure & Co', status: 'problem' as const, period: '7d' as const, query: 'a b', sort: { key: 'changed' as const, desc: true } }
    expect(parseView(buildHash(v))).toEqual(v)
  })
  it('default ist leer', () => {
    expect(buildHash(parseView(''))).toBe('')
  })
  it('ungültige Werte und altes Mail-Format', () => {
    expect(parseView('#t=x&s=zzz&p=1y').tab).toBe('urls')
    expect(parseView('#s=zzz').status).toBe('')
    expect(parseView('#changes:https%3A%2F%2Fa.de').tab).toBe('changes')
  })
})

describe('group order', () => {
  const e = (url: string, group: string) => ({ url, group }) as Entry
  const entries = [e('1', 'B'), e('2', 'A'), e('3', 'C')]
  it('nutzt gespeicherte Reihenfolge, Rest alphabetisch', () => {
    const metas = [{ name: 'C', position: 0, color: null, icon: null }]
    expect(orderGroups(entries, metas).map(([n]) => n)).toEqual(['C', 'A', 'B'])
  })
  it('leere Gruppen optional', () => {
    const metas = [{ name: 'Leer', position: 0, color: null, icon: null }]
    expect(orderGroups(entries, metas).map(([n]) => n)).toEqual(['Leer', 'A', 'B', 'C'])
    expect(orderGroups(entries, metas, false).map(([n]) => n)).toEqual(['A', 'B', 'C'])
  })
  it('moveGroup und Farbprüfung', () => {
    expect(moveGroup(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(moveGroup(['a', 'b'], 'a', -1)).toEqual(['a', 'b'])
    expect(isHexColor('#2563eb')).toBe(true)
    expect(isHexColor('red;x')).toBe(false)
  })
})

describe('Fehlerserie', () => {
  const e = (status: Entry['status'], streak?: number) => ({ url: 'u', name: 'n', group: 'G', checked: '', changed: '', error: '', status, streak }) as Entry
  it('dauerhaft kaputt ab 6 Läufen', () => {
    expect(isStuck(e('error', 6))).toBe(true)
    expect(isStuck(e('warn', 7))).toBe(true)
    expect(isStuck(e('error', 5))).toBe(false)
    expect(isStuck(e('ok', 9))).toBe(false)
  })
  it('Filter stuck', () => {
    expect(matches({ ...e('error', 6), text: '' }, '', '', 'stuck')).toBe(true)
    expect(matches({ ...e('error', 2), text: '' }, '', '', 'stuck')).toBe(false)
  })
})

describe('suggestIgnores', () => {
  const d = (a: string, b: string) => `@@ -1 +1 @@\n-${a}\n+${b}\n Rest`
  it('erkennt wiederkehrende Zählerzeilen und erzeugt passende Regex', () => {
    const s = suggestIgnores([d('Besucher: 100', 'Besucher: 101'), d('Besucher: 101', 'Besucher: 105'), d('alt', 'neu')])
    expect(s).toHaveLength(1)
    expect(s[0].count).toBe(2)
    expect(new RegExp(s[0].pattern).test('Besucher: 4711')).toBe(true)
    expect(new RegExp(s[0].pattern).test('Besucher: abc')).toBe(false)
  })
  it('maskiert Sonderzeichen und Datumsformate', () => {
    const s = suggestIgnores([d('Stand 01.02.2026 (a+b)', 'Stand 02.02.2026 (a+b)'), d('Stand 03.02.2026 (a+b)', 'Stand 04.02.2026 (a+b)')])
    expect(s[0].pattern).toBe('Stand\\s+\\d+\\.\\d+\\.\\d+\\s+\\(a\\+b\\)')
  })
  it('ignoriert einmalige Zeilen und bereits abgedeckte Muster', () => {
    expect(suggestIgnores([d('Preis 10', 'Preis 11')])).toEqual([])
    const two = [d('Zähler 1', 'Zähler 2'), d('Zähler 3', 'Zähler 4')]
    expect(suggestIgnores(two, ['Zähler \\d+'])).toEqual([])
    expect(suggestIgnores(two, ['(kaputt'])).toHaveLength(1)
  })
})

describe('Laufhistorie', () => {
  const run = (seconds: number, total: number, errors: number, warns: number, ok = true) => ({ time: 't', seconds, total, errors, warns, changes: 0, ok })
  it('Durchschnitt und Fehlerquote', () => {
    const s = runStats([run(10, 10, 1, 0), run(30, 10, 0, 1, false)])
    expect(s).toEqual({ avgSeconds: 20, errorRate: 0.1, failedRuns: 1 })
    expect(runStats([])).toEqual({ avgSeconds: 0, errorRate: 0, failedRuns: 0 })
  })
  it('Dauer formatieren', () => {
    expect(formatDuration(42.4)).toBe('42 s')
    expect(formatDuration(125)).toBe('2 min 5 s')
  })
})

describe('sideBySide', () => {
  const txt = (r: { left: { text: string }[] | null; right: { text: string }[] | null }) => [r.left?.map((x) => x.text).join('') ?? null, r.right?.map((x) => x.text).join('') ?? null]
  it('paart ersetzte Zeilen und lässt Rest leer', () => {
    const rows = sideBySide(['@@ -1,3 +1,4 @@', ' gleich', '-alt eins', '-alt zwei', '+neu eins'])
    expect(rows.map((r) => r.kind)).toEqual(['hunk', 'ctx', 'chg', 'chg'])
    expect(txt(rows[1])).toEqual(['gleich', 'gleich'])
    expect(txt(rows[2])).toEqual(['alt eins', 'neu eins'])
    expect(txt(rows[3])).toEqual(['alt zwei', null])
  })
  it('reine Einfügungen stehen rechts', () => {
    const rows = sideBySide(['+a', '+b'])
    expect(rows.map(txt)).toEqual([[null, 'a'], [null, 'b']])
  })
})

describe('Sortierung', () => {
  const e = (name: string, status: Entry['status'], changed = '', checked = '') => ({ url: name, name, group: 'G', checked, changed, error: '', status }) as Entry
  const items = [e('B', 'ok', '2026-10-24 06:00 UTC'), e('A', 'error'), e('C', 'ok', '2026-10-25 06:00 UTC')]
  const names = (s: Parameters<typeof sortEntries>[1]) => sortEntries(items, s).map((x) => x.name)
  it('nach Name und Status', () => {
    expect(names({ key: 'name', desc: true })).toEqual(['C', 'B', 'A'])
    expect(names({ key: 'status', desc: false })).toEqual(['A', 'B', 'C'])
  })
  it('Zeit: leere Werte immer am Ende', () => {
    expect(names({ key: 'changed', desc: false })).toEqual(['B', 'C', 'A'])
    expect(names({ key: 'changed', desc: true })).toEqual(['C', 'B', 'A'])
  })
  it('Standard ohne Schlüssel und Klick-Reihenfolge', () => {
    expect(names({ key: '', desc: false })).toEqual(['B', 'A', 'C'])
    const s1 = nextSort({ key: '', desc: false }, 'name')
    const s2 = nextSort(s1, 'name')
    expect([s1.desc, s2.desc, nextSort(s2, 'name').key]).toEqual([false, true, ''])
  })
})

describe('runPhase', () => {
  const run = (id: number, status: string, conclusion: string | null = null) => ({ id, status, conclusion, url: '' })
  it('wartet auf neuen Lauf', () => {
    expect(runPhase(null, 5)).toBe('waiting')
    expect(runPhase(run(5, 'completed', 'success'), 5)).toBe('waiting')
  })
  it('läuft, fertig, Fehler', () => {
    expect(runPhase(run(6, 'in_progress'), 5)).toBe('running')
    expect(runPhase(run(6, 'completed', 'success'), 5)).toBe('success')
    expect(runPhase(run(6, 'completed', 'failure'), 5)).toBe('failed')
  })
})

describe('pickView', () => {
  const stored = { view: { tab: 'groups' as const, group: 'A', status: '' as const, period: '' as const, query: '', sort: { key: '' as const, desc: false } }, collapsed: [] }
  it('Hash hat Vorrang, sonst gespeicherte Ansicht', () => {
    expect(pickView('#t=changes', stored).tab).toBe('changes')
    expect(pickView('', stored).tab).toBe('groups')
    expect(pickView('', null).tab).toBe('urls')
  })
})

describe('sparkline', () => {
  const now = new Date('2026-10-25T12:00:00Z')
  it('zählt Änderungen pro Tag', () => {
    const c = dailyCounts(['2026-10-25 06:00 UTC', '2026-10-25 18:00 UTC', '2026-10-24 06:00 UTC', '2026-01-01 06:00 UTC', 'kaputt'], now, 7)
    expect(c).toEqual([0, 0, 0, 0, 0, 1, 2])
  })
  it('Balken nur für Tage mit Änderungen', () => {
    expect(sparkBars([0, 2, 1], 30, 10)).toHaveLength(2)
    expect(sparkBars([0, 0], 30, 10)).toEqual([])
  })
})

describe('heatmap', () => {
  const now = new Date('2026-10-25T12:00:00Z') // Sonntag
  it('endet mit der aktuellen Woche, zählt pro Tag und stuft Stufen', () => {
    const h = heatmap(['2026-10-25 06:00 UTC', '2026-10-25 18:00 UTC', '2026-10-24 06:00 UTC', '2026-10-24 07:00 UTC', '2026-10-23 06:00 UTC', '2026-10-22 06:00 UTC', '2026-10-21 06:00 UTC', 'kaputt'], now, 4)
    expect(h.columns).toHaveLength(4)
    const last = h.columns[3]
    expect(last[6]).toMatchObject({ day: '2026-10-25', count: 2 })
    expect(last[5]).toMatchObject({ day: '2026-10-24', count: 2, level: 4 })
    expect(last[4]).toMatchObject({ day: '2026-10-23', count: 1, level: 2 })
    expect(last[0]?.day).toBe('2026-10-19')
    expect(h.columns[0][0]?.day).toBe('2026-09-28')
    expect(h.total).toBe(7)
  })
  it('lässt Tage nach heute und alte Einträge aus', () => {
    const h = heatmap(['2026-01-01 06:00 UTC'], new Date('2026-10-21T12:00:00Z'), 2)
    expect(h.columns[1].slice(3)).toEqual([null, null, null, null])
    expect(h.total).toBe(0)
  })
})
