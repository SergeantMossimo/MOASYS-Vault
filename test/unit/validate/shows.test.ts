import { describe, it, expect, beforeEach, vi } from 'vitest'

import { validateShows } from '../../../src/validate/shows'
import { defaultShowsRules, type ShowsRules } from '../../../src/core/rules/shows'
import { JsonCache } from '../../../src/validate/cache'
import { WarningCollector, type ShowOutput } from '../../../src/core/types'
import type { TmdbShowDetails, TmdbShowSearchResult } from '../../../src/validate/types'
import { TmdbClient } from '../../../src/validate/tmdb'

function memoryCache<T>(seed: Record<string, T> = {}): JsonCache<T> {
  const cache = new JsonCache<T>('/dev/null-' + Math.random().toString(36))
  for (const [k, v] of Object.entries(seed)) cache.set(k, v)
  return cache
}

function show(title: string, year: number, seasons: ShowOutput['seasons'] = []): ShowOutput {
  return { title, year, seasons }
}

function mockClient(opts: {
  searchResults?: TmdbShowSearchResult[]
  details?: Record<number, TmdbShowDetails>
  searchFails?: boolean
}): TmdbClient {
  return {
    searchShow: vi.fn(async () => {
      if (opts.searchFails) throw new Error('mock failure')
      return opts.searchResults ?? []
    }),
    getShow: vi.fn(async (id: number) => {
      const d = opts.details?.[id]
      if (!d) throw new Error('not found')
      return d
    }),
    get totalRequests() {
      return 0
    },
  } as unknown as TmdbClient
}

