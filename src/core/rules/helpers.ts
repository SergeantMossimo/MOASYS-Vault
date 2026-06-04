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
 * One entry in the `categories` rules array — a subfolder under root_path
 * that the scanner walks. The `name` is the folder name on disk AND the
 * label used in output (`category` field on each version).
 *
 * Leaving `categories` empty (or unset) is supported — the scanner falls
 * back to walking `root_path` directly and labelling records with `"default"`.
 */
export const CategorySchema = z.object({
  /** Subfolder name on disk under root_path, e.g. "UHD". Also used as the output label. */
  name: z.string().min(1),
})

export type Category = z.infer<typeof CategorySchema>

/**
 * Resolved internal form of a category — separates "what subfolder to walk"
 * from "what label to put on records." For configured categories these are
 * the same; for the synthetic root-walk case they differ ('' vs 'default').
 */
export interface ResolvedCategory {
  /** Subfolder under root_path to walk; empty string means walk root_path itself. */
  folderName: string
  /** Label used in output records (the version's `category` field). */
  name: string
}

/**
 * Resolve the effective category list for a media module.
 * If the rules supplied any categories, walk those. Otherwise return a single
 * synthetic entry that walks root_path and labels records "default".
 */
export function resolveCategories(configured: Category[]): ResolvedCategory[] {
  if (configured.length === 0) {
    return [{ folderName: '', name: 'default' }]
  }
  return configured.map(c => ({ folderName: c.name, name: c.name }))
}
