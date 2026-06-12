/**
 * media/shows.ts
 * --------------
 * Show-specific parsing, serialization, and DB logic for MOASYS-Vault.
 *
 * Expected Plex folder structure (default rules):
 *   <media_folder>/
 *     <Show Title (YEAR)>/
 *       Season 01/
 *         <Show Title (YEAR)> - S01E01 - Episode Title.mp4
 *         <Show Title (YEAR)> - S01E01-E02 - Multi Episode Title.mp4
 *       Specials/              ← named season from ignored_season_names rules
 *         <Show Title (YEAR)> - S00E01 - Special Title.mp4
 *
 * Patterns and ignored_season_names come from src/core/rules/shows.ts
 * (with optional YAML overrides in rules/shows.yaml).
 */

import fs from 'fs'
import path from 'path'

import { ShowsConfig, ShowRecord, ShowOutput, WarningCollector, MediaModule } from '../core/types'
import { hasExtension, isPrimary, formatPrimaryExts, findUnexpectedEntries } from '../core/files'
import { findNumericGaps } from '../core/gaps'
import { ShowsRules } from '../core/rules/shows'
import { compilePattern, resolveCategories, sortQualities } from '../core/rules/helpers'
import { finalizeVersions, distinctCategories } from '../core/versions'
import { ProbeData } from '../probe/types'
import { deriveQuality } from '../probe/helpers'

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function parseShowFolder(name: string, regex: RegExp): { title: string; year: number } | null {
  const m = regex.exec(name)
  if (!m?.groups) return null
  const { title, year } = m.groups
  if (title === undefined || year === undefined) return null
  return { title: title.trim(), year: parseInt(year, 10) }
}

function parseSeasonFolder(name: string, regex: RegExp): number | null {
  const m = regex.exec(name)
  if (!m?.groups) return null
  const season = m.groups.season
  if (season === undefined) return null
  return parseInt(season, 10)
}

/**
 * Parse an episode file stem. Returns first/last episode numbers — equal for
 * single-episode files, different for multi-episode files (S01E01-E02 → 1, 2).
 * episode_end is optional in the pattern; absent means single-episode.
 */
function parseFileStem(
  stem: string,
  regex: RegExp
): {
  title: string
  year: number
  season: number
  firstEpisode: number
  lastEpisode: number
} | null {
  const m = regex.exec(stem)
  if (!m?.groups) return null
  const { title, year, season, episode, episode_end } = m.groups
  if (title === undefined || year === undefined || season === undefined || episode === undefined) {
    return null
  }
  const first = parseInt(episode, 10)
  const last = episode_end !== undefined ? parseInt(episode_end, 10) : first
  return {
    title: title.trim(),
    year: parseInt(year, 10),
    season: parseInt(season, 10),
    firstEpisode: first,
    lastEpisode: last,
  }
}

function makeShowKey(title: string, year: number): string {
  return `${title.toLowerCase()}|${year}`
}

function makeSeasonKey(title: string, year: number, seasonLabel: string): string {
  return `${title.toLowerCase()}|${year}|${seasonLabel.toLowerCase()}`
}

/**
 * Sort key for season labels — numeric seasons first (in numeric order),
 * then named seasons alphabetically.
 * e.g. "1", "2", "10", "Champion of Champions", "Specials"
 */
function seasonSortKey(label: string): [number, number, string] {
  const n = parseInt(label, 10)
  if (!isNaN(n)) return [0, n, '']
  return [1, 0, label.toLowerCase()]
}

/** Normalize a path to forward slashes — matches the probe-side cache key. */
function toRel(p: string): string {
  return p.split(path.sep).join('/')
}

// ─────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────

