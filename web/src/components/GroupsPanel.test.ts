import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Entry, GroupMeta } from '../lib/watchlist'

vi.mock('../supabase', () => ({ supabase: {} }))

import { GroupsPanel } from './GroupsPanel'

const page = (url: string, group: string, active: boolean): Entry => ({
  url, name: url, group, active, status: 'ok', checked: '', changed: '', error: '',
})
const metas: GroupMeta[] = [{ name: 'Research', position: 0, icon: '📚', color: null }]

describe('group cards', () => {
  it('shows page counts and paused state while retaining settings and group actions', () => {
    const html = renderToStaticMarkup(createElement(GroupsPanel, {
      entries: [page('https://one.example', 'Research', false), page('https://two.example', 'General', true)],
      metas,
      groupsReady: true,
      onChanged: () => {},
    }))
    expect(html).toContain('1 page · 1 paused')
    expect(html).toContain('Resume all')
    expect(html).toContain('Pause all')
    expect(html).toContain('Group settings')
    expect(html).toContain('Colour of Research')
    expect(html).toContain('Move Research down')
    expect(html.match(/Dissolve group/g)).toHaveLength(1)
  })

  it('provides a clear empty state and creation action', () => {
    const html = renderToStaticMarkup(createElement(GroupsPanel, { entries: [], metas: [], groupsReady: true, onChanged: () => {} }))
    expect(html).toContain('No groups yet')
    expect(html).toContain('New group')
  })
})
