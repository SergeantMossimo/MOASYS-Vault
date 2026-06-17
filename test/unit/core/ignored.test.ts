import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

import {
  IgnoredEntry,
  IgnoredPathsSchema,
  loadIgnoredPaths,
  isWarningIgnored,
} from '../../../src/core/ignored'

describe('IgnoredPathsSchema', () => {
  it('accepts a list of non-empty strings', () => {
    expect(IgnoredPathsSchema.safeParse(['HD/Show', 'HD/Other']).success).toBe(true)
  })

  it('accepts an empty list', () => {
    expect(IgnoredPathsSchema.safeParse([]).success).toBe(true)
  })

  it('accepts type-scoped object entries', () => {
    expect(
      IgnoredPathsSchema.safeParse([{ path: 'HD/Show', types: ['warn_episode_gaps'] }]).success
    ).toBe(true)
  })

  it('accepts a mix of strings and object entries in the same list', () => {
    expect(
      IgnoredPathsSchema.safeParse([
        'HD/Show A',
        { path: 'HD/Show B', types: ['warn_a', 'warn_b'] },
      ]).success
    ).toBe(true)
  })

  it('rejects a non-array input', () => {
    expect(IgnoredPathsSchema.safeParse({ a: 1 }).success).toBe(false)
  })

  it('rejects an empty string entry', () => {
    expect(IgnoredPathsSchema.safeParse(['']).success).toBe(false)
  })

  it('rejects non-string non-object entries', () => {
    expect(IgnoredPathsSchema.safeParse(['HD/Show', 42]).success).toBe(false)
  })

  it('rejects an object entry with an empty types array', () => {
    expect(IgnoredPathsSchema.safeParse([{ path: 'HD/Show', types: [] }]).success).toBe(false)
  })

  it('rejects an object entry without a path', () => {
    expect(IgnoredPathsSchema.safeParse([{ types: ['warn_a'] }]).success).toBe(false)
  })
})

