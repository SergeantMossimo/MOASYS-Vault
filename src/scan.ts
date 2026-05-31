/**
 * scan.ts
 * -------
 * MOASYS-Vault — Media Library Scanner
 * Entry point for scanning your Plex media library and generating
 * structured JSON and warnings output per media type.
 *
 * Usage:
 *   npm run movies
 *   npm run shows
 *   npm run music
 *   npm run audiobooks
 *   npm run scan:all
 */

import fs from 'fs'
import path from 'path'

import { AppConfig, BaseMediaConfig, MediaModule, WarningCollector } from './core/types'
import { scan, writeJson, writeWarnings } from './core/scanner'
import { loadRules } from './core/rules/loader'

import { createMoviesModule } from './media/movies'
import { createShowsModule } from './media/shows'
import { createMusicModule } from './media/music'
import { createAudiobooksModule } from './media/audiobooks'

import { MoviesRulesSchema, defaultMoviesRules } from './core/rules/movies'
import { ShowsRulesSchema, defaultShowsRules } from './core/rules/shows'
import { MusicRulesSchema, defaultMusicRules } from './core/rules/music'
import { AudiobooksRulesSchema, defaultAudiobooksRules } from './core/rules/audiobooks'

// ─────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────

const SCRIPT_DIR = path.join(__dirname, '..')
const CONFIG_PATH = path.join(SCRIPT_DIR, 'config.json')
const OUTPUT_DIR = path.join(SCRIPT_DIR, 'output')

const CONFIG: AppConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))

// ─────────────────────────────────────────────
// Rules loading
// ─────────────────────────────────────────────

// Rules describe library conventions (regex patterns, year ranges, which
// warnings to emit). Loaded once at boot per media type. Each call returns
// either the code defaults or a deep-merge of the user's rules/<type>.yaml
// overrides on top of them. Validated through Zod, so any error here is
// caught before scanning starts.
const moviesRules = loadRules({
  mediaType: 'movies',
  schema: MoviesRulesSchema,
  defaults: defaultMoviesRules,
  projectRoot: SCRIPT_DIR,
})

const showsRules = loadRules({
  mediaType: 'shows',
  schema: ShowsRulesSchema,
  defaults: defaultShowsRules,
  projectRoot: SCRIPT_DIR,
})

const musicRules = loadRules({
  mediaType: 'music',
  schema: MusicRulesSchema,
  defaults: defaultMusicRules,
  projectRoot: SCRIPT_DIR,
})

const audiobooksRules = loadRules({
  mediaType: 'audiobooks',
  schema: AudiobooksRulesSchema,
  defaults: defaultAudiobooksRules,
  projectRoot: SCRIPT_DIR,
})

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface MediaTypeEntry<TRecord, TOutput, TConfig extends BaseMediaConfig> {
  module: MediaModule<TRecord, TOutput, TConfig>
  config: TConfig
  outputDir: string
  label: string
}

function makeEntry<TRecord, TOutput, TConfig extends BaseMediaConfig>(
  entry: MediaTypeEntry<TRecord, TOutput, TConfig>
): MediaTypeEntry<TRecord, TOutput, TConfig> {
  return entry
}

// ─────────────────────────────────────────────
// Media type registry
// ─────────────────────────────────────────────

// Registry of all supported media types.
// To add a new type in the future:
//   1. Create src/media/newtype.ts exporting a createNewtypeModule(rules) factory
//   2. Create src/core/rules/newtype.ts with schema + defaults
//   3. Import both above and load the rules with loadRules()
//   4. Add an entry here using makeEntry() — TypeScript enforces the shape
const MEDIA_TYPES = {
  movies: makeEntry({
    module: createMoviesModule(moviesRules),
    config: CONFIG.movies,
    outputDir: path.join(OUTPUT_DIR, 'movies'),
    label: 'Movies',
  }),
  shows: makeEntry({
    module: createShowsModule(showsRules),
    config: CONFIG.shows,
    outputDir: path.join(OUTPUT_DIR, 'shows'),
    label: 'Shows',
  }),
  music: makeEntry({
    module: createMusicModule(musicRules),
    config: CONFIG.music,
    outputDir: path.join(OUTPUT_DIR, 'music'),
    label: 'Music',
  }),
  audiobooks: makeEntry({
    module: createAudiobooksModule(audiobooksRules),
    config: CONFIG.audiobooks,
    outputDir: path.join(OUTPUT_DIR, 'audiobooks'),
    label: 'Audiobooks',
  }),
}

type MediaType = keyof typeof MEDIA_TYPES

// ─────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────

function runScan<TRecord, TOutput, TConfig extends BaseMediaConfig>(
  mediaType: MediaType,
  entry: MediaTypeEntry<TRecord, TOutput, TConfig>
): void {
  console.log(`\n${'─'.repeat(50)}`)
  console.log(`  MOASYS-Vault — ${entry.label}`)
  console.log(`  ${new Date().toLocaleString()}`)
  console.log('─'.repeat(50))
  console.log(`\n  Root : ${entry.config.root_path}`)
  console.log()

  entry.module.initTagOrder(entry.config.media_folders)

  fs.mkdirSync(entry.outputDir, { recursive: true })

  const warnings = new WarningCollector()

  const records = scan(entry.config, entry.module, warnings)

  console.log('\n  Writing output...')
  writeJson(records, entry.module, path.join(entry.outputDir, `${mediaType}.json`))
  writeWarnings(warnings, path.join(entry.outputDir, 'warnings.json'))

  console.log(`\n  Done — ${records.size} entries, ${warnings.count()} warnings.`)
  if (warnings.count() > 0) {
    console.log(`  → Review output/${mediaType}/warnings.json for files needing attention.`)
  }
}

// ─────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────

function dispatchScan(mediaType: MediaType): void {
  switch (mediaType) {
    case 'movies':
      return runScan(mediaType, MEDIA_TYPES.movies)
    case 'shows':
      return runScan(mediaType, MEDIA_TYPES.shows)
    case 'music':
      return runScan(mediaType, MEDIA_TYPES.music)
    case 'audiobooks':
      return runScan(mediaType, MEDIA_TYPES.audiobooks)
  }
}

function main(): void {
  const args = process.argv.slice(2)
  const flag = args[0]
  const value = args[1]

  if (!flag) {
    printHelp()
    process.exit(1)
  }

  if (flag === '--all') {
    for (const mediaType of Object.keys(MEDIA_TYPES) as MediaType[]) {
      dispatchScan(mediaType)
    }
  } else if (flag === '--type') {
    if (!value || !(value in MEDIA_TYPES)) {
      console.error(
        `\n  Error: invalid type '${value ?? ''}'. Choices: ${Object.keys(MEDIA_TYPES).join(', ')}`
      )
      process.exit(1)
    }
    dispatchScan(value as MediaType)
  } else if (flag === '--help' || flag === '-h') {
    printHelp()
  } else {
    console.error(`\n  Error: unknown flag '${flag}'`)
    printHelp()
    process.exit(1)
  }

  console.log()
}

function printHelp(): void {
  console.log(`
  MOASYS-Vault — Plex Media Library Scanner

  Usage:
    npm run <type>       Scan a specific media type
    npm run scan:all     Scan all media types

  Types: ${Object.keys(MEDIA_TYPES).join(', ')}

  Examples:
    npm run movies
    npm run scan:all
  `)
}

main()
