import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { JsonCache, searchKey } from '../../../src/validate/cache'

interface SampleEntry {
  id: number
  name: string
}

describe('JsonCache', () => {
  let tmpDir: string
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moasys-valcache-'))
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    logSpy.mockRestore()
  })

  it('starts empty when the file does not exist', () => {
    const cache = new JsonCache<SampleEntry>(path.join(tmpDir, 'cache.json'))
    expect(cache.size()).toBe(0)
  })

  it('round-trips entries through set + get', () => {
    const cache = new JsonCache<SampleEntry>(path.join(tmpDir, 'cache.json'))
    cache.set('key', { id: 42, name: 'X' })
    expect(cache.get('key')).toEqual({ id: 42, name: 'X' })
    expect(cache.has('key')).toBe(true)
  })

  it('returns undefined for unknown keys', () => {
    const cache = new JsonCache<SampleEntry>(path.join(tmpDir, 'cache.json'))
    expect(cache.get('missing')).toBeUndefined()
    expect(cache.has('missing')).toBe(false)
  })

  it('persists across save + reload', () => {
    const file = path.join(tmpDir, 'cache.json')

    const writer = new JsonCache<SampleEntry>(file)
    writer.set('a', { id: 1, name: 'A' })
    writer.set('b', { id: 2, name: 'B' })
    writer.save()

    const reader = new JsonCache<SampleEntry>(file)
    expect(reader.size()).toBe(2)
    expect(reader.get('a')).toEqual({ id: 1, name: 'A' })
  })

  it('discards cache when version mismatches', () => {
    const file = path.join(tmpDir, 'cache.json')
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 99, entries: { a: { id: 1, name: 'A' } } }),
      'utf-8'
    )

    const cache = new JsonCache<SampleEntry>(file, 1)
    expect(cache.size()).toBe(0)
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/Version mismatch/))
  })

  it('discards cache when shape is unexpected', () => {
    const file = path.join(tmpDir, 'cache.json')
    fs.writeFileSync(file, JSON.stringify({ totally: 'wrong' }), 'utf-8')

    const cache = new JsonCache<SampleEntry>(file)
    expect(cache.size()).toBe(0)
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/Unexpected shape/))
  })

  it('discards cache when JSON is malformed', () => {
    const file = path.join(tmpDir, 'cache.json')
    fs.writeFileSync(file, '{ not json', 'utf-8')

    const cache = new JsonCache<SampleEntry>(file)
    expect(cache.size()).toBe(0)
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/Corrupt cache/))
  })

  it('sorts entries alphabetically on save', () => {
    const file = path.join(tmpDir, 'cache.json')
    const cache = new JsonCache<SampleEntry>(file)
    cache.set('c', { id: 3, name: 'C' })
    cache.set('a', { id: 1, name: 'A' })
    cache.set('b', { id: 2, name: 'B' })
    cache.save()

    const written = JSON.parse(fs.readFileSync(file, 'utf-8'))
    expect(Object.keys(written.entries)).toEqual(['a', 'b', 'c'])
  })

  it('creates parent directories on save if missing', () => {
    const file = path.join(tmpDir, 'nested', 'sub', 'cache.json')
    const cache = new JsonCache<SampleEntry>(file)
    cache.set('a', { id: 1, name: 'A' })
    cache.save()
    expect(fs.existsSync(file)).toBe(true)
  })

  it('respects the explicit version parameter', () => {
    const file = path.join(tmpDir, 'cache.json')
    const cache = new JsonCache<SampleEntry>(file, 5)
    cache.set('a', { id: 1, name: 'A' })
    cache.save()

    const written = JSON.parse(fs.readFileSync(file, 'utf-8'))
    expect(written.version).toBe(5)
  })
})

describe('searchKey', () => {
  it('combines type, title, and year', () => {
    expect(searchKey('movie', 'The Crow', 1994)).toBe('movie|the crow|1994')
  })

  it('lowercases the title for cache deduplication', () => {
    expect(searchKey('movie', 'THE CROW', 1994)).toBe('movie|the crow|1994')
  })

  it('trims whitespace from the title', () => {
    expect(searchKey('movie', '  The Crow  ', 1994)).toBe('movie|the crow|1994')
  })

  it('uses different keys for movies vs shows even with same title/year', () => {
    expect(searchKey('movie', 'Heat', 1995)).not.toBe(searchKey('show', 'Heat', 1995))
  })
})
