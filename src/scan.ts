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

import { moviesModule } from './media/movies'
import { showsModule } from './media/shows'
import { musicModule } from './media/music'
import { audiobooksModule } from './media/audiobooks'

// ─────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────

// __dirname gives us the directory of this script file, so all paths
// are relative to wherever the project folder lives on your machine.
// We go up one level from src/ to reach the project root where config.json lives.
const SCRIPT_DIR = path.join(__dirname, '..')
const CONFIG_PATH = path.join(SCRIPT_DIR, 'config.json')
const OUTPUT_DIR = path.join(SCRIPT_DIR, 'output')

// Load config.json once at startup — typed as AppConfig so the compiler
// catches any mismatch between the config shape and what the modules expect
const CONFIG: AppConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

/**
 * A single entry in the media type registry.
 * Binding TRecord, TOutput, and TConfig together here means the compiler
 * can verify that module, config, and records all match each other —
 * no need for `any` casts anywhere in runScan().
 */
interface MediaTypeEntry<TRecord, TOutput, TConfig extends BaseMediaConfig> {
  module: MediaModule<TRecord, TOutput, TConfig>
  config: TConfig
  outputDir: string
  label: string
}

/**
 * Helper that creates a MediaTypeEntry with its generics fully inferred.
 * Without this, TypeScript can't infer TRecord/TOutput from the module alone
 * and we'd need to spell them out manually on every registry entry.
 */
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
//   1. Create src/media/newtype.ts implementing MediaModule<TRecord, TOutput, TConfig>
//   2. Import it above
//   3. Add an entry here using makeEntry() — TypeScript will enforce the correct shape
const MEDIA_TYPES = {
  movies: makeEntry({
    module: moviesModule,
    config: CONFIG.movies,
    outputDir: path.join(OUTPUT_DIR, 'movies'),
    label: 'Movies',
  }),
  shows: makeEntry({
    module: showsModule,
    config: CONFIG.shows,
    outputDir: path.join(OUTPUT_DIR, 'shows'),
    label: 'Shows',
  }),
  music: makeEntry({
    module: musicModule,
    config: CONFIG.music,
    outputDir: path.join(OUTPUT_DIR, 'music'),
    label: 'Music',
  }),
  audiobooks: makeEntry({
    module: audiobooksModule,
    config: CONFIG.audiobooks,
    outputDir: path.join(OUTPUT_DIR, 'audiobooks'),
    label: 'Audiobooks',
  }),
}

type MediaType = keyof typeof MEDIA_TYPES

// ─────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────

/**
 * Run a full scan for a single media type and write all output files.
 * The generic parameters flow through from the registry entry so the compiler
 * can verify that module, config, and records all match each other.
 */
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

  // Set the tag order so qualities and media_type appear in config-defined order
  entry.module.initTagOrder(entry.config.media_folders)

  // Create the output folder if it doesn't already exist
  // recursive: true means no error if the folder is already there
  fs.mkdirSync(entry.outputDir, { recursive: true })

  // WarningCollector accumulates issues found during scanning
  const warnings = new WarningCollector()

  // Walk the media folders and return a Map of records
  const records = scan(entry.config, entry.module, warnings)

  // Write output files
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

/**
 * Type-safe dispatcher — each branch narrows the union type so
 * runScan's generics resolve correctly without any casts.
 */
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
  // process.argv = ["node", "scan.ts", ...your args]
  // slice(2) strips "node" and the script path, leaving just the flags you passed
  const args = process.argv.slice(2)
  const flag = args[0]
  const value = args[1]

  if (!flag) {
    printHelp()
    process.exit(1)
  }

  if (flag === '--all') {
    // Scan every registered media type in order
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
