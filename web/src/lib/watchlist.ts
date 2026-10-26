import { parse, stringify } from 'yaml'
import settings from '../../../settings.json'

export type Status = 'ok' | 'new' | 'error' | 'warn' | 'pending' | 'paused'

export type Fix = { type: 'js' | 'url' | 'ignore_robots' | 'selector'; url?: string }
export type Diagnosis = { text: string; fix: Fix }

export type Entry = {
  url: string
  name: string
  group: string
  checked: string
  changed: string
  status: Status
  error: string
  streak?: number
  diagnosis?: Diagnosis
  active?: boolean
  options?: Record<string, unknown>
}

export type Change = {
  id: number
  name: string | null
  url: string
  grp: string | null
  time: string
  diff: string
  extra: number
  summary?: string | null
}

export type StatusFilter = '' | Status | 'problem' | 'stuck'

// Consecutive runs after which a page counts as permanently broken (settings.json)
export const STUCK_AFTER = settings.stuck_after
export const isStuck = (e: { status?: Status; streak?: number }) => (e.status === 'error' || e.status === 'warn') && (e.streak ?? 0) >= STUCK_AFTER

export const STATUS_LABEL: Record<Status, string> = { ok: 'OK', new: 'New', error: 'Error', warn: 'Too little text', pending: 'Not checked yet', paused: 'Paused' }

export function groupOf(group: string | null | undefined): string {
  return group || 'General'
}

export type UrlRow = { url: string; name: string | null; grp: string | null; active?: boolean; options?: Record<string, unknown> | null }

type StatusDoc = Record<string, Partial<Omit<Entry, 'url'>>>

/** All configured URLs, with the status from the last run. Without a status, "Not checked yet" applies. */
export function toEntries(urls: UrlRow[], status: StatusDoc): Entry[] {
  return urls.map((u) => {
    const s = status[u.url] ?? {}
    return {
      url: u.url,
      name: u.name || s.name || u.url,
      group: groupOf(u.grp),
      checked: s.checked ?? '',
      changed: s.changed ?? '',
      status: u.active === false ? 'paused' : (s.status ?? 'pending'),
      error: s.error ?? '',
      streak: s.streak,
      diagnosis: s.diagnosis,
      active: u.active !== false,
      options: u.options ?? {},
    }
  })
}

export function matches(
  item: { name?: string | null; url: string; text?: string; group: string; status?: Status; streak?: number },
  query: string,
  group: string,
  status: StatusFilter,
): boolean {
  const q = query.trim().toLowerCase()
  if (group && item.group !== group) return false
  if (status && item.status !== undefined) {
    const ok =
      status === 'problem' ? item.status === 'error' || item.status === 'warn' : status === 'stuck' ? isStuck(item) : item.status === status
    if (!ok) return false
  }
  return !q || `${item.name ?? ''} ${item.url} ${item.text ?? ''}`.toLowerCase().includes(q)
}

export function groupEntries(entries: Entry[]): [string, Entry[]][] {
  const groups = new Map<string, Entry[]>()
  for (const e of entries) groups.set(e.group, [...(groups.get(e.group) ?? []), e])
  return [...groups].sort(([a], [b]) => a.localeCompare(b, 'en-GB', { sensitivity: 'base' }))
}

export function diffClass(line: string): 'add' | 'del' | '' {
  return line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : ''
}

export type NewUrl = { url: string; name: string; group: string; selector: string; js: boolean }

/** Validates the form and returns the row for watchlist_urls or an error message. */
export function buildRow(
  form: NewUrl,
  existing: string[],
  position: number,
): { row: { url: string; name: string | null; grp: string | null; options: Record<string, unknown>; position: number } } | { error: string } {
  const url = form.url.trim()
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { error: 'Please enter a valid URL.' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { error: 'Only http and https are allowed.' }
  if (existing.includes(url)) return { error: 'This URL already exists.' }
  const options: Record<string, unknown> = {}
  if (form.selector.trim()) options.selector = form.selector.trim()
  if (form.js) options.js = true
  return { row: { url, name: form.name.trim() || null, grp: form.group.trim() || null, options, position } }
}

export type Summary = Record<Status, number> & { total: number; problems: number }

export function summarize(entries: Entry[]): Summary {
  const s: Summary = { total: entries.length, problems: 0, ok: 0, new: 0, error: 0, warn: 0, pending: 0, paused: 0 }
  for (const e of entries) s[e.status] += 1
  s.problems = s.error + s.warn
  return s
}

export type Segment = { text: string; changed: boolean }

const TOKEN = /\s+|\w+|[^\w\s]/gu

function lcsOps(a: string[], b: string[]): { a: boolean[]; b: boolean[] } {
  const n = a.length
  const m = b.length
  const dp = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => 0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  }
  const ca = Array.from({ length: n }, () => true)
  const cb = Array.from({ length: m }, () => true)
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { ca[i++] = false; cb[j++] = false }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++
    else j++
  }
  return { a: ca, b: cb }
}