describe('validateShows — confidence scoring', () => {
  let warnings: WarningCollector

  beforeEach(() => {
    warnings = new WarningCollector()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('resolves "high" on exact name + exact year', async () => {
    const client = mockClient({
      searchResults: [
        {
          id: 100,
          name: 'Star Trek Enterprise',
          original_name: 'Star Trek Enterprise',
          first_air_date: '2001-09-26',
          popularity: 50,
        },
      ],
      details: {
        100: {
          id: 100,
          name: 'Star Trek Enterprise',
          original_name: 'Star Trek Enterprise',
          first_air_date: '2001-09-26',
          number_of_seasons: 4,
          number_of_episodes: 98,
          seasons: [{ season_number: 1, episode_count: 26, name: 'Season 1' }],
        },
      },
    })

    const result = await validateShows(
      [show('Star Trek Enterprise', 2001)],
      defaultShowsRules,
      client,
      memoryCache(),
      memoryCache(),
      warnings
    )

    expect(result[0]?.confidence).toBe('high')
    expect(result[0]?.tmdb_first_air_year).toBe(2001)
  })

  it('returns "none" when search has no candidates', async () => {
    const client = mockClient({ searchResults: [] })
    const result = await validateShows(
      [show('Made Up Show', 2020)],
      defaultShowsRules,
      client,
      memoryCache(),
      memoryCache(),
      warnings
    )
    expect(result[0]?.confidence).toBe('none')
  })

  it('resolves "medium" via prefix match (subtitle missing) + exact year', async () => {
    // localTitle 'Friends' is a space-prefix of 'Friends Forever'.
    // prefix +60 + year exact +50 = 110 → medium.
    const client = mockClient({
      searchResults: [
        {
          id: 1,
          name: 'Friends Forever',
          original_name: 'Friends Forever',
          first_air_date: '1994-09-22',
          popularity: 50,
        },
      ],
      details: {
        1: {
          id: 1,
          name: 'Friends Forever',
          original_name: 'Friends Forever',
          first_air_date: '1994-09-22',
          number_of_seasons: 1,
          number_of_episodes: 24,
          seasons: [],
        },
      },
    })
    const result = await validateShows(
      [show('Friends', 1994)],
      defaultShowsRules,
      client,
      memoryCache(),
      memoryCache(),
      warnings
    )
    expect(result[0]?.confidence).toBe('medium')
  })

  it('resolves "low" via includes match + exact year', async () => {
    // substring +30 + year exact +50 = 80 → low.
    const client = mockClient({
      searchResults: [
        {
          id: 1,
          name: 'The Big Adventure Show',
          original_name: 'The Big Adventure Show',
          first_air_date: '2020-01-01',
          popularity: 1,
        },
      ],
      details: {
        1: {
          id: 1,
          name: 'The Big Adventure Show',
          original_name: 'The Big Adventure Show',
          first_air_date: '2020-01-01',
          number_of_seasons: 0,
          number_of_episodes: 0,
          seasons: [],
        },
      },
    })
    const result = await validateShows(
      [show('Adventure', 2020)],
      defaultShowsRules,
      client,
      memoryCache(),
      memoryCache(),
      warnings
    )
    expect(result[0]?.confidence).toBe('low')
  })

  it('logs and falls back to "none" when search throws', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const client = mockClient({ searchFails: true })
    const result = await validateShows(
      [show('X', 2020)],
      defaultShowsRules,
      client,
      memoryCache(),
      memoryCache(),
      warnings
    )
    expect(result[0]?.confidence).toBe('none')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/Search failed/))
  })

  it('logs and continues when getShow throws for the matched ID', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const client = mockClient({
      searchResults: [
        {
          id: 100,
          name: 'Show',
          original_name: 'Show',
          first_air_date: '2020-01-01',
          popularity: 50,
        },
      ],
      details: {}, // getShow throws when id not in details
    })
    const result = await validateShows(
      [show('Show', 2020)],
      defaultShowsRules,
      client,
      memoryCache(),
      memoryCache(),
      warnings
    )
    expect(result[0]?.confidence).toBe('high') // search still resolved
    expect(result[0]?.tmdb_title).toBeNull() // but details failed
    expect(errorSpy).toHaveBeenCalledWith(expect.stringMatching(/Details failed/))
  })

  it('collects alternate candidates from the details cache', async () => {
    const client = mockClient({
      searchResults: [
        {
          id: 1,
          name: 'Show',
          original_name: 'Show',
          first_air_date: '2020-01-01',
          popularity: 100,
        },
        {
          id: 2,
          name: 'Show',
          original_name: 'Show',
          first_air_date: '2010-01-01',
          popularity: 5,
        },
      ],
      details: {
        1: {
          id: 1,
          name: 'Show',
          original_name: 'Show',
          first_air_date: '2020-01-01',
          number_of_seasons: 0,
          number_of_episodes: 0,
          seasons: [],
        },
      },
    })
    const detailsCache = memoryCache<TmdbShowDetails>({
      '2': {
        id: 2,
        name: 'Older Show',
        original_name: 'Older Show',
        first_air_date: '2010-01-01',
        number_of_seasons: 0,
        number_of_episodes: 0,
        seasons: [],
      },
    })

    const result = await validateShows(
      [show('Show', 2020)],
      defaultShowsRules,
      client,
      memoryCache(),
      detailsCache,
      warnings
    )

    expect(result[0]?.alternatives).toEqual([{ id: 2, title: 'Older Show', year: 2010 }])
  })

  it('compares per-season episode counts to TMDB', async () => {
    const client = mockClient({
      searchResults: [
        {
          id: 100,
          name: 'Show',
          original_name: 'Show',
          first_air_date: '2020-01-01',
          popularity: 50,
        },
      ],
      details: {
        100: {
          id: 100,
          name: 'Show',
          original_name: 'Show',
          first_air_date: '2020-01-01',
          number_of_seasons: 2,
          number_of_episodes: 23,
          seasons: [
            { season_number: 1, episode_count: 13, name: 'Season 1' },
            { season_number: 2, episode_count: 10, name: 'Season 2' },
          ],
        },
      },
    })

    const result = await validateShows(
      [
        show('Show', 2020, [
          { season: '1', episode_count: 10, versions: [] }, // missing 3
          { season: '2', episode_count: 10, versions: [] }, // complete
        ]),
      ],
      defaultShowsRules,
      client,
      memoryCache(),
      memoryCache(),
      warnings
    )

    const s1 = result[0]?.seasons.find(s => s.season === '1')
    expect(s1?.tmdb_episode_count).toBe(13)
    expect(s1?.missing).toBe(3)
  })
})

