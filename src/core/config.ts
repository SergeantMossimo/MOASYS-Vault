/**
 * core/config.ts
 * --------------
 * Loader and Zod schema for `config.json`.
 *
 * Until now `config.json` was parsed with a bare `JSON.parse(...) as AppConfig`,
 * which means a missing field, a typo'd key, or an empty `root_path` would
 * blow up deep inside a media module with a confusing TypeError. This module
 * fixes that — same boot-time validation pattern we use for `.secrets.json`
 * and rules YAMLs.
 *
 * All four media types are required to match the existing registry-based
 * dispatch in `src/scan.ts`. If you have a library that doesn't include one
 * of the types, give it a placeholder `root_path` (it won't be touched
 * unless you run that media type's commands).
 */

import fs from 'fs'
import path from 'path'

import { z } from 'zod'

import { AppConfig } from './types'

// ─────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────

/** Each media type carries just `root_path` (subfolder lists live in rules). */
const MediaTypeConfigSchema = z.object({
  root_path: z.string().min(1, 'root_path must be a non-empty string'),
})

/**
 * Full `config.json` schema.
 *
 * `_notes` is allowed for self-documentation (some config files use it for
 * inline comments since JSON has none) — the scanner ignores it.
 */
export const AppConfigSchema = z.object({
  _notes: z.record(z.string(), z.string()).optional(),
  movies: MediaTypeConfigSchema,
  shows: MediaTypeConfigSchema,
  music: MediaTypeConfigSchema,
  audiobooks: MediaTypeConfigSchema,
})

// ─────────────────────────────────────────────
// Loader
// ─────────────────────────────────────────────

/**
 * Load and validate `config.json`. On any failure (missing file, malformed
 * JSON, schema mismatch) print a targeted message and exit cleanly.
 *
 * The function returns the same `AppConfig` shape the rest of the code
 * already expects, so callers swap `JSON.parse(...) as AppConfig` for
 * `loadConfig(projectRoot)` with no other changes.
 */
export function loadConfig(projectRoot: string): AppConfig {
  const configPath = path.join(projectRoot, 'config.json')

  if (!fs.existsSync(configPath)) {
    console.error(`\n  Error: config.json not found at ${configPath}`)
    console.error('  Create it with a root_path for each media type. Minimal example:')
    console.error('    {')
    console.error('      "movies":     { "root_path": "M:\\\\Movies" },')
    console.error('      "shows":      { "root_path": "M:\\\\Shows" },')
    console.error('      "music":      { "root_path": "M:\\\\Audio" },')
    console.error('      "audiobooks": { "root_path": "M:\\\\Audiobooks" }')
    console.error('    }')
    process.exit(1)
  }

  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  } catch (err) {
    console.error(`\n  Error parsing config.json: ${(err as Error).message}`)
    process.exit(1)
  }

  const parsed = AppConfigSchema.safeParse(raw)
  if (!parsed.success) {
    console.error('\n  Error: config.json failed schema validation:')
    for (const issue of parsed.error.issues) {
      const where = issue.path.length > 0 ? issue.path.join('.') : '(root)'
      console.error(`    - ${where}: ${issue.message}`)
    }
    process.exit(1)
  }

  return parsed.data
}
