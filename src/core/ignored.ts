/**
 * core/ignored.ts
 * ---------------
 * Loader + matcher for `ignored/<type>.yaml` — a per-type, gitignored file
 * that lets the user persistently silence warnings on specific paths.
 *
 * Lives in its own `ignored/` folder rather than `rules/` because these
 * aren't rules; they're per-library exceptions. Each type also ships a
 * committed `ignored/<type>.yaml.example` with commented usage patterns.
 *
 * Use case: the library has shows with genuinely incomplete seasons (web
 * extras that never aired, content that was never released on the format,
 * etc.) where the user can't fix the underlying issue but doesn't want the
 * `warn_episode_gaps` / `warn_tmdb_episode_count` noise on every run.
 *
 * Shape (the YAML is just a flat list of path prefixes):
 *
 *   # ignored/shows.yaml
 *   - HD/Channel 4 Catchup (2024)
 *   - HD/Some Show (2020)/Season 2
 *   - SD/Old VHS Rip (1995)
 *
 * Matching is case-insensitive and forward-slash-normalized so the same
 * file works on Windows (where warnings.json paths use `\`) and macOS/Linux.
 * A warning is silenced when its `path` either equals an ignored entry
 * exactly OR starts with one followed by `/` — so `HD/Show (2020)` silences
 * everything under that show's folder.
 */

import fs from 'fs'
import path from 'path'

import jsYaml from 'js-yaml'
import { z } from 'zod'

// ─────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────

/** Flat list of non-empty path prefixes. */
export const IgnoredPathsSchema = z.array(z.string().min(1))

// ─────────────────────────────────────────────
// Loader
// ─────────────────────────────────────────────

/**
 * Load and validate `ignored/<mediaType>.yaml`. Returns the parsed list of
 * path prefixes, or an empty list when the file doesn't exist.
 *
 * On YAML parse error or schema validation failure: prints a clear message
 * and exits — same fail-fast pattern as the rules loader.
 */
export function loadIgnoredPaths(projectRoot: string, mediaType: string): string[] {
  const file = path.join(projectRoot, 'ignored', `${mediaType}.yaml`)
  if (!fs.existsSync(file)) return []

  let raw: unknown
  try {
    raw = jsYaml.load(fs.readFileSync(file, 'utf-8'))
  } catch (err) {
    console.error(`\n  Error parsing ${file}: ${(err as Error).message}`)
    process.exit(1)
  }

  // A YAML file consisting only of comments parses to null. Normalize to [].
  if (raw === null || raw === undefined) return []

  const parsed = IgnoredPathsSchema.safeParse(raw)
  if (!parsed.success) {
    console.error(`\n  Error: ${file} must be a list of non-empty strings:`)
    for (const issue of parsed.error.issues) {
      const where = issue.path.length > 0 ? issue.path.join('.') : '(root)'
      console.error(`    - ${where}: ${issue.message}`)
    }
    process.exit(1)
  }

  return parsed.data
}

// ─────────────────────────────────────────────
// Matcher
// ─────────────────────────────────────────────

/**
 * Normalize a path for ignore-list comparison: forward slashes, lowercase.
 * The lowercase is friendliness — Windows is case-insensitive and Plex tends
 * to be case-preserving, so we don't want users to fight tiny case diffs.
 */
function normalize(s: string): string {
  return s.replace(/\\/g, '/').toLowerCase()
}

/**
 * Return true if `warningPath` is silenced by any of the `ignoredPaths`.
 * A path is silenced when it equals an ignored entry OR is nested under one
 * (i.e. starts with `entry + '/'`). Empty ignore list never silences.
 */
export function isPathIgnored(warningPath: string, ignoredPaths: string[]): boolean {
  if (ignoredPaths.length === 0) return false
  const target = normalize(warningPath)
  return ignoredPaths.some(entry => {
    const e = normalize(entry)
    return target === e || target.startsWith(e + '/')
  })
}
