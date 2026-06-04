import { describe, it, expect } from 'vitest'

import { findNumericGaps } from '../../../src/core/gaps'

describe('findNumericGaps', () => {
  it('returns empty for an empty array', () => {
    expect(findNumericGaps([])).toEqual([])
  })

  it('returns empty for a single value (no range to have gaps)', () => {
    expect(findNumericGaps([5])).toEqual([])
  })

  it('returns empty for a consecutive sequence', () => {
    expect(findNumericGaps([1, 2, 3, 4, 5])).toEqual([])
  })

  it('returns the missing value in a simple gap', () => {
    expect(findNumericGaps([1, 2, 4])).toEqual([3])
  })

  it('returns multiple missing values', () => {
    expect(findNumericGaps([1, 2, 5, 8, 10])).toEqual([3, 4, 6, 7, 9])
  })

  it('handles unsorted input correctly', () => {
    expect(findNumericGaps([4, 1, 2])).toEqual([3])
  })

  it('handles duplicate values without adding bogus gaps', () => {
    expect(findNumericGaps([1, 2, 2, 4])).toEqual([3])
  })

  it('starts the range from the minimum, not from 0 or 1', () => {
    // Range 5..7 with 6 missing - shouldn't report 1, 2, 3, 4.
    expect(findNumericGaps([5, 7])).toEqual([6])
  })

  it('handles negative numbers if they appear', () => {
    expect(findNumericGaps([-2, 0])).toEqual([-1])
  })

  it('handles a large flat sequence', () => {
    const nums = Array.from({ length: 100 }, (_, i) => i + 1)
    expect(findNumericGaps(nums)).toEqual([])
  })
})
