import { parse, stringify } from 'yaml'

export type Status = 'ok' | 'new' | 'error' | 'warn' | 'pending' | 'paused'

export type Entry = {
  url: string
  name: string
  group: string
  checked: string
  changed: string
  status: Status
  error: string
  streak?: number
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
}

export type StatusFilter = '' | Status | 'problem' | 'stuck'

// Gleicher Wert wie STUCK_AFTER in check.py: Läufe in Folge, ab denen eine Seite als dauerhaft kaputt gilt
export const STUCK_AFTER = 6
export const isStuck = (e: { status?: Status; streak?: number }) => (e.status === 'error' || e.status === 'warn') && (e.streak ?? 0) >= STUCK_AFTER

export const STATUS_LABEL: Record<Status, string> = { ok: 'OK', new: 'Neu', error: 'Fehler', warn: 'Zu wenig Text', pending: 'Noch nicht geprüft', paused: 'Pausiert' }

export function groupOf(group: string | null | undefined): string {
  return group || 'Allgemein'
}

export type UrlRow = { url: string; name: string | null; grp: string | null; active?: boolean; options?: Record<string, unknown> | null }

type StatusDoc = Record<string, Partial<Omit<Entry, 'url'>>>

/** Alle konfigurierten URLs, mit Status aus dem letzten Lauf. Ohne Status gilt "Noch nicht geprüft". */
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
  return [...groups].sort(([a], [b]) => a.localeCompare(b, 'de', { sensitivity: 'base' }))
}

export function diffClass(line: string): 'add' | 'del' | '' {
  return line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : ''
}

export type NewUrl = { url: string; name: string; group: string; selector: string; js: boolean }

