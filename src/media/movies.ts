/**
 * media/movies.ts
 * ---------------
 * Movie-specific parsing, serialization, and DB logic for MOASYS-Vault.
 *
 * Expected Plex folder structure (default rules):
 *   <media_folder>/
 *     <Movie Title (YEAR)>/
 *       <Movie Title (YEAR)>.mp4
 *       <Movie Title (YEAR)> {edition-Edition Name}.mp4
 *
 * The patterns and constants that define those conventions live in
 * src/core/rules/movies.ts (with optional YAML overrides in rules/movies.yaml).
 * This file no longer hardcodes regexes or year ranges — it consumes them
 * through the factory below.
 */

import fs from 'fs'
import path from 'path'

import {
  MoviesConfig,
  MediaFolder,
  MovieRecord,
  MovieOutput,
  WarningCollector,
  MediaModule,
} from '../core/types'
import { hasExtension, isPrimary, formatPrimaryExts, findUnexpectedEntries } from '../core/files'
import { MoviesRules } from '../core/rules/movies'
import { compilePattern } from '../core/rules/helpers'

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/**
 * Parse a Plex movie folder name using the configured folder pattern.
 * Returns { title, year } or null if the name doesn't match the pattern.
 *
 * The pattern is expected to use named capture groups `title` and `year`.
 */
function parseFolder(name: string, folderRegex: RegExp): { title: string; year: number } | null {
  const m = folderRegex.exec(name)
  if (!m?.groups) return null
  const { title, year } = m.groups
  if (title === undefined || year === undefined) return null
  return { title: title.trim(), year: parseInt(year, 10) }
}

/**
 * Parse a Plex movie file stem using the configured file pattern.
 * Returns { title, year, edition } or null.
 *
 * edition is null (no tag), "" (empty tag like `{edition-}`), or a string.
 * The pattern is expected to use named capture groups `title`, `year`, and
 * optionally `edition`.
 */
function parseFileStem(
  stem: string,
  fileRegex: RegExp
): { title: string; year: number; edition: string | null } | null {
  const m = fileRegex.exec(stem)
  if (!m?.groups) return null
  const { title, year, edition: editionRaw } = m.groups
  if (title === undefined || year === undefined) return null

  let edition: string | null
  if (editionRaw === undefined) {
    edition = null // No {edition-...} tag at all
  } else if (editionRaw.trim() === '') {
    edition = '' // Empty tag: {edition-}
  } else {
    edition = editionRaw.trim()
  }
  return { title: title.trim(), year: parseInt(year, 10), edition }
}

/**
 * Build a unique Map key for a movie record.
 * Lowercased so "The Crow" and "the crow" are treated as the same title.
 */
function makeKey(title: string, year: number, edition: string | null): string {
  return `${title.toLowerCase()}|${year}|${(edition ?? '').toLowerCase()}`
}

/** Return true if the qualities set matches one of the acceptable combos */
function isAcceptableCombo(qualities: Set<string>, combos: readonly string[][]): boolean {
  return combos.some(combo => combo.length === qualities.size && combo.every(q => qualities.has(q)))
}

/** Build the Plex-style movie name used as the warning path */
function movieDisplayName(record: MovieRecord): string {
  const base = `${record.title} (${record.year})`
  return record.edition ? `${base} {edition-${record.edition}}` : base
}

// ─────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────

/**
 * Create a movies media module bound to the provided rules.
 * Called once at startup by scan.ts after rules are loaded and validated.
 *
 * Rules are captured in closure rather than read from module-level state,
 * so the module is reusable and testable without globals (apart from the
 * qualityOrder slot already established by initTagOrder).
 */
