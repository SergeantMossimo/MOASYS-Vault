/**
 * media/movies.ts
 * ---------------
 * Movie-specific parsing, serialization, and DB logic for MOASYS-Vault.
 *
 * Expected Plex folder structure:
 *   <media_folder>/
 *     <Movie Title (YEAR)>/
 *       <Movie Title (YEAR)>.mp4
 *       <Movie Title (YEAR)> {edition-Edition Name}.mp4
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

// ─────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────

const EARLIEST_FILM_YEAR = 1888 // Roundhay Garden Scene
const CURRENT_YEAR = new Date().getFullYear() // Evaluated once at startup

// ─────────────────────────────────────────────
// Regex patterns
// ─────────────────────────────────────────────

// Matches Plex-style movie folder names: "The Crow (1994)"
// Group 1 = title, Group 2 = year
const FOLDER_PATTERN = /^(.+)\s\((\d{4})\)$/

// Matches Plex-style movie file stems, with an optional edition tag:
//   "The Crow (1994)"
//   "The Crow (1994) {edition-Director's Cut}"
//   "The Crow (1994) {edition-}"   ← empty edition, caught as a warning
// Group 1 = title, Group 2 = year, Group 3 = edition value (may be empty string)
const FILE_PATTERN = /^(.+)\s\((\d{4})\)(?:\s\{edition-([^}]*)\})?$/

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** Return true if the file extension is in the configured video_extensions list */
function isVideo(filename: string, config: MoviesConfig): boolean {
  const ext = path.extname(filename).toLowerCase()
  return config.video_extensions.map(e => e.toLowerCase()).includes(ext)
}

/** Return true if the file extension matches any configured primary_extension */
function isPrimary(filename: string, config: MoviesConfig): boolean {
  const ext = path.extname(filename).toLowerCase()
  return config.primary_extension.map(e => e.toLowerCase()).includes(ext)
}

/**
 * Return a human-readable string of primary extensions for warning messages.
 * e.g. [".mp4"] -> "Non-.MP4"   [".mp4", ".mkv"] -> "Non-.MP4/.MKV"
 */
function formatPrimaryExts(config: MoviesConfig): string {
  return 'Non-' + config.primary_extension.map(e => e.toUpperCase()).join('/')
}

/**
 * Parse a Plex movie folder name into { title, year } or null.
 * Example: "The Crow (1994)" -> { title: "The Crow", year: 1994 }
 */
function parseFolder(name: string): { title: string; year: number } | null {
  const m = FOLDER_PATTERN.exec(name)
  if (!m) return null
  return { title: m[1]!.trim(), year: parseInt(m[2]!, 10) }
}

/**
 * Parse a Plex movie file stem into { title, year, edition } or null.
 * edition is null (no tag), "" (empty tag), or a string (edition name).
 */
function parseFileStem(
  stem: string
): { title: string; year: number; edition: string | null } | null {
  const m = FILE_PATTERN.exec(stem)
  if (!m) return null
  const editionRaw = m[3] // m[3] is string|undefined — handled below
  let edition: string | null
  if (editionRaw === undefined) {
    edition = null // No {edition-...} tag at all
  } else if (editionRaw.trim() === '') {
    edition = '' // Empty tag: {edition-}
  } else {
    edition = editionRaw.trim()
  }
  return { title: m[1]!.trim(), year: parseInt(m[2]!, 10), edition }
}

/**
 * Build a unique Map key for a movie record.
 * Lowercased so "The Crow" and "the crow" are treated as the same title.
 */
function makeKey(title: string, year: number, edition: string | null): string {
  return `${title.toLowerCase()}|${year}|${(edition ?? '').toLowerCase()}`
}

// ─────────────────────────────────────────────
// Quality order
// ─────────────────────────────────────────────

// Populated at startup by initTagOrder() so qualities always appear
// in the same order as defined in config.json (e.g. UHD before HD before SD)
let qualityOrder: string[] = []

// ─────────────────────────────────────────────
// Media module implementation
// ─────────────────────────────────────────────

