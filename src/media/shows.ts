/**
 * media/shows.ts
 * --------------
 * Show-specific parsing, serialization, and DB logic for MOASYS-Vault.
 *
 * Expected Plex folder structure:
 *   <media_folder>/
 *     <Show Title (YEAR)>/
 *       Season 01/
 *         <Show Title (YEAR)> - S01E01 - Episode Title.mp4
 *         <Show Title (YEAR)> - S01E01-E02 - Multi Episode Title.mp4
 *       Specials/              ← named season from ignored_season_names config
 *         <Show Title (YEAR)> - S00E01 - Special Title.mp4
 */

import fs from 'fs'
import path from 'path'

import {
  ShowsConfig,
  MediaFolder,
  ShowRecord,
  ShowOutput,
  WarningCollector,
  MediaModule,
} from '../core/types'

// ─────────────────────────────────────────────
// Regex patterns
// ─────────────────────────────────────────────

// Matches Plex-style show folder names: "Star Trek Enterprise (2001)"
// Group 1 = title, Group 2 = year
const SHOW_FOLDER_PATTERN = /^(.+)\s\((\d{4})\)$/

// Matches standard Plex season folder names — requires exactly two digits (zero-padded).
// "Season 01" matches, "Season 1" does not and will be flagged as a warning.
// Group 1 = season number e.g. "01"
const SEASON_FOLDER_PATTERN = /^Season\s(\d{2})$/i

// Matches episode file stems — single and multi-episode:
//   "Star Trek Enterprise (2001) - S01E03 - Flight Or Flight"
//   "Star Trek Enterprise (2001) - S01E01-E02 - Broken Bow Part 1 And 2"
// Group 1 = title, Group 2 = year, Group 3 = season,
// Group 4 = first episode, Group 5 = second episode (multi only)
const FILE_PATTERN = /^(.+)\s\((\d{4})\)\s-\sS(\d{2})E(\d{2})(?:-E?(\d{2}))?\s-\s.+$/i

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function isVideo(filename: string, config: ShowsConfig): boolean {
  const ext = path.extname(filename).toLowerCase()
  return config.video_extensions.map(e => e.toLowerCase()).includes(ext)
}

function isPrimary(filename: string, config: ShowsConfig): boolean {
  const ext = path.extname(filename).toLowerCase()
  return config.primary_extension.map(e => e.toLowerCase()).includes(ext)
}

function formatPrimaryExts(config: ShowsConfig): string {
  return 'Non-' + config.primary_extension.map(e => e.toUpperCase()).join('/')
}

/** Parse a show folder name into { title, year } or null */
function parseShowFolder(name: string): { title: string; year: number } | null {
  const m = SHOW_FOLDER_PATTERN.exec(name)
  if (!m) return null
  return { title: m[1]!.trim(), year: parseInt(m[2]!, 10) }
}

/**
 * Parse a season folder name into a season number or null.
 * Requires zero-padded two-digit format ("Season 01" not "Season 1").
 */
function parseSeasonFolder(name: string): number | null {
  const m = SEASON_FOLDER_PATTERN.exec(name)
  if (!m) return null
  return parseInt(m[1]!, 10)
}

/** Parse an episode file stem into { title, year, season, episodeCount } or null */
function parseFileStem(stem: string): {
  title: string
  year: number
  season: number
  episodeCount: number
} | null {
  const m = FILE_PATTERN.exec(stem)
  if (!m) return null
  return {
    title: m[1]!.trim(),
    year: parseInt(m[2]!, 10),
    season: parseInt(m[3]!, 10),
    episodeCount: m[5] ? 2 : 1, // Group 5 only exists for multi-episode files
  }
}

function makeShowKey(title: string, year: number): string {
  return `${title.toLowerCase()}|${year}`
}

function makeSeasonKey(title: string, year: number, seasonLabel: string): string {
  return `${title.toLowerCase()}|${year}|${seasonLabel.toLowerCase()}`
}

/**
 * Find gaps in episode numbers within a season.
 * Example: [1, 2, 4] -> [3]
 */
function findEpisodeGaps(numbers: number[]): number[] {
  if (numbers.length === 0) return []
  const min = Math.min(...numbers)
  const max = Math.max(...numbers)
  const gaps = []
  for (let i = min; i <= max; i++) {
    if (!numbers.includes(i)) gaps.push(i)
  }
  return gaps
}

