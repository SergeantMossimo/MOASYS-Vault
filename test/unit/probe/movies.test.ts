import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

import { probeMovies } from '../../../src/probe/movies'
import { defaultMoviesRules, type MoviesRules } from '../../../src/core/rules/movies'
import { ProbeCache } from '../../../src/probe/cache'
import { WarningCollector } from '../../../src/core/types'
import type { ProbeData } from '../../../src/probe/types'
import { buildLibrary, fakeProbe, type DirSpec } from '../../fixtures/library'

/**
 * Pre-populate the ProbeCache with entries for every file in the fixture
 * library so probeBatch never spawns ffprobe. Returns the seeded cache.
 *
 * The cache key is `relativePath|mtime|size`, so we must stat each fixture
 * file (the OS chooses mtime when the file is created) to compute matching
 * keys. Callers supply the ProbeData for each relative path.
 */
function primeCache(cachePath: string, root: string, data: Record<string, ProbeData>): ProbeCache {
  const cache = new ProbeCache(cachePath)
  for (const [relPath, probeData] of Object.entries(data)) {
    const abs = path.join(root, relPath)
    const stat = fs.statSync(abs)
    cache.set(relPath, stat.mtimeMs, stat.size, probeData)
  }
  return cache
}

describe('probeMovies', () => {
  let tmpDir: string
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moasys-probe-movies-'))
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    logSpy.mockRestore()
  })

  function setup(opts: {
    spec: DirSpec
    rules?: Partial<MoviesRules>
    probes: Record<string, ProbeData>
  }) {
    const rules: MoviesRules = {
      ...defaultMoviesRules,
      categories: [{ name: 'UHD' }, { name: 'HD' }, { name: 'SD' }],
      quality_thresholds: [
        { name: 'UHD', min_width: 2000 },
        { name: 'HD', min_width: 1000, max_width: 2000 },
        { name: 'SD', max_width: 1000 },
      ],
      ...opts.rules,
    }
    const root = buildLibrary(opts.spec, 'moasys-probemovies-')
    const cache = primeCache(path.join(tmpDir, 'probe.json'), root, opts.probes)
    const warnings = new WarningCollector()
    return { rules, root, cache, warnings }
  }

  it('returns the aggregated output and the byPath map', async () => {
    const { rules, root, cache, warnings } = setup({
      spec: {
        UHD: { 'The Crow (1994)': { 'The Crow (1994).mp4': '' } },
      },
      probes: {
        'UHD/The Crow (1994)/The Crow (1994).mp4': fakeProbe({
          video: { codec: 'hevc', width: 3840, height: 2160, frame_rate: 24 },
        }),
      },
    })

    const result = await probeMovies({ root_path: root }, rules, cache, warnings)

    expect(result.output).toHaveLength(1)
    expect(result.output[0]?.title).toBe('The Crow')
    expect(result.byPath.size).toBe(1)
    expect(result.byPath.has('UHD/The Crow (1994)/The Crow (1994).mp4')).toBe(true)
  })

  it('emits warn_quality_mismatch when a file in a quality-bucket category does not fit', () => {
    // SD-dimension file in HD/ folder triggers the mismatch warning.
    const { rules, root, cache, warnings } = setup({
      spec: { HD: { 'X (2000)': { 'X (2000).mp4': '' } } },
      probes: {
        'HD/X (2000)/X (2000).mp4': fakeProbe({
          video: { codec: 'h264', width: 720, height: 480, frame_rate: 24 },
        }),
      },
    })
    return probeMovies({ root_path: root }, rules, cache, warnings).then(() => {
      expect(warnings.all().some(w => w.issue.match(/Quality mismatch/))).toBe(true)
    })
  })

  it('skips warn_quality_mismatch for categories with no matching bucket', async () => {
    // "Other HD" is not a bucket name, so files there are silently passed.
    const { rules, root, cache, warnings } = setup({
      spec: { 'Other HD': { 'X (2000)': { 'X (2000).mp4': '' } } },
      rules: {
        categories: [{ name: 'Other HD' }],
      },
      probes: {
        'Other HD/X (2000)/X (2000).mp4': fakeProbe({
          video: { codec: 'h264', width: 720, height: 480, frame_rate: 24 },
        }),
      },
    })

    await probeMovies({ root_path: root }, rules, cache, warnings)
    expect(warnings.all().some(w => w.issue.match(/Quality mismatch/))).toBe(false)
  })

  it('silences warn_quality_mismatch when the toggle is false', async () => {
    const { rules, root, cache, warnings } = setup({
      spec: { HD: { 'X (2000)': { 'X (2000).mp4': '' } } },
      rules: {
        checks: { ...defaultMoviesRules.checks, warn_quality_mismatch: false },
      },
      probes: {
        'HD/X (2000)/X (2000).mp4': fakeProbe({
          video: { codec: 'h264', width: 720, height: 480, frame_rate: 24 },
        }),
      },
    })

    await probeMovies({ root_path: root }, rules, cache, warnings)
    expect(warnings.all().some(w => w.issue.match(/Quality mismatch/))).toBe(false)
  })

  it('skips a file with no video stream (audio-only is rare here)', async () => {
    const { rules, root, cache, warnings } = setup({
      spec: { HD: { 'X (2000)': { 'X (2000).mp4': '' } } },
      probes: {
        'HD/X (2000)/X (2000).mp4': fakeProbe({ video: null }),
      },
    })

    await probeMovies({ root_path: root }, rules, cache, warnings)
    // No video means classifyQuality is skipped entirely; no warning.
    expect(warnings.all()).toEqual([])
  })

  it('skips category folders that do not exist on disk', async () => {
    const { rules, root, cache, warnings } = setup({
      // Configure UHD + HD + SD, but only build UHD.
      spec: { UHD: { 'X (2000)': { 'X (2000).mp4': '' } } },
      probes: {
        'UHD/X (2000)/X (2000).mp4': fakeProbe({
          video: { codec: 'h264', width: 3840, height: 2160, frame_rate: 24 },
        }),
      },
    })

    const result = await probeMovies({ root_path: root }, rules, cache, warnings)
    expect(result.output).toHaveLength(1)
  })
})
