/**
 * scan.ts
 * -------
 * MOASYS-Vault — Media Library Scanner
 * Entry point for cataloging a Plex media library. Each type runs as one
 * merged pass: probe (cache-aware) + scan (folder walk) → catalog + rich
 * probe data + warnings.
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
import { loadConfig } from './core/config'
import { scan, writeJson } from './core/scanner'
import { loadRules } from './core/rules/loader'
import { IgnoredEntry, loadIgnoredPaths } from './core/ignored'
import { parseRunnerArgs, writeJsonOutput, writeWarnings } from './core/runner-shared'

import { createMoviesModule } from './media/movies'
import { createShowsModule } from './media/shows'
import { createMusicModule } from './media/music'
import { createAudiobooksModule } from './media/audiobooks'

import { MoviesRulesSchema, defaultMoviesRules } from './core/rules/movies'
import { ShowsRulesSchema, defaultShowsRules } from './core/rules/shows'
import { MusicRulesSchema, defaultMusicRules } from './core/rules/music'
import { AudiobooksRulesSchema, defaultAudiobooksRules } from './core/rules/audiobooks'

import { ProbeCache } from './probe/cache'
import { ProbeData } from './probe/types'
import { probeMovies } from './probe/movies'
import { probeShows } from './probe/shows'
import { probeMusic } from './probe/music'
import { probeAudiobooks } from './probe/audiobooks'

// ─────────────────────────────────────────────
// Config + paths
// ─────────────────────────────────────────────

const SCRIPT_DIR = path.join(__dirname, '..')
const OUTPUT_DIR = path.join(SCRIPT_DIR, 'output')
const CACHE_DIR = path.join(SCRIPT_DIR, 'cache')

// CONFIG is loaded + Zod-validated by loadConfig(); see src/core/config.ts.
// Cheap to load once at module init — it's small and shared across all types.
const CONFIG: AppConfig = loadConfig(SCRIPT_DIR)

// ─────────────────────────────────────────────
// Media-type registry shape
// ─────────────────────────────────────────────

/**
 * Per-media-type registry entry. Carries everything the merged runner needs:
 *   - `module` walks folders and produces the catalog.
 *   - `probe` walks the same files with ffprobe (cache-aware) and produces
 *     the rich `probe.json` artifact + the probe-specific warnings.
 *   - `cachePath` persists ffprobe results across runs so re-scans are fast.
 *
 * Built lazily by per-type factory functions (`buildMoviesEntry()` etc.) so
 * `npm run movies` only loads rules for movies — a typo in
 * rules/audiobooks.yaml no longer blocks an unrelated movies scan, and the
 * boot log prints just one `[RULES] Loaded ...` line instead of four.
 */
interface MediaTypeEntry<TRecord, TOutput, TConfig extends BaseMediaConfig> {
  module: MediaModule<TRecord, TOutput, TConfig>
  config: TConfig
  outputDir: string
  cachePath: string
  label: string
  /** Entries loaded from ignored/<type>.yaml — silences warnings on matching
   *  paths (optionally scoped to specific warning types via the object form). */
  ignoredPaths: IgnoredEntry[]
  probe: (
    config: TConfig,
    cache: ProbeCache,
    warnings: WarningCollector
  ) => Promise<{ output: unknown; byPath: Map<string, ProbeData> }>
}

function makeEntry<TRecord, TOutput, TConfig extends BaseMediaConfig>(
  entry: MediaTypeEntry<TRecord, TOutput, TConfig>
): MediaTypeEntry<TRecord, TOutput, TConfig> {
  return entry
}

// ─────────────────────────────────────────────
// Per-type factory functions
// ─────────────────────────────────────────────

// Each factory loads its own rules + ignore list + builds its module and
// probe closure. They're only called for the media type the user actually
// requested.
//
// To add a new type in the future:
//   1. Create src/media/newtype.ts exporting a createNewtypeModule(rules) factory
//   2. Create src/core/rules/newtype.ts with schema + defaults
//   3. Create src/probe/newtype.ts exporting probeNewtype(config, rules, cache, warnings)
//   4. Add `<newtype>` to VALID_TYPES below and write a build<Newtype>Entry() here
//   5. Wire dispatchType to call the new factory

