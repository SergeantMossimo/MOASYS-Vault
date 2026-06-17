/**
 * validate/tmdb.ts
 * ----------------
 * Minimal TMDB API client. Only the four endpoints we need:
 *
 *   GET /3/search/movie?query=...&year=...
 *   GET /3/movie/<id>
 *   GET /3/search/tv?query=...&first_air_date_year=...
 *   GET /3/tv/<id>
 *
 * Rate limiting: TMDB allows ~40 requests per 10 seconds. We use a fixed
 * 250 ms minimum delay between requests (4 rps average) so we never approach
 * the limit. Simpler than a rolling window and the throughput is sufficient
 * for thousands of items.
 *
 * Retries: on HTTP 429 the response carries a `Retry-After` header. We sleep
 * for that duration and retry once. Other 4xx/5xx errors bubble up as
 * exceptions for the caller to surface as a warning.
 */

import type {
  TmdbMovieSearchResult,
  TmdbMovieDetails,
  TmdbShowSearchResult,
  TmdbShowDetails,
  TmdbSeasonDetails,
} from './types'

const TMDB_BASE = 'https://api.themoviedb.org/3'

/** Fixed per-request delay (ms). 250 ms → 4 rps → well under 40 / 10 s. */
const MIN_REQUEST_DELAY_MS = 250

/** How long to wait when TMDB returns 429 without a Retry-After header (ms). */
const DEFAULT_429_BACKOFF_MS = 10_000

/** ── Sleep helper ─────────────────────────────────────────────────────── */
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

// ─────────────────────────────────────────────
// Client
// ─────────────────────────────────────────────

export class TmdbClient {
  /** Timestamp of the last successful request — used for the delay calc. */
  private lastRequestAt = 0
  /** Running tally of HTTP requests issued. Surfaced in run summaries. */
  private requestCount = 0

  constructor(private apiKey: string) {}

  /** Total HTTP requests issued since this client was created. */
  get totalRequests(): number {
    return this.requestCount
  }

  /**
   * Core fetch wrapper.
   *   1. Enforces MIN_REQUEST_DELAY_MS between requests.
   *   2. Adds api_key query param.
   *   3. Retries once on 429, honoring Retry-After.
   *   4. Returns parsed JSON or throws an Error with a useful message.
   */
  private async request<T>(pathWithQuery: string): Promise<T> {
    const url = new URL(TMDB_BASE + pathWithQuery)
    url.searchParams.set('api_key', this.apiKey)

    // Throttle so we never hit the 40 / 10 s rate limit.
    const sinceLast = Date.now() - this.lastRequestAt
    if (sinceLast < MIN_REQUEST_DELAY_MS) {
      await sleep(MIN_REQUEST_DELAY_MS - sinceLast)
    }

    let response: Response
    try {
      response = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
      })
    } catch (err) {
      throw new Error(`TMDB network error: ${(err as Error).message}`)
    } finally {
      this.lastRequestAt = Date.now()
      this.requestCount++
    }

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('retry-after') ?? '', 10)
      const waitMs =
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : DEFAULT_429_BACKOFF_MS
      console.log(`    [TMDB] Rate-limited, sleeping ${waitMs}ms before retrying...`)
      await sleep(waitMs)
      return this.request(pathWithQuery)
    }

    if (response.status === 401) {
      throw new Error('TMDB 401 Unauthorized — check your api_key in .secrets.json')
    }

    if (response.status === 404) {
      // Caller-specific handling — let them branch on this.
      throw new Error('TMDB 404 Not Found')
    }

    if (!response.ok) {
      throw new Error(`TMDB HTTP ${response.status} ${response.statusText}`)
    }

    return (await response.json()) as T
  }

  // ─── Movies ──────────────────────────────────────────────────────────

  /**
   * Search for movies matching `title`. `year` is sent as the `year`
   * query param, which TMDB uses to bias results — it returns close-year
   * matches too, so the caller filters further.
   */
  async searchMovie(title: string, year: number): Promise<TmdbMovieSearchResult[]> {
    const path =
      `/search/movie?query=${encodeURIComponent(title)}` +
      `&year=${year}&include_adult=false&language=en-US`
    const data = await this.request<{ results: TmdbMovieSearchResult[] }>(path)
    return data.results ?? []
  }

  /** Fetch full movie details by TMDB ID. */
  async getMovie(id: number): Promise<TmdbMovieDetails> {
    return this.request<TmdbMovieDetails>(`/movie/${id}?language=en-US`)
  }

  // ─── Shows ───────────────────────────────────────────────────────────

  /**
   * Search for TV shows matching `name`. `year` is sent as
   * `first_air_date_year` which biases TMDB's ranking but isn't a strict
   * filter — caller still verifies the year on the result.
   */
  async searchShow(name: string, year: number): Promise<TmdbShowSearchResult[]> {
    const path =
      `/search/tv?query=${encodeURIComponent(name)}` +
      `&first_air_date_year=${year}&include_adult=false&language=en-US`
    const data = await this.request<{ results: TmdbShowSearchResult[] }>(path)
    return data.results ?? []
  }

  /**
   * Fetch full show details (including the seasons array with episode counts).
   */
  async getShow(id: number): Promise<TmdbShowDetails> {
    return this.request<TmdbShowDetails>(`/tv/${id}?language=en-US`)
  }

  /**
   * Fetch a single season's details — per-episode titles + air dates.
   * Caller is responsible for caching; this is one request per (show, season).
   */
  async getShowSeason(showId: number, seasonNumber: number): Promise<TmdbSeasonDetails> {
    return this.request<TmdbSeasonDetails>(`/tv/${showId}/season/${seasonNumber}?language=en-US`)
  }
}
