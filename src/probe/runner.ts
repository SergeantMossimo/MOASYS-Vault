/**
 * probe/runner.ts
 * ---------------
 * CLI entry point for the ffprobe pass.
 *
 *   npm run probe:movies
 *   npm run probe:shows
 *   npm run probe:music
 *   npm run probe:audiobooks
 *   npm run probe:all
 *
 * Per type, writes:
 *   output/<type>/probe.json           ← aggregated probe data
 *   output/<type>/probe-warnings.json  ← quality_mismatch + future probe warnings
 *   cache/<type>-probe.json            ← raw probe results, gitignored
 *
 * Naming-related warnings stay in output/<type>/warnings.json (written by
 * the scan pass). The two warning files are independent — running probe
 * does NOT touch the scan's warnings.json.
 */

import fs from 'fs'
import path from 'path'

import { AppConfig, WarningCollector, WarningsOutput } from '../core/types'
import { loadRules } from '../core/rules/loader'

import { MoviesRulesSchema, defaultMoviesRules } from '../core/rules/movies'
import { ShowsRulesSchema, defaultShowsRules } from '../core/rules/shows'
import { MusicRulesSchema, defaultMusicRules } from '../core/rules/music'
import { AudiobooksRulesSchema, defaultAudiobooksRules } from '../core/rules/audiobooks'

import { ProbeCache } from './cache'
import { probeMovies } from './movies'
import { probeShows } from './shows'
import { probeMusic } from './music'
import { probeAudiobooks } from './audiobooks'

// ─────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────

const SCRIPT_DIR = path.join(__dirname, '..', '..')
const CONFIG_PATH = path.join(SCRIPT_DIR, 'config.json')
const OUTPUT_DIR = path.join(SCRIPT_DIR, 'output')
const CACHE_DIR = path.join(SCRIPT_DIR, 'cache')

const CONFIG: AppConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))

// ─────────────────────────────────────────────
// Output helpers
// ─────────────────────────────────────────────

function writeProbeJson(outputPath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8')
  const count = Array.isArray(data) ? data.length : 0
  console.log(`    [OUT] ${outputPath}  (${count} entries)`)
}

function writeProbeWarnings(outputPath: string, warnings: WarningCollector): void {
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
// Per-type runners
// ─────────────────────────────────────────────

interface ProbeRun {
  label: string
  outputDir: string
  cachePath: string
  run: (cache: ProbeCache, warnings: WarningCollector) => Promise<unknown>
}

function makeRuns(): Record<string, ProbeRun> {
  return {
    movies: {
      label: 'Movies',
      outputDir: path.join(OUTPUT_DIR, 'movies'),
      cachePath: path.join(CACHE_DIR, 'movies-probe.json'),
      run: async (cache, warnings) => {
        const rules = loadRules({
          mediaType: 'movies',
          schema: MoviesRulesSchema,
          defaults: defaultMoviesRules,
          projectRoot: SCRIPT_DIR,
        })
        return probeMovies(CONFIG.movies, rules, cache, warnings)
      },
    },
    shows: {
      label: 'Shows',
      outputDir: path.join(OUTPUT_DIR, 'shows'),
      cachePath: path.join(CACHE_DIR, 'shows-probe.json'),
      run: async (cache, warnings) => {
        const rules = loadRules({
          mediaType: 'shows',
          schema: ShowsRulesSchema,
          defaults: defaultShowsRules,
          projectRoot: SCRIPT_DIR,
        })
        return probeShows(CONFIG.shows, rules, cache, warnings)
      },
    },
    music: {
      label: 'Music',
      outputDir: path.join(OUTPUT_DIR, 'music'),
      cachePath: path.join(CACHE_DIR, 'music-probe.json'),
      run: async (cache, warnings) => {
        const rules = loadRules({
          mediaType: 'music',
          schema: MusicRulesSchema,
          defaults: defaultMusicRules,
          projectRoot: SCRIPT_DIR,
        })
        return probeMusic(CONFIG.music, rules, cache, warnings)
      },
    },
    audiobooks: {
      label: 'Audiobooks',
      outputDir: path.join(OUTPUT_DIR, 'audiobooks'),
      cachePath: path.join(CACHE_DIR, 'audiobooks-probe.json'),
      run: async (cache, warnings) => {
        const rules = loadRules({
          mediaType: 'audiobooks',
          schema: AudiobooksRulesSchema,
          defaults: defaultAudiobooksRules,
          projectRoot: SCRIPT_DIR,
        })
        return probeAudiobooks(CONFIG.audiobooks, rules, cache, warnings)
      },
    },
  }
}

async function runOne(type: string, run: ProbeRun): Promise<void> {
  console.log(`\n${'─'.repeat(50)}`)
  console.log(`  MOASYS-Vault — Probe ${run.label}`)
  console.log(`  ${new Date().toLocaleString()}`)
  console.log('─'.repeat(50))
  console.log()

  const cache = new ProbeCache(run.cachePath)
  console.log(`    [CACHE] ${cache.size()} entries loaded from ${run.cachePath}`)
  const warnings = new WarningCollector()

  const data = await run.run(cache, warnings)

  console.log('\n  Writing output...')
  writeProbeJson(path.join(run.outputDir, 'probe.json'), data)
  writeProbeWarnings(path.join(run.outputDir, 'probe-warnings.json'), warnings)

  cache.save()
  console.log(`    [CACHE] ${cache.size()} entries saved to ${run.cachePath}`)

  console.log(`\n  Done — ${warnings.count()} probe warnings.`)
  if (warnings.count() > 0) {
    console.log(`  → Review output/${type}/probe-warnings.json`)
  }
}

// ─────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────

function printHelp(types: string[]): void {
  console.log(`
  MOASYS-Vault — ffprobe pass

  Usage:
    npm run probe:<type>   Probe a specific media type
    npm run probe:all      Probe all media types

  Types: ${types.join(', ')}
  `)
}

async function main(): Promise<void> {
  const runs = makeRuns()
  const types = Object.keys(runs)
  const args = process.argv.slice(2)
  const flag = args[0]
  const value = args[1]

  if (!flag) {
    printHelp(types)
    process.exit(1)
  }

  if (flag === '--all') {
    for (const t of types) await runOne(t, runs[t]!)
  } else if (flag === '--type') {
    if (!value || !(value in runs)) {
      console.error(`\n  Error: invalid type '${value ?? ''}'. Choices: ${types.join(', ')}`)
      process.exit(1)
    }
    await runOne(value, runs[value]!)
  } else if (flag === '--help' || flag === '-h') {
    printHelp(types)
  } else {
    console.error(`\n  Error: unknown flag '${flag}'`)
    printHelp(types)
    process.exit(1)
  }

  console.log()
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