export const moviesModule: MediaModule<MovieRecord, MovieOutput, MoviesConfig> = {
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

    // Each subfolder inside a media folder should be a movie folder
    for (const entry of fs.readdirSync(folderPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue // Skip loose files in the media folder

      const movieFolderPath = path.join(folderPath, entry.name)
      const folderRel = path.join(folderName, entry.name)
      const parsedFolder = parseFolder(entry.name)

      // Read all files inside this movie folder
      let allFiles: fs.Dirent[]
      try {
        allFiles = fs.readdirSync(movieFolderPath, { withFileTypes: true })
      } catch {
        warnings.add(folderRel, 'Permission denied reading folder')
        continue
      }

      // Separate into video and non-video, then primary and non-primary
      const videoFiles = allFiles.filter(f => f.isFile() && isVideo(f.name, config))
      const nonPrimary = videoFiles.filter(f => !isPrimary(f.name, config))
      const primaryFiles = videoFiles.filter(f => isPrimary(f.name, config))

      // Warning: folder has no video files at all
      if (videoFiles.length === 0) {
        warnings.add(folderRel, 'No recognized video files found in folder')
        continue
      }

      // Warning: non-primary video files (e.g. .mkv when primary is .mp4)
      for (const f of nonPrimary) {
        const ext = path.extname(f.name).toLowerCase()
        warnings.add(
          path.join(folderRel, f.name),
          `${formatPrimaryExts(config)} video file — may need re-encoding`,
          ext
        )
      }

      // Track seen editions in this folder to detect duplicates
      // Key = lowercased edition, Value = filename of first file with that edition
      const seenEditions = new Map<string, string>()

      for (const f of primaryFiles) {
        const stem = path.basename(f.name, path.extname(f.name))
        const parsed = parseFileStem(stem)

        // Warning: file name doesn't follow Plex naming convention
        if (!parsed) {
          warnings.add(
            path.join(folderRel, f.name),
            'File name does not match Plex naming convention'
          )
          continue
        }

        const { title: fileTitle, year: fileYear } = parsed
        let { edition } = parsed

        // Warning: empty edition tag — {edition-} with no value
        if (edition === '') {
          warnings.add(
            path.join(folderRel, f.name),
            'Empty edition tag found — {edition-} has no value after the dash'
          )
          edition = null // Treat as no edition so file still gets catalogued
        }

        // Warning: suspicious year (before cinema existed or in the future)
        if (fileYear < EARLIEST_FILM_YEAR || fileYear > CURRENT_YEAR) {
          warnings.add(
            path.join(folderRel, f.name),
            `Suspicious year (${fileYear}) — expected between ${EARLIEST_FILM_YEAR} and ${CURRENT_YEAR}`
          )
        }

        if (!parsedFolder) {
          // Warning: parent folder name doesn't follow Plex convention
          warnings.add(folderRel, 'Folder name does not match Plex naming convention')
        } else {
          const { title: folderTitle, year: folderYear } = parsedFolder

          // Warning: file title doesn't match folder title
          if (fileTitle.toLowerCase() !== folderTitle.toLowerCase()) {
            warnings.add(
              path.join(folderRel, f.name),
              `File title '${fileTitle}' does not match folder title '${folderTitle}'`
            )
          }

          // Warning: file year doesn't match folder year (checked independently of title)
          if (fileYear !== folderYear) {
            warnings.add(
              path.join(folderRel, f.name),
              `File year (${fileYear}) does not match folder year (${folderYear}) in '${entry.name}'`
            )
          }
        }

        // Warning: two files in the same folder claim the same edition
        const editionKey = (edition ?? '').toLowerCase()
        const existing = seenEditions.get(editionKey)
        if (existing !== undefined) {
          warnings.add(
            path.join(folderRel, f.name),
            `Duplicate edition — another file already claims ${!edition ? 'no edition' : `'${edition}'`}: '${existing}'`
          )
        } else {
          seenEditions.set(editionKey, f.name)
        }

        // Add or update the movie record
        const key = makeKey(fileTitle, fileYear, edition)
        if (!records.has(key)) {
          records.set(key, {
            title: fileTitle,
            year: fileYear,
            edition,
            qualities: new Set(),
          })
        }
        records.get(key)!.qualities.add(tag) // ! = we just confirmed it exists above
      }
    }

    return records
  },

  /**
   * Merge incoming records into existing — if a key already exists,
   * add the new quality tags to the existing set.
   */
  merge(existing: Map<string, MovieRecord>, incoming: Map<string, MovieRecord>): void {
    for (const [key, record] of incoming) {
      if (existing.has(key)) {
        for (const q of record.qualities) existing.get(key)!.qualities.add(q)
      } else {
        existing.set(key, record)
      }
    }
  },

  /**
   * Convert the internal records Map into a sorted array for JSON output.
   * Qualities converted from Set to sorted array here since JSON has no Set type.
   */
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
}
