import { describe, it, expect, beforeEach, vi } from 'vitest'

import { validateMovies } from '../../../src/validate/movies'
import { defaultMoviesRules, type MoviesRules } from '../../../src/core/rules/movies'
import { JsonCache } from '../../../src/validate/cache'
import { WarningCollector, type MovieOutput } from '../../../src/core/types'
import type {
  ResolvedSearch,
  TmdbMovieDetails,
  TmdbMovieSearchResult,
} from '../../../src/validate/types'
import { TmdbClient } from '../../../src/validate/tmdb'

/**
 * Build an in-memory JsonCache that doesn't read from disk. We pass a
 * non-existent path so load() short-circuits, then set entries directly.
 */
function memoryCache<T>(seed: Record<string, T> = {}): JsonCache<T> {
  const cache = new JsonCache<T>('/dev/null-' + Math.random().toString(36))
  for (const [k, v] of Object.entries(seed)) cache.set(k, v)
  return cache
}

/** Minimal MovieOutput for validate input — versions is unused here. */
function movie(title: string, year: number, edition: string | null = null): MovieOutput {
  return { title, year, edition, versions: [] }
}

/**
 * Build a mock TmdbClient that returns canned responses. Lets us drive
 * validateMovies through every confidence path without hitting the network.
 */
function mockClient(opts: {
  searchResults?: TmdbMovieSearchResult[]
  details?: Record<number, TmdbMovieDetails>
  searchFails?: boolean
}): TmdbClient {
  return {
    searchMovie: vi.fn(async () => {
      if (opts.searchFails) throw new Error('mock failure')
      return opts.searchResults ?? []
    }),
    getMovie: vi.fn(async (id: number) => {
      const d = opts.details?.[id]
      if (!d) throw new Error('not found')
      return d
    }),
    get totalRequests() {
      return 0
    },
  } as unknown as TmdbClient
}

describe('validateMovies — confidence scoring', () => {
  let warnings: WarningCollector
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnings = new WarningCollector()
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('resolves "high" confidence on exact title + exact year', async () => {
    const client = mockClient({
      searchResults: [
        {
          id: 100,
          title: 'The Crow',
          original_title: 'The Crow',
          release_date: '1994-05-13',
          popularity: 50,
        },
      ],
      details: {
        100: { id: 100, title: 'The Crow', original_title: 'The Crow', release_date: '1994-05-13' },
      },
    })

    const result = await validateMovies(
      [movie('The Crow', 1994)],
      defaultMoviesRules,
      client,
      memoryCache(),
      memoryCache(),
      warnings
    )

    expect(result[0]?.confidence).toBe('high')
    expect(result[0]?.tmdb_id).toBe(100)
    expect(result[0]?.tmdb_title).toBe('The Crow')
    expect(result[0]?.tmdb_year).toBe(1994)
  })

  it('resolves "medium" confidence when year is off by 1', async () => {
    const client = mockClient({
      searchResults: [
        {
          id: 100,
          title: 'The Crow',
          original_title: 'The Crow',
          release_date: '1993-12-01', // off by 1
          popularity: 50,
        },
      ],
      details: {
        100: { id: 100, title: 'The Crow', original_title: 'The Crow', release_date: '1993-12-01' },
      },
    })

    const result = await validateMovies(
      [movie('The Crow', 1994)],
      defaultMoviesRules,
      client,
      memoryCache(),
      memoryCache(),
      warnings
    )

    expect(result[0]?.confidence).toBe('medium')
  })

  it('resolves "low" confidence for partial title match', async () => {
    const client = mockClient({
      searchResults: [
        {
          id: 100,
          title: 'Random Adventure',
          original_title: 'Random Adventure',
          release_date: '1994-01-01',
          popularity: 50,
        },
      ],
      details: {
        100: {
          id: 100,
          title: 'Random Adventure',
          original_title: 'Random Adventure',
          release_date: '1994-01-01',
        },
      },
    })

    const result = await validateMovies(
      [movie('Adventure', 1994)],
      defaultMoviesRules,
      client,
      memoryCache(),
      memoryCache(),
      warnings
    )

    expect(result[0]?.confidence).toBe('low')
  })

  it('resolves "none" with no candidates', async () => {
    const client = mockClient({ searchResults: [] })

    const result = await validateMovies(
      [movie('Bogus Title', 2020)],
      defaultMoviesRules,
      client,
      memoryCache(),
      memoryCache(),
      warnings
    )

    expect(result[0]?.confidence).toBe('none')
    expect(result[0]?.tmdb_id).toBeNull()
  })

  it('handles a search exception as confidence "none" without crashing', async () => {
    const client = mockClient({ searchFails: true })

    const result = await validateMovies(
      [movie('X', 2000)],
      defaultMoviesRules,
      client,
      memoryCache(),
      memoryCache(),
      warnings
    )

    expect(result[0]?.confidence).toBe('none')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/Search failed/))
  })

  it('scores a space-prefix match (subtitle missing) at +60 title points', async () => {
    // TMDB title prefixes our title with a space + extra words. With exact
    // year, score = 60 (prefix) + 50 (year) = 110 → "medium".
    const client = mockClient({
      searchResults: [
        {
          id: 1,
          title: 'Star Wars Episode IV',
          original_title: 'Star Wars Episode IV',
          release_date: '1977-05-25',
          popularity: 50,
        },
      ],
      details: {
        1: {
          id: 1,
          title: 'Star Wars Episode IV',
          original_title: 'Star Wars Episode IV',
          release_date: '1977-05-25',
        },
      },
    })

    const result = await validateMovies(
      [movie('Star Wars', 1977)],
      defaultMoviesRules,
      client,
      memoryCache(),
      memoryCache(),
      warnings
    )

    expect(result[0]?.confidence).toBe('medium')
  })

  it('picks the more popular movie when scores tie', async () => {
    const client = mockClient({
      searchResults: [
        {
          id: 1,
          title: 'Heat',
          original_title: 'Heat',
          release_date: '1995-01-01',
          popularity: 5,
        },
        {
          id: 2,
          title: 'Heat',
          original_title: 'Heat',
          release_date: '1995-01-01',
          popularity: 100,
        },
      ],
      details: {
        1: { id: 1, title: 'Heat', original_title: 'Heat', release_date: '1995-01-01' },
        2: { id: 2, title: 'Heat', original_title: 'Heat', release_date: '1995-01-01' },
      },
    })

    const result = await validateMovies(
      [movie('Heat', 1995)],
      defaultMoviesRules,
      client,
      memoryCache(),
      memoryCache(),
      warnings
    )

    expect(result[0]?.tmdb_id).toBe(2) // the more popular one
  })
})