function toSegments(tokens: string[], changed: boolean[]): Segment[] {
  const out: Segment[] = []
  tokens.forEach((text, i) => {
    const last = out[out.length - 1]
    if (last && last.changed === changed[i]) last.text += text
    else out.push({ text, changed: changed[i] })
  })
  return out
}

/** Text segments per diff line; in replaced lines (-/+ pairs) only the changed words are marked. */
export function annotateDiff(lines: string[]): Segment[][] {
  const result: (Segment[] | null)[] = lines.map(() => null)
  let i = 0
  while (i < lines.length) {
    if (!lines[i].startsWith('-')) { i++; continue }
    let j = i
    while (j < lines.length && lines[j].startsWith('-')) j++
    let k = j
    while (k < lines.length && lines[k].startsWith('+')) k++
    for (let n = 0; n < Math.min(j - i, k - j); n++) {
      const oldTokens = lines[i + n].slice(1).match(TOKEN) ?? []
      const newTokens = lines[j + n].slice(1).match(TOKEN) ?? []
      if (oldTokens.length * newTokens.length > 40000) continue
      const ops = lcsOps(oldTokens, newTokens)
      const kept = ops.a.filter((c) => !c).length
      if (kept / Math.max(oldTokens.length, newTokens.length, 1) < 0.4) continue
      result[i + n] = [{ text: '-', changed: false }, ...toSegments(oldTokens, ops.a)]
      result[j + n] = [{ text: '+', changed: false }, ...toSegments(newTokens, ops.b)]
    }
    i = k
  }
  return lines.map((line, idx) => result[idx] ?? [{ text: line, changed: false }])
}

export type SideRow = { kind: 'hunk' | 'ctx' | 'chg'; left: Segment[] | null; right: Segment[] | null }

function stripSign(segs: Segment[]): Segment[] {
  const [first, ...rest] = segs
  const text = first.text.slice(1)
  return text ? [{ ...first, text }, ...rest] : rest
}

/** Diff lines as line pairs for the Old/New view; hunk headers (@@) stay separate rows. */
export function sideBySide(lines: string[]): SideRow[] {
  const ann = annotateDiff(lines)
  const rows: SideRow[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('@@')) {
      rows.push({ kind: 'hunk', left: ann[i], right: null })
      i++
    } else if (line.startsWith('-') || line.startsWith('+')) {
      let j = i
      while (j < lines.length && lines[j].startsWith('-')) j++
      let k = j
      while (k < lines.length && lines[k].startsWith('+')) k++
      const dels = j - i
      const adds = k - j
      if (dels === 0) {
        for (let n = i; n < k; n++) rows.push({ kind: 'chg', left: null, right: stripSign(ann[n]) })
        i = k
        continue
      }
      for (let n = 0; n < Math.max(dels, adds); n++) {
        rows.push({
          kind: 'chg',
          left: n < dels ? stripSign(ann[i + n]) : null,
          right: n < adds ? stripSign(ann[j + n]) : null,
        })
      }
      i = k
    } else {
      const seg = [{ text: line.startsWith(' ') ? line.slice(1) : line, changed: false }]
      rows.push({ kind: 'ctx', left: seg, right: seg })
      i++
    }
  }
  return rows
}

export function countLines(diff: string, sign: '+' | '-'): number {
  return diff.split('\n').filter((l) => l.startsWith(sign) && !l.startsWith(sign.repeat(3))).length
}

export type RunRecord = { time: string; seconds: number; total: number; errors: number; warns: number; changes: number; ok: boolean }

export function formatRelativeTime(value: string | null | undefined, now = Date.now()): string {
  if (!value) return 'No run yet'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return 'Unknown time'
  const secondsAgo = (timestamp - now) / 1000
  if (Math.abs(secondsAgo) < 60) return secondsAgo <= 0 ? 'just now' : 'in less than a minute'

  const units = [
    ['minute', 60],
    ['hour', 60 * 60],
    ['day', 24 * 60 * 60],
    ['week', 7 * 24 * 60 * 60],
    ['month', 30 * 24 * 60 * 60],
    ['year', 365 * 24 * 60 * 60],
  ] as const
  const absoluteSeconds = Math.abs(secondsAgo)
  let unit: (typeof units)[number] = units[0]
  for (const candidate of units) {
    if (absoluteSeconds < candidate[1]) break
    unit = candidate
  }
  return new Intl.RelativeTimeFormat('en-GB', { numeric: 'always' }).format(Math.round(secondsAgo / unit[1]), unit[0])
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`
  return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`
}

