/**
 * validate/helpers.ts
 * -------------------
 * Shared helpers used by both movies and shows validation.
 *
 * `stripFilenameIllegalChars` lives in core/files.ts because the music
 * tag-matching path also depends on it. Re-exported here so existing
 * validate-side callsites keep working.
 */

import { stripFilenameIllegalChars } from '../core/files'

export { stripFilenameIllegalChars }

// ─────────────────────────────────────────────
// Title normalization
// ─────────────────────────────────────────────

/**
 * Normalize a title for matching against TMDB. Strict by design — only strips
 * characters the user couldn't have used in a filename anyway, so we never
 * silently bridge legitimate library/TMDB differences.
 *
 *   1. Strip Windows-illegal filename characters (no replacement).
 *   2. Lowercase.
 *   3. Collapse internal whitespace runs to single spaces.
 *   4. Trim.
 *
 * Diacritics are NOT stripped. "Amélie" ≠ "Amelie" because `é` is legal in
 * filenames — if the user typed it without the accent, that's a real (small)
 * divergence from TMDB's canonical title, and we surface it as no_match so
 * the user can decide whether to add the accent.
 *
 * Apostrophes, hyphens, periods, etc. are preserved since those are legal
 * in filenames.
 */
export function normalizeTitle(s: string): string {
  return stripFilenameIllegalChars(s).toLowerCase().replace(/\s+/g, ' ').trim()
}

// ─────────────────────────────────────────────
// Date parsing
// ─────────────────────────────────────────────

/**
 * Parse the leading 4 digits of a TMDB date string ("YYYY-MM-DD") into an
 * integer year. Returns null when the string is missing, too short, or
 * doesn't parse as a finite number.
 *
 * TMDB returns dates as ISO strings, but with occasional empty/null values
 * for unreleased films or scheduling placeholders.
 */
export function parseYear(date: string | undefined): number | null {
  if (!date || date.length < 4) return null
  const n = parseInt(date.slice(0, 4), 10)
  return Number.isFinite(n) ? n : null
}
