/**
 * core/types.ts
 * ------------
 * Shared TypeScript interfaces used across all media modules and the core scanner.
 * Defining types here means any structural change is caught by the compiler
 * everywhere it's used — no silent mismatches between modules.
 */

// ─────────────────────────────────────────────
// Config types
// ─────────────────────────────────────────────

/**
 * One entry in the categories rules array — a subfolder under root_path
 * that the scanner walks. Re-exported from core/rules/helpers.ts.
 */
import type { Category, ResolvedCategory } from './rules/helpers'
import type { ProbeData } from '../probe/types'
export type { Category, ResolvedCategory }

/**
 * Shared fields present in every media type config section.
 * config.json now only carries the per-machine root_path. Everything else
 * (extensions, patterns, conventions, the categories list) lives in the
 * rules layer (src/core/rules/<type>.ts and rules/<type>.yaml).
 */
export interface BaseMediaConfig {
  root_path: string
}

/**
 * Per-type config interfaces. All four are structurally identical to
 * BaseMediaConfig now — kept as named aliases for documentation and so
 * future per-type config fields have a natural home.
 */
export type MoviesConfig = BaseMediaConfig
export type ShowsConfig = BaseMediaConfig
export type MusicConfig = BaseMediaConfig
export type AudiobooksConfig = BaseMediaConfig

/** The full shape of config.json */
export interface AppConfig {
  _notes?: Record<string, string> // Optional documentation keys — ignored by scanner
  movies: MoviesConfig
  shows: ShowsConfig
  music: MusicConfig
  audiobooks: AudiobooksConfig
}

// ─────────────────────────────────────────────
// Warning types
// ─────────────────────────────────────────────

/** A single warning entry written to warnings.json */
export interface Warning {
  type: string // Stable machine-readable identifier (e.g. 'warn_bad_folder_name')
  path: string
  issue: string
  extension?: string // Optional — only present for non-primary file warnings
}

/** The full shape of warnings.json */
export interface WarningsOutput {
  generated: string // ISO 8601 UTC timestamp
  count: number
  files: Warning[]
}

// ─────────────────────────────────────────────
// Version (unified per-copy descriptor)
// ─────────────────────────────────────────────

/**
 * One physical copy of a media item — where it lives (category) and what
 * quality it is. The same record can have multiple versions when it lives
 * in more than one category, or when its tracks/episodes have multiple
 * codecs/resolutions.
 *
 * For movies/shows, `quality` is derived from probe data (long-edge px
 * mapped against quality_thresholds) and is null until the probe pass has
 * run. For music/audiobooks, `quality` is the file extension uppercased
 * (FLAC, MP3, AAC, etc.) and is always populated during scan.
 */
export interface Version {
  category: string
  quality: string | null
}

// ─────────────────────────────────────────────
// Movie types
// ─────────────────────────────────────────────

/** Internal record for a single movie (or edition) during scanning */
export interface MovieRecord {
  title: string
  year: number
  edition: string | null // null = no edition tag, string = edition name
  versions: Version[] // may contain duplicates; deduped on serialize
}

/** One entry in movies.json */
export interface MovieOutput {
  title: string
  year: number
  edition: string | null
  versions: Version[] // sorted by category order, then by quality
}

// ─────────────────────────────────────────────
// Show types
// ─────────────────────────────────────────────

/**
 * One episode (or multi-episode file) parsed from disk. Carried through to
 * `shows.json` so downstream consumers (and the TMDB-episode-name validation
 * pass) can join on `(season, episode_start)`.
 *
 *   episode_start === episode_end → single-episode file
 *   episode_start !== episode_end → multi-episode file (e.g. S01E01-E02)
 *   title === null                 → filename omits " - Episode Title"
 */
export interface EpisodeOutput {
  episode_start: number
  episode_end: number
  title: string | null
}

/** Internal record for a single season during scanning */
export interface SeasonRecord {
  season_label: string // "1", "2", "Specials" etc.
  episode_count: number
  versions: Version[]
  episodes: EpisodeOutput[]
}

/** Internal record for a single show during scanning */
export interface ShowRecord {
  title: string
  year: number
  seasons: Map<string, SeasonRecord> // Key = season_key string
}

/** One season entry in shows.json */
export interface SeasonOutput {
  season: string // "1", "2", "Specials"
  episode_count: number
  versions: Version[]
  episodes: EpisodeOutput[]
}

/** One entry in shows.json */
export interface ShowOutput {
  title: string
  year: number
  seasons: SeasonOutput[]
}

// ─────────────────────────────────────────────
// Music types
// ─────────────────────────────────────────────

/** Internal record for a single album during scanning */
export interface AlbumRecord {
  album: string
  track_count: number
  versions: Version[] // (category, codec) pairs; deduped on serialize
}

