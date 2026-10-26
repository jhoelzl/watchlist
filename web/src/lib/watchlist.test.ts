import { describe, expect, it } from 'vitest'
import { groupChange, dayLabel, fragmentUrl, groupByDay, inPeriod, parseStamp, annotateDiff, countLines, summarize, buildRow, diffClass, groupEntries, groupOf, matches, toEntries, exportUrls, parseImport, applyEdit, toEditForm, buildHash, parseView, orderGroups, moveGroup, isHexColor, runPhase, isStuck, suggestIgnores, noisyUrls, applyFix, runStats, formatDuration, sideBySide, sortEntries, nextSort, pickView, dailyCounts, sparkBars, heatmap, healthRows, healthSummary, formatMs, type Entry } from './watchlist'

const entry = (over: Partial<Entry>): Entry => ({
  url: 'https://a', name: 'A', group: 'G', checked: '', changed: '', status: 'ok', error: '', ...over,
})

describe('watchlist helpers', () => {
  it('uses a default group', () => {
    expect(groupOf('')).toBe('General')
    expect(groupOf(null)).toBe('General')
    expect(groupOf('Azure')).toBe('Azure')
  })

  it('lists configured urls and merges the status', () => {
    const entries = toEntries(
      [{ url: 'https://a', name: null, grp: '' }, { url: 'https://b', name: 'B', grp: 'G' }],
      { 'https://a': { name: 'Title A', checked: 'x', status: 'ok' } },
    )
    expect(entries[0]).toMatchObject({ url: 'https://a', name: 'Title A', group: 'General', status: 'ok', checked: 'x' })
    expect(entries[1]).toMatchObject({ name: 'B', group: 'G', status: 'pending', checked: '' })
  })

  it('a set name takes precedence over the page title from the status', () => {
    const e = toEntries([{ url: 'https://a', name: 'My name', grp: '' }], { 'https://a': { name: 'Page title', status: 'ok' } })
    expect(e[0].name).toBe('My name')
  })

  it('filters by text, group and status', () => {
    const e = entry({ status: 'warn', error: 'little' })
    expect(matches({ ...e, text: e.error }, 'LITTLE', '', '')).toBe(true)
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
    expect(buildRow(form, ['https://a.example/x'], 1)).toEqual({ error: 'This URL already exists.' })
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
    const [header, del, add, plain] = annotateDiff(['@@ -1 +1 @@', '-Price: 10 Euro', '+Price: 12 Euro', '-deleted'])
    expect(header).toEqual([{ text: '@@ -1 +1 @@', changed: false }])
    expect(del.filter((s) => s.changed)).toEqual([{ text: '10', changed: true }])
    expect(add.filter((s) => s.changed)).toEqual([{ text: '12', changed: true }])
    expect(del.map((s) => s.text).join('')).toBe('-Price: 10 Euro')
    expect(plain).toEqual([{ text: '-deleted', changed: false }])
  })

  it('leaves completely different lines unmarked', () => {
    const [del, add] = annotateDiff(['-old completely', '+totally different here'])
    expect(del).toEqual([{ text: '-old completely', changed: false }])
    expect(add).toEqual([{ text: '+totally different here', changed: false }])
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
    expect(parseStamp('broken')).toBeNull()
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
    expect(fragmentUrl('https://a/x', '@@\n-old\n+New prices from 12-Euro, now & today')).toBe(
      'https://a/x#:~:text=New%20prices%20from%2012%2DEuro%2C%20now%20%26%20today',
    )
    expect(fragmentUrl('https://a/x#top', '+A long new sentence')).toContain('https://a/x#top:~:text=')
    expect(fragmentUrl('https://a/x', '-just gone\n+short')).toBe('https://a/x')
  })
})

describe('groupChange', () => {
  const e = (url: string, group: string) => ({ url, group }) as Entry
  const entries = [e('a', 'X'), e('b', 'X'), e('c', 'General')]

  it('renames and moves members', () => {
    const r = groupChange(entries, 'X', ' New ', new Set(['a', 'c']))
    expect(r.grp).toBe('New')
    expect(r.assign.sort()).toEqual(['a', 'c'])
    expect(r.clear).toEqual(['b'])
  })

  it('maps General to null and empty selection clears all', () => {
    expect(groupChange(entries, 'X', 'General', new Set(['a'])).grp).toBeNull()
    expect(groupChange(entries, 'X', 'X', new Set()).clear.sort()).toEqual(['a', 'b'])
  })
})

