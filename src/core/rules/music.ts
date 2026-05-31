/**
 * core/rules/music.ts
 * -------------------
 * Schema, defaults, and inferred type for the Music rules layer.
 *
 * Mirrors the previously hardcoded patterns in src/media/music.ts.
 * Music has no constants beyond regex — just patterns and check toggles.
 */

import { z } from 'zod'

import { PatternSchema } from './helpers'

export const MusicRulesSchema = z.object({
  /**
   * Regex patterns for folders and track file stems.
   *
   * Track stems: the scanner tries `multi_disc` first (more specific), then
   * `single_disc`. Single-disc files (e.g. "01 - Track Name") get disc 1.
   *
   * - `artist_folder` captures: name. Default matches any non-empty name —
   *   Plex itself doesn't specify a format for artist folders.
   * - `album_folder` captures: name. Same — Plex example: `/The Wall`, no year.
   * - `single_disc` captures: track, name
   * - `multi_disc` captures: disc, track, name
   *
   * Override `artist_folder` or `album_folder` if your library uses a stricter
   * convention (e.g. album folders that include the year in parens).
   */
  patterns: z.object({
    artist_folder: PatternSchema,
    album_folder: PatternSchema,
    single_disc: PatternSchema,
    multi_disc: PatternSchema,
  }),

  /**
   * File extensions for Plex sidecar files (NFO metadata, cover art,
   * lyrics, cuesheets). Silently allowed anywhere in the music hierarchy
   * and never flagged as "unexpected".
   */
  sidecar_extensions: z.array(z.string()),

  /** Per-warning toggles. */
  checks: z.object({
    warn_non_primary: z.boolean(),
    warn_no_audio: z.boolean(),
    warn_bad_track_name: z.boolean(),
    warn_bad_artist_folder: z.boolean(),
    warn_bad_album_folder: z.boolean(),
    warn_suspicious_folder_chars: z.boolean(),
    warn_track_gaps: z.boolean(),
    warn_duplicate_album: z.boolean(),
    /**
     * Audio files found at a level where the scanner expects a subfolder.
     * Examples: tracks directly in the media folder (no artist), or tracks
     * directly in an artist folder (no album). Files at these levels are
     * silently dropped from the catalog without this warning enabled.
     */
    warn_loose_files: z.boolean(),
    /**
     * Subfolders inside an album folder, where Plex expects a flat track
     * layout. Multi-disc albums should use disc-prefixed numbers (101, 201)
     * rather than per-disc subfolders. Files inside such subfolders are
     * silently dropped without this warning enabled.
     */
    warn_extra_subfolders: z.boolean(),
    /**
     * Files that aren't audio, aren't recognized Plex sidecars, and aren't
     * known OS artifacts. Catches stray files silently ignored elsewhere.
     */
    warn_unexpected_entries: z.boolean(),
  }),
})

export type MusicRules = z.infer<typeof MusicRulesSchema>

export const defaultMusicRules: MusicRules = MusicRulesSchema.parse({
  patterns: {
    // Permissive defaults — Plex has no required format for artist or album
    // folders. The named capture is there so callers and overrides can rely
    // on `match.groups.name` regardless of how strict the user's regex gets.
    artist_folder: '^(?<name>.+)$',
    album_folder: '^(?<name>.+)$',
    single_disc: '^(?<track>\\d{2})\\s-\\s(?<name>.+)$',
    multi_disc: '^(?<disc>\\d+)(?<track>\\d{2})\\s-\\s(?<name>.+)$',
  },
  // Music sidecars — NFO metadata, cover art, lyrics, cuesheets, PDF liner notes.
  sidecar_extensions: [
    '.nfo',
    '.jpg',
    '.jpeg',
    '.png',
    '.webp',
    '.lrc',
    '.cue',
    '.m3u',
    '.m3u8',
    '.pdf',
  ],
  checks: {
    warn_non_primary: true,
    warn_no_audio: true,
    warn_bad_track_name: true,
    warn_bad_artist_folder: true,
    warn_bad_album_folder: true,
    warn_suspicious_folder_chars: true,
    warn_track_gaps: true,
    warn_duplicate_album: true,
    warn_loose_files: true,
    warn_extra_subfolders: true,
    warn_unexpected_entries: true,
  },
})