/** Internal record for a single artist during scanning */
export interface ArtistRecord {
  artist: string
  albums: Map<string, AlbumRecord> // Key = album_key string
}

/** One album entry in music.json */
export interface AlbumOutput {
  album: string
  track_count: number
  versions: Version[]
}

/** One entry in music.json */
export interface ArtistOutput {
  artist: string
  albums: AlbumOutput[]
}

// ─────────────────────────────────────────────
// Audiobook types
// ─────────────────────────────────────────────

/** Internal record for a single book during scanning */
export interface BookRecord {
  title: string
  authors: string[] // e.g. ["Terry Pratchett", "Neil Gaiman"]
  chapter_count: number
  versions: Version[] // (category, codec) pairs; deduped on serialize
}

/** One entry in audiobooks.json */
export interface BookOutput {
  title: string
  authors: string[]
  chapter_count: number
  versions: Version[]
}

// ─────────────────────────────────────────────
// Media module interface
// ─────────────────────────────────────────────

/**
 * Every media module (movies, shows, music, audiobooks) must conform to this interface.
 * The core scanner calls these functions without knowing which media type it's working with.
 * Adding a new media type means implementing this interface in a new file.
 */
export interface MediaModule<TRecord, TOutput, TConfig extends BaseMediaConfig> {
  /**
   * Return the effective categories for this module. The factory resolves
   * this from rules.categories, synthesizing a single-entry list pointing
   * at root_path (name: "default", folderName: "") when the user hasn't
   * configured any. The core scanner iterates whatever this returns.
   */
  getCategories(): ResolvedCategory[]

  /**
   * Walk one category folder and return a map of records found.
   *
   * `probeByPath` provides ffprobe results keyed by relative path (forward
   * slashes) so video modules can derive a `quality` for each version from
   * the file's dimensions. Audio modules generally ignore it and key off
   * the file extension instead.
   */
  scanCategory(
    folderPath: string,
    folderName: string,
    category: string,
    config: TConfig,
    warnings: WarningCollector,
    probeByPath: Map<string, ProbeData>
  ): Map<string, TRecord>

  /** Merge records from one media folder into the accumulated results */
  merge(existing: Map<string, TRecord>, incoming: Map<string, TRecord>): void

  /** Convert internal records to the final output shape for JSON */
  serialize(records: Map<string, TRecord>): TOutput[]

  /**
   * Optional: runs once after all media folders have been scanned and merged.
   * Use for warnings that need the fully-merged records map (e.g. movies'
   * multi-quality check, which can only fire once a movie's qualities Set is
   * complete across all folders).
   */
  postScan?(records: Map<string, TRecord>, warnings: WarningCollector): void
}

// ─────────────────────────────────────────────
// Warning collector class
// ─────────────────────────────────────────────

/**
 * Accumulates warning messages during a scan.
 * Passed into each media module so warnings can be added from anywhere
 * in the scanning process and written to warnings.json at the end.
 *
 * If constructed with `ignoredPaths`, any warning whose `path` matches an
 * ignore prefix (see `core/ignored.ts`) is silently dropped — the user's
 * way of permanently silencing warnings they can't or don't want to fix.
 * Silenced warnings are still counted via `silencedCount()` so the runner
 * can surface "N silenced" in its summary.
 */
import { IgnoredEntry, isWarningIgnored } from './ignored'

export class WarningCollector {
  private warnings: Warning[] = []
  private silenced = 0

  constructor(private ignored: IgnoredEntry[] = []) {}

  /** Add a warning. type, path, and issue are required; extension is optional.
   *  - type:   stable machine-readable identifier (e.g. 'warn_bad_folder_name'),
   *            used for grouping in warnings.json and for type-scoped silencing
   *            in ignored/<type>.yaml.
   *  - path:   library-relative location. Backslashes are normalized to forward
   *            slashes so output is consistent across Windows and macOS/Linux.
   *  - issue:  human-readable description.
   *  - extension: optional file extension, only set for non-primary file warnings. */
  add(type: string, path: string, issue: string, extension?: string): void {
    const normalizedPath = path.replace(/\\/g, '/')
    if (isWarningIgnored(type, normalizedPath, this.ignored)) {
      this.silenced++
      return
    }
    const entry: Warning = { type, path: normalizedPath, issue }
    if (extension !== undefined) entry.extension = extension
    this.warnings.push(entry)
  }

  /** Return a copy of all collected warnings, sorted by (type, path) for
   *  predictable grouping in warnings.json. */
  all(): Warning[] {
    return [...this.warnings].sort((a, b) => {
      if (a.type !== b.type) return a.type.localeCompare(b.type)
      return a.path.localeCompare(b.path)
    })
  }

  /** Return the total number of warnings collected (excludes silenced). */
  count(): number {
    return this.warnings.length
  }

  /** Return the number of warnings silenced by the ignore list. */
  silencedCount(): number {
    return this.silenced
  }
}