describe('isWarningIgnored', () => {
  const anyType = (path: string): IgnoredEntry => ({ path, types: null })
  const scoped = (path: string, types: string[]): IgnoredEntry => ({ path, types })

  it('returns false for an empty ignore list', () => {
    expect(isWarningIgnored('warn_x', 'HD/Show', [])).toBe(false)
  })

  it('returns true for an exact match on a path-only entry', () => {
    expect(isWarningIgnored('warn_x', 'HD/Show (2020)', [anyType('HD/Show (2020)')])).toBe(true)
  })

  it('returns true for a child path under a path-only entry', () => {
    expect(isWarningIgnored('warn_x', 'HD/Show (2020)/Season 1', [anyType('HD/Show (2020)')])).toBe(
      true
    )
    expect(
      isWarningIgnored('warn_x', 'HD/Show (2020)/Season 1/episode.mp4', [anyType('HD/Show (2020)')])
    ).toBe(true)
  })

  it('returns false when the prefix matches but is not followed by /', () => {
    expect(isWarningIgnored('warn_x', 'HD/Show 2 (2020)', [anyType('HD/Show')])).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(isWarningIgnored('warn_x', 'HD/Show (2020)', [anyType('hd/show (2020)')])).toBe(true)
    expect(isWarningIgnored('warn_x', 'hd/show (2020)/Season 1', [anyType('HD/Show (2020)')])).toBe(
      true
    )
  })

  it('normalizes path separators (Windows backslash vs forward slash)', () => {
    expect(
      isWarningIgnored('warn_x', 'HD\\Show (2020)\\file.mp4', [anyType('HD/Show (2020)')])
    ).toBe(true)
    expect(
      isWarningIgnored('warn_x', 'HD/Show (2020)/file.mp4', [anyType('HD\\Show (2020)')])
    ).toBe(true)
  })

  it('matches any of multiple ignored entries', () => {
    const ignored = [anyType('HD/A'), anyType('HD/B'), anyType('SD/C')]
    expect(isWarningIgnored('warn_x', 'HD/A/x', ignored)).toBe(true)
    expect(isWarningIgnored('warn_x', 'HD/B/x', ignored)).toBe(true)
    expect(isWarningIgnored('warn_x', 'SD/C/x', ignored)).toBe(true)
    expect(isWarningIgnored('warn_x', 'HD/D/x', ignored)).toBe(false)
  })

  it('handles deeply nested paths', () => {
    expect(
      isWarningIgnored('warn_x', 'HD/Show (2020)/Season 2/Show (2020) - S02E05.mp4', [
        anyType('HD/Show (2020)/Season 2'),
      ])
    ).toBe(true)
  })

  it('type-scoped entry silences only the listed warning types on its path', () => {
    const ignored = [scoped('HD/Show (2020)/Season 2', ['warn_episode_gaps'])]
    expect(isWarningIgnored('warn_episode_gaps', 'HD/Show (2020)/Season 2', ignored)).toBe(true)
    expect(isWarningIgnored('warn_episode_gaps', 'HD/Show (2020)/Season 2/x.mp4', ignored)).toBe(
      true
    )
    expect(isWarningIgnored('warn_bad_file_name', 'HD/Show (2020)/Season 2/x.mp4', ignored)).toBe(
      false
    )
  })

  it('type-scoped entry with multiple types matches each', () => {
    const ignored = [scoped('HD/Show', ['warn_a', 'warn_b'])]
    expect(isWarningIgnored('warn_a', 'HD/Show', ignored)).toBe(true)
    expect(isWarningIgnored('warn_b', 'HD/Show', ignored)).toBe(true)
    expect(isWarningIgnored('warn_c', 'HD/Show', ignored)).toBe(false)
  })

  it('path-only and type-scoped entries can coexist for the same path', () => {
    // A type-scoped entry silences `warn_a` only; a separate path-only entry
    // for a child path silences everything under that child.
    const ignored = [scoped('HD/Show', ['warn_a']), anyType('HD/Show/Season 99')]
    expect(isWarningIgnored('warn_a', 'HD/Show/Season 1/x.mp4', ignored)).toBe(true)
    expect(isWarningIgnored('warn_b', 'HD/Show/Season 1/x.mp4', ignored)).toBe(false)
    expect(isWarningIgnored('warn_b', 'HD/Show/Season 99/x.mp4', ignored)).toBe(true)
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

  it('normalizes string entries to {path, types: null}', () => {
    writeYaml('shows.yaml', '- HD/Show A\n- HD/Show B\n')
    expect(loadIgnoredPaths(tmpDir, 'shows')).toEqual([
      { path: 'HD/Show A', types: null },
      { path: 'HD/Show B', types: null },
    ])
  })

  it('preserves type-scoped object entries', () => {
    writeYaml(
      'shows.yaml',
      '- path: HD/Show A\n  types:\n    - warn_episode_gaps\n    - warn_tmdb_episode_count\n'
    )
    expect(loadIgnoredPaths(tmpDir, 'shows')).toEqual([
      { path: 'HD/Show A', types: ['warn_episode_gaps', 'warn_tmdb_episode_count'] },
    ])
  })

  it('accepts a mix of string and object entries', () => {
    writeYaml('shows.yaml', '- HD/Show A\n- path: HD/Show B\n  types:\n    - warn_episode_gaps\n')
    expect(loadIgnoredPaths(tmpDir, 'shows')).toEqual([
      { path: 'HD/Show A', types: null },
      { path: 'HD/Show B', types: ['warn_episode_gaps'] },
    ])
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

  it('exits when a list entry is a number', () => {
    writeYaml('shows.yaml', '- HD/Show\n- 42\n')
    expect(() => loadIgnoredPaths(tmpDir, 'shows')).toThrow('process.exit called')
  })

  it('exits when a list entry is an empty string', () => {
    writeYaml('shows.yaml', '- ""\n')
    expect(() => loadIgnoredPaths(tmpDir, 'shows')).toThrow('process.exit called')
  })

  it('exits when an object entry has an empty types array', () => {
    writeYaml('shows.yaml', '- path: HD/Show\n  types: []\n')
    expect(() => loadIgnoredPaths(tmpDir, 'shows')).toThrow('process.exit called')
  })

  it('loads per-type — each mediaType has its own file', () => {
    writeYaml('movies.yaml', '- UHD/Movie A\n')
    writeYaml('shows.yaml', '- HD/Show B\n')
    expect(loadIgnoredPaths(tmpDir, 'movies')).toEqual([{ path: 'UHD/Movie A', types: null }])
    expect(loadIgnoredPaths(tmpDir, 'shows')).toEqual([{ path: 'HD/Show B', types: null }])
    expect(loadIgnoredPaths(tmpDir, 'music')).toEqual([])
  })

  it('ignores the .yaml.example reference file', () => {
    writeYaml('shows.yaml.example', '- HD/Show From Example\n')
    expect(loadIgnoredPaths(tmpDir, 'shows')).toEqual([])
  })
})
