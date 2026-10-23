export type Status = 'ok' | 'new' | 'error' | 'warn'

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

export const STATUS_LABEL: Record<Status, string> = { ok: 'OK', new: 'Neu', error: 'Fehler', warn: 'Zu wenig Text' }

export function groupOf(group: string | null | undefined): string {
  return group || 'Allgemein'
}

export function toEntries(status: Record<string, Omit<Entry, 'url'>>): Entry[] {
  return Object.entries(status).map(([url, e]) => ({ ...e, url, group: groupOf(e.group) }))
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