export function createMoviesModule(
  rules: MoviesRules
): MediaModule<MovieRecord, MovieOutput, MoviesConfig> {
  // Compile pattern entries to RegExp objects once at boot. The rules schema
  // already validated that pattern and flags are well-formed, so no try/catch.
  const folderRegex = compilePattern(rules.patterns.folder)
  const fileRegex = compilePattern(rules.patterns.file)

  // year_range.max is resolved to a plain number by the loader, even if the
  // YAML wrote `max: current`. So this assertion is safe.
  const yearMin = rules.year_range.min
  const yearMax = rules.year_range.max as number

  let qualityOrder: string[] = []

  return {
    /** Set the canonical quality sort order from config */
    initTagOrder(mediaFolders: MediaFolder[]): void {
      qualityOrder = mediaFolders.map(mf => mf.tag)
    },

    /**
     * Walk one media folder (e.g. UHD/) and return a Map of movie records.
     * Called once per media_folder entry by core/scanner.ts.
     */
    scanMediaFolder(
      folderPath: string,
      folderName: string,
      tag: string,
      config: MoviesConfig,
      warnings: WarningCollector
    ): Map<string, MovieRecord> {
      const records = new Map<string, MovieRecord>()

      const rootEntries = fs.readdirSync(folderPath, { withFileTypes: true })

      // Loose video files at media folder level — silently dropped without
      // this check. Plex expects each movie inside a Title (YEAR)/ folder.
      if (rules.checks.warn_loose_files) {
        const looseRoot = rootEntries.filter(
          e => e.isFile() && hasExtension(e.name, config.video_extensions)
        )
        if (looseRoot.length > 0) {
          warnings.add(
            folderName,
            `${looseRoot.length} loose video file(s) in media folder root — Plex expects each movie inside a 'Movie Title (YEAR)' folder. ` +
              `Move each file into its own correctly-named folder.`
          )
        }
      }

      // Unexpected non-media, non-sidecar files at media folder root.
      if (rules.checks.warn_unexpected_entries) {
        const unexpected = findUnexpectedEntries(
          rootEntries,
          config.video_extensions,
          rules.sidecar_extensions
        )
        if (unexpected.length > 0) {
          const names = unexpected.map(e => `'${e.name}'`).join(', ')
          warnings.add(
            folderName,
            `Unexpected file(s) in media folder root: ${names}. ` +
              `Expected only Movie Title (YEAR)/ subfolders plus Plex sidecars (${rules.sidecar_extensions.join(', ')}).`
          )
        }
      }

      for (const entry of rootEntries) {
        if (!entry.isDirectory()) continue

        const movieFolderPath = path.join(folderPath, entry.name)
        const folderRel = path.join(folderName, entry.name)
        const parsedFolder = parseFolder(entry.name, folderRegex)

        let allFiles: fs.Dirent[]
        try {
          allFiles = fs.readdirSync(movieFolderPath, { withFileTypes: true })
        } catch {
          warnings.add(folderRel, 'Permission denied reading folder')
          continue
        }

        // Subfolders inside a movie folder are silently ignored — any video
        // files in them would be dropped from the catalog.
        if (rules.checks.warn_extra_subfolders) {
          const subfolders = allFiles.filter(e => e.isDirectory())
          if (subfolders.length > 0) {
            const names = subfolders.map(s => `'${s.name}'`).join(', ')
            warnings.add(
              folderRel,
              `Unexpected subfolder(s) in movie folder: ${names}. ` +
                `Plex expects all video files directly inside the Movie Title (YEAR)/ folder. ` +
                `Files inside these subfolders are not scanned.`
            )
          }
        }

        // Non-media, non-sidecar files inside a movie folder (e.g. .zip, .txt).
        if (rules.checks.warn_unexpected_entries) {
          const unexpected = findUnexpectedEntries(
            allFiles,
            config.video_extensions,
            rules.sidecar_extensions
          )
          if (unexpected.length > 0) {
            const names = unexpected.map(e => `'${e.name}'`).join(', ')
            warnings.add(
              folderRel,
              `Unexpected file(s) in movie folder: ${names}. ` +
                `Expected only video files plus Plex sidecars (${rules.sidecar_extensions.join(', ')}).`
            )
          }
        }

        const videoFiles = allFiles.filter(
          f => f.isFile() && hasExtension(f.name, config.video_extensions)
        )
        const nonPrimary = videoFiles.filter(f => !isPrimary(f.name, config))
        const primaryFiles = videoFiles.filter(f => isPrimary(f.name, config))

        if (videoFiles.length === 0) {
          if (rules.checks.warn_no_videos) {
            warnings.add(folderRel, 'No recognized video files found in folder')
          }
          continue
        }

        if (rules.checks.warn_non_primary) {
          for (const f of nonPrimary) {
            const ext = path.extname(f.name).toLowerCase()
            warnings.add(
              path.join(folderRel, f.name),
              `${formatPrimaryExts(config)} video file — may need re-encoding`,
              ext
            )
          }
        }

        // Track seen editions in this folder to detect duplicates
        const seenEditions = new Map<string, string>()

        for (const f of primaryFiles) {
          const stem = path.basename(f.name, path.extname(f.name))
          const parsed = parseFileStem(stem, fileRegex)

          if (!parsed) {
            if (rules.checks.warn_bad_file_name) {
              warnings.add(
                path.join(folderRel, f.name),
                'File name does not match Plex naming convention'
              )
            }
            continue
          }

          const { title: fileTitle, year: fileYear } = parsed
          let { edition } = parsed

          if (edition === '') {
            if (rules.checks.warn_empty_edition) {
              warnings.add(
                path.join(folderRel, f.name),
                'Empty edition tag found — {edition-} has no value after the dash'
              )
            }
            edition = null // Treat as no edition so file still gets catalogued
          }

          if (fileYear < yearMin || fileYear > yearMax) {
            if (rules.checks.warn_suspicious_year) {
              warnings.add(
                path.join(folderRel, f.name),
                `Suspicious year (${fileYear}) — expected between ${yearMin} and ${yearMax}`
              )
            }
          }

          if (!parsedFolder) {
            if (rules.checks.warn_bad_folder_name) {
              warnings.add(folderRel, 'Folder name does not match Plex naming convention')
            }
          } else {
            const { title: folderTitle, year: folderYear } = parsedFolder

            if (fileTitle.toLowerCase() !== folderTitle.toLowerCase()) {
              if (rules.checks.warn_title_mismatch) {
                warnings.add(
                  path.join(folderRel, f.name),
                  `File title '${fileTitle}' does not match folder title '${folderTitle}'`
                )
              }
            }

            if (fileYear !== folderYear) {
              if (rules.checks.warn_year_mismatch) {
                warnings.add(
                  path.join(folderRel, f.name),
                  `File year (${fileYear}) does not match folder year (${folderYear}) in '${entry.name}'`
                )
              }
            }
          }

          // Duplicate-edition check: two files in same folder claiming same edition
          const editionKey = (edition ?? '').toLowerCase()
          const existing = seenEditions.get(editionKey)
          if (existing !== undefined) {
            if (rules.checks.warn_duplicate_edition) {
              warnings.add(
                path.join(folderRel, f.name),
                `Duplicate edition — another file already claims ${!edition ? 'no edition' : `'${edition}'`}: '${existing}'`
              )
            }
          } else {
            seenEditions.set(editionKey, f.name)
          }

          const key = makeKey(fileTitle, fileYear, edition)
          if (!records.has(key)) {
            records.set(key, {
              title: fileTitle,
              year: fileYear,
              edition,
              qualities: new Set(),
            })
          }
          records.get(key)!.qualities.add(tag)
        }
      }

      return records
    },

    merge(existing: Map<string, MovieRecord>, incoming: Map<string, MovieRecord>): void {
      for (const [key, record] of incoming) {
        if (existing.has(key)) {
          for (const q of record.qualities) existing.get(key)!.qualities.add(q)
        } else {
          existing.set(key, record)
        }
      }
    },

    serialize(records: Map<string, MovieRecord>): MovieOutput[] {
      const orderQualities = (qs: Set<string>) => qualityOrder.filter(q => qs.has(q))

      return [...records.values()]
        .map(r => ({
          title: r.title,
          year: r.year,
          edition: r.edition,
          qualities: orderQualities(r.qualities),
        }))
        .sort((a, b) => {
          const t = a.title.toLowerCase().localeCompare(b.title.toLowerCase())
          if (t !== 0) return t
          if (a.year !== b.year) return a.year - b.year
          return (a.edition ?? '').localeCompare(b.edition ?? '')
        })
    },

    /**
     * Post-merge check: emit a warning for each movie that exists in more than
     * one quality folder, unless its quality set is in acceptable_quality_combos.
     */
    postScan(records: Map<string, MovieRecord>, warnings: WarningCollector): void {
      if (!rules.checks.warn_multi_quality) return

      for (const record of records.values()) {
        if (record.qualities.size <= 1) continue
        if (isAcceptableCombo(record.qualities, rules.acceptable_quality_combos)) continue

        const ordered = qualityOrder.filter(q => record.qualities.has(q))
        warnings.add(
          movieDisplayName(record),
          `Movie exists in multiple quality folders: ${ordered.join(', ')}`
        )
      }
    },
  }
}
