/**
 * core/rules/audiobooks.ts
 * ------------------------
 * Schema, defaults, and inferred type for the Audiobooks rules layer.
 *
 * Mirrors the previously hardcoded patterns in src/media/audiobooks.ts.
 *
 * Author folder parsing (single author, comma-separated, "and"-joined) lives
 * in code — it's not regex-shaped and exposing it as YAML would be more
 * brittle than helpful. If anyone needs a different author convention later
 * we can add a separator field then.
 */

import { z } from 'zod'

import { PatternSchema } from './helpers'

export const AudiobooksRulesSchema = z.object({
  /**
   * Regex patterns for chapter file stems.
   *
   * The scanner tries `multi_disc` first (more specific), then `single_disc`.
   * - `single_disc` captures: chapter, name
   * - `multi_disc` captures: disc, chapter, name
   *
   * Single-disc files (e.g. "01 - Chapter Name") are treated as disc 1.
   */
  patterns: z.object({
    single_disc: PatternSchema,
    multi_disc: PatternSchema,
  }),

  /**
   * File extensions for sidecar files (NFO metadata, cover art).
   * Silently allowed anywhere in the audiobooks hierarchy.
   */
  sidecar_extensions: z.array(z.string()),

  /** Per-warning toggles. */
  checks: z.object({
    warn_non_primary: z.boolean(),
    warn_no_audio: z.boolean(),
    warn_bad_chapter_name: z.boolean(),
    warn_chapter_gaps: z.boolean(),
    warn_duplicate_book: z.boolean(),
    /**
     * Audio files found at a level where the scanner expects a subfolder.
     * Examples: files directly in a media folder (no author), or directly
     * in an author folder (no book subfolder). Silently dropped without
     * this warning enabled.
     */
    warn_loose_files: z.boolean(),
    /**
     * Subfolders inside a book folder. The scanner expects a flat chapter
     * layout (multi-disc uses prefix like 101, 201). Files in subfolders
     * are silently dropped without this warning enabled.
     */
    warn_extra_subfolders: z.boolean(),
    /**
     * Files that aren't audio, aren't recognized sidecars, and aren't known
     * OS artifacts. Catches stray files silently ignored elsewhere.
     */
    warn_unexpected_entries: z.boolean(),
  }),
})

export type AudiobooksRules = z.infer<typeof AudiobooksRulesSchema>

export const defaultAudiobooksRules: AudiobooksRules = AudiobooksRulesSchema.parse({
  patterns: {
    single_disc: '^(?<chapter>\\d{2})\\s-\\s(?<name>.+)$',
    multi_disc: '^(?<disc>\\d+)(?<chapter>\\d{2})\\s-\\s(?<name>.+)$',
  },
  // Audiobook sidecars — NFO metadata, cover art, cuesheets, PDF booklets.
  sidecar_extensions: ['.nfo', '.jpg', '.jpeg', '.png', '.webp', '.cue', '.pdf'],
  checks: {
    warn_non_primary: true,
    warn_no_audio: true,
    warn_bad_chapter_name: true,
    warn_chapter_gaps: true,
    warn_duplicate_book: true,
    warn_loose_files: true,
    warn_extra_subfolders: true,
    warn_unexpected_entries: true,
  },
})