/** Average duration and error rate (share of URLs with an error or warning) over the given runs. */
export function runStats(runs: RunRecord[]): { avgSeconds: number; errorRate: number; failedRuns: number } {
  if (!runs.length) return { avgSeconds: 0, errorRate: 0, failedRuns: 0 }
  const total = runs.reduce((a, r) => a + r.total, 0)
  const bad = runs.reduce((a, r) => a + r.errors + r.warns, 0)
  return {
    avgSeconds: runs.reduce((a, r) => a + r.seconds, 0) / runs.length,
    errorRate: total ? bad / total : 0,
    failedRuns: runs.filter((r) => !r.ok).length,
  }
}

export const HISTORY_LIMIT = settings.max_history
export const PAGE_HISTORY_LIMIT = 500

export type Period = '' | 'today' | '7d' | '30d'

export const PERIODS: [Period, string][] = [['', 'All'], ['today', 'Today'], ['7d', '7 days'], ['30d', '30 days']]

/** Timestamp such as "2026-10-23 06:00 UTC" as a Date, otherwise null. */
export function parseStamp(time: string): Date | null {
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/.exec(time)
  if (!m) return null
  const d = new Date(`${m[1]}T${m[2]}:00Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

export function inPeriod(time: string, period: Period, now: Date = new Date()): boolean {
  if (!period) return true
  const at = parseStamp(time)
  if (!at) return true
  if (period === 'today') return at.toDateString() === now.toDateString()
  const days = period === '7d' ? 7 : 30
  return now.getTime() - at.getTime() <= days * 86_400_000
}

/** Groups by day (order is preserved, newest first). */
export function groupByDay<T extends { time: string }>(items: T[]): [string, T[]][] {
  const days = new Map<string, T[]>()
  for (const item of items) {
    const day = item.time.slice(0, 10)
    days.set(day, [...(days.get(day) ?? []), item])
  }
  return [...days]
}

export function dayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00`)
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

/** URL with text fragment (#:~:text=) pointing to the first added line; otherwise the unchanged URL. */
const PLAIN_SNIPPET = /^[\p{L}\p{N}_ .,'-]+$/u

/** Feed lines look like "Date | Title | Link | Summary": the entry link is the better target. */
function feedEntryLink(line: string): string {
  return line.split(' | ').slice(1).map((p) => p.trim()).find((p) => /^https?:\/\/\S+$/.test(p)) ?? ''
}

/** Like Python's urllib.parse.quote(safe="") plus %2D: encodeURIComponent additionally leaves !'()* unescaped. */
function encodeFragment(text: string): string {
  return encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`).replaceAll('-', '%2D')
}

/** Jump target to the changed spot: the entry link for feeds, otherwise a text fragment of the longest plain line. */
export function fragmentUrl(url: string, diff: string): string {
  const added = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1))
  for (const line of added) {
    const link = feedEntryLink(line)
    if (link) return link
  }
  let best = ''
  let bestPlain = false
  for (const line of added) {
    const snippet = line.trim().split(/\s+/).slice(0, 8).join(' ').slice(0, 80).trim()
    if (snippet.length < 8) continue
    const plain = PLAIN_SNIPPET.test(snippet)
    if (plain > bestPlain || (plain === bestPlain && snippet.length > best.length)) {
      best = snippet
      bestPlain = plain
    }
  }
  if (!best) return url
  return `${url}${url.includes('#') ? ':~:text=' : '#:~:text='}${encodeFragment(best)}`
}

export const DEFAULT_GROUP = 'General'

/** Which URLs get the group, which lose it (grp = null → "General")? */
export function groupChange(entries: Entry[], current: string | null, name: string, selected: Set<string>) {
  const trimmed = name.trim()
  const grp = !trimmed || trimmed === DEFAULT_GROUP ? null : trimmed
  const members = new Set(entries.filter((e) => e.group === current).map((e) => e.url))
  const assign = [...selected]
  const clear = [...members].filter((u) => !selected.has(u))
  return { grp, assign, clear }
}

export type DbUrl = { url: string; name: string | null; grp: string | null; options: Record<string, unknown> | null }
export type NewRow = ReturnType<typeof buildRow> extends infer R ? Extract<R, { row: unknown }>['row'] : never

/** Format like urls.yml: {urls: [{url, name, group, ...options}]}. */
export function exportUrls(rows: DbUrl[], format: 'yaml' | 'json'): string {
  const urls = rows.map((r) => ({
    url: r.url,
    ...(r.name ? { name: r.name } : {}),
    ...(r.grp ? { group: r.grp } : {}),
    ...r.options,
  }))
  return format === 'json' ? JSON.stringify({ urls }, null, 2) + '\n' : stringify({ urls })
}

export type ImportResult = { rows: NewRow[]; skipped: number; errors: string[] }

/** Reads YAML or JSON (list or {urls: [...]}, also the old urls.yml). Existing URLs are skipped. */
export function parseImport(text: string, existing: string[]): ImportResult {
  let doc: unknown
  try {
    doc = parse(text)
  } catch (e) {
    return { rows: [], skipped: 0, errors: [`File not readable: ${e instanceof Error ? e.message.split('\n')[0] : 'syntax error'}`] }
  }
  const list = Array.isArray(doc) ? doc : (doc as { urls?: unknown } | null)?.urls
  if (!Array.isArray(list)) return { rows: [], skipped: 0, errors: ['Expected a list or an object with "urls".'] }
  const seen = [...existing]
  const rows: NewRow[] = []
  const errors: string[] = []
  let skipped = 0
  list.forEach((item, i) => {
    const e: Record<string, unknown> = typeof item === 'string' ? { url: item } : { ...(item as object) }
    if (!e || typeof e.url !== 'string') return void errors.push(`Entry ${i + 1}: url is missing.`)
    if (seen.includes(e.url.trim())) return void (skipped += 1)
    const { url, name, group, ...options } = e
    const built = buildRow(
      { url: String(url), name: typeof name === 'string' ? name : '', group: typeof group === 'string' ? group : '', selector: '', js: false },
      seen,
      existing.length + rows.length + 1,
    )
    if ('error' in built) return void errors.push(`Entry ${i + 1} (${String(url)}): ${built.error}`)
    built.row.options = options
    seen.push(built.row.url)
    rows.push(built.row)
  })
  return { rows, skipped, errors }
}

export type IgnoreSuggestion = { pattern: string; example: string; count: number }

const MAX_SUGGESTION_LENGTH = 160

/** Regex that matches the line and leaves every digit sequence (date, counter, time) open. */
function lineToPattern(line: string): string {
  return line
    .trim()
    .split(/(\b[0-9a-f]{8,}\b|\d+|\s+)/)
    .map((part) => {
      if (/^\d+$/.test(part)) return '\\d+'
      if (/^\s+$/.test(part)) return '\\s+'
      if (/^[0-9a-f]{8,}$/.test(part) && /\d/.test(part)) return '[0-9a-f]+' // build hashes, session or commit ids
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('')
}

/**
 * Looks through a page's history for lines with digits that differ only in their numbers across at least
 * `minCount` changes (date, visitor counter, timestamp), and suggests ignore regexes for them.
 */
export function suggestIgnores(diffs: string[], existing: string[] = [], minCount = 2): IgnoreSuggestion[] {
  const found = new Map<string, { example: string; entries: number }>()
  for (const diff of diffs) {
    const seen = new Set<string>()
    for (const raw of diff.split('\n')) {
      if (!/^[+-]/.test(raw) || raw.startsWith('+++') || raw.startsWith('---')) continue
      const line = raw.slice(1).trim()
      if (!/\d/.test(line) || line.length < 3) continue
      const pattern = lineToPattern(line)
      if (pattern.length > MAX_SUGGESTION_LENGTH || seen.has(pattern)) continue
      seen.add(pattern)
      const hit = found.get(pattern)
      if (hit) hit.entries++
      else found.set(pattern, { example: line, entries: 1 })
    }
  }
  const compiled = existing.flatMap((p) => { try { return [new RegExp(p)] } catch { return [] } })
  return [...found.entries()]
    .filter(([, v]) => v.entries >= minCount)
    .filter(([pattern, v]) => !existing.includes(pattern) && !compiled.some((re) => re.test(v.example)))
    .map(([pattern, v]) => ({ pattern, example: v.example, count: v.entries }))
    .sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern))
}

/** Noise suggestions for every URL, from the changes already loaded. Only URLs with at least one suggestion are returned. */
export function noisyUrls(changes: Pick<Change, 'url' | 'diff'>[], entries: Entry[]): Map<string, IgnoreSuggestion[]> {
  const diffs = new Map<string, string[]>()
  for (const c of changes) diffs.set(c.url, [...(diffs.get(c.url) ?? []), c.diff])
  const out = new Map<string, IgnoreSuggestion[]>()
  for (const e of entries) {
    const ignore = e.options?.ignore
    const existing = Array.isArray(ignore) ? ignore.filter((x): x is string => typeof x === 'string') : typeof ignore === 'string' ? [ignore] : []
    const found = suggestIgnores(diffs.get(e.url) ?? [], existing)
    if (found.length) out.set(e.url, found)
  }
  return out
}

/** Applies a suggested fix. Returns the new options and, for a moved page, the new URL. Unknown options are preserved. */
export function applyFix(options: Record<string, unknown>, url: string, fix: Fix): { options: Record<string, unknown>; url: string } | { error: string } {
  switch (fix.type) {
    case 'js': return { options: { ...options, js: true }, url }
    case 'ignore_robots': return { options: { ...options, ignore_robots: true }, url }
    case 'selector': return { options: { ...options, selector: 'auto' }, url }
    case 'url':
      try {
        const next = new URL(fix.url ?? '')
        if (next.protocol !== 'http:' && next.protocol !== 'https:') return { error: 'The suggested URL is not http(s).' }
        return { options, url: next.href }
      } catch {
        return { error: 'The suggested URL is invalid.' }
      }
  }
}

export type EditForm = { name: string; group: string; selector: string; js: boolean; screenshot: boolean; ignore: string; onlyAdded: boolean; paused: boolean; interval: string }

export function toEditForm(e: Entry): EditForm {
  const o = e.options ?? {}
  const ignore = o.ignore
  return {
    name: e.name === e.url ? '' : e.name,
    group: e.group === 'General' ? '' : e.group,
    selector: typeof o.selector === 'string' ? o.selector : '',
    js: o.js === true,
    screenshot: o.screenshot === true,
    ignore: (Array.isArray(ignore) ? ignore : typeof ignore === 'string' ? [ignore] : []).join('\n'),
    onlyAdded: o.only_added === true,
    paused: e.active === false,
    interval: o.interval === 'daily' || o.interval === 'weekly' ? o.interval : '',
  }
}

/** Applies the form to the row. Unknown options (min_ratio, ignore_robots, ...) are preserved. */
export function applyEdit(options: Record<string, unknown>, form: EditForm): { options: Record<string, unknown> } | { error: string } {
  const next: Record<string, unknown> = { ...options }
  const set = (key: string, value: unknown, keep: boolean) => (keep ? (next[key] = value) : delete next[key])
  const patterns = form.ignore.split('\n').map((l) => l.trim()).filter(Boolean)
  for (const p of patterns) {
    try {
      new RegExp(p)
    } catch {
      return { error: `Invalid ignore expression: ${p}` }
    }
  }
  set('selector', form.selector.trim(), form.selector.trim() !== '')
  set('js', true, form.js)
  set('screenshot', true, form.screenshot)
  set('only_added', true, form.onlyAdded)
  set('interval', form.interval, form.interval === 'daily' || form.interval === 'weekly')
  set('ignore', patterns, patterns.length > 0)
  return { options: next }
}

export type Tab = 'overview' | 'urls' | 'changes' | 'groups' | 'health'
export type SortKey = '' | 'name' | 'status' | 'checked' | 'changed'
export type Sort = { key: SortKey; desc: boolean }
export type ViewState = { tab: Tab; group: string; status: StatusFilter; period: Period; query: string; sort: Sort }
export const DEFAULT_VIEW: ViewState = { tab: 'overview', group: '', status: '', period: '', query: '', sort: { key: '', desc: false } }
const SORT_KEYS = ['name', 'status', 'checked', 'changed']
const TABS: Tab[] = ['overview', 'changes', 'urls', 'groups', 'health']
const STATUSES = ['', 'ok', 'new', 'changed', 'error', 'paused', 'problem', 'stuck']
const PERIOD_VALUES = ['', 'today', '7d', '30d']

// Format: #t=changes&g=Azure&s=problem&p=7d&q=text. The old mail format #changes[:URL] remains valid.
export function parseView(hash: string): ViewState {
  const raw = hash.replace(/^#/, '')
  if (raw.startsWith('changes')) return { ...DEFAULT_VIEW, tab: 'changes' }
  const p = new URLSearchParams(raw)
  const t = p.get('t') as Tab
  const s = p.get('s') ?? ''
  const per = p.get('p') ?? ''
  return {
    tab: TABS.includes(t) ? t : DEFAULT_VIEW.tab,
    group: p.get('g') ?? '',
    status: (STATUSES.includes(s) ? s : '') as StatusFilter,
    period: (PERIOD_VALUES.includes(per) ? per : '') as Period,
    query: p.get('q') ?? '',
    sort: parseSort(p.get('o') ?? ''),
  }
}

// "changed" = ascending, "-changed" = descending
function parseSort(raw: string): Sort {
  const desc = raw.startsWith('-')
  const key = desc ? raw.slice(1) : raw
  return SORT_KEYS.includes(key) ? { key: key as SortKey, desc } : { key: '', desc: false }
}

export function buildHash(v: ViewState): string {
  const p = new URLSearchParams()
  if (v.tab !== DEFAULT_VIEW.tab) p.set('t', v.tab)
  if (v.group) p.set('g', v.group)
  if (v.status) p.set('s', v.status)
  if (v.period) p.set('p', v.period)
  if (v.query) p.set('q', v.query)
  if (v.sort.key) p.set('o', (v.sort.desc ? '-' : '') + v.sort.key)
  const out = p.toString()
  return out ? `#${out}` : ''
}

export type GroupMeta = { name: string; position: number; color: string | null; icon: string | null }
export type GroupActivity = { group: string; pages: number; changes: number }

export function groupActivityLast7Days(entries: Entry[], groupChanges: Record<string, string[]>, groupNames: string[], now = Date.now()): GroupActivity[] {
  const activity = new Map(groupNames.map((group) => [group, { pages: 0, changes: 0 }]))
  const since = now - 7 * 24 * 60 * 60 * 1000

  for (const entry of entries) {
    const group = activity.get(entry.group) ?? { pages: 0, changes: 0 }
    group.pages += 1
    activity.set(entry.group, group)
  }
  for (const [name, values] of Object.entries(groupChanges)) {
    const group = activity.get(name)
    if (!group) continue
    group.changes = values.reduce((count, value) => {
      const time = Date.parse(value)
      return Number.isFinite(time) && time >= since && time <= now ? count + 1 : count
    }, 0)
  }

  return [...activity].map(([group, count]) => ({ group, ...count }))
    .sort((a, b) => b.changes - a.changes || a.group.localeCompare(b.group, 'en-GB', { sensitivity: 'base' }))
}

export const GROUP_COLORS: [string, string][] = [
  ['', 'None'], ['#2563eb', 'Blue'], ['#16a34a', 'Green'], ['#d97706', 'Orange'], ['#dc2626', 'Red'], ['#9333ea', 'Purple'], ['#0891b2', 'Teal'], ['#64748b', 'Grey'],
]

/** Groups in stored order, then alphabetically. Empty groups only with includeEmpty. */
export function orderGroups(entries: Entry[], metas: GroupMeta[], includeEmpty = true): [string, Entry[]][] {
  const map = new Map<string, Entry[]>()
  for (const e of entries) map.set(e.group, [...(map.get(e.group) ?? []), e])
  if (includeEmpty) for (const m of metas) if (!map.has(m.name)) map.set(m.name, [])
  const pos = new Map(metas.map((m) => [m.name, m.position]))
  return [...map].sort(([a], [b]) => {
    const pa = pos.get(a) ?? Infinity
    const pb = pos.get(b) ?? Infinity
    return pa === pb ? a.localeCompare(b, 'en-GB', { sensitivity: 'base' }) : pa < pb ? -1 : 1
  })
}

/** New order after moving by one position (-1 up, +1 down). */
export function sortGroupNames(order: string[], dir: 'asc' | 'desc' = 'asc'): string[] {
  const sorted = [...order].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }))
  return dir === 'asc' ? sorted : sorted.reverse()
}