/** Prüft das Formular und liefert die Zeile für watchlist_urls oder eine Fehlermeldung. */
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
    return { error: 'Bitte eine gültige URL eingeben.' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return { error: 'Nur http und https sind erlaubt.' }
  if (existing.includes(url)) return { error: 'Diese URL ist schon vorhanden.' }
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

/** Je Diff-Zeile die Textstücke; in ersetzten Zeilen (-/+ Paare) sind nur die geänderten Wörter markiert. */
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

/** Diff-Zeilen als Zeilenpaare für die Ansicht Alt/Neu; Hunk-Köpfe (@@) bleiben eigene Zeilen. */
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

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`
  return `${Math.floor(seconds / 60)} min ${Math.round(seconds % 60)} s`
}

/** Durchschnittsdauer und Fehlerquote (Anteil URLs mit Fehler oder Warnung) über die übergebenen Läufe. */
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

export const HISTORY_LIMIT = 100
export const PAGE_HISTORY_LIMIT = 500

export type Period = '' | 'today' | '7d' | '30d'

export const PERIODS: [Period, string][] = [['', 'Alle'], ['today', 'Heute'], ['7d', '7 Tage'], ['30d', '30 Tage']]

/** Zeitstempel wie "2026-10-23 06:00 UTC" als Date, sonst null. */
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

/** Gruppiert nach Tag (Reihenfolge bleibt erhalten, neueste zuerst). */
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
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

/** URL mit Textfragment (#:~:text=) zur ersten hinzugefügten Zeile; sonst die unveränderte URL. */
const PLAIN_SNIPPET = /^[\p{L}\p{N}_ .,'-]+$/u

/** Feed-Zeilen heißen "Datum | Titel | Link | Zusammenfassung": der Eintragslink ist das bessere Ziel. */
function feedEntryLink(line: string): string {
  return line.split(' | ').slice(1).map((p) => p.trim()).find((p) => /^https?:\/\/\S+$/.test(p)) ?? ''
}

/** Sprungziel zur geänderten Stelle: bei Feeds der Eintragslink, sonst Textfragment der längsten schlichten Zeile. */
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
  return `${url}${url.includes('#') ? ':~:text=' : '#:~:text='}${encodeURIComponent(best).replaceAll('-', '%2D')}`
}

export const DEFAULT_GROUP = 'Allgemein'

/** Welche URLs bekommen die Gruppe, welche verlieren sie (grp = null → "Allgemein")? */
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

/** Format wie urls.yml: {urls: [{url, name, group, ...Optionen}]}. */
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

/** Liest YAML oder JSON (Liste oder {urls: [...]}, auch das alte urls.yml). Vorhandene URLs werden übersprungen. */
export function parseImport(text: string, existing: string[]): ImportResult {
  let doc: unknown
  try {
    doc = parse(text)
  } catch (e) {
    return { rows: [], skipped: 0, errors: [`Datei nicht lesbar: ${e instanceof Error ? e.message.split('\n')[0] : 'Syntaxfehler'}`] }
  }
  const list = Array.isArray(doc) ? doc : (doc as { urls?: unknown } | null)?.urls
  if (!Array.isArray(list)) return { rows: [], skipped: 0, errors: ['Erwartet wird eine Liste oder ein Objekt mit "urls".'] }
  const seen = [...existing]
  const rows: NewRow[] = []
  const errors: string[] = []
  let skipped = 0
  list.forEach((item, i) => {
    const e: Record<string, unknown> = typeof item === 'string' ? { url: item } : { ...(item as object) }
    if (!e || typeof e.url !== 'string') return void errors.push(`Eintrag ${i + 1}: url fehlt.`)
    if (seen.includes(e.url.trim())) return void (skipped += 1)
    const { url, name, group, ...options } = e
    const built = buildRow(
      { url: String(url), name: typeof name === 'string' ? name : '', group: typeof group === 'string' ? group : '', selector: '', js: false },
      seen,
      existing.length + rows.length + 1,
    )
    if ('error' in built) return void errors.push(`Eintrag ${i + 1} (${String(url)}): ${built.error}`)
    built.row.options = options
    seen.push(built.row.url)
    rows.push(built.row)
  })
  return { rows, skipped, errors }
}

export type EditForm = { name: string; group: string; selector: string; js: boolean; ignore: string; onlyAdded: boolean; paused: boolean }

export function toEditForm(e: Entry): EditForm {
  const o = e.options ?? {}
  const ignore = o.ignore
  return {
    name: e.name === e.url ? '' : e.name,
    group: e.group === 'Allgemein' ? '' : e.group,
    selector: typeof o.selector === 'string' ? o.selector : '',
    js: o.js === true,
    ignore: (Array.isArray(ignore) ? ignore : typeof ignore === 'string' ? [ignore] : []).join('\n'),
    onlyAdded: o.only_added === true,
    paused: e.active === false,
  }
}

/** Übernimmt das Formular in die Zeile. Unbekannte Optionen (min_ratio, ignore_robots, ...) bleiben erhalten. */
export function applyEdit(options: Record<string, unknown>, form: EditForm): { options: Record<string, unknown> } | { error: string } {
  const next: Record<string, unknown> = { ...options }
  const set = (key: string, value: unknown, keep: boolean) => (keep ? (next[key] = value) : delete next[key])
  const patterns = form.ignore.split('\n').map((l) => l.trim()).filter(Boolean)
  for (const p of patterns) {
    try {
      new RegExp(p)
    } catch {
      return { error: `Ungültiger Ignore-Ausdruck: ${p}` }
    }
  }
  set('selector', form.selector.trim(), form.selector.trim() !== '')
  set('js', true, form.js)
  set('only_added', true, form.onlyAdded)
  set('ignore', patterns, patterns.length > 0)
  return { options: next }
}

export type Tab = 'urls' | 'changes' | 'groups'
export type SortKey = '' | 'name' | 'status' | 'checked' | 'changed'
export type Sort = { key: SortKey; desc: boolean }
export type ViewState = { tab: Tab; group: string; status: StatusFilter; period: Period; query: string; sort: Sort }
export const DEFAULT_VIEW: ViewState = { tab: 'urls', group: '', status: '', period: '', query: '', sort: { key: '', desc: false } }
const SORT_KEYS = ['name', 'status', 'checked', 'changed']
const TABS: Tab[] = ['urls', 'changes', 'groups']
const STATUSES = ['', 'ok', 'new', 'changed', 'error', 'paused', 'problem', 'stuck']
const PERIOD_VALUES = ['', 'today', '7d', '30d']

// Format: #t=changes&g=Azure&s=problem&p=7d&q=text. Altes Mail-Format #changes[:URL] bleibt gültig.
export function parseView(hash: string): ViewState {
  const raw = hash.replace(/^#/, '')
  if (raw.startsWith('changes')) return { ...DEFAULT_VIEW, tab: 'changes' }
  const p = new URLSearchParams(raw)
  const t = p.get('t') as Tab
  const s = p.get('s') ?? ''
  const per = p.get('p') ?? ''
  return {
    tab: TABS.includes(t) ? t : 'urls',
    group: p.get('g') ?? '',
    status: (STATUSES.includes(s) ? s : '') as StatusFilter,
    period: (PERIOD_VALUES.includes(per) ? per : '') as Period,
    query: p.get('q') ?? '',
    sort: parseSort(p.get('o') ?? ''),
  }
}

// "changed" = aufsteigend, "-changed" = absteigend
function parseSort(raw: string): Sort {
  const desc = raw.startsWith('-')
  const key = desc ? raw.slice(1) : raw
  return SORT_KEYS.includes(key) ? { key: key as SortKey, desc } : { key: '', desc: false }
}

export function buildHash(v: ViewState): string {
  const p = new URLSearchParams()
  if (v.tab !== 'urls') p.set('t', v.tab)
  if (v.group) p.set('g', v.group)
  if (v.status) p.set('s', v.status)
  if (v.period) p.set('p', v.period)
  if (v.query) p.set('q', v.query)
  if (v.sort.key) p.set('o', (v.sort.desc ? '-' : '') + v.sort.key)
  const out = p.toString()
  return out ? `#${out}` : ''
}

