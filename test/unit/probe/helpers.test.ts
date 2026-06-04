import { describe, it, expect } from 'vitest'

import { classifyQuality, deriveQuality, type QualityBucket } from '../../../src/probe/helpers'

const buckets: QualityBucket[] = [
  { name: 'UHD', min_width: 2000 },
  { name: 'HD', min_width: 1000, max_width: 2000 },
  { name: 'SD', max_width: 1000 },
]

describe('deriveQuality', () => {
  it('matches a file that falls in the UHD range (long edge >= 2000)', () => {
    expect(deriveQuality(3840, 2160, buckets)).toBe('UHD')
  })

  it('matches a file that falls in the HD range', () => {
    expect(deriveQuality(1920, 1080, buckets)).toBe('HD')
  })

  it('matches a file that falls in the SD range (long edge <= 1000)', () => {
    expect(deriveQuality(720, 480, buckets)).toBe('SD')
  })

  it('uses long edge so vertically-oriented files classify by their largest dimension', () => {
    // 1080 wide x 1920 tall - long edge is 1920, in HD range.
    expect(deriveQuality(1080, 1920, buckets)).toBe('HD')
  })

  it('returns null when no bucket range contains the long edge', () => {
    // long edge 0 falls in SD by virtue of <= 1000, but a true no-match
    // needs no overlap. Build a bucket set with a gap to test it.
    const gappy: QualityBucket[] = [
      { name: 'UHD', min_width: 3000 },
      { name: 'SD', max_width: 500 },
    ]
    expect(deriveQuality(1000, 1000, gappy)).toBeNull()
  })

  it('returns null when buckets is empty', () => {
    expect(deriveQuality(1920, 1080, [])).toBeNull()
  })

  it('scans buckets in declaration order and returns the first match', () => {
    // Two overlapping buckets - first one wins.
    const overlap: QualityBucket[] = [
      { name: 'First', min_width: 1000, max_width: 2000 },
      { name: 'Second', min_width: 1500, max_width: 2500 },
    ]
    expect(deriveQuality(1920, 1080, overlap)).toBe('First')
  })

  it('handles bucket with no min_width (only max_width)', () => {
    expect(deriveQuality(500, 300, [{ name: 'SD', max_width: 1000 }])).toBe('SD')
  })

  it('handles bucket with no max_width (only min_width)', () => {
    expect(deriveQuality(4000, 2000, [{ name: 'UHD', min_width: 2000 }])).toBe('UHD')
  })

  it('handles bucket with neither min_width nor max_width (matches everything)', () => {
    expect(deriveQuality(1, 1, [{ name: 'Any' }])).toBe('Any')
  })

  it('treats min_width as inclusive', () => {
    expect(deriveQuality(2000, 100, [{ name: 'UHD', min_width: 2000 }])).toBe('UHD')
  })

  it('treats max_width as inclusive', () => {
    expect(deriveQuality(1000, 100, [{ name: 'SD', max_width: 1000 }])).toBe('SD')
  })
})

describe('classifyQuality', () => {
  it('returns bucket=null and fits=true when no bucket matches the category name', () => {
    const result = classifyQuality(3840, 2160, 'Other UHD', buckets)
    expect(result.bucket).toBeNull()
    expect(result.fits).toBe(true)
    expect(result.longEdge).toBe(3840)
  })

  it('reports fits=true when the file is in its matching bucket range', () => {
    const result = classifyQuality(3840, 2160, 'UHD', buckets)
    expect(result.bucket?.name).toBe('UHD')
    expect(result.fits).toBe(true)
  })

  it('reports fits=false when the file is in its matching bucket but undersized', () => {
    // File in UHD category but actually only HD-sized (1920px).
    const result = classifyQuality(1920, 1080, 'UHD', buckets)
    expect(result.bucket?.name).toBe('UHD')
    expect(result.fits).toBe(false)
  })

  it('reports fits=false when the file exceeds the bucket max', () => {
    // File in SD category but actually 4K.
    const result = classifyQuality(3840, 2160, 'SD', buckets)
    expect(result.bucket?.name).toBe('SD')
    expect(result.fits).toBe(false)
  })

  it('uses long edge for dimension check', () => {
    // 1080 wide x 1920 tall - long edge 1920, fits HD.
    const result = classifyQuality(1080, 1920, 'HD', buckets)
    expect(result.bucket?.name).toBe('HD')
    expect(result.fits).toBe(true)
    expect(result.longEdge).toBe(1920)
  })

  it('passes silently when category does not appear in any bucket name', () => {
    // The opt-in semantic: "Other UHD" has no matching bucket, so classifyQuality
    // returns bucket=null even though the file's dimensions would also fail UHD.
    const result = classifyQuality(1920, 1080, 'Other UHD', buckets)
    expect(result.bucket).toBeNull()
    expect(result.fits).toBe(true)
  })
})
