import { describe, expect, it } from 'vitest'
import { tierSpans } from '../HealthPage'

/** Only `tier` matters here; the real rows carry the full stats. */
const rows = (...tiers: string[]) => tiers.map(tier => ({ tier }))

describe('tierSpans', () => {
  it('spans each run of consecutive rows sharing a tier', () => {
    // The shape `/health` actually renders: one raw rung, then three
    // rungs each for m3 and m10.
    expect(tierSpans(rows('raw', 'm3', 'm3', 'm3', 'm10', 'm10', 'm10')))
      .toEqual([1, 3, 0, 0, 3, 0, 0])
  })

  it('gives every row its own cell when no tier repeats', () => {
    expect(tierSpans(rows('raw', 'm3', 'm10'))).toEqual([1, 1, 1])
  })

  it('spans the whole table when one tier owns every row', () => {
    expect(tierSpans(rows('m3', 'm3', 'm3'))).toEqual([3, 0, 0])
  })

  it('starts a fresh span when a tier recurs non-adjacently', () => {
    // Not how the API orders rungs today, but a span must never reach
    // across a different tier — that would misattribute the rows.
    expect(tierSpans(rows('m3', 'm3', 'd1', 'm3'))).toEqual([2, 0, 1, 1])
  })

  it('handles an empty table', () => {
    expect(tierSpans([])).toEqual([])
  })
})