export function createShowsModule(
  rules: ShowsRules
): MediaModule<ShowRecord, ShowOutput, ShowsConfig> {
  const showFolderRegex = compilePattern(rules.patterns.show_folder)
  const seasonFolderRegex = compilePattern(rules.patterns.season_folder)
  const fileRegex = compilePattern(rules.patterns.file)

  // Pre-lowercase the ignored names once rather than on every season check.
  const ignoredNamesLower = rules.ignored_season_names.map(n => n.toLowerCase())

  const effectiveCategories = resolveCategories(rules.categories)
  const categoryOrder = effectiveCategories.map(c => c.name)

  // Map each category name to its auto-detected quality (or the category
  // name itself when quality is null). Used by the per-season multi_quality
  // postScan check so {Other HD, SD} resolves to qualities {HD, SD}.
  const categoryToQuality = new Map<string, string>()
  for (const c of effectiveCategories) {
    categoryToQuality.set(c.name, c.quality ?? c.name)
  }

  /** Return true if the quality set matches one of the acceptable combos. */
  function isAcceptableCombo(qualities: Set<string>, combos: readonly string[][]): boolean {
    return combos.some(
      combo => combo.length === qualities.size && combo.every(q => qualities.has(q))
    )
  }

  return {
    getCategories: () => effectiveCategories,

    scanCategory(
      folderPath: string,
      folderName: string,
      category: string,
      config: ShowsConfig,
      warnings: WarningCollector,
      probeByPath: Map<string, ProbeData>
    ): Map<string, ShowRecord> {
      const records = new Map<string, ShowRecord>()

      const rootEntries = fs.readdirSync(folderPath, { withFileTypes: true })

      // Loose video files at media folder level — silently dropped without
      // this check. Plex expects each show inside a Show Title (YEAR)/ folder.
      if (rules.checks.warn_loose_files) {
        const looseRoot = rootEntries.filter(
          e => e.isFile() && hasExtension(e.name, rules.video_extensions)
        )
        if (looseRoot.length > 0) {
          warnings.add(
            folderName,
            `${looseRoot.length} loose video file(s) in media folder root — Plex expects each show inside a 'Show Title (YEAR)' folder with Season XX subfolders.`
          )
        }
      }

      // Unexpected non-media, non-sidecar files at media folder root.
      if (rules.checks.warn_unexpected_entries) {
        const unexpected = findUnexpectedEntries(
          rootEntries,
          rules.video_extensions,
          rules.sidecar_extensions
        )
        if (unexpected.length > 0) {
          const names = unexpected.map(e => `'${e.name}'`).join(', ')
          warnings.add(
            folderName,
            `Unexpected file(s) in media folder root: ${names}. ` +
              `Expected only Show Title (YEAR)/ subfolders plus Plex sidecars.`
          )
        }
      }

      for (const showEntry of rootEntries) {
        if (!showEntry.isDirectory()) continue

        const showPath = path.join(folderPath, showEntry.name)
        const showRel = path.join(folderName, showEntry.name)
        const parsedShow = parseShowFolder(showEntry.name, showFolderRegex)

        if (!parsedShow) {
          if (rules.checks.warn_bad_show_folder) {
            warnings.add(
              showRel,
              'Show folder name does not match Plex naming convention — expected: Show Title (YEAR)'
            )
          }
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

        // Loose video files in the show folder (no Season XX folder around
        // them) — silently dropped from the catalog without this check.
        if (rules.checks.warn_loose_files) {
          const looseShow = seasonEntries.filter(
            e => e.isFile() && hasExtension(e.name, rules.video_extensions)
          )
          if (looseShow.length > 0) {
            warnings.add(
              showRel,
              `${looseShow.length} loose video file(s) in show folder — Plex expects episodes inside a Season XX subfolder. ` +
                `Move episodes into a Season XX folder (Season 01, Season 02, etc.).`
            )
          }
        }

        // Unexpected non-media, non-sidecar files in the show folder.
        // Sidecars (show poster, banner, fanart, NFO) are silently allowed.
        if (rules.checks.warn_unexpected_entries) {
          const unexpected = findUnexpectedEntries(
            seasonEntries,
            rules.video_extensions,
            rules.sidecar_extensions
          )
          if (unexpected.length > 0) {
            const names = unexpected.map(e => `'${e.name}'`).join(', ')
            warnings.add(
              showRel,
              `Unexpected file(s) in show folder: ${names}. ` +
                `Expected only Season XX/ subfolders plus Plex sidecars.`
            )
          }
        }

        for (const seasonEntry of seasonEntries) {
          if (!seasonEntry.isDirectory()) continue

          const seasonPath = path.join(showPath, seasonEntry.name)
          const seasonRel = path.join(showRel, seasonEntry.name)
          const nameLower = seasonEntry.name.toLowerCase()

          // ── Determine season label ───────────────────────────────────────
          let seasonLabel: string
          let isNamed: boolean

          if (ignoredNamesLower.includes(nameLower)) {
            // Named season from rules (e.g. "Specials") — use as-is
            seasonLabel = seasonEntry.name
            isNamed = true
          } else {
            const seasonNumber = parseSeasonFolder(seasonEntry.name, seasonFolderRegex)
            if (seasonNumber === null) {
              if (rules.checks.warn_bad_season_folder) {
                warnings.add(
                  seasonRel,
                  `Season folder '${seasonEntry.name}' does not match expected format ` +
                    `(expected: Season 01) and is not in ignored_season_names`
                )
              }
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

          // Subfolders inside a season are silently ignored — any files in
          // them would be dropped from the catalog.
          if (rules.checks.warn_extra_subfolders) {
            const subfolders = allFiles.filter(e => e.isDirectory())
            if (subfolders.length > 0) {
              const names = subfolders.map(s => `'${s.name}'`).join(', ')
              warnings.add(
                seasonRel,
                `Unexpected subfolder(s) in season folder: ${names}. ` +
                  `Plex expects all episodes directly inside the Season XX folder. ` +
                  `Files inside these subfolders are not scanned.`
              )
            }
          }

          // Non-media, non-sidecar files inside the season folder.
          if (rules.checks.warn_unexpected_entries) {
            const unexpected = findUnexpectedEntries(
              allFiles,
              rules.video_extensions,
              rules.sidecar_extensions
            )
            if (unexpected.length > 0) {
              const names = unexpected.map(e => `'${e.name}'`).join(', ')
              warnings.add(
                seasonRel,
                `Unexpected file(s) in season folder: ${names}. ` +
                  `Expected only episode files plus Plex sidecars.`
              )
            }
          }

          const videoFiles = allFiles.filter(
            f => f.isFile() && hasExtension(f.name, rules.video_extensions)
          )
          const nonPrimary = videoFiles.filter(f => !isPrimary(f.name, rules.primary_extension))
          const primaryFiles = videoFiles.filter(f => isPrimary(f.name, rules.primary_extension))

          if (videoFiles.length === 0) {
            if (rules.checks.warn_no_videos) {
              warnings.add(seasonRel, 'No recognized video files found in season folder')
            }
            continue
          }

          if (rules.checks.warn_non_primary) {
            for (const f of nonPrimary) {
              const ext = path.extname(f.name).toLowerCase()
              warnings.add(
                path.join(seasonRel, f.name),
                `${formatPrimaryExts(rules.primary_extension)} video file — may need re-encoding`,
                ext
              )
            }
          }

          const episodeNumbers: number[] = []
          let seasonEpCount = 0

          for (const f of primaryFiles) {
            const stem = path.basename(f.name, path.extname(f.name))
            const parsed = parseFileStem(stem, fileRegex)

            if (!parsed) {
              if (rules.checks.warn_bad_file_name) {
                warnings.add(
                  path.join(seasonRel, f.name),
                  'File name does not match Plex naming convention — expected: Show Title (YEAR) - S01E01 or Show Title (YEAR) - S01E01 - Episode Title'
                )
              }
              continue
            }

            const {
              title: fileTitle,
              year: fileYear,
              season: fileSeason,
              firstEpisode,
              lastEpisode,
            } = parsed

            if (fileTitle.toLowerCase() !== showTitle.toLowerCase() || fileYear !== showYear) {
              if (rules.checks.warn_show_year_mismatch) {
                warnings.add(
                  path.join(seasonRel, f.name),
                  `File show/year '${fileTitle} (${fileYear})' does not match show folder '${showEntry.name}'`
                )
              }
            }

            if (!isNamed && fileSeason !== parseInt(seasonLabel, 10)) {
              if (rules.checks.warn_season_mismatch) {
                warnings.add(
                  path.join(seasonRel, f.name),
                  `File season 'S${String(fileSeason).padStart(2, '0')}' does not match season folder '${seasonEntry.name}'`
                )
              }
            }

            // Add each individual episode number for gap detection
            for (let ep = firstEpisode; ep <= lastEpisode; ep++) {
              episodeNumbers.push(ep)
            }
            seasonEpCount += lastEpisode - firstEpisode + 1
          }

          if (rules.checks.warn_episode_gaps) {
            const gaps = findNumericGaps(episodeNumbers)
            if (gaps.length > 0) {
              const gapStr = gaps.map(g => `E${String(g).padStart(2, '0')}`).join(', ')
              warnings.add(
                seasonRel,
                `Potential missing episodes in ${seasonEntry.name}: ${gapStr}`
              )
            }
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
              versions: [],
            })
          }

          const season = show.seasons.get(seasonKey)!
          season.episode_count += seasonEpCount
          // Push one version per probed episode file. dedupVersions collapses
          // identical (category, quality) entries at serialize time, so a
          // uniform-quality season produces one version while a mixed-quality
          // one produces multiple — accurate to what's on disk.
          for (const f of primaryFiles) {
            const probePath = toRel(path.join(seasonRel, f.name))
            const probe = probeByPath.get(probePath)
            const quality = probe?.video
              ? deriveQuality(probe.video.width, probe.video.height, rules.quality_thresholds)
              : null
            season.versions.push({ category, quality })
          }
        }
      }

      return records
    },

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
            existingSeason.versions.push(...newSeason.versions)
            existingSeason.episode_count = Math.max(
              existingSeason.episode_count,
              newSeason.episode_count
            )
          }
        }
      }
    },

    serialize(records: Map<string, ShowRecord>): ShowOutput[] {
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
              const [ag0, ag1, as2] = seasonSortKey(a.season_label)
              const [bg0, bg1, bs2] = seasonSortKey(b.season_label)
              if (ag0 !== bg0) return ag0 - bg0
              if (ag1 !== bg1) return ag1 - bg1
              return as2.localeCompare(bs2)
            })
            .map(s => ({
              season: s.season_label,
              episode_count: s.episode_count,
              versions: finalizeVersions(s.versions, categoryOrder),
            })),
        }))
    },

    /**
     * Post-merge check: emit a warning for each (show, season) pair whose
     * versions span more than one distinct quality, unless that quality set
     * is whitelisted via `acceptable_quality_combos`. Per-season scope means
     * different seasons in different qualities (S01 DVD, S02-S08 Bluray) do
     * NOT trigger this — only a single season existing in multiple qualities
     * does (e.g. S01 in both DVD/SD and Bluray/HD).
     */
    postScan(records: Map<string, ShowRecord>, warnings: WarningCollector): void {
      if (!rules.checks.warn_multi_quality) return

      for (const show of records.values()) {
        for (const season of show.seasons.values()) {
          const cats = distinctCategories(season.versions)
          const qualities = new Set<string>()
          for (const c of cats) qualities.add(categoryToQuality.get(c) ?? c)
          if (qualities.size <= 1) continue
          if (isAcceptableCombo(qualities, rules.acceptable_quality_combos)) continue

          warnings.add(
            `${show.title} (${show.year}) — Season ${season.season_label}`,
            `Season ${season.season_label} exists in multiple qualities: ${sortQualities(qualities).join(', ')}`
          )
        }
      }
    },
  }
}
