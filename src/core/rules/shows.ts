/**
 * core/rules/shows.ts
 * -------------------
 * Schema, defaults, and inferred type for the Shows rules layer.
 *
 * Mirrors the previously hardcoded regex and constants in src/media/shows.ts.
 * `ignored_season_names` used to live in config.json — moved here since it
 * describes a Plex naming convention, not a per-user library path.
 */

import { z } from 'zod'

import { PatternSchema, CategorySchema } from './helpers'

export const ShowsRulesSchema = z.object({
  /**
   * Regex patterns for show, season, and episode names.
   * - `show_folder` must capture: title, year
   * - `season_folder` must capture: season (number string, will be parseInt'd)
   * - `file` must capture: title, year, season, episode, and optionally episode_end
   *
   * `season_folder` and `file` default to case-insensitive matching (`flags: 'i'`)
   * so `season 01` and `s01e01` are accepted too.
   */
  patterns: z.object({
    show_folder: PatternSchema,
    season_folder: PatternSchema,
    file: PatternSchema,
  }),

  /** Subfolders under root_path to walk. Empty = walk root_path directly with "default" label. */
  categories: z.array(CategorySchema),

  /** Expected primary file format(s) for episodes. */
  primary_extension: z.array(z.string()).min(1),

  /** All file extensions the scanner recognizes as video files. */
  video_extensions: z.array(z.string()).min(1),

  /**
   * Season folder names that bypass the season-folder regex check.
   * Useful for Plex special-season conventions like "Specials" or
   * library-specific named events.
   */
  ignored_season_names: z.array(z.string()),

  /**
   * File extensions for Plex sidecar files (NFO metadata, posters,
   * subtitles, etc.). Silently allowed anywhere in the shows hierarchy
   * and never flagged as "unexpected".
   */
  sidecar_extensions: z.array(z.string()),

  /**
   * Quality buckets for ffprobe-driven validation. Same shape and behavior
   * as movies — see src/core/rules/movies.ts for details. Empty by default.
   */
  quality_thresholds: z.array(
    z.object({
      name: z.string(),
      min_width: z.number().int().positive().optional(),
      max_width: z.number().int().positive().optional(),
    })
  ),

  /**
   * Per-season cross-quality combos that are intentional and should NOT
   * trigger the multi-quality warning for a season. Examples: a series whose
   * S01 you bought on DVD (SD) and S02-S08 on Bluray (HD) won't fire — those
   * are different seasons in different qualities. The check fires only when
   * a SINGLE season has copies in multiple qualities (e.g. you have S01 on
   * both DVD and Bluray). Comparison is set-based — order doesn't matter.
   */
  acceptable_quality_combos: z.array(z.array(z.string())),

  /** Per-warning toggles. */
  checks: z.object({
    warn_non_primary: z.boolean(),
    warn_no_videos: z.boolean(),
    warn_bad_show_folder: z.boolean(),
    warn_bad_season_folder: z.boolean(),
    warn_bad_file_name: z.boolean(),
    warn_show_year_mismatch: z.boolean(),
    warn_season_mismatch: z.boolean(),
    warn_episode_gaps: z.boolean(),
    warn_quality_mismatch: z.boolean(),
    /**
     * A SINGLE season exists in multiple distinct qualities (e.g. S01 is in
     * both HD and SD). Per-season scope — different seasons in different
     * qualities (S01 DVD, S02 Bluray) do NOT trigger this.
     */
    warn_multi_quality: z.boolean(),
    /**
     * Video files found at a level where the scanner expects a subfolder.
     * Examples: files directly in a media folder (no show), or directly in
     * a show folder (no season subfolder). Silently dropped without this
     * warning enabled.
     */
    warn_loose_files: z.boolean(),
    /**
     * Subfolders inside a season folder. The scanner expects a flat episode
     * layout. Files in subfolders are silently dropped without this warning.
     */
    warn_extra_subfolders: z.boolean(),
    /**
     * Files that aren't video, aren't recognized Plex sidecars, and aren't
     * known OS artifacts. Catches stray files silently ignored elsewhere.
     */
    warn_unexpected_entries: z.boolean(),
    /**
     * TMDB found no plausible match for the local title + year. Surfaced
     * from the validate pass (validation-warnings.json).
     */
    warn_tmdb_no_match: z.boolean(),
    /**
     * TMDB match had low confidence — title close but not exact, or year
     * disagrees. Worth reviewing.
     */
    warn_tmdb_low_confidence: z.boolean(),
    /**
     * Local season has a different episode count than TMDB reports. Catches
     * incomplete seasons even when episode numbers don't have gaps (e.g.
     * you have 1-10 but TMDB says the season has 13). Per-season warning.
     */
    warn_tmdb_episode_count: z.boolean(),
    /**
     * TMDB matched but the folder title isn't byte-for-byte equal to TMDB's
     * filename-safe canonical title (case-sensitive). Same idea as the
     * movies rule — surfaces case/accent/capitalization opportunities.
     */
    warn_tmdb_title_canonical: z.boolean(),
  }),
})

export type ShowsRules = z.infer<typeof ShowsRulesSchema>

export const defaultShowsRules: ShowsRules = ShowsRulesSchema.parse({
  patterns: {
    show_folder: '^(?<title>.+)\\s\\((?<year>\\d{4})\\)$',
    season_folder: { pattern: '^Season\\s(?<season>\\d{2})$', flags: 'i' },
    file: {
      pattern:
        '^(?<title>.+)\\s\\((?<year>\\d{4})\\)\\s-\\sS(?<season>\\d{2})E(?<episode>\\d{2})(?:-E?(?<episode_end>\\d{2}))?(?:\\s-\\s.+)?$',
      flags: 'i',
    },
  },
  categories: [],
  primary_extension: ['.mp4'],
  video_extensions: ['.mp4', '.mkv', '.avi', '.m4v', '.mov', '.wmv', '.ts', '.m2ts'],
  ignored_season_names: ['Specials'],
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
  quality_thresholds: [],
  // Neutral default mirroring movies: a UHD master + HD downscale of the same
  // season is commonly intentional. Libraries can clear or extend this in
  // shows.local.yaml.
  acceptable_quality_combos: [['UHD', 'HD']],
  checks: {
    warn_non_primary: true,
    warn_no_videos: true,
    warn_bad_show_folder: true,
    warn_bad_season_folder: true,
    warn_bad_file_name: true,
    warn_show_year_mismatch: true,
    warn_season_mismatch: true,
    warn_episode_gaps: true,
    warn_quality_mismatch: true,
    warn_multi_quality: true,
    warn_loose_files: true,
    warn_extra_subfolders: true,
    warn_unexpected_entries: true,
    warn_tmdb_no_match: true,
    warn_tmdb_low_confidence: true,
    warn_tmdb_episode_count: true,
    warn_tmdb_title_canonical: true,
  },
})