describe('fragmentUrl selection', () => {
  it('prefers the longest plain line and the entry link for feeds', () => {
    expect(fragmentUrl('https://a', '+Short & brief <b>\n+A plain line with text\n+Another clearly longer plain line here'))
      .toBe('https://a#:~:text=Another%20clearly%20longer%20plain%20line%20here')
    expect(fragmentUrl('https://a', '+Very long sentence with & many <special chars> here\n+Plain but short')).toContain('text=Plain%20but%20short')
    expect(fragmentUrl('https://a/feed', '+2026-01-01 | New post | https://a/post/1 | Summary')).toBe('https://a/post/1')
  })
})

describe('Export/Import', () => {
  const rows = [
    { url: 'https://a/x', name: 'A', grp: 'Azure', options: { selector: 'main', js: true } },
    { url: 'https://b', name: null, grp: null, options: null },
  ]
  it('exports in the urls.yml format and reads it back', () => {
    for (const format of ['yaml', 'json'] as const) {
      const out = parseImport(exportUrls(rows, format), [])
      expect(out.errors).toEqual([])
      expect(out.rows.map((r) => [r.url, r.name, r.grp, r.options])).toEqual([
        ['https://a/x', 'A', 'Azure', { selector: 'main', js: true }],
        ['https://b', null, null, {}],
      ])
    }
  })
  it('skips existing URLs and reports errors', () => {
    const out = parseImport('- https://a/x\n- ftp://c\n- {name: without}\n- https://new', ['https://a/x'])
    expect(out.skipped).toBe(1)
    expect(out.rows.map((r) => r.url)).toEqual(['https://new'])
    expect(out.errors).toHaveLength(2)
  })
  it('accepts lists, rejects unusable input', () => {
    expect(parseImport('[', []).errors[0]).toContain('not readable')
    expect(parseImport('foo: 1', []).errors).toHaveLength(1)
  })
})

describe('editing URLs', () => {
  const entry = toEntries([{ url: 'https://a', name: 'A', grp: 'G', active: true, options: { selector: 'main', ignore: ['x.*'], min_ratio: 0.5 } }], {})[0]
  it('fills the form from the options', () => {
    expect(toEditForm(entry)).toMatchObject({ name: 'A', group: 'G', selector: 'main', ignore: 'x.*', js: false, paused: false })
  })
  it('applies changes and keeps unknown options', () => {
    const form = { ...toEditForm(entry), selector: '', js: true, onlyAdded: true, ignore: ' a+ \n\nb' }
    expect(applyEdit(entry.options ?? {}, form)).toEqual({ options: { ignore: ['a+', 'b'], min_ratio: 0.5, js: true, only_added: true } })
    expect(applyEdit({}, { ...toEditForm(entry), selector: '', ignore: '', screenshot: true })).toEqual({ options: { screenshot: true } })
  })
  it('rejects invalid regex', () => {
    expect('error' in applyEdit({}, { ...toEditForm(entry), ignore: '(' })).toBe(true)
    expect(applyEdit({}, { ...toEditForm(entry), selector: '', ignore: '', interval: 'weekly' })).toEqual({ options: { interval: 'weekly' } })
    expect(applyEdit({ interval: 'daily' }, { ...toEditForm(entry), selector: '', ignore: '', interval: '' })).toEqual({ options: {} })
  })
  it('paused URLs get the status "paused"', () => {
    expect(toEntries([{ url: 'https://a', name: null, grp: null, active: false }], { 'https://a': { status: 'ok' } })[0].status).toBe('paused')
  })
})

describe('view hash', () => {
  it('roundtrip', () => {
    const v = { tab: 'changes' as const, group: 'Azure & Co', status: 'problem' as const, period: '7d' as const, query: 'a b', sort: { key: 'changed' as const, desc: true } }
    expect(parseView(buildHash(v))).toEqual(v)
  })
  it('default is empty', () => {
    expect(buildHash(parseView(''))).toBe('')
  })
  it('invalid values and old mail format', () => {
    expect(parseView('#t=x&s=zzz&p=1y').tab).toBe('changes')
    expect(parseView('#s=zzz').status).toBe('')
    expect(parseView('#changes:https%3A%2F%2Fa.de').tab).toBe('changes')
  })
})