export function moveGroup(order: string[], name: string, delta: -1 | 1): string[] {
  const i = order.indexOf(name)
  const j = i + delta
  if (i < 0 || j < 0 || j >= order.length) return order
  const next = [...order]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

export function isHexColor(c: string | null | undefined): c is string {
  return !!c && /^#[0-9a-fA-F]{6}$/.test(c)
}

export type RunInfo = { id: number; status: string; conclusion: string | null; url: string }
export type RunPhase = 'waiting' | 'running' | 'success' | 'failed'

/** Interprets the latest workflow run. Runs with id <= baseline belong to an earlier check. */
export function runPhase(run: RunInfo | null | undefined, baseline: number): RunPhase {
  if (!run || run.id <= baseline) return 'waiting'
  if (run.status !== 'completed') return 'running'
  return run.conclusion === 'success' ? 'success' : 'failed'
}

export type Prefs = { view: ViewState; collapsed: string[] }
const PREFS_KEY = 'watchlist-prefs'

/** The hash takes precedence (shared links), otherwise the last remembered view. */
export function pickView(hash: string, stored: Prefs | null): ViewState {
  const fromHash = parseView(hash)
  if (hash.replace(/^#/, '') || !stored) return fromHash
  return { ...DEFAULT_VIEW, ...stored.view }
}

export function readPrefs(): Prefs | null {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null')
    if (!raw || typeof raw !== 'object') return null
    const collapsed = Array.isArray(raw.collapsed) ? raw.collapsed.filter((x: unknown) => typeof x === 'string') : []
    return { view: parseView(buildHash({ ...DEFAULT_VIEW, ...raw.view })), collapsed }
  } catch {
    return null
  }
}

export function writePrefs(prefs: Prefs): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* storage blocked or full */ }
}

