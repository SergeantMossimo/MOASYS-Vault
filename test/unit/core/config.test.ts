import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { AppConfigSchema, loadConfig } from '../../../src/core/config'

describe('AppConfigSchema', () => {
  const validConfig = {
    movies: { root_path: 'M:\\Movies' },
    shows: { root_path: 'M:\\Shows' },
    music: { root_path: 'M:\\Audio' },
    audiobooks: { root_path: 'M:\\Audiobooks' },
  }

  it('accepts the minimal valid shape', () => {
    expect(AppConfigSchema.safeParse(validConfig).success).toBe(true)
  })

  it('accepts an optional _notes object of string values', () => {
    expect(
      AppConfigSchema.safeParse({
        ...validConfig,
        _notes: { reminder: 'Update root_path when drive letter changes' },
      }).success
    ).toBe(true)
  })

  it('rejects when movies is missing', () => {
    const { movies: _movies, ...rest } = validConfig
    const result = AppConfigSchema.safeParse(rest)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some(i => i.path.includes('movies'))).toBe(true)
    }
  })

  it('rejects when shows is missing', () => {
    const { shows: _shows, ...rest } = validConfig
    expect(AppConfigSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects when music is missing', () => {
    const { music: _music, ...rest } = validConfig
    expect(AppConfigSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects when audiobooks is missing', () => {
    const { audiobooks: _audiobooks, ...rest } = validConfig
    expect(AppConfigSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects when root_path is an empty string', () => {
    const bad = { ...validConfig, movies: { root_path: '' } }
    const result = AppConfigSchema.safeParse(bad)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/non-empty/i)
    }
  })

  it('rejects when root_path is the wrong type', () => {
    const bad = { ...validConfig, movies: { root_path: 42 } }
    expect(AppConfigSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects when a media type is not an object', () => {
    const bad = { ...validConfig, movies: 'not-an-object' }
    expect(AppConfigSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects _notes that contains non-string values', () => {
    const bad = { ...validConfig, _notes: { reminder: 42 } }
    expect(AppConfigSchema.safeParse(bad).success).toBe(false)
  })
})

describe('loadConfig', () => {
  let tmpDir: string
  let exitSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moasys-config-'))
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

  it('loads and validates a valid config.json', () => {
    const config = {
      movies: { root_path: 'M:\\Movies' },
      shows: { root_path: 'M:\\Shows' },
      music: { root_path: 'M:\\Audio' },
      audiobooks: { root_path: 'M:\\Audiobooks' },
    }
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify(config), 'utf-8')

    const loaded = loadConfig(tmpDir)
    expect(loaded.movies.root_path).toBe('M:\\Movies')
    expect(loaded.audiobooks.root_path).toBe('M:\\Audiobooks')
  })

  it('exits with a helpful message when config.json is missing', () => {
    expect(() => loadConfig(tmpDir)).toThrow('process.exit called')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/config\.json not found/))
  })

  it('exits when config.json is malformed JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.json'), '{ this is not json', 'utf-8')
    expect(() => loadConfig(tmpDir)).toThrow('process.exit called')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/Error parsing config\.json/))
  })

  it('exits when config.json passes JSON.parse but fails schema validation', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'config.json'),
      JSON.stringify({ movies: { root_path: '' } }),
      'utf-8'
    )
    expect(() => loadConfig(tmpDir)).toThrow('process.exit called')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/failed schema validation/))
  })

  it('lists each validation issue path on failure', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'config.json'),
      JSON.stringify({ movies: { root_path: '' } }),
      'utf-8'
    )
    expect(() => loadConfig(tmpDir)).toThrow('process.exit called')
    // Each issue prints a line; one of them should reference movies.root_path or shows etc.
    const allErrorOutput = errorSpy.mock.calls.flat().join('\n')
    expect(allErrorOutput).toMatch(/root_path|shows|music|audiobooks/)
  })

  it('returns the original _notes when present (passes through validation)', () => {
    const config = {
      _notes: { hint: 'whatever' },
      movies: { root_path: 'M:\\Movies' },
      shows: { root_path: 'M:\\Shows' },
      music: { root_path: 'M:\\Audio' },
      audiobooks: { root_path: 'M:\\Audiobooks' },
    }
    fs.writeFileSync(path.join(tmpDir, 'config.json'), JSON.stringify(config), 'utf-8')
    const loaded = loadConfig(tmpDir)
    expect(loaded._notes).toEqual({ hint: 'whatever' })
  })
})
