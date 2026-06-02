/**
 * core/rules/helpers.ts
 * ---------------------
 * Shared Zod building blocks used by every per-media-type rules schema.
 *
 * `PatternSchema` is the important bit: it accepts either a plain string or
 * a `{ pattern, flags }` object in the YAML, and normalizes both into the
 * object form so the runtime code never has to branch.
 *
 * Why this exists:
 *   JavaScript regex does NOT support inline flag groups like (?i)...
 *   so case-insensitive patterns must pass flags through the constructor.
 *   Users who don't need flags shouldn't have to write the object form.
 */

import { z } from 'zod'

/** String that must compile as a JavaScript regular expression. */
export const RegexString = z.string().refine(
  s => {
    try {
      new RegExp(s)
      return true
    } catch {
      return false
    }
  },
  { message: 'must be a valid regular expression' }
)

/**
 * A pattern in the rules YAML. Either:
 *   - a plain string:  `folder: '^(?<title>.+)\s\((?<year>\d{4})\)$'`
 *   - or an object:    `folder: { pattern: '...', flags: 'i' }`
 *
 * After parsing, the value is always `{ pattern, flags }` with `flags`
 * defaulting to `''` — so callsites can just do `new RegExp(p.pattern, p.flags)`.
 *
 * `flags` is validated against the set of letters JavaScript actually accepts
 * so a typo like `flags: 'x'` fails at boot instead of throwing inside RegExp.
 */
export const PatternSchema = z.preprocess(
  v => (typeof v === 'string' ? { pattern: v, flags: '' } : v),
  z.object({
    pattern: RegexString,
    flags: z
      .string()
      .regex(/^[dgimsuy]*$/, {
        message:
          'flags must be a combination of JavaScript regex flag letters (d, g, i, m, s, u, y)',
      })
      .default(''),
  })
)

/** Inferred type for a normalized pattern entry. */
export type Pattern = z.infer<typeof PatternSchema>

/** Compile a Pattern into a RegExp. Convenience for factories. */
export function compilePattern(p: Pattern): RegExp {
  return new RegExp(p.pattern, p.flags)
}

/**
 * One entry in the media_folders rules array — maps a folder name on disk
 * to a tag used in output. Same shape that used to live in `BaseMediaConfig`
 * as part of `config.json`. Now part of rules so it sits alongside the things
 * that reference its tags (e.g. movies' `quality_thresholds`).
 *
 * Leaving `media_folders` empty (or unset) is supported — the scanner falls
 * back to walking `root_path` directly and tagging records with `"default"`.
 */
export const MediaFolderSchema = z.object({
  /** Subfolder name on disk under root_path, e.g. "UHD" */
  name: z.string(),
  /** Label used in output JSON, e.g. "UHD" or "Music" */
  tag: z.string(),
})

export type MediaFolder = z.infer<typeof MediaFolderSchema>

/** Synthetic single-entry list used when media_folders is empty. */
export const IMPLICIT_MEDIA_FOLDER: MediaFolder = { name: '', tag: 'default' }

/**
 * Resolve the effective media_folders list for a media module.
 * If the rules supplied any folders, use them. Otherwise return a synthetic
 * single-entry list pointing at root_path with tag "default".
 */
export function resolveMediaFolders(configured: MediaFolder[]): MediaFolder[] {
  return configured.length > 0 ? configured : [IMPLICIT_MEDIA_FOLDER]
}
