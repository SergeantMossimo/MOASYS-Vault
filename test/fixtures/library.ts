/**
 * test/fixtures/library.ts
 * ------------------------
 * Helpers for building tiny synthetic library trees in OS temp dirs so the
 * media modules can be exercised against real fs.readdir calls.
 *
 * Each fixture is fully self-contained — created in beforeEach, removed in
 * afterEach — so tests can't interfere with each other.
 */

import fs from 'fs'
import os from 'os'
import path from 'path'

import type { ProbeData } from '../../src/probe/types'

/**
 * Recursive directory spec. A string value writes a file with that content;
 * an object value recurses into a subdirectory.
 *
 * Example:
 *   {
 *     'UHD': {
 *       'The Crow (1994)': {
 *         'The Crow (1994).mp4': '',
 *       },
 *     },
 *   }
 */
export type DirSpec = { [name: string]: string | DirSpec }

/**
 * Materialize `spec` as a real directory tree under a fresh temp dir.
 * Returns the absolute path to the root. Caller is responsible for cleanup
 * via `cleanupLibrary(root)` (or just `fs.rmSync(root, { recursive: true })`).
 */
export function buildLibrary(spec: DirSpec, prefix = 'moasys-fixture-'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  writeSpec(root, spec)
  return root
}

function writeSpec(dir: string, spec: DirSpec): void {
  for (const [name, value] of Object.entries(spec)) {
    const full = path.join(dir, name)
    if (typeof value === 'string') {
      fs.writeFileSync(full, value, 'utf-8')
    } else {
      fs.mkdirSync(full, { recursive: true })
      writeSpec(full, value)
    }
  }
}

/** Remove a fixture root. Safe to call on a path that no longer exists. */
export function cleanupLibrary(root: string): void {
  fs.rmSync(root, { recursive: true, force: true })
}

/**
 * Build a fake ProbeData object with sensible defaults. Tests pass overrides
 * for whichever fields they care about — most often just video.width/height
 * for movies/shows quality derivation.
 */
export function fakeProbe(overrides: Partial<ProbeData> = {}): ProbeData {
  return {
    size_bytes: 0,
    duration_seconds: null,
    bitrate: null,
    video: null,
    audio: null,
    tags: null,
    ...overrides,
  }
}

/**
 * Build a probe map (the same shape `scanCategory` consumes) keyed by relative
 * forward-slash paths. Pass an empty object when you don't care about probe
 * data (movies/shows then derive `quality: null`).
 */
export function probeMap(entries: Record<string, ProbeData>): Map<string, ProbeData> {
  return new Map(Object.entries(entries))
}