describe('validateMovies — warnings', () => {
  let warnings: WarningCollector

  beforeEach(() => {
    warnings = new WarningCollector()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('emits warn_tmdb_no_match when nothing matches', async () => {
    const client = mockClient({ searchResults: [] })
    await validateMovies(
      [movie('Missing', 2020)],
      defaultMoviesRules,
      client,
      memoryCache(),
      memoryCache(),
      warnings
    )
    expect(warnings.all().some(w => w.issue.match(/TMDB found no match/))).toBe(true)
  })

  it('emits warn_tmdb_low_confidence when the best match is low', async () => {
    // Substring match (+30 title) + exact year (+50) = 80, which lands in
    // "low" (>= 60, < 110).
    const client = mockClient({
      searchResults: [
        {
          id: 1,
          title: 'The Big Adventure',
          original_title: 'The Big Adventure',
          release_date: '2020-01-01',
          popularity: 1,
        },
      ],
      details: {
        1: {
          id: 1,
          title: 'The Big Adventure',
          original_title: 'The Big Adventure',
          release_date: '2020-01-01',
        },
      },
    })
    await validateMovies(
      [movie('Adventure', 2020)],
      defaultMoviesRules,
      client,
      memoryCache(),
      memoryCache(),
      warnings
    )
    expect(warnings.all().some(w => w.issue.match(/low-confidence/i))).toBe(true)
  })

  it('emits warn_tmdb_year_mismatch when TMDB year differs from folder', async () => {
    const client = mockClient({
      searchResults: [
        {
          id: 1,
          title: 'The Crow',
          original_title: 'The Crow',
          release_date: '1994-05-13',
          popularity: 50,
        },
      ],
      details: {
        1: { id: 1, title: 'The Crow', original_title: 'The Crow', release_date: '1994-05-13' },
      },
    })
    await validateMovies(
      [movie('The Crow', 1993)], // local says 1993, TMDB says 1994
      defaultMoviesRules,
      client,
      memoryCache(),
      memoryCache(),
      warnings
    )
    expect(warnings.all().some(w => w.issue.match(/year mismatch/i))).toBe(true)
  })

  it('emits warn_tmdb_title_canonical when the folder title differs from TMDB filename-safe form', async () => {
    const client = mockClient({
      searchResults: [
        {
          id: 1,
          title: 'The Crow',
          original_title: 'The Crow',
          release_date: '1994-05-13',
          popularity: 50,
        },
      ],
      details: {
        1: { id: 1, title: 'The Crow', original_title: 'The Crow', release_date: '1994-05-13' },
      },
    })
    await validateMovies(
      [movie('the crow', 1994)], // local has lowercase; TMDB has Title Case
      defaultMoviesRules,
      client,
      memoryCache(),
      memoryCache(),
      warnings
    )
    expect(warnings.all().some(w => w.issue.match(/canonical title/i))).toBe(true)
  })

  it('warn_tmdb_low_confidence includes Alternatives: text when alternate candidates are available', async () => {
    // Search returns two candidates. The best is low-confidence (partial title
    // match) and the runner-up has details in the cache, so the warning text
    // ends with the "Alternatives: ..." sentence.
    const client = mockClient({
      searchResults: [
        {
          id: 1,
          title: 'The Big Adventure',
          original_title: 'The Big Adventure',
          release_date: '2020-01-01',
          popularity: 100, // wins ranking
        },
        {
          id: 2,
          title: 'Adventure Time',
          original_title: 'Adventure Time',
          release_date: '2010-01-01',
          popularity: 5,
        },
      ],
      details: {
        1: {
          id: 1,
          title: 'The Big Adventure',
          original_title: 'The Big Adventure',
          release_date: '2020-01-01',
        },
      },
    })
    const detailsCache = memoryCache<TmdbMovieDetails>({
      '2': {
        id: 2,
        title: 'Adventure Time',
        original_title: 'Adventure Time',
        release_date: '2010-01-01',
      },
    })

    await validateMovies(
      [movie('Adventure', 2020)],
      defaultMoviesRules,
      client,
      memoryCache(),
      detailsCache,
      warnings
    )

    const lowWarn = warnings.all().find(w => w.issue.match(/low-confidence/i))
    expect(lowWarn?.issue).toMatch(/Alternatives:/)
    expect(lowWarn?.issue).toContain("'Adventure Time'")
  })

  it('silences warnings when toggles are false', async () => {
    const client = mockClient({ searchResults: [] })
    const rules: MoviesRules = {
      ...defaultMoviesRules,
      checks: { ...defaultMoviesRules.checks, warn_tmdb_no_match: false },
    }
    await validateMovies(
      [movie('Missing', 2020)],
      rules,
      client,
      memoryCache(),
      memoryCache(),
      warnings
    )
    expect(warnings.all()).toEqual([])
  })
})

describe('validateMovies — caching', () => {
  it('serves cached search results without calling TMDB', async () => {
    const client = mockClient({ searchResults: [] })
    const searchCache = memoryCache<ResolvedSearch>({
      'movie|the crow|1994': { best_id: null, confidence: 'high', candidates: [] },
    })

    await validateMovies(
      [movie('The Crow', 1994)],
      defaultMoviesRules,
      client,
      searchCache,
      memoryCache(),
      new WarningCollector()
    )

    expect((client.searchMovie as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
  })

  it('reports progress through the callback', async () => {
    const client = mockClient({ searchResults: [] })
    const progress = vi.fn()

    await validateMovies(
      [movie('A', 2020), movie('B', 2021)],
      defaultMoviesRules,
      client,
      memoryCache(),
      memoryCache(),
      new WarningCollector(),
      progress
    )

    expect(progress).toHaveBeenCalledWith(1, 2, 0)
    expect(progress).toHaveBeenCalledWith(2, 2, 0)
  })

  it('collects alternates from details cache for review', async () => {
    const client = mockClient({
      searchResults: [
        {
          id: 1,
          title: 'Heat',
          original_title: 'Heat',
          release_date: '1995-01-01',
          popularity: 100,
        },
        {
          id: 2,
          title: 'Heat',
          original_title: 'Heat',
          release_date: '1986-01-01',
          popularity: 5,
        },
      ],
      details: {
        1: { id: 1, title: 'Heat', original_title: 'Heat', release_date: '1995-01-01' },
        2: { id: 2, title: 'Heat (Old)', original_title: 'Heat', release_date: '1986-01-01' },
      },
    })
    const detailsCache = memoryCache<TmdbMovieDetails>({
      '2': { id: 2, title: 'Heat (Old)', original_title: 'Heat', release_date: '1986-01-01' },
    })

    const result = await validateMovies(
      [movie('Heat', 1995)],
      defaultMoviesRules,
      client,
      memoryCache(),
      detailsCache,
      new WarningCollector()
    )

    expect(result[0]?.alternatives).toEqual([{ id: 2, title: 'Heat (Old)', year: 1986 }])
  })
})