/**
 * Sort key for season labels — numeric seasons first (in numeric order),
 * then named seasons alphabetically.
 * e.g. "1", "2", "10", "Champion of Champions", "Specials"
 */
function seasonSortKey(label: string): [number, number, string] {
  const n = parseInt(label, 10)
  if (!isNaN(n)) return [0, n, ''] // Numeric: group 0, sort by number
  return [1, 0, label.toLowerCase()] // Named: group 1, sort alphabetically
}

// ─────────────────────────────────────────────
// Quality order
// ─────────────────────────────────────────────

let qualityOrder: string[] = []

// ─────────────────────────────────────────────
// Media module implementation
// ─────────────────────────────────────────────

export const showsModule: MediaModule<ShowRecord, ShowOutput, ShowsConfig> = {
  initTagOrder(mediaFolders: MediaFolder[]): void {
    qualityOrder = mediaFolders.map(mf => mf.tag)
  },

  scanMediaFolder(
    folderPath: string,
    folderName: string,
    tag: string,
    config: ShowsConfig,
    warnings: WarningCollector
  ): Map<string, ShowRecord> {
    const records = new Map<string, ShowRecord>()

    // Pull ignored season names from config, lowercased for case-insensitive comparison
    const ignoredNames = (config.ignored_season_names ?? []).map(n => n.toLowerCase())

    for (const showEntry of fs.readdirSync(folderPath, {
      withFileTypes: true,
    })) {
      if (!showEntry.isDirectory()) continue

      const showPath = path.join(folderPath, showEntry.name)
      const showRel = path.join(folderName, showEntry.name)
      const parsedShow = parseShowFolder(showEntry.name)

      // Warning: show folder doesn't follow Plex convention
      if (!parsedShow) {
        warnings.add(
          showRel,
          'Show folder name does not match Plex naming convention — expected: Show Title (YEAR)'
        )
        continue
      }

      const { title: showTitle, year: showYear } = parsedShow

      let seasonEntries: fs.Dirent[]
      try {
        seasonEntries = fs.readdirSync(showPath, { withFileTypes: true })
      } catch {
        warnings.add(showRel, 'Permission denied reading show folder')
        continue
      }

      for (const seasonEntry of seasonEntries) {
        if (!seasonEntry.isDirectory()) continue

        const seasonPath = path.join(showPath, seasonEntry.name)
        const seasonRel = path.join(showRel, seasonEntry.name)
        const nameLower = seasonEntry.name.toLowerCase()

        // ── Determine season label ───────────────────────────────────────
        let seasonLabel: string
        let isNamed: boolean

        if (ignoredNames.includes(nameLower)) {
          // Named season from config (e.g. "Specials") — use as-is
          seasonLabel = seasonEntry.name
          isNamed = true
        } else {
          const seasonNumber = parseSeasonFolder(seasonEntry.name)
          if (seasonNumber === null) {
            warnings.add(
              seasonRel,
              `Season folder '${seasonEntry.name}' does not match expected format ` +
                `(expected: Season 01) and is not in ignored_season_names`
            )
            continue
          }
          seasonLabel = String(seasonNumber) // "01" -> "1"
          isNamed = false
        }

        // ── Read episode files ───────────────────────────────────────────
        let allFiles: fs.Dirent[]
        try {
          allFiles = fs.readdirSync(seasonPath, { withFileTypes: true })
        } catch {
          warnings.add(seasonRel, 'Permission denied reading season folder')
          continue
        }

        const videoFiles = allFiles.filter(f => f.isFile() && isVideo(f.name, config))
        const nonPrimary = videoFiles.filter(f => !isPrimary(f.name, config))
        const primaryFiles = videoFiles.filter(f => isPrimary(f.name, config))

        if (videoFiles.length === 0) {
          warnings.add(seasonRel, 'No recognized video files found in season folder')
          continue
        }

        for (const f of nonPrimary) {
          const ext = path.extname(f.name).toLowerCase()
          warnings.add(
            path.join(seasonRel, f.name),
            `${formatPrimaryExts(config)} video file — may need re-encoding`,
            ext
          )
        }

        // Process episode files
        const episodeNumbers: number[] = []
        let seasonEpCount = 0

        for (const f of primaryFiles) {
          const stem = path.basename(f.name, path.extname(f.name))
          const parsed = parseFileStem(stem)

          if (!parsed) {
            warnings.add(
              path.join(seasonRel, f.name),
              'File name does not match Plex naming convention — expected: Show Title (YEAR) - S01E01 - Episode Title'
            )
            continue
          }

          const { title: fileTitle, year: fileYear, season: fileSeason, episodeCount } = parsed

          // Warning: file show/year doesn't match parent show folder
          if (fileTitle.toLowerCase() !== showTitle.toLowerCase() || fileYear !== showYear) {
            warnings.add(
              path.join(seasonRel, f.name),
              `File show/year '${fileTitle} (${fileYear})' does not match show folder '${showEntry.name}'`
            )
          }

          // Warning: file season doesn't match parent season folder (numeric only)
          if (!isNamed && fileSeason !== parseInt(seasonLabel, 10)) {
            warnings.add(
              path.join(seasonRel, f.name),
              `File season 'S${String(fileSeason).padStart(2, '0')}' does not match season folder '${seasonEntry.name}'`
            )
          }

          // Expand multi-episode files for gap detection
          const m = FILE_PATTERN.exec(stem)
          if (m) {
            const first = parseInt(m[4]!, 10)
            const second = m[5] ? parseInt(m[5], 10) : null
            if (second !== null) {
              for (let ep = first; ep <= second; ep++) episodeNumbers.push(ep)
            } else {
              episodeNumbers.push(first)
            }
          }

          seasonEpCount += episodeCount
        }

        // Warning: gaps in episode numbers
        const gaps = findEpisodeGaps(episodeNumbers)
        if (gaps.length > 0) {
          const gapStr = gaps.map(g => `E${String(g).padStart(2, '0')}`).join(', ')
          warnings.add(seasonRel, `Potential missing episodes in ${seasonEntry.name}: ${gapStr}`)
        }

        // ── Add season to records ────────────────────────────────────────
        const showKey = makeShowKey(showTitle, showYear)
        const seasonKey = makeSeasonKey(showTitle, showYear, seasonLabel)

        if (!records.has(showKey)) {
          records.set(showKey, {
            title: showTitle,
            year: showYear,
            seasons: new Map(),
          })
        }

        const show = records.get(showKey)!
        if (!show.seasons.has(seasonKey)) {
          show.seasons.set(seasonKey, {
            season_label: seasonLabel,
            episode_count: 0,
            qualities: new Set(),
          })
        }

        const season = show.seasons.get(seasonKey)!
        season.episode_count += seasonEpCount
        season.qualities.add(tag)
      }
    }

    return records
  },

  /**
   * Merge shows — custom merge needed for nested seasons.
   * Combines quality sets and takes the highest episode count across folders.
   */
  merge(existing: Map<string, ShowRecord>, incoming: Map<string, ShowRecord>): void {
    for (const [showKey, newShow] of incoming) {
      if (!existing.has(showKey)) {
        existing.set(showKey, newShow)
        continue
      }
      const existingShow = existing.get(showKey)!
      for (const [seasonKey, newSeason] of newShow.seasons) {
        if (!existingShow.seasons.has(seasonKey)) {
          existingShow.seasons.set(seasonKey, newSeason)
        } else {
          const existingSeason = existingShow.seasons.get(seasonKey)!
          for (const q of newSeason.qualities) existingSeason.qualities.add(q)
          existingSeason.episode_count = Math.max(
            existingSeason.episode_count,
            newSeason.episode_count
          )
        }
      }
    }
  },

  serialize(records: Map<string, ShowRecord>): ShowOutput[] {
    const orderQualities = (qs: Set<string>) => qualityOrder.filter(q => qs.has(q))

    return [...records.values()]
      .sort((a, b) => {
        const t = a.title.toLowerCase().localeCompare(b.title.toLowerCase())
        return t !== 0 ? t : a.year - b.year
      })
      .map(show => ({
        title: show.title,
        year: show.year,
        seasons: [...show.seasons.values()]
          .sort((a, b) => {
            const [ag0 = 0, ag1 = 0, as2 = ''] = seasonSortKey(a.season_label)
            const [bg0 = 0, bg1 = 0, bs2 = ''] = seasonSortKey(b.season_label)
            if (ag0 !== bg0) return ag0 - bg0
            if (ag1 !== bg1) return ag1 - bg1
            return as2.localeCompare(bs2)
          })
          .map(s => ({
            season: s.season_label,
            episode_count: s.episode_count,
            qualities: orderQualities(s.qualities),
          })),
      }))
  },
}
