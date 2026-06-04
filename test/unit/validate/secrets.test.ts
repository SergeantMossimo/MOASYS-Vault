import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { SecretsSchema, loadSecrets } from '../../../src/validate/secrets'

const validKey = 'abc1234567890123456789' // 22 chars, passes min(20)

describe('SecretsSchema', () => {
  it('accepts a valid TMDB key', () => {
    expect(SecretsSchema.safeParse({ tmdb: { api_key: validKey } }).success).toBe(true)
  })

  it('accepts an optional _notes block', () => {
    expect(
      SecretsSchema.safeParse({
        _notes: { reminder: 'rotate this key annually' },
        tmdb: { api_key: validKey },
      }).success
    ).toBe(true)
  })

  it('rejects when tmdb is missing', () => {
    expect(SecretsSchema.safeParse({}).success).toBe(false)
  })

  it('rejects when api_key is too short', () => {
    expect(SecretsSchema.safeParse({ tmdb: { api_key: 'short' } }).success).toBe(false)
  })

  it('rejects the .secrets.json.example placeholder string', () => {
    const placeholder = 'PASTE-YOUR-TMDB-V3-API-KEY-HERE'
    const result = SecretsSchema.safeParse({ tmdb: { api_key: placeholder } })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/placeholder/i)
    }
  })

  it('rejects when api_key is the wrong type', () => {
    expect(SecretsSchema.safeParse({ tmdb: { api_key: 42 } }).success).toBe(false)
  })
})

describe('loadSecrets', () => {
  let tmpDir: string
  let exitSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moasys-secrets-'))
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

  it('loads a valid .secrets.json', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.secrets.json'),
      JSON.stringify({ tmdb: { api_key: validKey } }),
      'utf-8'
    )
    const loaded = loadSecrets(tmpDir)
    expect(loaded.tmdb.api_key).toBe(validKey)
  })

  it('exits with a helpful message when .secrets.json is missing', () => {
    expect(() => loadSecrets(tmpDir)).toThrow('process.exit called')
    const output = errorSpy.mock.calls.flat().join('\n')
    expect(output).toMatch(/\.secrets\.json not found/)
    expect(output).toMatch(/themoviedb\.org/)
  })

  it('exits with parse error message when JSON is malformed', () => {
    fs.writeFileSync(path.join(tmpDir, '.secrets.json'), '{ not json', 'utf-8')
    expect(() => loadSecrets(tmpDir)).toThrow('process.exit called')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/Error parsing/))
  })

  it('exits with schema validation message when api_key is too short', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.secrets.json'),
      JSON.stringify({ tmdb: { api_key: 'short' } }),
      'utf-8'
    )
    expect(() => loadSecrets(tmpDir)).toThrow('process.exit called')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/failed schema validation/))
  })
})