describe('validateShows — warnings', () => {
  let warnings: WarningCollector

  beforeEach(() => {
    warnings = new WarningCollector()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('emits warn_tmdb_no_match', async () => {
    const client = mockClient({ searchResults: [] })
    await validateShows(
      [show('Missing', 2020)],
      defaultShowsRules,
      client,
      memoryCache(),
      memoryCache(),
      warnings
    )
    expect(warnings.all().some(w => w.issue.match(/no match/i))).toBe(true)
  })

  it('emits warn_tmdb_episode_count when a numeric season is short of TMDB', async () => {
    const client = mockClient({
      searchResults: [
        {
          id: 100,
          name: 'Show',
          original_name: 'Show',
          first_air_date: '2020-01-01',
          popularity: 50,
        },
      ],
      details: {
        100: {
          id: 100,
          name: 'Show',
          original_name: 'Show',
          first_air_date: '2020-01-01',
          number_of_seasons: 1,
          number_of_episodes: 13,
          seasons: [{ season_number: 1, episode_count: 13, name: 'Season 1' }],
        },
      },
    })

    await validateShows(
      [show('Show', 2020, [{ season: '1', episode_count: 10, versions: [] }])],
      defaultShowsRules,
      client,
      memoryCache(),
      memoryCache(),
      warnings
    )

    expect(warnings.all().some(w => w.issue.match(/10 of 13 episodes/i))).toBe(true)
  })

  it('skips episode-count warning for Specials season', async () => {
    const client = mockClient({
      searchResults: [
        {
          id: 100,
          name: 'Show',
          original_name: 'Show',
          first_air_date: '2020-01-01',
          popularity: 50,
        },
      ],
      details: {
        100: {
          id: 100,
          name: 'Show',
          original_name: 'Show',
          first_air_date: '2020-01-01',
          number_of_seasons: 0,
          number_of_episodes: 0,
          seasons: [{ season_number: 0, episode_count: 50, name: 'Specials' }],
        },
      },
    })

    await validateShows(
      [show('Show', 2020, [{ season: 'Specials', episode_count: 4, versions: [] }])],
      defaultShowsRules,
      client,
      memoryCache(),
      memoryCache(),
      warnings
    )

    expect(warnings.all().some(w => w.issue.match(/episodes per TMDB/i))).toBe(false)
  })

  it('emits warn_tmdb_title_canonical when folder differs from TMDB filename-safe form', async () => {
    // TMDB "The Crow" → safe form "The Crow". Folder "the crow" differs by
    // case, triggers the warning.
    const client = mockClient({
      searchResults: [
        {
          id: 100,
          name: 'The Crow',
          original_name: 'The Crow',
          first_air_date: '1994-09-01',
          popularity: 50,
        },
      ],
      details: {
        100: {
          id: 100,
          name: 'The Crow',
          original_name: 'The Crow',
          first_air_date: '1994-09-01',
          number_of_seasons: 0,
          number_of_episodes: 0,
          seasons: [],
        },
      },
    })

    await validateShows(
      [show('the crow', 1994)],
      defaultShowsRules,
      client,
      memoryCache(),
      memoryCache(),
      warnings
    )

    expect(warnings.all().some(w => w.issue.match(/canonical title/i))).toBe(true)
  })

  it('silences each toggleable warning when set to false', async () => {
    const rules: ShowsRules = {
      ...defaultShowsRules,
      checks: {
        ...defaultShowsRules.checks,
        warn_tmdb_no_match: false,
        warn_tmdb_episode_count: false,
        warn_tmdb_title_canonical: false,
      },
    }
    const client = mockClient({ searchResults: [] })
    await validateShows(
      [show('Missing', 2020)],
      rules,
      client,
      memoryCache(),
      memoryCache(),
      warnings
    )
    expect(warnings.all()).toEqual([])
  })
})
