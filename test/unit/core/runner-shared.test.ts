import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

import {
  parseRunnerArgs,
  writeJsonOutput,
  writeWarningsOutput,
} from '../../../src/core/runner-shared'
import { WarningCollector } from '../../../src/core/types'

const VALID_TYPES = ['movies', 'shows', 'music', 'audiobooks'] as const

describe('parseRunnerArgs', () => {
  let originalArgv: string[]
  let exitSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    originalArgv = process.argv
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((_code?: number) => {
      throw new Error('process.exit called')
    }) as never)
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    process.argv = originalArgv
    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })

  function setArgv(...args: string[]) {
    process.argv = ['node', 'script.js', ...args]
  }

  it('returns implicit help when no flags are provided', () => {
    setArgv()
    expect(parseRunnerArgs(VALID_TYPES)).toEqual({ kind: 'help', explicit: false })
  })

  it('returns explicit help for --help', () => {
    setArgv('--help')
    expect(parseRunnerArgs(VALID_TYPES)).toEqual({ kind: 'help', explicit: true })
  })

  it('returns explicit help for -h', () => {
    setArgv('-h')
    expect(parseRunnerArgs(VALID_TYPES)).toEqual({ kind: 'help', explicit: true })
  })

  it('returns all-mode for --all', () => {
    setArgv('--all')
    expect(parseRunnerArgs(VALID_TYPES)).toEqual({ kind: 'all' })
  })

  it('returns one-mode for --type movies', () => {
    setArgv('--type', 'movies')
    expect(parseRunnerArgs(VALID_TYPES)).toEqual({ kind: 'one', type: 'movies' })
  })

  it('accepts each valid type', () => {
    for (const t of VALID_TYPES) {
      setArgv('--type', t)
      expect(parseRunnerArgs(VALID_TYPES)).toEqual({ kind: 'one', type: t })
    }
  })

  it('exits when --type value is missing', () => {
    setArgv('--type')
    expect(() => parseRunnerArgs(VALID_TYPES)).toThrow('process.exit called')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/invalid type/i))
  })

  it('exits when --type value is not in the validTypes list', () => {
    setArgv('--type', 'photos')
    expect(() => parseRunnerArgs(VALID_TYPES)).toThrow('process.exit called')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/Choices:/))
  })

  it('exits when an unknown flag is passed', () => {
    setArgv('--quiet')
    expect(() => parseRunnerArgs(VALID_TYPES)).toThrow('process.exit called')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/unknown flag/i))
  })
})

describe('writeJsonOutput', () => {
  let tmpDir: string
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moasys-write-'))
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    logSpy.mockRestore()
  })

  it('writes pretty-printed JSON', () => {
    const out = path.join(tmpDir, 'data.json')
    writeJsonOutput(out, { hello: 'world' })
    const content = fs.readFileSync(out, 'utf-8')
    expect(content).toContain('\n')
    expect(JSON.parse(content)).toEqual({ hello: 'world' })
  })

  it('creates parent directories that do not exist', () => {
    const out = path.join(tmpDir, 'nested', 'sub', 'data.json')
    writeJsonOutput(out, { hello: 'world' })
    expect(fs.existsSync(out)).toBe(true)
  })

  it('logs item count for arrays', () => {
    const out = path.join(tmpDir, 'list.json')
    writeJsonOutput(out, [1, 2, 3])
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/3 entries/))
  })

  it('logs 0 entries for non-array outputs', () => {
    const out = path.join(tmpDir, 'obj.json')
    writeJsonOutput(out, { a: 1 })
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/0 entries/))
  })
})

describe('writeWarningsOutput', () => {
  let tmpDir: string
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moasys-warn-'))
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    logSpy.mockRestore()
  })

  it('writes a warnings file with the expected shape', () => {
    const out = path.join(tmpDir, 'warnings.json')
    const warnings = new WarningCollector()
    warnings.add('path/to/file', 'bad name')

    writeWarningsOutput(out, warnings)
    const parsed = JSON.parse(fs.readFileSync(out, 'utf-8'))
    expect(parsed.count).toBe(1)
    expect(parsed.files[0]).toEqual({ path: 'path/to/file', issue: 'bad name' })
    expect(parsed.generated).toMatch(/^\d{4}-\d{2}-\d{2}T/) // ISO 8601
  })

  it('writes an empty warnings file when no warnings were collected', () => {
    const out = path.join(tmpDir, 'warnings.json')
    writeWarningsOutput(out, new WarningCollector())
    const parsed = JSON.parse(fs.readFileSync(out, 'utf-8'))
    expect(parsed.count).toBe(0)
    expect(parsed.files).toEqual([])
  })

  it('preserves the optional extension field on individual warnings', () => {
    const out = path.join(tmpDir, 'warnings.json')
    const warnings = new WarningCollector()
    warnings.add('path/to/file.mkv', 'Non-MP4', '.mkv')

    writeWarningsOutput(out, warnings)
    const parsed = JSON.parse(fs.readFileSync(out, 'utf-8'))
    expect(parsed.files[0].extension).toBe('.mkv')
  })

  it('logs the warning count', () => {
    const out = path.join(tmpDir, 'warnings.json')
    const warnings = new WarningCollector()
    warnings.add('a', '1')
    warnings.add('b', '2')
    writeWarningsOutput(out, warnings)
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/2 warnings/))
  })
})

describe('WarningCollector', () => {
  it('starts empty', () => {
    const wc = new WarningCollector()
    expect(wc.count()).toBe(0)
    expect(wc.all()).toEqual([])
  })

  it('adds a warning with path and issue', () => {
    const wc = new WarningCollector()
    wc.add('x', 'y')
    expect(wc.count()).toBe(1)
    expect(wc.all()).toEqual([{ path: 'x', issue: 'y' }])
  })

  it('attaches the optional extension field only when provided', () => {
    const wc = new WarningCollector()
    wc.add('a.mkv', 'Non-MP4', '.mkv')
    expect(wc.all()[0]?.extension).toBe('.mkv')
  })

  it('omits the extension field when not provided', () => {
    const wc = new WarningCollector()
    wc.add('a', 'x')
    expect('extension' in (wc.all()[0] ?? {})).toBe(false)
  })

  it('returns a defensive copy from all()', () => {
    const wc = new WarningCollector()
    wc.add('a', '1')
    const list = wc.all()
    list.push({ path: 'b', issue: '2' })
    expect(wc.count()).toBe(1) // unaffected by mutation of the returned array
  })

  it('preserves insertion order', () => {
    const wc = new WarningCollector()
    wc.add('a', '1')
    wc.add('b', '2')
    wc.add('c', '3')
    expect(wc.all().map(w => w.path)).toEqual(['a', 'b', 'c'])
  })
})
