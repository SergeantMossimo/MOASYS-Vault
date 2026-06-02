/**
 * validate/shows.ts
 * -----------------
 * Per-show TMDB validation. Mirrors validate/movies.ts but adds the big
 * additional check: comparing each scanned season's episode count against
 * what TMDB lists as the canonical episode count. Plain gap detection
 * (from the scan pass) catches missing-in-the-middle; this catches
 * "season has 13 episodes but you only have 10".
 *
 * Specials (season 0) is intentionally skipped from the episode-count
 * comparison — TMDB's `Specials` season often includes content that doesn't
 * map cleanly to anyone's local library (early extras, web shorts, etc).
 */

import { ShowOutput, WarningCollector } from '../core/types'
import { ShowsRules } from '../core/rules/shows'

import { JsonCache, searchKey } from './cache'
import { normalizeTitle, parseYear, stripFilenameIllegalChars } from './helpers'
import { TmdbClient } from './tmdb'
import {
  ShowValidation,
  ResolvedSearch,
  TmdbShowDetails,
  TmdbShowSearchResult,
  SeasonValidation,
} from './types'

// ─────────────────────────────────────────────
// Match scoring (shows-specific)
// ─────────────────────────────────────────────

/**
 * Same scoring shape as movies — see `pickBestMovieMatch` in
 * `validate/movies.ts` for the full rationale on weights and thresholds.
 *
 * The only TV-specific concern: matched against `name` / `original_name` /
 * `first_air_date` instead of `title` / `original_title` / `release_date`.
 * Year off-by-one is even more common for shows because UK shows often
 * use UK air dates while users tag their copies with US-broadcast year.
 */