function buildMoviesEntry() {
  const rules = loadRules({
    mediaType: 'movies',
    schema: MoviesRulesSchema,
    defaults: defaultMoviesRules,
    projectRoot: SCRIPT_DIR,
  })
  return makeEntry({
    module: createMoviesModule(rules),
    config: CONFIG.movies,
    outputDir: path.join(OUTPUT_DIR, 'movies'),
    cachePath: path.join(CACHE_DIR, 'movies-probe.json'),
    label: 'Movies',
    ignoredPaths: loadIgnoredPaths(SCRIPT_DIR, 'movies'),
    probe: (cfg, cache, warnings) => probeMovies(cfg, rules, cache, warnings),
  })
}

function buildShowsEntry() {
  const rules = loadRules({
    mediaType: 'shows',
    schema: ShowsRulesSchema,
    defaults: defaultShowsRules,
    projectRoot: SCRIPT_DIR,
  })
  return makeEntry({
    module: createShowsModule(rules),
    config: CONFIG.shows,
    outputDir: path.join(OUTPUT_DIR, 'shows'),
    cachePath: path.join(CACHE_DIR, 'shows-probe.json'),
    label: 'Shows',
    ignoredPaths: loadIgnoredPaths(SCRIPT_DIR, 'shows'),
    probe: (cfg, cache, warnings) => probeShows(cfg, rules, cache, warnings),
  })
}

function buildMusicEntry() {
  const rules = loadRules({
    mediaType: 'music',
    schema: MusicRulesSchema,
    defaults: defaultMusicRules,
    projectRoot: SCRIPT_DIR,
  })
  return makeEntry({
    module: createMusicModule(rules),
    config: CONFIG.music,
    outputDir: path.join(OUTPUT_DIR, 'music'),
    cachePath: path.join(CACHE_DIR, 'music-probe.json'),
    label: 'Music',
    ignoredPaths: loadIgnoredPaths(SCRIPT_DIR, 'music'),
    probe: (cfg, cache, warnings) => probeMusic(cfg, rules, cache, warnings),
  })
}

function buildAudiobooksEntry() {
  const rules = loadRules({
    mediaType: 'audiobooks',
    schema: AudiobooksRulesSchema,
    defaults: defaultAudiobooksRules,
    projectRoot: SCRIPT_DIR,
  })
  return makeEntry({
    module: createAudiobooksModule(rules),
    config: CONFIG.audiobooks,
    outputDir: path.join(OUTPUT_DIR, 'audiobooks'),
    cachePath: path.join(CACHE_DIR, 'audiobooks-probe.json'),
    label: 'Audiobooks',
    ignoredPaths: loadIgnoredPaths(SCRIPT_DIR, 'audiobooks'),
    probe: (cfg, cache, warnings) => probeAudiobooks(cfg, rules, cache, warnings),
  })
}

// ─────────────────────────────────────────────
// Valid types (lightweight, no factories invoked)
// ─────────────────────────────────────────────

const VALID_TYPES = ['movies', 'shows', 'music', 'audiobooks'] as const
type MediaType = (typeof VALID_TYPES)[number]

// ─────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────

/**
 * Run the merged pipeline for one media type:
 *   1. Probe pass — walks every primary file (cache-aware), writes probe.json
 *   2. Scan pass — walks folders, parses names, builds the catalog
 *   3. Write all three outputs — <type>.json, probe.json, warnings.json
 *
 * The probe cache makes subsequent runs near-instant: only newly added /
 * modified / removed files trigger a real ffprobe call.
 */
