/**
 * validate/runner.ts
 * ------------------
 * CLI entry point for the TMDB validation pass.
 *
 *   npm run validate:movies
 *   npm run validate:shows
 *   npm run validate:all
 *
 * Per type, reads from the scan output (movies.json / shows.json) and writes:
 *   output/<type>/validation.json           ← per-record TMDB resolution + alts
 *   output/<type>/validation-warnings.json  ← low-confidence and mismatch warnings
 *   cache/tmdb-search.json                  ← shared search-lookup cache
 *   cache/tmdb-movies.json                  ← movie-details cache
 *   cache/tmdb-shows.json                   ← show-details cache
 *
 * Requires `.secrets.json` at repo root with a TMDB API v3 key. See
 * .secrets.json.example for the shape.
 */

import fs from 'fs'
import path from 'path'

import { MovieOutput, ShowOutput, WarningCollector } from '../core/types'
import { loadRules } from '../core/rules/loader'
import { loadIgnoredPaths } from '../core/ignored'
import { parseRunnerArgs, writeJsonOutput, writeWarnings } from '../core/runner-shared'

import { MoviesRulesSchema, defaultMoviesRules } from '../core/rules/movies'
import { ShowsRulesSchema, defaultShowsRules } from '../core/rules/shows'

import { loadSecrets } from './secrets'
import { JsonCache } from './cache'
import { TmdbClient } from './tmdb'
import { validateMovies } from './movies'
import { validateShows } from './shows'
import {
  ResolvedSearch,
  TmdbMovieDetails,
  TmdbShowDetails,
  TmdbSeasonDetails,
  CACHE_VERSION,
  SEARCH_CACHE_VERSION,
} from './types'

// ─────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────

const SCRIPT_DIR = path.join(__dirname, '..', '..')
const OUTPUT_DIR = path.join(SCRIPT_DIR, 'output')
const CACHE_DIR = path.join(SCRIPT_DIR, 'cache')

// ─────────────────────────────────────────────
// Scan-output readers
// ─────────────────────────────────────────────

/**
 * Read the scan-generated movies.json. Fails clearly if the file is missing —
 * validation depends on it (we don't re-scan inside the validator).
 */
function readMoviesScan(): MovieOutput[] {
  const p = path.join(OUTPUT_DIR, 'movies', 'movies.json')
  if (!fs.existsSync(p)) {
    console.error(`\n  Error: ${p} not found.`)
    console.error('    Run `npm run movies` first to generate it.')
    process.exit(1)
  }
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as MovieOutput[]
}

function readShowsScan(): ShowOutput[] {
  const p = path.join(OUTPUT_DIR, 'shows', 'shows.json')
  if (!fs.existsSync(p)) {
    console.error(`\n  Error: ${p} not found.`)
    console.error('    Run `npm run shows` first to generate it.')
    process.exit(1)
  }
  return JSON.parse(fs.readFileSync(p, 'utf-8')) as ShowOutput[]
}

// ─────────────────────────────────────────────
// Per-type runners
// ─────────────────────────────────────────────