export const SPARK_DAYS = 30

/** Changes per day over the last `days` days (oldest first, last value = today). */
export function dailyCounts(times: string[], now: Date = new Date(), days = SPARK_DAYS): number[] {
  const counts = Array.from({ length: days }, () => 0)
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  for (const t of times) {
    const at = parseStamp(t)
    if (!at) continue
    const day = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate())
    const ago = Math.round((today - day) / 86_400_000)
    if (ago >= 0 && ago < days) counts[days - 1 - ago]++
  }
  return counts
}

export const HEAT_WEEKS = 26

export type HeatCell = { day: string; count: number; level: 0 | 1 | 2 | 3 | 4 }

/** Calendar heatmap: columns = weeks (Mon–Sun, UTC), last column = current week; days after today are missing (null). */
export function heatmap(times: string[], now: Date = new Date(), weeks = HEAT_WEEKS): { columns: (HeatCell | null)[][]; total: number; months: (string | null)[] } {
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const monday = today - ((new Date(today).getUTCDay() + 6) % 7) * 86_400_000
  const start = monday - (weeks - 1) * 7 * 86_400_000
  const counts = new Map<string, number>()
  for (const t of times) {
    const at = parseStamp(t)
    if (!at) continue
    const day = iso(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
    counts.set(day, (counts.get(day) ?? 0) + 1)
  }
  const max = Math.max(1, ...[...counts].filter(([d]) => d >= iso(start) && d <= iso(today)).map(([, n]) => n))
  let total = 0
  const columns = Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d): HeatCell | null => {
      const ms = start + (w * 7 + d) * 86_400_000
      if (ms > today) return null
      const count = counts.get(iso(ms)) ?? 0
      total += count
      return { day: iso(ms), count, level: count ? (Math.min(4, Math.ceil((count / max) * 4)) as 1 | 2 | 3 | 4) : 0 }
    }),
  )
  const months = columns.map((col, i) => {
    const first = col.find((c) => c)?.day.slice(5, 7)
    const prev = i ? columns[i - 1].find((c) => c)?.day.slice(5, 7) : undefined
    return first && first !== prev ? new Date(`2000-${first}-15T12:00:00`).toLocaleDateString('en-GB', { month: 'short' }) : null
  })
  return { columns, total, months }
}