async function runType<TRecord, TOutput, TConfig extends BaseMediaConfig>(
  mediaType: MediaType,
  entry: MediaTypeEntry<TRecord, TOutput, TConfig>
): Promise<void> {
  console.log(`\n${'─'.repeat(50)}`)
  console.log(`  MOASYS-Vault — ${entry.label}`)
  console.log(`  ${new Date().toLocaleString()}`)
  console.log('─'.repeat(50))
  console.log(`\n  Root : ${entry.config.root_path}`)
  console.log()

  fs.mkdirSync(entry.outputDir, { recursive: true })

  // A single WarningCollector is shared across both passes so warnings.json
  // collects everything — naming hygiene from scan, quality / ID3 issues from
  // probe — in one file. Constructed with the type's ignored entries so any
  // warning that matches an entry in ignored/<type>.yaml is silently dropped
  // (still counted via warnings.silencedCount()).
  const warnings = new WarningCollector(entry.ignoredPaths)

  // ── Probe pass ────────────────────────────────────────────────────────
  const cache = new ProbeCache(entry.cachePath)
  console.log(`    [CACHE] ${cache.size()} entries loaded from ${entry.cachePath}`)

  const { output: probeOutput, byPath: probeByPath } = await entry.probe(
    entry.config,
    cache,
    warnings
  )

  // ── Scan pass ─────────────────────────────────────────────────────────
  // Scan reuses the probe results via `probeByPath` so each version's
  // `quality` is populated alongside the structural catalog work.
  const records = scan(entry.config, entry.module, warnings, probeByPath)

  // ── Write outputs ─────────────────────────────────────────────────────
  console.log('\n  Writing output...')
  writeJson(records, entry.module, path.join(entry.outputDir, `${mediaType}.json`))
  writeJsonOutput(path.join(entry.outputDir, 'probe.json'), probeOutput)
  writeWarnings(path.join(entry.outputDir, 'warnings.json'), warnings)

  // Drop cache entries whose files no longer exist under root_path. Keeps
  // cache/<type>-probe.json from growing without bound as files are
  // renamed or deleted from the library.
  const orphans = cache.pruneOrphans(entry.config.root_path)
  cache.save()
  const orphanSummary = orphans > 0 ? ` (pruned ${orphans} orphan${orphans === 1 ? '' : 's'})` : ''
  console.log(`    [CACHE] ${cache.size()} entries saved to ${entry.cachePath}${orphanSummary}`)

  const silenced = warnings.silencedCount()
  const silencedSummary = silenced > 0 ? `, ${silenced} silenced via ignore list` : ''
  console.log(`\n  Done — ${records.size} entries, ${warnings.count()} warnings${silencedSummary}.`)
  if (warnings.count() > 0) {
    const breakdown = warnings
      .countByType()
      .map(({ type, count }) => `${type} (${count})`)
      .join(', ')
    console.log(`    ${breakdown}`)
    console.log(`  → Review output/${mediaType}/warnings.json for files needing attention.`)
  }
}

// ─────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────

async function dispatchType(mediaType: MediaType): Promise<void> {
  // Each branch builds its own entry — rules, module, probe, ignored list
  // — only when that type is actually about to run. `scan:all` calls this
  // four times sequentially, each time loading only what it needs for that
  // type.
  switch (mediaType) {
    case 'movies':
      return runType(mediaType, buildMoviesEntry())
    case 'shows':
      return runType(mediaType, buildShowsEntry())
    case 'music':
      return runType(mediaType, buildMusicEntry())
    case 'audiobooks':
      return runType(mediaType, buildAudiobooksEntry())
  }
}

async function main(): Promise<void> {
  const parsed = parseRunnerArgs(VALID_TYPES)

  if (parsed.kind === 'help') {
    printHelp()
    // Implicit help (no args) exits with status 1; explicit `--help` is clean.
    process.exit(parsed.explicit ? 0 : 1)
  } else if (parsed.kind === 'all') {
    for (const t of VALID_TYPES) await dispatchType(t)
  } else {
    await dispatchType(parsed.type as MediaType)
  }

  console.log()
}

function printHelp(): void {
  console.log(`
  MOASYS-Vault — Plex Media Library Scanner

  Each run executes the merged pipeline (probe + scan) for the selected type,
  producing <type>.json (catalog), probe.json (rich ffprobe data), and
  warnings.json (all hygiene issues). The probe cache makes re-runs fast.

  Usage:
    npm run <type>       Run the merged pipeline for one media type
    npm run scan:all     Run the merged pipeline for all media types

  Types: ${VALID_TYPES.join(', ')}

  Examples:
    npm run movies
    npm run scan:all
  `)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