function pickBestShowMatch(
  localTitle: string,
  localYear: number,
  candidates: TmdbShowSearchResult[]
): ResolvedSearch {
  if (candidates.length === 0) {
    return { best_id: null, confidence: 'none', candidates: [] }
  }

  const ourTitle = normalizeTitle(localTitle)
  let bestScore = 0
  let bestId: number | null = null
  const candidateIds: number[] = []

  const sorted = [...candidates].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
  for (const c of sorted.slice(0, 5)) candidateIds.push(c.id)

  for (const c of sorted) {
    const theirTitle = normalizeTitle(c.name)
    const theirOrigTitle = normalizeTitle(c.original_name)
    const theirYear = parseYear(c.first_air_date)
    const yearDelta = theirYear === null ? 99 : Math.abs(theirYear - localYear)

    let score = 0
    if (theirTitle === ourTitle || theirOrigTitle === ourTitle) {
      score += 100
    } else if (theirTitle.startsWith(ourTitle + ' ') || ourTitle.startsWith(theirTitle + ' ')) {
      score += 60
    } else if (theirTitle.includes(ourTitle) || ourTitle.includes(theirTitle)) {
      score += 30
    }

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

  if (confidence === 'none') bestId = null
  return { best_id: bestId, confidence, candidates: candidateIds }
}

// ─────────────────────────────────────────────
// Season comparison
// ─────────────────────────────────────────────

/**
 * Build per-season validation comparing local episode counts to TMDB.
 *
 * Season label handling:
 *   - Numeric labels ("1", "2", "10") → match against TMDB's season_number
 *   - "Specials" → maps to TMDB season 0 in principle, but we don't compare
 *     counts (see file docstring)
 *   - Any other named season (e.g. "Champion of Champions") is recorded but
 *     not compared
 */
function compareSeasons(
  scanned: ShowOutput['seasons'],
  tmdbDetails: TmdbShowDetails
): SeasonValidation[] {
  const tmdbByNumber = new Map<number, number>()
  for (const s of tmdbDetails.seasons) {
    tmdbByNumber.set(s.season_number, s.episode_count)
  }

  return scanned.map(s => {
    const numeric = parseInt(s.season, 10)
    let tmdbCount: number | null = null
    if (!isNaN(numeric)) {
      tmdbCount = tmdbByNumber.get(numeric) ?? null
    }
    return {
      season: s.season,
      local_episode_count: s.episode_count,
      tmdb_episode_count: tmdbCount,
      missing: tmdbCount !== null ? tmdbCount - s.episode_count : null,
    }
  })
}

// ─────────────────────────────────────────────
// Validation entry point
// ─────────────────────────────────────────────

export async function validateShows(
  shows: ShowOutput[],
  rules: ShowsRules,
  client: TmdbClient,
  searchCache: JsonCache<ResolvedSearch>,
  detailsCache: JsonCache<TmdbShowDetails>,
  warnings: WarningCollector,
  onProgress?: (done: number, total: number, cached: number) => void
): Promise<ShowValidation[]> {
  const out: ShowValidation[] = []
  let cachedCount = 0

  for (let i = 0; i < shows.length; i++) {
    const show = shows[i]!
    const sKey = searchKey('show', show.title, show.year)

    let resolved = searchCache.get(sKey)
    if (resolved) {
      cachedCount++
    } else {
      try {
        const candidates = await client.searchShow(show.title, show.year)
        resolved = pickBestShowMatch(show.title, show.year, candidates)
        searchCache.set(sKey, resolved)
      } catch (err) {
        console.error(
          `    [TMDB] Search failed for ${show.title} (${show.year}): ${(err as Error).message}`
        )
        resolved = { best_id: null, confidence: 'none', candidates: [] }
      }
    }

    const entry: ShowValidation = {
      title: show.title,
      year: show.year,
      confidence: resolved.confidence,
      tmdb_id: resolved.best_id,
      tmdb_title: null,
      tmdb_title_filename_safe: null,
      tmdb_first_air_year: null,
      alternatives: [],
      seasons: show.seasons.map(s => ({
        season: s.season,
        local_episode_count: s.episode_count,
        tmdb_episode_count: null,
        missing: null,
      })),
    }

    let details: TmdbShowDetails | undefined
    if (resolved.best_id !== null) {
      details = detailsCache.get(String(resolved.best_id))
      if (!details) {
        try {
          details = await client.getShow(resolved.best_id)
          detailsCache.set(String(resolved.best_id), details)
        } catch (err) {
          console.error(
            `    [TMDB] Details failed for show id=${resolved.best_id}: ${(err as Error).message}`
          )
        }
      }
      if (details) {
        entry.tmdb_title = details.name
        entry.tmdb_title_filename_safe = stripFilenameIllegalChars(details.name)
        entry.tmdb_first_air_year = parseYear(details.first_air_date)
        entry.seasons = compareSeasons(show.seasons, details)
      }
    }

    // Collect alternates from cache for review
    for (const altId of resolved.candidates) {
      if (altId === resolved.best_id) continue
      const altDetails = detailsCache.get(String(altId))
      if (altDetails) {
        entry.alternatives.push({
          id: altId,
          title: altDetails.name,
          year: parseYear(altDetails.first_air_date),
        })
      }
    }

    // Warnings
    const label = `${show.title} (${show.year})`

    if (resolved.confidence === 'none' && rules.checks.warn_tmdb_no_match) {
      warnings.add(
        label,
        `TMDB found no match for '${show.title}' (${show.year}). Possible typo or this show isn't in TMDB.`
      )
    } else if (resolved.confidence === 'low' && rules.checks.warn_tmdb_low_confidence) {
      const altText =
        entry.alternatives.length > 0
          ? ` Alternatives: ${entry.alternatives.map(a => `'${a.title}' (${a.year})`).join(', ')}.`
          : ''
      warnings.add(
        label,
        `TMDB low-confidence match: best guess is '${entry.tmdb_title}' (${entry.tmdb_first_air_year}).${altText} Review and confirm.`
      )
    }

    // Canonical title check — fires when a match was made and folder title
    // differs (byte-for-byte) from TMDB's filename-safe form.
    if (
      rules.checks.warn_tmdb_title_canonical &&
      entry.tmdb_title_filename_safe !== null &&
      entry.tmdb_title_filename_safe !== show.title
    ) {
      warnings.add(
        label,
        `TMDB canonical title differs: folder is '${show.title}', TMDB filename-safe form is '${entry.tmdb_title_filename_safe}'. Consider renaming the folder to match.`
      )
    }

    // Per-season episode count check (skip season 0 / "Specials" — see header)
    if (rules.checks.warn_tmdb_episode_count && details !== undefined) {
      for (const season of entry.seasons) {
        if (season.tmdb_episode_count === null) continue
        if (season.season === '0' || season.season.toLowerCase() === 'specials') continue
        if (season.missing !== null && season.missing > 0) {
          warnings.add(
            `${label} — Season ${season.season}`,
            `Season ${season.season} has ${season.local_episode_count} of ${season.tmdb_episode_count} episodes per TMDB (${season.missing} missing). Identify gaps via shows.json or the scan's potential-missing-episodes warning.`
          )
        }
      }
    }

    out.push(entry)
    onProgress?.(i + 1, shows.length, cachedCount)
  }

  return out
}
