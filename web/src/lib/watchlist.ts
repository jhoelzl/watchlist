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
  return [...groups]
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
