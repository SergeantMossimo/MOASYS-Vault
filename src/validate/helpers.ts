/**
 * validate/helpers.ts
 * -------------------
 * Shared helpers used by both movies and shows validation.
 *
 * These were duplicated verbatim across movies.ts and shows.ts during the
 * initial build — extracted here so any future tweaks to normalization or
 * year-parsing happen in exactly one place.
 */

// ─────────────────────────────────────────────
// Filename-safe normalization
// ─────────────────────────────────────────────

/**
 * Strip Windows-illegal filename characters from a string without replacement.
 * Used in two places:
 *   1. Matching normalization — both sides become equal when the user removed
 *      a slash/colon/asterisk that they couldn't have used in a folder name.
 *   2. Deriving `tmdb_title_filename_safe` for the output — gives the user a
 *      copy-pasteable rename target.
 *
 *   "50/50"           → "5050"
 *   "3:10 to Yuma"    → "310 to Yuma"
 *   "M*A*S*H"         → "MASH"
 *   "WALL·E"          → "WALL·E"  (middot is legal in filenames; left alone)
 *
 * Windows-illegal characters: `< > : " | ? * \ /`
 */
export function stripFilenameIllegalChars(s: string): string {
  return s.replace(/[<>:"|?*\\/]/g, '')
}

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
