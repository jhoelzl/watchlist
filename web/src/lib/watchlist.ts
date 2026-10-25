export type Status = 'ok' | 'new' | 'error' | 'warn' | 'pending'

export type Entry = {
  url: string
  name: string
  group: string
  checked: string
  changed: string
  status: Status
  error: string
  streak?: number
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

export type StatusFilter = '' | Status | 'problem'

export const STATUS_LABEL: Record<Status, string> = { ok: 'OK', new: 'Neu', error: 'Fehler', warn: 'Zu wenig Text', pending: 'Noch nicht geprüft' }

export function groupOf(group: string | null | undefined): string {
  return group || 'Allgemein'
}

export type UrlRow = { url: string; name: string | null; grp: string | null }

type StatusDoc = Record<string, Partial<Omit<Entry, 'url'>>>

/** Alle konfigurierten URLs, mit Status aus dem letzten Lauf. Ohne Status gilt "Noch nicht geprüft". */
export function toEntries(urls: UrlRow[], status: StatusDoc): Entry[] {
  return urls.map((u) => {
    const s = status[u.url] ?? {}
    return {
      url: u.url,
      name: s.name || u.name || u.url,
      group: groupOf(u.grp),
      checked: s.checked ?? '',
      changed: s.changed ?? '',
      status: s.status ?? 'pending',
      error: s.error ?? '',
      streak: s.streak,
    }
  })
}

export function matches(
  item: { name?: string | null; url: string; text?: string; group: string; status?: Status },
  query: string,
  group: string,
  status: StatusFilter,
): boolean {
  const q = query.trim().toLowerCase()
  if (group && item.group !== group) return false
  if (status && item.status !== undefined) {
    const ok = status === 'problem' ? item.status === 'error' || item.status === 'warn' : item.status === status
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
  const s: Summary = { total: entries.length, problems: 0, ok: 0, new: 0, error: 0, warn: 0, pending: 0 }
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

export function countLines(diff: string, sign: '+' | '-'): number {
  return diff.split('\n').filter((l) => l.startsWith(sign) && !l.startsWith(sign.repeat(3))).length
}

export const HISTORY_LIMIT = 100

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
export function fragmentUrl(url: string, diff: string): string {
  for (const line of diff.split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue
    const snippet = line.slice(1).trim().split(/\s+/).slice(0, 8).join(' ').slice(0, 80)
    if (snippet.length >= 8) return `${url}${url.includes('#') ? ':~:text=' : '#:~:text='}${encodeURIComponent(snippet).replaceAll('-', '%2D')}`
  }
  return url
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
