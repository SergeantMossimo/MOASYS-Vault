import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { IgnoredPathsSchema, loadIgnoredPaths, isPathIgnored } from '../../../src/core/ignored'

describe('IgnoredPathsSchema', () => {
  it('accepts a list of non-empty strings', () => {
    expect(IgnoredPathsSchema.safeParse(['HD/Show', 'HD/Other']).success).toBe(true)
  })

  it('accepts an empty list', () => {
    expect(IgnoredPathsSchema.safeParse([]).success).toBe(true)
  })

  it('rejects a non-array input', () => {
    expect(IgnoredPathsSchema.safeParse({ a: 1 }).success).toBe(false)
  })

  it('rejects an empty string entry', () => {
    expect(IgnoredPathsSchema.safeParse(['']).success).toBe(false)
  })

  it('rejects non-string entries', () => {
    expect(IgnoredPathsSchema.safeParse(['HD/Show', 42]).success).toBe(false)
  })
})

describe('isPathIgnored', () => {
  it('returns false for an empty ignore list', () => {
    expect(isPathIgnored('HD/Show', [])).toBe(false)
  })

  it('returns true for an exact match', () => {
    expect(isPathIgnored('HD/Show (2020)', ['HD/Show (2020)'])).toBe(true)
  })

  it('returns true for a child path under an ignored prefix', () => {
    expect(isPathIgnored('HD/Show (2020)/Season 1', ['HD/Show (2020)'])).toBe(true)
    expect(isPathIgnored('HD/Show (2020)/Season 1/episode.mp4', ['HD/Show (2020)'])).toBe(true)
  })

  it('returns false when the prefix matches but is not followed by /', () => {
    // "HD/Show" matches as a string prefix of "HD/Show 2", but conceptually
    // those are different shows. The matcher requires `/` boundary.
    expect(isPathIgnored('HD/Show 2 (2020)', ['HD/Show'])).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(isPathIgnored('HD/Show (2020)', ['hd/show (2020)'])).toBe(true)
    expect(isPathIgnored('hd/show (2020)/Season 1', ['HD/Show (2020)'])).toBe(true)
  })

  it('normalizes path separators (Windows backslash vs forward slash)', () => {
    expect(isPathIgnored('HD\\Show (2020)\\file.mp4', ['HD/Show (2020)'])).toBe(true)
    expect(isPathIgnored('HD/Show (2020)/file.mp4', ['HD\\Show (2020)'])).toBe(true)
  })

  it('matches any of multiple ignored prefixes', () => {
    const ignored = ['HD/A', 'HD/B', 'SD/C']
    expect(isPathIgnored('HD/A/x', ignored)).toBe(true)
    expect(isPathIgnored('HD/B/x', ignored)).toBe(true)
    expect(isPathIgnored('SD/C/x', ignored)).toBe(true)
    expect(isPathIgnored('HD/D/x', ignored)).toBe(false)
  })

  it('handles deeply nested paths', () => {
    expect(
      isPathIgnored('HD/Show (2020)/Season 2/Show (2020) - S02E05.mp4', ['HD/Show (2020)/Season 2'])
    ).toBe(true)
  })
})

describe('loadIgnoredPaths', () => {
  let tmpDir: string
  let exitSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moasys-ignored-'))
    fs.mkdirSync(path.join(tmpDir, 'ignored'))
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((_code?: number) => {
      throw new Error('process.exit called')
    }) as never)
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })

  function writeYaml(name: string, contents: string): void {
    fs.writeFileSync(path.join(tmpDir, 'ignored', name), contents, 'utf-8')
  }

  it('returns [] when the file does not exist', () => {
    expect(loadIgnoredPaths(tmpDir, 'shows')).toEqual([])
  })

  it('returns the parsed list when the file is valid', () => {
    writeYaml('shows.yaml', '- HD/Show A\n- HD/Show B\n')
    expect(loadIgnoredPaths(tmpDir, 'shows')).toEqual(['HD/Show A', 'HD/Show B'])
  })

  it('returns [] for a comments-only YAML', () => {
    writeYaml('shows.yaml', '# just a comment\n# nothing else\n')
    expect(loadIgnoredPaths(tmpDir, 'shows')).toEqual([])
  })

  it('exits when the YAML is malformed', () => {
    writeYaml('shows.yaml', '- [unterminated')
    expect(() => loadIgnoredPaths(tmpDir, 'shows')).toThrow('process.exit called')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/Error parsing/))
  })

  it('exits when the YAML is not a list', () => {
    writeYaml('shows.yaml', 'not_a_list: true\n')
    expect(() => loadIgnoredPaths(tmpDir, 'shows')).toThrow('process.exit called')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/must be a list/))
  })

  it('exits when a list entry is not a string', () => {
    writeYaml('shows.yaml', '- HD/Show\n- 42\n')
    expect(() => loadIgnoredPaths(tmpDir, 'shows')).toThrow('process.exit called')
  })

  it('exits when a list entry is an empty string', () => {
    writeYaml('shows.yaml', '- ""\n')
    expect(() => loadIgnoredPaths(tmpDir, 'shows')).toThrow('process.exit called')
  })

  it('loads per-type — each mediaType has its own file', () => {
    writeYaml('movies.yaml', '- UHD/Movie A\n')
    writeYaml('shows.yaml', '- HD/Show B\n')
    expect(loadIgnoredPaths(tmpDir, 'movies')).toEqual(['UHD/Movie A'])
    expect(loadIgnoredPaths(tmpDir, 'shows')).toEqual(['HD/Show B'])
    expect(loadIgnoredPaths(tmpDir, 'music')).toEqual([])
  })

  it('ignores the .yaml.example reference file', () => {
    writeYaml('shows.yaml.example', '- HD/Show From Example\n')
    expect(loadIgnoredPaths(tmpDir, 'shows')).toEqual([])
  })
})