async function runMovies(client: TmdbClient, refreshOlderThanDays: number): Promise<void> {
  console.log(`\n${'─'.repeat(50)}`)
  console.log(`  MOASYS-Vault — Validate Movies`)
  console.log(`  ${new Date().toLocaleString()}`)
  console.log('─'.repeat(50))
  console.log()

  const rules = loadRules({
    mediaType: 'movies',
    schema: MoviesRulesSchema,
    defaults: defaultMoviesRules,
    projectRoot: SCRIPT_DIR,
  })

  const movies = readMoviesScan()
  console.log(`    [INPUT] ${movies.length} movies from output/movies/movies.json`)

  const searchCache = new JsonCache<ResolvedSearch>(
    path.join(CACHE_DIR, 'tmdb-search.json'),
    SEARCH_CACHE_VERSION
  )
  const detailsCache = new JsonCache<TmdbMovieDetails>(
    path.join(CACHE_DIR, 'tmdb-movies.json'),
    CACHE_VERSION
  )
  const prunedSearch = searchCache.pruneOlderThan(refreshOlderThanDays)
  const prunedDetails = detailsCache.pruneOlderThan(refreshOlderThanDays)
  const prunedSummary =
    refreshOlderThanDays > 0
      ? ` (pruned ${prunedSearch} search + ${prunedDetails} details older than ${refreshOlderThanDays}d)`
      : ''
  console.log(
    `    [CACHE] ${searchCache.size()} search entries, ${detailsCache.size()} movie-details entries${prunedSummary}`
  )

  const warnings = new WarningCollector(loadIgnoredPaths(SCRIPT_DIR, 'movies'))

  const data = await validateMovies(
    movies,
    rules,
    client,
    searchCache,
    detailsCache,
    warnings,
    (done, total, cached) => {
      if (done === total || done % 50 === 0) {
        console.log(`    [TMDB] ${done}/${total} (${cached} cached)`)
      }
    }
  )

  console.log('\n  Writing output...')
  const outDir = path.join(OUTPUT_DIR, 'movies')
  writeJsonOutput(path.join(outDir, 'validation.json'), data)
  writeWarnings(path.join(outDir, 'validation-warnings.json'), warnings)

  searchCache.save()
  detailsCache.save()

  const silenced = warnings.silencedCount()
  const silencedSummary = silenced > 0 ? `, ${silenced} silenced via ignore list` : ''
  console.log(
    `\n  Done — ${warnings.count()} validation warnings${silencedSummary}. ${client.totalRequests} TMDB requests.`
  )
  if (warnings.count() > 0) {
    const breakdown = warnings
      .countByType()
      .map(({ type, count }) => `${type} (${count})`)
      .join(', ')
    console.log(`    ${breakdown}`)
    console.log(`  → Review output/movies/validation-warnings.json`)
  }
}

async function runShows(client: TmdbClient, refreshOlderThanDays: number): Promise<void> {
  console.log(`\n${'─'.repeat(50)}`)
  console.log(`  MOASYS-Vault — Validate Shows`)
  console.log(`  ${new Date().toLocaleString()}`)
  console.log('─'.repeat(50))
  console.log()

  const rules = loadRules({
    mediaType: 'shows',
    schema: ShowsRulesSchema,
    defaults: defaultShowsRules,
    projectRoot: SCRIPT_DIR,
  })

  const shows = readShowsScan()
  console.log(`    [INPUT] ${shows.length} shows from output/shows/shows.json`)

  const searchCache = new JsonCache<ResolvedSearch>(
    path.join(CACHE_DIR, 'tmdb-search.json'),
    SEARCH_CACHE_VERSION
  )
  const detailsCache = new JsonCache<TmdbShowDetails>(
    path.join(CACHE_DIR, 'tmdb-shows.json'),
    CACHE_VERSION
  )
  const seasonsCache = new JsonCache<TmdbSeasonDetails>(
    path.join(CACHE_DIR, 'tmdb-show-seasons.json'),
    CACHE_VERSION
  )
  const prunedSearch = searchCache.pruneOlderThan(refreshOlderThanDays)
  const prunedDetails = detailsCache.pruneOlderThan(refreshOlderThanDays)
  const prunedSeasons = seasonsCache.pruneOlderThan(refreshOlderThanDays)
  const prunedSummary =
    refreshOlderThanDays > 0
      ? ` (pruned ${prunedSearch} search + ${prunedDetails} details + ${prunedSeasons} seasons older than ${refreshOlderThanDays}d)`
      : ''
  console.log(
    `    [CACHE] ${searchCache.size()} search entries, ${detailsCache.size()} show-details entries, ${seasonsCache.size()} season-details entries${prunedSummary}`
  )

  const warnings = new WarningCollector(loadIgnoredPaths(SCRIPT_DIR, 'shows'))

  const data = await validateShows(
    shows,
    rules,
    client,
    searchCache,
    detailsCache,
    seasonsCache,
    warnings,
    (done, total, cached) => {
      if (done === total || done % 10 === 0) {
        console.log(`    [TMDB] ${done}/${total} (${cached} cached)`)
      }
    }
  )

  console.log('\n  Writing output...')
  const outDir = path.join(OUTPUT_DIR, 'shows')
  writeJsonOutput(path.join(outDir, 'validation.json'), data)
  writeWarnings(path.join(outDir, 'validation-warnings.json'), warnings)

  searchCache.save()
  detailsCache.save()
  seasonsCache.save()

  const silenced = warnings.silencedCount()
  const silencedSummary = silenced > 0 ? `, ${silenced} silenced via ignore list` : ''
  console.log(
    `\n  Done — ${warnings.count()} validation warnings${silencedSummary}. ${client.totalRequests} TMDB requests.`
  )
  if (warnings.count() > 0) {
    const breakdown = warnings
      .countByType()
      .map(({ type, count }) => `${type} (${count})`)
      .join(', ')
    console.log(`    ${breakdown}`)
    console.log(`  → Review output/shows/validation-warnings.json`)
  }
}