describe('group order', () => {
  const e = (url: string, group: string) => ({ url, group }) as Entry
  const entries = [e('1', 'B'), e('2', 'A'), e('3', 'C')]
  it('uses the stored order, the rest alphabetically', () => {
    const metas = [{ name: 'C', position: 0, color: null, icon: null }]
    expect(orderGroups(entries, metas).map(([n]) => n)).toEqual(['C', 'A', 'B'])
  })
  it('empty groups are optional', () => {
    const metas = [{ name: 'Empty', position: 0, color: null, icon: null }]
    expect(orderGroups(entries, metas).map(([n]) => n)).toEqual(['Empty', 'A', 'B', 'C'])
    expect(orderGroups(entries, metas, false).map(([n]) => n)).toEqual(['A', 'B', 'C'])
  })
  it('moveGroup and colour validation', () => {
    expect(moveGroup(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(moveGroup(['a', 'b'], 'a', -1)).toEqual(['a', 'b'])
    expect(isHexColor('#2563eb')).toBe(true)
    expect(isHexColor('red;x')).toBe(false)
  })
})

describe('error streak', () => {
  const e = (status: Entry['status'], streak?: number) => ({ url: 'u', name: 'n', group: 'G', checked: '', changed: '', error: '', status, streak }) as Entry
  it('permanently broken from 6 runs', () => {
    expect(isStuck(e('error', 6))).toBe(true)
    expect(isStuck(e('warn', 7))).toBe(true)
    expect(isStuck(e('error', 5))).toBe(false)
    expect(isStuck(e('ok', 9))).toBe(false)
  })
  it('stuck filter', () => {
    expect(matches({ ...e('error', 6), text: '' }, '', '', 'stuck')).toBe(true)
    expect(matches({ ...e('error', 2), text: '' }, '', '', 'stuck')).toBe(false)
  })
})

describe('suggestIgnores', () => {
  const d = (a: string, b: string) => `@@ -1 +1 @@\n-${a}\n+${b}\n Rest`
  it('detects recurring counter lines and creates a matching regex', () => {
    const s = suggestIgnores([d('Visitors: 100', 'Visitors: 101'), d('Visitors: 101', 'Visitors: 105'), d('old', 'new')])
    expect(s).toHaveLength(1)
    expect(s[0].count).toBe(2)
    expect(new RegExp(s[0].pattern).test('Visitors: 4711')).toBe(true)
    expect(new RegExp(s[0].pattern).test('Visitors: abc')).toBe(false)
  })
  it('escapes special characters and date formats', () => {
    const s = suggestIgnores([d('As of 01.02.2026 (a+b)', 'As of 02.02.2026 (a+b)'), d('As of 03.02.2026 (a+b)', 'As of 04.02.2026 (a+b)')])
    expect(s[0].pattern).toBe('As\\s+of\\s+\\d+\\.\\d+\\.\\d+\\s+\\(a\\+b\\)')
  })
  it('ignores one-off lines and already covered patterns', () => {
    expect(suggestIgnores([d('Price 10', 'Price 11')])).toEqual([])
    const two = [d('Counter 1', 'Counter 2'), d('Counter 3', 'Counter 4')]
    expect(suggestIgnores(two, ['Counter \\d+'])).toEqual([])
    expect(suggestIgnores(two, ['(broken'])).toHaveLength(1)
  })
})

describe('run history', () => {
  const run = (seconds: number, total: number, errors: number, warns: number, ok = true) => ({ time: 't', seconds, total, errors, warns, changes: 0, ok })
  it('average and error rate', () => {
    const s = runStats([run(10, 10, 1, 0), run(30, 10, 0, 1, false)])
    expect(s).toEqual({ avgSeconds: 20, errorRate: 0.1, failedRuns: 1 })
    expect(runStats([])).toEqual({ avgSeconds: 0, errorRate: 0, failedRuns: 0 })
  })
  it('formats durations', () => {
    expect(formatDuration(42.4)).toBe('42 s')
    expect(formatDuration(125)).toBe('2 min 5 s')
  })
})

describe('sideBySide', () => {
  const txt = (r: { left: { text: string }[] | null; right: { text: string }[] | null }) => [r.left?.map((x) => x.text).join('') ?? null, r.right?.map((x) => x.text).join('') ?? null]
  it('pairs replaced lines and leaves the rest empty', () => {
    const rows = sideBySide(['@@ -1,3 +1,4 @@', ' same', '-old one', '-old two', '+new one'])
    expect(rows.map((r) => r.kind)).toEqual(['hunk', 'ctx', 'chg', 'chg'])
    expect(txt(rows[1])).toEqual(['same', 'same'])
    expect(txt(rows[2])).toEqual(['old one', 'new one'])
    expect(txt(rows[3])).toEqual(['old two', null])
  })
  it('pure insertions appear on the right', () => {
    const rows = sideBySide(['+a', '+b'])
    expect(rows.map(txt)).toEqual([[null, 'a'], [null, 'b']])
  })
})

describe('sorting', () => {
  const e = (name: string, status: Entry['status'], changed = '', checked = '') => ({ url: name, name, group: 'G', checked, changed, error: '', status }) as Entry
  const items = [e('B', 'ok', '2026-10-24 06:00 UTC'), e('A', 'error'), e('C', 'ok', '2026-10-25 06:00 UTC')]
  const names = (s: Parameters<typeof sortEntries>[1]) => sortEntries(items, s).map((x) => x.name)
  it('by name and status', () => {
    expect(names({ key: 'name', desc: true })).toEqual(['C', 'B', 'A'])
    expect(names({ key: 'status', desc: false })).toEqual(['A', 'B', 'C'])
  })
  it('time: empty values always last', () => {
    expect(names({ key: 'changed', desc: false })).toEqual(['B', 'C', 'A'])
    expect(names({ key: 'changed', desc: true })).toEqual(['C', 'B', 'A'])
  })
  it('default without key and click order', () => {
    expect(names({ key: '', desc: false })).toEqual(['B', 'A', 'C'])
    const s1 = nextSort({ key: '', desc: false }, 'name')
    const s2 = nextSort(s1, 'name')
    expect([s1.desc, s2.desc, nextSort(s2, 'name').key]).toEqual([false, true, ''])
  })
})

describe('runPhase', () => {
  const run = (id: number, status: string, conclusion: string | null = null) => ({ id, status, conclusion, url: '' })
  it('waits for a new run', () => {
    expect(runPhase(null, 5)).toBe('waiting')
    expect(runPhase(run(5, 'completed', 'success'), 5)).toBe('waiting')
  })
  it('running, done, failed', () => {
    expect(runPhase(run(6, 'in_progress'), 5)).toBe('running')
    expect(runPhase(run(6, 'completed', 'success'), 5)).toBe('success')
    expect(runPhase(run(6, 'completed', 'failure'), 5)).toBe('failed')
  })
})

describe('pickView', () => {
  const stored = { view: { tab: 'groups' as const, group: 'A', status: '' as const, period: '' as const, query: '', sort: { key: '' as const, desc: false } }, collapsed: [] }
  it('the hash takes precedence, otherwise the stored view', () => {
    expect(pickView('#t=changes', stored).tab).toBe('changes')
    expect(pickView('', stored).tab).toBe('groups')
    expect(pickView('', null).tab).toBe('changes')
  })
})

describe('sparkline', () => {
  const now = new Date('2026-10-25T12:00:00Z')
  it('counts changes per day', () => {
    const c = dailyCounts(['2026-10-25 06:00 UTC', '2026-10-25 18:00 UTC', '2026-10-24 06:00 UTC', '2026-01-01 06:00 UTC', 'broken'], now, 7)
    expect(c).toEqual([0, 0, 0, 0, 0, 1, 2])
  })
  it('bars only for days with changes', () => {
    expect(sparkBars([0, 2, 1], 30, 10)).toHaveLength(2)
    expect(sparkBars([0, 0], 30, 10)).toEqual([])
  })
})

describe('heatmap', () => {
  const now = new Date('2026-10-25T12:00:00Z') // Sunday
  it('ends with the current week, counts per day and assigns levels', () => {
    const h = heatmap(['2026-10-25 06:00 UTC', '2026-10-25 18:00 UTC', '2026-10-24 06:00 UTC', '2026-10-24 07:00 UTC', '2026-10-23 06:00 UTC', '2026-10-22 06:00 UTC', '2026-10-21 06:00 UTC', 'broken'], now, 4)
    expect(h.columns).toHaveLength(4)
    const last = h.columns[3]
    expect(last[6]).toMatchObject({ day: '2026-10-25', count: 2 })
    expect(last[5]).toMatchObject({ day: '2026-10-24', count: 2, level: 4 })
    expect(last[4]).toMatchObject({ day: '2026-10-23', count: 1, level: 2 })
    expect(last[0]?.day).toBe('2026-10-19')
    expect(h.columns[0][0]?.day).toBe('2026-09-28')
    expect(h.total).toBe(7)
  })
  it('omits days after today and old entries', () => {
    const h = heatmap(['2026-01-01 06:00 UTC'], new Date('2026-10-21T12:00:00Z'), 2)
    expect(h.columns[1].slice(3)).toEqual([null, null, null, null])
    expect(h.total).toBe(0)
  })
})

describe('noise learning', () => {
  const d = (a: string, b: string) => `@@ -1 +1 @@\n-${a}\n+${b}\n Rest`
  it('recognizes hex ids such as build hashes', () => {
    const s = suggestIgnores([d('Build 3fa9c01b2d', 'Build 7c1d44e9a0'), d('Build 7c1d44e9a0', 'Build 90ab12cd34')])
    expect(s).toHaveLength(1)
    expect(new RegExp(s[0].pattern).test('Build 1234abcd99')).toBe(true)
  })
  it('does not treat plain words as ids', () => {
    expect(suggestIgnores([d('Release notes', 'Release news'), d('Release news', 'Release notes')])).toHaveLength(0)
  })
  it('lists only URLs with suggestions and skips patterns that are already ignored', () => {
    const entries = toEntries([
      { url: 'https://noisy', name: null, grp: null },
      { url: 'https://quiet', name: null, grp: null },
      { url: 'https://handled', name: null, grp: null, options: { ignore: ['Visitors:\\s+\\d+'] } },
    ], {})
    const changes = ['https://noisy', 'https://handled', 'https://quiet'].flatMap((url) =>
      url === 'https://quiet'
        ? [{ url, diff: d('old', 'new') }]
        : [{ url, diff: d('Visitors: 1', 'Visitors: 2') }, { url, diff: d('Visitors: 2', 'Visitors: 3') }])
    const out = noisyUrls(changes, entries)
    expect([...out.keys()]).toEqual(['https://noisy'])
    expect(out.get('https://noisy')?.[0].count).toBe(2)
  })
})

describe('applyFix', () => {
  it('sets options and keeps the rest', () => {
    expect(applyFix({ min_ratio: 0.5 }, 'https://a', { type: 'js' })).toEqual({ options: { min_ratio: 0.5, js: true }, url: 'https://a' })
    expect(applyFix({}, 'https://a', { type: 'selector' })).toEqual({ options: { selector: 'auto' }, url: 'https://a' })
    expect(applyFix({}, 'https://a', { type: 'ignore_robots' })).toEqual({ options: { ignore_robots: true }, url: 'https://a' })
  })
  it('replaces the URL only with a valid http(s) address', () => {
    expect(applyFix({ js: true }, 'https://a', { type: 'url', url: 'https://b/new' })).toEqual({ options: { js: true }, url: 'https://b/new' })
    expect('error' in applyFix({}, 'https://a', { type: 'url', url: 'javascript:alert(1)' })).toBe(true)
    expect('error' in applyFix({}, 'https://a', { type: 'url' })).toBe(true)
  })
})

describe('health', () => {
  const a = entry({ url: 'https://a', name: 'A' })
  const b = entry({ url: 'https://b', name: 'B', status: 'error', streak: 9 })
  const c = entry({ url: 'https://c', name: 'C', active: false })
  const health = { 'https://a': { h: 'ooeo', ms: [100, 300] }, 'https://b': { h: 'eeee', ms: [] } }

  it('computes uptime, average time and flags; stuck pages first; inactive ones hidden', () => {
    const rows = healthRows([a, b, c], health, new Set(['https://a']))
    expect(rows.map((r) => r.entry.url)).toEqual(['https://b', 'https://a'])
    expect(rows[1]).toMatchObject({ checks: 4, uptime: 75, avgMs: 200, noisy: true, stuck: false })
    expect(rows[0]).toMatchObject({ uptime: 0, avgMs: null, stuck: true })
  })

  it('handles URLs without data and summarizes', () => {
    const rows = healthRows([a], {}, new Set())
    expect(rows[0]).toMatchObject({ checks: 0, uptime: null, avgMs: null })
    expect(healthSummary(rows)).toEqual({ uptime: null, avgMs: null, stuck: 0, noisy: 0 })
    expect(healthSummary(healthRows([a, b], health, new Set()))).toMatchObject({ uptime: 37.5, avgMs: 200, stuck: 1 })
  })

  it('formats milliseconds', () => {
    expect([formatMs(null), formatMs(450), formatMs(2500)]).toEqual(['-', '450 ms', '2.5 s'])
  })
})
