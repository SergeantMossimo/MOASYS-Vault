import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { scan, writeJson, writeWarnings } from '../../../src/core/scanner'
import { createMoviesModule } from '../../../src/media/movies'
import { defaultMoviesRules } from '../../../src/core/rules/movies'
import { WarningCollector } from '../../../src/core/types'

describe('writeJson', () => {
  let tmpDir: string
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moasys-scanner-'))
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    logSpy.mockRestore()
  })

  it('writes the serialized output for an empty records map', () => {
    const module = createMoviesModule({
      ...defaultMoviesRules,
      categories: [{ name: 'UHD' }],
    })
    const out = path.join(tmpDir, 'out.json')
    writeJson(new Map(), module, out)
    expect(JSON.parse(fs.readFileSync(out, 'utf-8'))).toEqual([])
  })

  it('writes a list when the module returns serialized records', () => {
    const module = createMoviesModule({
      ...defaultMoviesRules,
      categories: [{ name: 'UHD' }],
    })
    const out = path.join(tmpDir, 'out.json')
    const records = new Map([
      [
        'k',
        {
          title: 'X',
          year: 2000,
          edition: null,
          versions: [{ category: 'UHD', quality: null }],
        },
      ],
    ])
    writeJson(records, module, out)
    const parsed = JSON.parse(fs.readFileSync(out, 'utf-8'))
    expect(parsed).toHaveLength(1)
    expect(parsed[0].title).toBe('X')
  })

  it('logs the entry count after writing', () => {
    const module = createMoviesModule({
      ...defaultMoviesRules,
      categories: [{ name: 'UHD' }],
    })
    writeJson(new Map(), module, path.join(tmpDir, 'out.json'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/0 entries/))
  })
})

describe('writeWarnings', () => {
  let tmpDir: string
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moasys-scanner-w-'))
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    logSpy.mockRestore()
  })

  it('writes a warnings JSON file with the expected shape', () => {
    const warnings = new WarningCollector()
    warnings.add('file.mp4', 'something bad')

    const out = path.join(tmpDir, 'warnings.json')
    writeWarnings(warnings, out)

    const parsed = JSON.parse(fs.readFileSync(out, 'utf-8'))
    expect(parsed.count).toBe(1)
    expect(parsed.files[0]).toEqual({ path: 'file.mp4', issue: 'something bad' })
    expect(parsed.generated).toMatch(/^\d{4}-/) // ISO timestamp
  })

  it('writes count=0 and empty files array when no warnings collected', () => {
    const out = path.join(tmpDir, 'warnings.json')
    writeWarnings(new WarningCollector(), out)

    const parsed = JSON.parse(fs.readFileSync(out, 'utf-8'))
    expect(parsed.count).toBe(0)
    expect(parsed.files).toEqual([])
  })
})

describe('scan — top-level integration', () => {
  let tmpDir: string
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moasys-scan-int-'))
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    logSpy.mockRestore()
  })

  it('logs [SKIP] for category folders that do not exist on disk', () => {
    const module = createMoviesModule({
      ...defaultMoviesRules,
      categories: [{ name: 'UHD' }, { name: 'HD' }],
    })
    const warnings = new WarningCollector()

    // Build only UHD; HD is missing on disk.
    fs.mkdirSync(path.join(tmpDir, 'UHD'))

    scan({ root_path: tmpDir }, module, warnings, new Map())

    const messages = logSpy.mock.calls.flat().join('\n')
    expect(messages).toMatch(/SKIP.*HD/)
  })

  it('logs the friendlier root_path message for the synthetic-default category', () => {
    const module = createMoviesModule({
      ...defaultMoviesRules,
      categories: [],
    })
    const warnings = new WarningCollector()

    scan({ root_path: tmpDir }, module, warnings, new Map())

    const messages = logSpy.mock.calls.flat().join('\n')
    expect(messages).toMatch(/no categories configured/)
  })
})
