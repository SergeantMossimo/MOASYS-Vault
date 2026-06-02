/**
 * validate/movies.ts
 * ------------------
 * Per-movie TMDB validation. For each movie in the scan output:
 *   1. Look up the search cache. On miss, call TMDB /search/movie.
 *   2. Pick the best candidate using title + year matching with confidence
 *      scoring. Save the resolution back to the search cache.
 *   3. If a match was found, look up (or fetch + cache) movie details for
 *      the canonical title/year/runtime.
 *   4. Emit warnings for low-confidence matches so the user can review.
 *
 * The aggregated MovieValidation[] is what gets written to
 * output/movies/validation.json. Warnings go to validation-warnings.json
 * via the shared WarningCollector.
 */

import { MovieOutput, WarningCollector } from '../core/types'
import { MoviesRules } from '../core/rules/movies'

import { JsonCache, searchKey } from './cache'
import { normalizeTitle, parseYear, stripFilenameIllegalChars } from './helpers'
import { TmdbClient } from './tmdb'
import { MovieValidation, ResolvedSearch, TmdbMovieDetails, TmdbMovieSearchResult } from './types'

// ─────────────────────────────────────────────
// Match scoring
// ─────────────────────────────────────────────

/**
 * Score the best TMDB candidate against the local title + year and assign
 * a confidence bucket.
 *
 * ── Scoring components ─────────────────────────
 * Title match (one of, in priority order):
 *   100  exact match on either `title` or `original_title` after normalization
 *    60  one side is a prefix of the other followed by a space (handles missing
 *        subtitles like "Star Wars" vs "Star Wars: A New Hope")
 *    30  substring containment in either direction (last-resort fuzzy)
 *
 * Year match:
 *    50  exact
 *    30  off by 1 (US vs international release dates often differ by a year)
 *    15  off by 2
 *   -20  off by more (strong penalty — wrong year usually means wrong film)
 *
 * ── Confidence thresholds ──────────────────────
 *   high   ≥ 150  → only achievable as 100 (title exact) + 50 (year exact).
 *                   Locks in cases where both fields agree.
 *   medium ≥ 110  → 100 + 30 (title exact, year off by 1) or
 *                   60 + 50 (prefix match, year exact).
 *   low    ≥ 60   → anything else with at least a partial title match.
 *   none   < 60   → no plausible candidate; we drop the ID entirely so the
 *                   warning isn't misleading.
 *
 * The popularity sort below means: when two candidates tie on score (very
 * common with generic titles like "Heat" or "It"), we pick the more famous
 * one — which is almost always what the user has.
 */
function pickBestMovieMatch(
  localTitle: string,
  localYear: number,
  candidates: TmdbMovieSearchResult[]
): ResolvedSearch {
  if (candidates.length === 0) {
    return { best_id: null, confidence: 'none', candidates: [] }
  }

  const ourTitle = normalizeTitle(localTitle)
  let bestScore = 0
  let bestId: number | null = null
  const candidateIds: number[] = []

  // Sort by popularity descending so that score ties resolve to the better-
  // known film. TMDB's `popularity` is updated nightly from view counts +
  // search frequency, so it's a decent proxy for "the one most users mean".
  const sorted = [...candidates].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))

  // Keep only the top 5 candidate IDs for the output's `alternatives` list —
  // anything beyond the top 5 is rarely worth showing the user.
  for (const c of sorted.slice(0, 5)) candidateIds.push(c.id)

  for (const c of sorted) {
    const theirTitle = normalizeTitle(c.title)
    const theirOrigTitle = normalizeTitle(c.original_title)
    const theirYear = parseYear(c.release_date)
    const yearDelta = theirYear === null ? 99 : Math.abs(theirYear - localYear)

    let score = 0

    // Title match — try both `title` (localized) and `original_title` (native).
    // Foreign films often hit on `original_title` when the user kept the
    // native name (e.g. "Amélie" vs the English-localized version).
    if (theirTitle === ourTitle || theirOrigTitle === ourTitle) {
      score += 100
    } else if (theirTitle.startsWith(ourTitle + ' ') || ourTitle.startsWith(theirTitle + ' ')) {
      score += 60
    } else if (theirTitle.includes(ourTitle) || ourTitle.includes(theirTitle)) {
      score += 30
    }

    // Year match. The off-by-1 case is by far the most common after exact —
    // TMDB uses the original-release year, which often differs from the wide-
    // release year a user gets their copy from. Casablanca (1942 premiere /
    // 1943 wide), 300 (2006 premiere / 2007 wide), etc.
    if (yearDelta === 0) score += 50
    else if (yearDelta === 1) score += 30
    else if (yearDelta === 2) score += 15
    else score -= 20

    if (score > bestScore) {
      bestScore = score
      bestId = c.id
    }
  }

  let confidence: ResolvedSearch['confidence']
  if (bestScore >= 150) confidence = 'high'
  else if (bestScore >= 110) confidence = 'medium'
  else if (bestScore >= 60) confidence = 'low'
  else confidence = 'none'

  // Drop the ID for `none` so consumers don't accidentally treat a low-score
  // best guess as a real match. The candidate list is still preserved for
  // the alternatives section of the warning.
  if (confidence === 'none') bestId = null
  return { best_id: bestId, confidence, candidates: candidateIds }
}

