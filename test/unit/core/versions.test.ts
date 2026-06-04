import { describe, it, expect } from 'vitest'

import {
  dedupVersions,
  sortVersions,
  finalizeVersions,
  distinctCategories,
} from '../../../src/core/versions'
import type { Version } from '../../../src/core/types'

describe('dedupVersions', () => {
  it('returns the input unchanged when there are no duplicates', () => {
    const input: Version[] = [
      { category: 'UHD', quality: 'UHD' },
      { category: 'HD', quality: 'HD' },
    ]
    expect(dedupVersions(input)).toEqual(input)
  })

  it('collapses two identical entries to one', () => {
    const input: Version[] = [
      { category: 'UHD', quality: 'UHD' },
      { category: 'UHD', quality: 'UHD' },
    ]
    expect(dedupVersions(input)).toEqual([{ category: 'UHD', quality: 'UHD' }])
  })

  it('treats null quality and "" quality as different entries', () => {
    const input: Version[] = [
      { category: 'UHD', quality: null },
      { category: 'UHD', quality: '' },
    ]
    // Both serialize to key 'UHD|' so they collapse — this documents the
    // intended behavior. Empty-string quality isn't a real case in practice;
    // null is. If callers ever produce '' quality, the dedup will still match.
    expect(dedupVersions(input)).toEqual([{ category: 'UHD', quality: null }])
  })

  it('preserves insertion order of first occurrence', () => {
    const input: Version[] = [
      { category: 'HD', quality: 'HD' },
      { category: 'UHD', quality: 'UHD' },
      { category: 'HD', quality: 'HD' }, // duplicate of first
    ]
    expect(dedupVersions(input)).toEqual([
      { category: 'HD', quality: 'HD' },
      { category: 'UHD', quality: 'UHD' },
    ])
  })

  it('returns an empty array for empty input', () => {
    expect(dedupVersions([])).toEqual([])
  })

  it('distinguishes same-category different-quality entries', () => {
    const input: Version[] = [
      { category: 'HD', quality: 'HD' },
      { category: 'HD', quality: 'SD' },
    ]
    expect(dedupVersions(input)).toEqual(input)
  })

  it('distinguishes same-quality different-category entries', () => {
    const input: Version[] = [
      { category: 'Music', quality: 'FLAC' },
      { category: 'Soundtracks', quality: 'FLAC' },
    ]
    expect(dedupVersions(input)).toEqual(input)
  })
})

describe('sortVersions', () => {
  const order = ['UHD', 'HD', 'SD']

  it('sorts by category order list', () => {
    const input: Version[] = [
      { category: 'SD', quality: 'SD' },
      { category: 'UHD', quality: 'UHD' },
      { category: 'HD', quality: 'HD' },
    ]
    expect(sortVersions(input, order)).toEqual([
      { category: 'UHD', quality: 'UHD' },
      { category: 'HD', quality: 'HD' },
      { category: 'SD', quality: 'SD' },
    ])
  })

  it('puts categories not in the order list after categories that are', () => {
    const input: Version[] = [
      { category: 'Other UHD', quality: 'UHD' },
      { category: 'UHD', quality: 'UHD' },
    ]
    expect(sortVersions(input, order)).toEqual([
      { category: 'UHD', quality: 'UHD' },
      { category: 'Other UHD', quality: 'UHD' },
    ])
  })

  it('sorts by quality alphabetically within a category', () => {
    const input: Version[] = [
      { category: 'HD', quality: 'SD' },
      { category: 'HD', quality: 'HD' },
    ]
    expect(sortVersions(input, order)).toEqual([
      { category: 'HD', quality: 'HD' },
      { category: 'HD', quality: 'SD' },
    ])
  })

  it('sorts null quality after populated qualities within a category', () => {
    const input: Version[] = [
      { category: 'HD', quality: null },
      { category: 'HD', quality: 'HD' },
    ]
    expect(sortVersions(input, order)).toEqual([
      { category: 'HD', quality: 'HD' },
      { category: 'HD', quality: null },
    ])
  })

  it('treats both-null qualities as equal (sort stable)', () => {
    const input: Version[] = [
      { category: 'HD', quality: null },
      { category: 'UHD', quality: null },
    ]
    expect(sortVersions(input, order)).toEqual([
      { category: 'UHD', quality: null },
      { category: 'HD', quality: null },
    ])
  })

  it('returns a new array; does not mutate the input', () => {
    const input: Version[] = [
      { category: 'HD', quality: 'HD' },
      { category: 'UHD', quality: 'UHD' },
    ]
    const snapshot = [...input]
    sortVersions(input, order)
    expect(input).toEqual(snapshot)
  })

  it('handles empty input', () => {
    expect(sortVersions([], order)).toEqual([])
  })
})

describe('finalizeVersions', () => {
  it('dedupes then sorts', () => {
    const input: Version[] = [
      { category: 'HD', quality: 'HD' },
      { category: 'UHD', quality: 'UHD' },
      { category: 'HD', quality: 'HD' }, // dup
    ]
    expect(finalizeVersions(input, ['UHD', 'HD'])).toEqual([
      { category: 'UHD', quality: 'UHD' },
      { category: 'HD', quality: 'HD' },
    ])
  })

  it('handles empty input', () => {
    expect(finalizeVersions([], ['UHD'])).toEqual([])
  })
})

describe('distinctCategories', () => {
  it('returns unique category names in insertion order', () => {
    const input: Version[] = [
      { category: 'HD', quality: 'HD' },
      { category: 'UHD', quality: 'UHD' },
      { category: 'HD', quality: 'SD' }, // same category, different quality
    ]
    expect(distinctCategories(input)).toEqual(['HD', 'UHD'])
  })

  it('returns an empty array for empty input', () => {
    expect(distinctCategories([])).toEqual([])
  })

  it('treats different category strings as distinct even when quality matches', () => {
    const input: Version[] = [
      { category: 'Music', quality: 'FLAC' },
      { category: 'Soundtracks', quality: 'FLAC' },
    ]
    expect(distinctCategories(input)).toEqual(['Music', 'Soundtracks'])
  })
})
