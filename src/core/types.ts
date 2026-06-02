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
 * One entry in the media_folders rules array — maps a folder name on disk
 * to a tag used in output. Re-exported from core/rules/helpers.ts so existing
 * imports from core/types keep working.
 */
import type { MediaFolder } from './rules/helpers'
export type { MediaFolder }

/**
 * Shared fields present in every media type config section.
 * config.json now only carries the per-machine root_path. Everything else
 * (extensions, patterns, conventions, the media_folders list) lives in the
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
// Movie types
// ─────────────────────────────────────────────

/** Internal record for a single movie (or edition) during scanning */
export interface MovieRecord {
  title: string
  year: number
  edition: string | null // null = no edition tag, string = edition name
  qualities: Set<string> // e.g. Set { "UHD", "HD" }
}

/** One entry in movies.json */
export interface MovieOutput {
  title: string
  year: number
  edition: string | null
  qualities: string[] // Sorted list e.g. ["UHD", "HD"]
}

// ─────────────────────────────────────────────
// Show types
// ─────────────────────────────────────────────

/** Internal record for a single season during scanning */
export interface SeasonRecord {
  season_label: string // "1", "2", "Specials" etc.
  episode_count: number
  qualities: Set<string>
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
  qualities: string[]
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
  qualities: Set<string> // e.g. Set { "FLAC", "MP3" }
  media_type: Set<string> // e.g. Set { "Music" }
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
  qualities: string[]
  media_type: string[]
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
  media_type: Set<string>
}

/** One entry in audiobooks.json */
export interface BookOutput {
  title: string
  authors: string[]
  chapter_count: number
  media_type: string[]
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
   * Return the effective media_folders for this module. The factory resolves
   * this from rules.media_folders, synthesizing a single-entry list pointing
   * at root_path (tag: "default") when the user hasn't configured any.
   * The core scanner iterates whatever this returns.
   */
  getMediaFolders(): MediaFolder[]

  /** Walk one media folder and return a map of records found */
  scanMediaFolder(
    folderPath: string,
    folderName: string,
    tag: string,
    config: TConfig,
    warnings: WarningCollector
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
 */
export class WarningCollector {
  private warnings: Warning[] = []

  /** Add a warning. path and issue are required; extension is optional. */
  add(path: string, issue: string, extension?: string): void {
    const entry: Warning = { path, issue }
    if (extension !== undefined) entry.extension = extension
    this.warnings.push(entry)
  }

  /** Return a copy of all collected warnings */
  all(): Warning[] {
    return [...this.warnings]
  }

  /** Return the total number of warnings collected */
  count(): number {
    return this.warnings.length
  }
}
