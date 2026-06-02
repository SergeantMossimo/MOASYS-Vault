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

import { MovieOutput, ShowOutput, WarningCollector, WarningsOutput } from '../core/types'
import { loadRules } from '../core/rules/loader'

import { MoviesRulesSchema, defaultMoviesRules } from '../core/rules/movies'
import { ShowsRulesSchema, defaultShowsRules } from '../core/rules/shows'

import { loadSecrets } from './secrets'
import { JsonCache } from './cache'
import { TmdbClient } from './tmdb'
import { validateMovies } from './movies'
import { validateShows } from './shows'
import { ResolvedSearch, TmdbMovieDetails, TmdbShowDetails, SEARCH_CACHE_VERSION } from './types'

// ─────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────

const SCRIPT_DIR = path.join(__dirname, '..', '..')
const OUTPUT_DIR = path.join(SCRIPT_DIR, 'output')
const CACHE_DIR = path.join(SCRIPT_DIR, 'cache')

// ─────────────────────────────────────────────
// Output writers
// ─────────────────────────────────────────────

function writeJson(outputPath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8')
  const count = Array.isArray(data) ? data.length : 0
  console.log(`    [OUT] ${outputPath}  (${count} entries)`)
}

function writeWarnings(outputPath: string, warnings: WarningCollector): void {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  const out: WarningsOutput = {
    generated: new Date().toISOString(),
    count: warnings.count(),
    files: warnings.all(),
  }
  fs.writeFileSync(outputPath, JSON.stringify(out, null, 2), 'utf-8')
  console.log(`    [OUT] ${outputPath}  (${warnings.count()} warnings)`)
}

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

async function runMovies(client: TmdbClient): Promise<void> {
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
  const detailsCache = new JsonCache<TmdbMovieDetails>(path.join(CACHE_DIR, 'tmdb-movies.json'))
  console.log(
    `    [CACHE] ${searchCache.size()} search entries, ${detailsCache.size()} movie-details entries`
  )

  const warnings = new WarningCollector()

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
  writeJson(path.join(outDir, 'validation.json'), data)
  writeWarnings(path.join(outDir, 'validation-warnings.json'), warnings)

  searchCache.save()
  detailsCache.save()

  console.log(
    `\n  Done — ${warnings.count()} validation warnings. ${client.totalRequests} TMDB requests.`
  )
  if (warnings.count() > 0) {
    console.log(`  → Review output/movies/validation-warnings.json`)
  }
}

async function runShows(client: TmdbClient): Promise<void> {
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
  const detailsCache = new JsonCache<TmdbShowDetails>(path.join(CACHE_DIR, 'tmdb-shows.json'))
  console.log(
    `    [CACHE] ${searchCache.size()} search entries, ${detailsCache.size()} show-details entries`
  )

  const warnings = new WarningCollector()

  const data = await validateShows(
    shows,
    rules,
    client,
    searchCache,
    detailsCache,
    warnings,
    (done, total, cached) => {
      if (done === total || done % 10 === 0) {
        console.log(`    [TMDB] ${done}/${total} (${cached} cached)`)
      }
    }
  )

  console.log('\n  Writing output...')
  const outDir = path.join(OUTPUT_DIR, 'shows')
  writeJson(path.join(outDir, 'validation.json'), data)
  writeWarnings(path.join(outDir, 'validation-warnings.json'), warnings)

  searchCache.save()
  detailsCache.save()

  console.log(
    `\n  Done — ${warnings.count()} validation warnings. ${client.totalRequests} TMDB requests.`
  )
  if (warnings.count() > 0) {
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

  Requires .secrets.json with a TMDB API v3 key. See .secrets.json.example.
  `)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const flag = args[0]
  const value = args[1]

  if (!flag) {
    printHelp()
    process.exit(1)
  }

  if (flag === '--help' || flag === '-h') {
    printHelp()
    return
  }

  // Loading secrets here so a missing API key fails BEFORE any work.
  const secrets = loadSecrets(SCRIPT_DIR)
  const client = new TmdbClient(secrets.tmdb.api_key)

  if (flag === '--all') {
    await runMovies(client)
    await runShows(client)
  } else if (flag === '--type') {
    if (value === 'movies') await runMovies(client)
    else if (value === 'shows') await runShows(client)
    else {
      console.error(`\n  Error: invalid type '${value ?? ''}'. Choices: movies, shows`)
      process.exit(1)
    }
  } else {
    console.error(`\n  Error: unknown flag '${flag}'`)
    printHelp()
    process.exit(1)
  }

  console.log()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