/** Bar sparkline as SVG rectangles (x, y, height) within an area of width x height. */
export function sparkBars(counts: number[], width = 90, height = 18): { x: number; y: number; w: number; h: number }[] {
  const max = Math.max(...counts, 1)
  const w = width / counts.length
  return counts.flatMap((c, i) => (c ? [{ x: i * w, y: height - Math.max(2, (c / max) * height), w: Math.max(w - 1, 1), h: Math.max(2, (c / max) * height) }] : []))
}

const STATUS_RANK: Record<Status, number> = { error: 0, warn: 1, new: 2, pending: 3, ok: 4, paused: 5 }

/** Click on a column: ascending, then descending, then default order. */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key !== key) return { key, desc: false }
  return current.desc ? { key: '', desc: false } : { key, desc: true }
}

/** Sorts entries within a group. Empty time values always come last. */
export function sortEntries(items: Entry[], sort: Sort): Entry[] {
  if (!sort.key) return items
  const dir = sort.desc ? -1 : 1
  const key = sort.key
  const empty = (v: string) => !v || v === '-'
  return [...items].sort((a, b) => {
    if (key === 'name') return dir * a.name.localeCompare(b.name, 'en-GB', { sensitivity: 'base' })
    if (key === 'status') return dir * (STATUS_RANK[a.status] - STATUS_RANK[b.status]) || a.name.localeCompare(b.name, 'en-GB', { sensitivity: 'base' })
    const x = a[key]
    const y = b[key]
    if (empty(x) !== empty(y)) return empty(x) ? 1 : -1
    return dir * x.localeCompare(y)
  })
}