export type GroupMeta = { name: string; position: number; color: string | null; icon: string | null }
export const GROUP_COLORS: [string, string][] = [
  ['', 'Keine'], ['#2563eb', 'Blau'], ['#16a34a', 'Grün'], ['#d97706', 'Orange'], ['#dc2626', 'Rot'], ['#9333ea', 'Violett'], ['#0891b2', 'Türkis'], ['#64748b', 'Grau'],
]

/** Gruppen nach gespeicherter Reihenfolge, danach alphabetisch. Leere Gruppen nur mit includeEmpty. */
export function orderGroups(entries: Entry[], metas: GroupMeta[], includeEmpty = true): [string, Entry[]][] {
  const map = new Map<string, Entry[]>()
  for (const e of entries) map.set(e.group, [...(map.get(e.group) ?? []), e])
  if (includeEmpty) for (const m of metas) if (!map.has(m.name)) map.set(m.name, [])
  const pos = new Map(metas.map((m) => [m.name, m.position]))
  return [...map].sort(([a], [b]) => {
    const pa = pos.get(a) ?? Infinity
    const pb = pos.get(b) ?? Infinity
    return pa === pb ? a.localeCompare(b, 'de', { sensitivity: 'base' }) : pa < pb ? -1 : 1
  })
}

/** Neue Reihenfolge nach Verschieben um eine Position (-1 hoch, +1 runter). */
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

/** Deutet den letzten Workflow-Lauf. Läufe mit id <= baseline gehören zu einer früheren Prüfung. */
export function runPhase(run: RunInfo | null | undefined, baseline: number): RunPhase {
  if (!run || run.id <= baseline) return 'waiting'
  if (run.status !== 'completed') return 'running'
  return run.conclusion === 'success' ? 'success' : 'failed'
}

export type Prefs = { view: ViewState; collapsed: string[] }
const PREFS_KEY = 'watchlist-prefs'

/** Hash hat Vorrang (geteilte Links), sonst die zuletzt gemerkte Ansicht. */
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
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* Speicher gesperrt oder voll */ }
}

export const SPARK_DAYS = 30

/** Änderungen pro Tag der letzten `days` Tage (älteste zuerst, letzter Wert = heute). */
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

/** Balken-Sparkline als SVG-Rechtecke (x, y, Höhe) in einer Fläche von width x height. */
export function sparkBars(counts: number[], width = 90, height = 18): { x: number; y: number; w: number; h: number }[] {
  const max = Math.max(...counts, 1)
  const w = width / counts.length
  return counts.flatMap((c, i) => (c ? [{ x: i * w, y: height - Math.max(2, (c / max) * height), w: Math.max(w - 1, 1), h: Math.max(2, (c / max) * height) }] : []))
}

const STATUS_RANK: Record<Status, number> = { error: 0, warn: 1, new: 2, pending: 3, ok: 4, paused: 5 }

/** Klick auf eine Spalte: aufsteigend, dann absteigend, dann Standardreihenfolge. */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key !== key) return { key, desc: false }
  return current.desc ? { key: '', desc: false } : { key, desc: true }
}

/** Sortiert Einträge innerhalb einer Gruppe. Leere Zeitwerte stehen immer am Ende. */
export function sortEntries(items: Entry[], sort: Sort): Entry[] {
  if (!sort.key) return items
  const dir = sort.desc ? -1 : 1
  const key = sort.key
  const empty = (v: string) => !v || v === '-'
  return [...items].sort((a, b) => {
    if (key === 'name') return dir * a.name.localeCompare(b.name, 'de', { sensitivity: 'base' })
    if (key === 'status') return dir * (STATUS_RANK[a.status] - STATUS_RANK[b.status]) || a.name.localeCompare(b.name, 'de', { sensitivity: 'base' })
    const x = a[key]
    const y = b[key]
    if (empty(x) !== empty(y)) return empty(x) ? 1 : -1
    return dir * x.localeCompare(y)
  })
}
