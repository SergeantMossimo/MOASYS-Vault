/**
 * core/rules/movies.ts
 * --------------------
 * Schema, defaults, and inferred type for the Movies rules layer.
 *
 * Rules describe the *conventions* of a Plex movie library — what folder
 * and file names look like, what year range is plausible, which cross-folder
 * quality combos are intentional, and which warnings the user wants to see.
 *
 * Code-shipped defaults below mirror the original hardcoded constants and
 * regex from src/media/movies.ts so that running with no rules/movies.yaml
 * file behaves identically to the pre-refactor scanner.
 */

import { z } from 'zod'

import { PatternSchema } from './helpers'

export const MoviesRulesSchema = z.object({
  /** Regex patterns for folder and file names. Must use named capture groups. */
  patterns: z.object({
    /** Captures: title, year */
    folder: PatternSchema,
    /** Captures: title, year, edition (optional) */
    file: PatternSchema,
  }),

  /**
   * Acceptable year range for a film.
   * `max: "current"` is replaced with the current year at load time so
   * the runtime always sees `max: number`.
   */
  year_range: z.object({
    min: z.number().int().positive(),
    max: z.union([z.number().int().positive(), z.literal('current')]),
  }),

  /**
   * Cross-folder quality combos that are intentional and should NOT trigger
   * the "movie exists in multiple quality folders" warning.
   * Comparison is set-based — order inside each combo doesn't matter.
   */
  acceptable_quality_combos: z.array(z.array(z.string())),

  /**
   * File extensions for Plex sidecar files (NFO metadata, posters,
   * subtitles, etc.). Files with these extensions are silently allowed
   * anywhere in the movie hierarchy and never flagged as "unexpected".
   * Override if your library uses additional sidecar formats.
   */
  sidecar_extensions: z.array(z.string()),

  /**
   * Quality buckets for ffprobe-driven validation. Each bucket groups one or
   * more folder tags (e.g. UHD + Other UHD) and defines a pixel-width range
   * the file's long edge must fall within. Compared against max(width, height)
   * so HandBrake-cropped or rotated files still classify correctly.
   *
   * Empty by default — only files in folders whose tag appears in a bucket
   * are checked, so libraries with custom folder structures don't get bogus
   * warnings until they configure their own buckets.
   */
  quality_thresholds: z.array(
    z.object({
      name: z.string(), // Display name used in warning messages, e.g. "UHD"
      tags: z.array(z.string()).min(1),
      min_width: z.number().int().positive().optional(),
      max_width: z.number().int().positive().optional(),
    })
  ),

  /** Per-warning toggles. Set any to false to silence that warning. */
  checks: z.object({
    warn_non_primary: z.boolean(),
    warn_no_videos: z.boolean(),
    warn_bad_file_name: z.boolean(),
    warn_bad_folder_name: z.boolean(),
    warn_empty_edition: z.boolean(),
    warn_suspicious_year: z.boolean(),
    warn_title_mismatch: z.boolean(),
    warn_year_mismatch: z.boolean(),
    warn_duplicate_edition: z.boolean(),
    warn_multi_quality: z.boolean(),
    warn_quality_mismatch: z.boolean(),
    /**
     * Video files found at a level where the scanner expects a subfolder.
     * Specifically: video files placed directly in a media folder rather
     * than inside a Movie Title (YEAR) folder. Files there are silently
     * dropped from the catalog without this warning enabled.
     */
    warn_loose_files: z.boolean(),
    /**
     * Subfolders inside a movie folder. The scanner does not recurse, so
     * video files in subfolders are silently dropped without this warning.
     */
    warn_extra_subfolders: z.boolean(),
    /**
     * Files that aren't video, aren't recognized Plex sidecars, and aren't
     * known OS artifacts (Thumbs.db, .DS_Store, etc.). Catches stray .zip,
     * .txt, .m3u files etc. that are silently ignored without this check.
     */
    warn_unexpected_entries: z.boolean(),
  }),
})

export type MoviesRules = z.infer<typeof MoviesRulesSchema>

// Defaults use the string form of patterns since none need flags — Zod's
// preprocess normalizes them to { pattern, flags: '' } at validation time.
export const defaultMoviesRules: MoviesRules = MoviesRulesSchema.parse({
  patterns: {
    folder: '^(?<title>.+)\\s\\((?<year>\\d{4})\\)$',
    file: '^(?<title>.+)\\s\\((?<year>\\d{4})\\)(?:\\s\\{edition-(?<edition>[^}]*)\\})?$',
  },
  year_range: {
    min: 1888, // Roundhay Garden Scene
    max: 'current',
  },
  acceptable_quality_combos: [
    ['UHD', 'HD'],
    ['Other UHD', 'Other HD'],
    ['HD', 'Other UHD'],
    ['UHD', 'Other HD'],
  ],
  // Plex sidecar formats — metadata (.nfo), artwork (.jpg/.png/.webp/.tbn),
  // subtitles (.srt/.ass/.ssa/.vtt/.sub/.idx). Silently allowed everywhere.
  sidecar_extensions: [
    '.nfo',
    '.jpg',
    '.jpeg',
    '.png',
    '.webp',
    '.tbn',
    '.srt',
    '.ass',
    '.ssa',
    '.vtt',
    '.sub',
    '.idx',
  ],
  quality_thresholds: [], // Ships empty — see rules/movies.example.yaml for the shape
  checks: {
    warn_non_primary: true,
    warn_no_videos: true,
    warn_bad_file_name: true,
    warn_bad_folder_name: true,
    warn_empty_edition: true,
    warn_suspicious_year: true,
    warn_title_mismatch: true,
    warn_year_mismatch: true,
    warn_duplicate_edition: true,
    warn_multi_quality: true,
    warn_quality_mismatch: true,
    warn_loose_files: true,
    warn_extra_subfolders: true,
    warn_unexpected_entries: true,
  },
})