/** Per-URL check history: h has one letter per check (o = ok, w = too little text, e = error), ms the fetch durations. */
export type HealthRecord = { h: string; ms: number[] }

export type HealthRow = { entry: Entry; checks: number; uptime: number | null; avgMs: number | null; stuck: boolean; noisy: boolean; results: string }

export function healthRows(entries: Entry[], health: Record<string, HealthRecord>, noisy: Set<string>): HealthRow[] {
  return entries
    .filter((e) => e.active !== false)
    .map((entry) => {
      const rec = health[entry.url]
      const results = rec?.h ?? ''
      const ms = rec?.ms ?? []
      return {
        entry,
        checks: results.length,
        uptime: results.length ? ([...results].filter((c) => c === 'o').length / results.length) * 100 : null,
        avgMs: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null,
        stuck: isStuck(entry),
        noisy: noisy.has(entry.url),
        results,
      }
    })
    .sort((a, b) => Number(b.stuck) - Number(a.stuck) || (a.uptime ?? 101) - (b.uptime ?? 101) || Number(b.noisy) - Number(a.noisy) || a.entry.name.localeCompare(b.entry.name))
}

export function healthSummary(rows: HealthRow[]): { uptime: number | null; avgMs: number | null; stuck: number; noisy: number } {
  const checked = rows.filter((r) => r.uptime !== null)
  const timed = rows.filter((r) => r.avgMs !== null)
  return {
    uptime: checked.length ? checked.reduce((a, r) => a + (r.uptime ?? 0), 0) / checked.length : null,
    avgMs: timed.length ? Math.round(timed.reduce((a, r) => a + (r.avgMs ?? 0), 0) / timed.length) : null,
    stuck: rows.filter((r) => r.stuck).length,
    noisy: rows.filter((r) => r.noisy).length,
  }
}

