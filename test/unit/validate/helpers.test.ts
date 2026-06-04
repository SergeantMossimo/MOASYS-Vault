import { describe, it, expect } from 'vitest'

import { stripFilenameIllegalChars, normalizeTitle, parseYear } from '../../../src/validate/helpers'

describe('stripFilenameIllegalChars', () => {
  it('strips Windows-illegal characters without replacement', () => {
    expect(stripFilenameIllegalChars('50/50')).toBe('5050')
    expect(stripFilenameIllegalChars('3:10 to Yuma')).toBe('310 to Yuma')
    expect(stripFilenameIllegalChars('M*A*S*H')).toBe('MASH')
  })

  it('strips all of < > : " | ? * \\ /', () => {
    expect(stripFilenameIllegalChars('<>:"|?*\\/')).toBe('')
  })

  it('preserves diacritics', () => {
    expect(stripFilenameIllegalChars('Amélie')).toBe('Amélie')
    expect(stripFilenameIllegalChars('WALL·E')).toBe('WALL·E')
  })

  it('preserves apostrophes, hyphens, and periods', () => {
    expect(stripFilenameIllegalChars("Schindler's List")).toBe("Schindler's List")
    expect(stripFilenameIllegalChars('Spider-Man')).toBe('Spider-Man')
    expect(stripFilenameIllegalChars('Mr. Robot')).toBe('Mr. Robot')
  })

  it('returns the input unchanged when no illegal characters present', () => {
    expect(stripFilenameIllegalChars('The Crow')).toBe('The Crow')
  })
})

describe('normalizeTitle', () => {
  it('strips illegal chars, lowercases, collapses whitespace, and trims', () => {
    expect(normalizeTitle('  The   Crow  ')).toBe('the crow')
    expect(normalizeTitle('Mission: Impossible')).toBe('mission impossible')
  })

  it('keeps diacritics intact (so Amelie != Amélie at the strict comparison)', () => {
    expect(normalizeTitle('Amelie')).toBe('amelie')
    expect(normalizeTitle('Amélie')).toBe('amélie')
    expect(normalizeTitle('Amelie')).not.toBe(normalizeTitle('Amélie'))
  })

  it('preserves apostrophes and dashes', () => {
    expect(normalizeTitle("Schindler's List")).toBe("schindler's list")
    expect(normalizeTitle('Spider-Man')).toBe('spider-man')
  })

  it('handles empty input', () => {
    expect(normalizeTitle('')).toBe('')
  })
})

describe('parseYear', () => {
  it('parses the leading 4 digits of an ISO date string', () => {
    expect(parseYear('1994-05-13')).toBe(1994)
  })

  it('handles dates with only the year', () => {
    expect(parseYear('2020')).toBe(2020)
  })

  it('returns null for undefined', () => {
    expect(parseYear(undefined)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseYear('')).toBeNull()
  })

  it('returns null for too-short input', () => {
    expect(parseYear('199')).toBeNull()
  })

  it('returns null for non-numeric input', () => {
    expect(parseYear('TBD-DATE')).toBeNull()
  })
})