// ─────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────

function printHelp(): void {
  console.log(`
  MOASYS-Vault — TMDB validation

  Usage:
    npm run validate:movies     Validate movies against TMDB
    npm run validate:shows      Validate shows against TMDB (incl. season episode counts)
    npm run validate:all        Validate both

  Flags:
    --refresh-older-than=Nd     Re-fetch any cache entries older than N days
                                (e.g. 30 or 30d). Without this flag, all
                                cached entries are used regardless of age.

  Requires .secrets.json with a TMDB API v3 key. See .secrets.json.example.
  `)
}

/**
 * Pull `--refresh-older-than=Nd` (or `=N`) out of process.argv, returning the
 * number of days (0 = no refresh). Mutates argv so parseRunnerArgs sees a
 * clean view afterwards.
 */
function extractRefreshOlderThanFlag(): number {
  const flagPrefix = '--refresh-older-than='
  const argIndex = process.argv.findIndex(a => a.startsWith(flagPrefix))
  if (argIndex === -1) return 0

  const value = process.argv[argIndex]!.slice(flagPrefix.length)
  const match = value.match(/^(\d+)d?$/)
  if (!match) {
    console.error(
      `\n  Error: --refresh-older-than expects a number of days (e.g. 30 or 30d), got '${value}'`
    )
    process.exit(1)
  }

  process.argv.splice(argIndex, 1)
  return parseInt(match[1]!, 10)
}

// Only movies and shows have a validate pass — music and audiobooks aren't
// in TMDB. This is intentional, not a TODO.
const VALIDATE_TYPES = ['movies', 'shows'] as const

async function main(): Promise<void> {
  // Extract validate-only flags before parseRunnerArgs (which expects to see
  // only the standard --type/--all/--help flag set).
  const refreshOlderThanDays = extractRefreshOlderThanFlag()

  const parsed = parseRunnerArgs(VALIDATE_TYPES)

  if (parsed.kind === 'help') {
    printHelp()
    // Implicit help (no args) is conventionally an error for CLI scripts;
    // explicit `--help` is a clean exit.
    process.exit(parsed.explicit ? 0 : 1)
  }

  // Load secrets here so a missing API key fails BEFORE any work.
  const secrets = loadSecrets(SCRIPT_DIR)
  const client = new TmdbClient(secrets.tmdb.api_key)

  if (parsed.kind === 'all') {
    await runMovies(client, refreshOlderThanDays)
    await runShows(client, refreshOlderThanDays)
  } else if (parsed.type === 'movies') {
    await runMovies(client, refreshOlderThanDays)
  } else {
    await runShows(client, refreshOlderThanDays)
  }

  console.log()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
