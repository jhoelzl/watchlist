import { describe, expect, it } from 'vitest'
import cases from '../../../fixtures/shared_cases.json'
import { annotateDiff, countLines, fragmentUrl, groupOf } from './watchlist'

// The same cases are checked by tests/test_shared_cases.py against the Python version (diffing.py, notify.py).
describe('shared fixtures (Python <-> TypeScript)', () => {
  it.each(cases.group_of)('groupOf %j', ({ input, expected }) => {
    expect(groupOf(input)).toBe(expected)
  })

  it.each(cases.counts)('countLines %j', ({ diff, expected }) => {
    const text = diff.join('\n')
    expect([countLines(text, '+'), countLines(text, '-')]).toEqual(expected)
  })

  it.each(cases.fragment)('fragmentUrl %j', ({ url, diff, expected }) => {
    expect(fragmentUrl(url, diff.join('\n'))).toBe(expected)
  })

  it.each(cases.annotate)('annotateDiff %j', ({ diff, expected }) => {
    const rows = annotateDiff(diff).map((row) => row.map((s) => [s.text, s.changed]))
    expect(rows).toEqual(expected)
  })
})