export const formatMs = (ms: number | null): string => (ms === null ? '-' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`)

export type Prefill = { url: string; name: string }

/** Link from the bookmarklet: #add=<URL>&title=<page title>. Only http(s) URLs are accepted. */
export function parseAddHash(hash: string): Prefill | null {
  const p = new URLSearchParams(hash.replace(/^#/, ''))
  const url = p.get('add')?.trim()
  if (!url) return null
  try {
    if (!/^https?:$/.test(new URL(url).protocol)) return null
  } catch {
    return null
  }
  return { url, name: (p.get('title') ?? '').trim().slice(0, 120) }
}

/** Bookmarklet code: opens the dashboard with the current page prefilled in the "Add URL" form. */
export function bookmarkletCode(dashboard: string): string {
  return `javascript:(()=>{window.open(${JSON.stringify(dashboard)}+'#add='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title),'_blank')})()`
}

export type BulkOption = { id: string; label: string; key: string; value: unknown }

/** Options that can be set (or removed again) on several URLs at once; value undefined removes the key. */
export const BULK_OPTIONS: BulkOption[] = [
  { id: 'js-on', label: 'Render with JavaScript: on', key: 'js', value: true },
  { id: 'js-off', label: 'Render with JavaScript: off', key: 'js', value: undefined },
  { id: 'shot-on', label: 'Screenshot on changes: on', key: 'screenshot', value: true },
  { id: 'shot-off', label: 'Screenshot on changes: off', key: 'screenshot', value: undefined },
  { id: 'added-on', label: 'Only added text: on', key: 'only_added', value: true },
  { id: 'added-off', label: 'Only added text: off', key: 'only_added', value: undefined },
  { id: 'ab-on', label: 'A/B test page (ignore known variants): on', key: 'ab_test', value: true },
  { id: 'ab-off', label: 'A/B test page (ignore known variants): off', key: 'ab_test', value: undefined },
  { id: 'summary-off', label: 'AI summary: off', key: 'summary', value: false },
  { id: 'summary-on', label: 'AI summary: on (default)', key: 'summary', value: undefined },
  { id: 'daily', label: 'Check interval: daily', key: 'interval', value: 'daily' },
  { id: 'weekly', label: 'Check interval: weekly', key: 'interval', value: 'weekly' },
  { id: 'every-run', label: 'Check interval: every run', key: 'interval', value: undefined },
]

export function applyBulkOption(options: Record<string, unknown>, opt: BulkOption): Record<string, unknown> {
  const next = { ...options }
  if (opt.value === undefined) delete next[opt.key]
  else next[opt.key] = opt.value
  return next
}

/** Selection after a click on a group checkbox: selects all of the group's URLs, or none if all were selected. */
export function toggleGroupSelection(selected: Set<string>, urls: string[]): Set<string> {
  const next = new Set(selected)
  const all = urls.length > 0 && urls.every((u) => next.has(u))
  for (const u of urls) {
    if (all) next.delete(u)
    else next.add(u)
  }
  return next
}
