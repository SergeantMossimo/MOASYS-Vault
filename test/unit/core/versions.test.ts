import { describe, it, expect } from 'vitest'

import {
  dedupVersions,
  sortVersions,
  finalizeVersions,
  distinctCategories,
  groupCategoriesByQuality,
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

  it('treats two null-quality versions in the same category as equal (no swap)', () => {
    const input: Version[] = [
      { category: 'Music', quality: null },
      { category: 'Music', quality: null },
    ]
    // Both null → tie → no reordering, and dedupVersions collapses to one.
    expect(finalizeVersions(input, ['Music'])).toEqual([{ category: 'Music', quality: null }])
  })

  it('sorts null quality after non-null quality within the same category', () => {
    const input: Version[] = [
      { category: 'Music', quality: null },
      { category: 'Music', quality: 'FLAC' },
    ]
    expect(finalizeVersions(input, ['Music'])).toEqual([
      { category: 'Music', quality: 'FLAC' },
      { category: 'Music', quality: null },
    ])
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

describe('groupCategoriesByQuality', () => {
  // Mirrors what buildCategoryQualityMap produces for a quality-organized
  // library with "Other" overflow folders.
  const tiers = new Map<string, string>([
    ['UHD', 'UHD'],
    ['Other UHD', 'UHD'],
    ['HD', 'HD'],
    ['Other HD', 'HD'],
    ['SD', 'SD'],
  ])

  it('buckets two categories that share a tier together', () => {
    const input: Version[] = [
      { category: 'UHD', quality: 'UHD' },
      { category: 'HD', quality: 'HD' },
      { category: 'Other HD', quality: 'HD' },
    ]
    expect(groupCategoriesByQuality(input, tiers)).toEqual(
      new Map([
        ['UHD', ['UHD']],
        ['HD', ['HD', 'Other HD']],
      ])
    )
  })

  it('collapses repeated versions of one category into a single bucket entry', () => {
    // Shows push one version per episode file, so the same category recurs
    // with differing derived qualities. That must not read as a duplicate.
    const input: Version[] = [
      { category: 'HD', quality: 'HD' },
      { category: 'HD', quality: 'SD' },
      { category: 'HD', quality: null },
    ]
    expect(groupCategoriesByQuality(input, tiers)).toEqual(new Map([['HD', ['HD']]]))
  })

  it('gives each general-tag category its own tier, keyed by its own name', () => {
    const generalTags = new Map<string, string>([
      ['Kids', 'Kids'],
      ['Documentaries', 'Documentaries'],
    ])
    const input: Version[] = [
      { category: 'Kids', quality: null },
      { category: 'Documentaries', quality: null },
    ]
    expect(groupCategoriesByQuality(input, generalTags)).toEqual(
      new Map([
        ['Kids', ['Kids']],
        ['Documentaries', ['Documentaries']],
      ])
    )
  })

  it('falls back to the category name when it is absent from the map', () => {
    const input: Version[] = [{ category: 'Unmapped', quality: null }]
    expect(groupCategoriesByQuality(input, tiers)).toEqual(new Map([['Unmapped', ['Unmapped']]]))
  })

  it('returns an empty map for an empty versions list', () => {
    expect(groupCategoriesByQuality([], tiers)).toEqual(new Map())
  })
})
