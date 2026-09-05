/**
 * core/ignored.ts
 * ---------------
 * Loader + matcher for `ignored/<drive>/<type>.yaml` — a per-drive, per-type
 * gitignored file that lets the user persistently silence warnings on
 * specific paths.
 *
 * Scoped per drive because warning paths are relative to that drive's
 * `root_path`, so the same relative path can mean different files on
 * different drives. `ignored/server/movies.yaml` only affects runs against
 * the "Server" root.
 *
 * Lives in its own `ignored/` folder rather than `rules/` because these
 * aren't rules; they're per-library exceptions. Each type also ships a
 * committed `ignored/<type>.yaml.example` at the top level with commented
 * usage patterns — copy one into `ignored/<drive>/<type>.yaml` to start.
 *
 * Use case: the library has shows with genuinely incomplete seasons (web
 * extras that never aired, content that was never released on the format,
 * etc.) where the user can't fix the underlying issue but doesn't want the
 * `warn_episode_gaps` / `warn_tmdb_episode_count` noise on every run.
 *
 * Two entry shapes — both allowed in the same file:
 *
 *   # Path-only entry: silences EVERY warning under this path prefix.
 *   - HD/Channel 4 Catchup (2024)
 *
 *   # Type-scoped entry: silences only the listed warning types under
 *   # this path prefix. Other warnings on the same path stay visible.
 *   - path: HD/Some Show (2020)/Season 2
 *     types:
 *       - warn_episode_gaps
 *       - warn_tmdb_episode_count
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

/**
 * One entry in the ignore list. Either:
 *   - a bare string (path prefix that silences every warning type), or
 *   - an object with a path prefix and one or more warning types to silence.
 */
const IgnoredEntryInputSchema = z.union([
  z.string().min(1),
  z.object({
    path: z.string().min(1),
    types: z.array(z.string().min(1)).min(1),
  }),
])

export const IgnoredPathsSchema = z.array(IgnoredEntryInputSchema)

/** Normalized in-memory representation. `types === null` means "all types". */
export interface IgnoredEntry {
  path: string
  types: string[] | null
}

// ─────────────────────────────────────────────
// Loader
// ─────────────────────────────────────────────

/**
 * Load and validate `ignored/<driveSlug>/<mediaType>.yaml`. Returns the
 * normalized list of entries, or an empty list when the file doesn't exist —
 * so a drive with nothing to silence needs no file at all.
 *
 * `driveSlug` is the lowercased root name from config.json (see
 * `driveSlug()` in core/config.ts).
 *
 * String entries are normalized to `{path, types: null}` so the matcher only
 * needs to handle one shape.
 *
 * On YAML parse error or schema validation failure: prints a clear message
 * and exits — same fail-fast pattern as the rules loader.
 */
export function loadIgnoredPaths(
  projectRoot: string,
  driveSlug: string,
  mediaType: string
): IgnoredEntry[] {
  const file = path.join(projectRoot, 'ignored', driveSlug, `${mediaType}.yaml`)
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
    console.error(`\n  Error: ${file} must be a list of strings or {path, types: [...]} objects:`)
    for (const issue of parsed.error.issues) {
      const where = issue.path.length > 0 ? issue.path.join('.') : '(root)'
      console.error(`    - ${where}: ${issue.message}`)
    }
    process.exit(1)
  }

  return parsed.data.map(entry =>
    typeof entry === 'string'
      ? { path: entry, types: null }
      : { path: entry.path, types: entry.types }
  )
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
 * Return true if a warning is silenced by any entry in `ignored`.
 * A warning matches an entry when:
 *   1. its `path` equals the entry's path OR starts with `entry.path + '/'`, AND
 *   2. the entry has no `types` (matches all) OR the entry's `types` includes
 *      the warning's `type`.
 */
export function isWarningIgnored(
  warningType: string,
  warningPath: string,
  ignored: IgnoredEntry[]
): boolean {
  if (ignored.length === 0) return false
  const target = normalize(warningPath)
  return ignored.some(entry => {
    const e = normalize(entry.path)
    const pathMatches = target === e || target.startsWith(e + '/')
    if (!pathMatches) return false
    if (entry.types === null) return true
    return entry.types.includes(warningType)
  })
}
