import { describe, it, expect } from 'vitest'

import {
  PatternSchema,
  CategorySchema,
  compilePattern,
  resolveCategories,
} from '../../../../src/core/rules/helpers'

describe('PatternSchema', () => {
  it('accepts a plain string and normalizes it to { pattern, flags: "" }', () => {
    const parsed = PatternSchema.parse('^abc$')
    expect(parsed).toEqual({ pattern: '^abc$', flags: '' })
  })

  it('accepts an object with pattern only', () => {
    const parsed = PatternSchema.parse({ pattern: '^abc$' })
    expect(parsed).toEqual({ pattern: '^abc$', flags: '' })
  })

  it('accepts an object with pattern and flags', () => {
    const parsed = PatternSchema.parse({ pattern: '^abc$', flags: 'i' })
    expect(parsed).toEqual({ pattern: '^abc$', flags: 'i' })
  })

  it('rejects an invalid regex string', () => {
    expect(() => PatternSchema.parse('[unterminated')).toThrow()
  })

  it('rejects invalid flag letters', () => {
    expect(() => PatternSchema.parse({ pattern: 'x', flags: 'q' })).toThrow()
  })

  it('accepts each valid flag letter', () => {
    for (const flag of ['d', 'g', 'i', 'm', 's', 'u', 'y']) {
      expect(() => PatternSchema.parse({ pattern: 'x', flags: flag })).not.toThrow()
    }
  })

  it('accepts combined flag letters', () => {
    const parsed = PatternSchema.parse({ pattern: 'x', flags: 'gim' })
    expect(parsed.flags).toBe('gim')
  })
})

describe('compilePattern', () => {
  it('produces a RegExp that matches its pattern', () => {
    const re = compilePattern({ pattern: '^abc$', flags: '' })
    expect(re.test('abc')).toBe(true)
    expect(re.test('xyz')).toBe(false)
  })

  it('respects the case-insensitive flag', () => {
    const re = compilePattern({ pattern: '^abc$', flags: 'i' })
    expect(re.test('ABC')).toBe(true)
  })

  it('preserves named capture groups', () => {
    const re = compilePattern({ pattern: '^(?<title>.+)$', flags: '' })
    const match = re.exec('Hello')
    expect(match?.groups?.title).toBe('Hello')
  })
})

describe('CategorySchema', () => {
  it('accepts a category with a name', () => {
    expect(CategorySchema.parse({ name: 'UHD' })).toEqual({ name: 'UHD' })
  })

  it('rejects a category with an empty name', () => {
    expect(() => CategorySchema.parse({ name: '' })).toThrow()
  })

  it('rejects a category missing the name field', () => {
    expect(() => CategorySchema.parse({})).toThrow()
  })
})

describe('resolveCategories', () => {
  it('synthesizes a single root-walk entry when configured is empty', () => {
    expect(resolveCategories([])).toEqual([{ folderName: '', name: 'default' }])
  })

  it('maps each configured category to { folderName, name } with matching values', () => {
    expect(resolveCategories([{ name: 'UHD' }, { name: 'Other HD' }])).toEqual([
      { folderName: 'UHD', name: 'UHD' },
      { folderName: 'Other HD', name: 'Other HD' },
    ])
  })

  it('preserves input order', () => {
    const result = resolveCategories([{ name: 'C' }, { name: 'A' }, { name: 'B' }])
    expect(result.map(r => r.name)).toEqual(['C', 'A', 'B'])
  })
})