// ─────────────────────────────────────────────
// Validation entry point
// ─────────────────────────────────────────────

export async function validateMovies(
  movies: MovieOutput[],
  rules: MoviesRules,
  client: TmdbClient,
  searchCache: JsonCache<ResolvedSearch>,
  detailsCache: JsonCache<TmdbMovieDetails>,
  warnings: WarningCollector,
  onProgress?: (done: number, total: number, cached: number) => void
): Promise<MovieValidation[]> {
  const out: MovieValidation[] = []
  let cachedCount = 0

  for (let i = 0; i < movies.length; i++) {
    const movie = movies[i]!
    const sKey = searchKey('movie', movie.title, movie.year)

    let resolved = searchCache.get(sKey)
    if (resolved) {
      cachedCount++
    } else {
      try {
        const candidates = await client.searchMovie(movie.title, movie.year)
        resolved = pickBestMovieMatch(movie.title, movie.year, candidates)
        searchCache.set(sKey, resolved)
      } catch (err) {
        console.error(
          `    [TMDB] Search failed for ${movie.title} (${movie.year}): ${(err as Error).message}`
        )
        resolved = { best_id: null, confidence: 'none', candidates: [] }
      }
    }

    const entry: MovieValidation = {
      title: movie.title,
      year: movie.year,
      edition: movie.edition,
      confidence: resolved.confidence,
      tmdb_id: resolved.best_id,
      tmdb_title: null,
      tmdb_title_filename_safe: null,
      tmdb_year: null,
      alternatives: [],
    }

    // Pull canonical details for the best match
    if (resolved.best_id !== null) {
      let details = detailsCache.get(String(resolved.best_id))
      if (!details) {
        try {
          details = await client.getMovie(resolved.best_id)
          detailsCache.set(String(resolved.best_id), details)
        } catch (err) {
          console.error(
            `    [TMDB] Details failed for id=${resolved.best_id}: ${(err as Error).message}`
          )
        }
      }
      if (details) {
        entry.tmdb_title = details.title
        entry.tmdb_title_filename_safe = stripFilenameIllegalChars(details.title)
        entry.tmdb_year = parseYear(details.release_date)
      }
    }

    // Pull alternates (other candidates) for review
    for (const altId of resolved.candidates) {
      if (altId === resolved.best_id) continue
      const altDetails = detailsCache.get(String(altId))
      if (altDetails) {
        entry.alternatives.push({
          id: altId,
          title: altDetails.title,
          year: parseYear(altDetails.release_date),
        })
      }
    }

    // Emit warnings according to confidence
    const movieLabel = movie.edition
      ? `${movie.title} (${movie.year}) {edition-${movie.edition}}`
      : `${movie.title} (${movie.year})`

    if (resolved.confidence === 'none' && rules.checks.warn_tmdb_no_match) {
      warnings.add(
        movieLabel,
        `TMDB found no match for '${movie.title}' (${movie.year}). Possible typo in title or year, or this movie isn't in TMDB.`
      )
    } else if (resolved.confidence === 'low' && rules.checks.warn_tmdb_low_confidence) {
      const altText =
        entry.alternatives.length > 0
          ? ` Alternatives: ${entry.alternatives.map(a => `'${a.title}' (${a.year})`).join(', ')}.`
          : ''
      warnings.add(
        movieLabel,
        `TMDB low-confidence match: best guess is '${entry.tmdb_title}' (${entry.tmdb_year}).${altText} Review and confirm.`
      )
    } else if (
      rules.checks.warn_tmdb_year_mismatch &&
      entry.tmdb_year !== null &&
      entry.tmdb_year !== movie.year
    ) {
      warnings.add(
        movieLabel,
        `TMDB year mismatch: folder says ${movie.year} but TMDB says '${entry.tmdb_title}' was released in ${entry.tmdb_year}. Verify which is correct.`
      )
    }

    // Canonical title check — only fires when a match was made and the local
    // folder title differs (byte-for-byte) from TMDB's filename-safe form.
    if (
      rules.checks.warn_tmdb_title_canonical &&
      entry.tmdb_title_filename_safe !== null &&
      entry.tmdb_title_filename_safe !== movie.title
    ) {
      warnings.add(
        movieLabel,
        `TMDB canonical title differs: folder is '${movie.title}', TMDB filename-safe form is '${entry.tmdb_title_filename_safe}'. Consider renaming the folder to match.`
      )
    }

    out.push(entry)
    onProgress?.(i + 1, movies.length, cachedCount)
  }

  return out
}
