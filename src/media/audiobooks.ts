/**
 * media/audiobooks.ts
 * -------------------
 * Audiobook-specific parsing, serialization, and DB logic for MOASYS-Vault.
 *
 * Expected folder structure:
 *   <media_folder>/
 *     <Author Name>/                          ← single author
 *     <Author 1, Author 2>/                   ← multiple authors, comma-separated
 *     <Author 1, Author 2, and Author 3>/     ← multiple authors with "and"
 *       <Book Title>/
 *         01 - Chapter Name.m4b
 *         101 - Chapter Name.mp3   ← multi-disc (Book On CD)
 */

import fs from 'fs'
import path from 'path'

import {
  AudiobooksConfig,
  MediaFolder,
  BookRecord,
  BookOutput,
  WarningCollector,
  MediaModule,
} from '../core/types'

// ─────────────────────────────────────────────
// Regex patterns
// ─────────────────────────────────────────────

// Matches standard chapter file stems: "01 - Chapter Name"
// Group 1 = chapter number (2 digits), Group 2 = chapter name
const SINGLE_DISC_PATTERN = /^(\d{2})\s-\s(.+)$/

// Matches multi-disc chapter file stems: "101 - Chapter Name", "201 - Chapter Name"
// Group 1 = disc number, Group 2 = chapter number (2 digits), Group 3 = chapter name
const MULTI_DISC_PATTERN = /^(\d+)(\d{2})\s-\s(.+)$/

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function isAudio(filename: string, config: AudiobooksConfig): boolean {
  const ext = path.extname(filename).toLowerCase()
  return config.audio_extensions.map(e => e.toLowerCase()).includes(ext)
}

function isPrimary(filename: string, config: AudiobooksConfig): boolean {
  const ext = path.extname(filename).toLowerCase()
  return config.primary_extension.map(e => e.toLowerCase()).includes(ext)
}

function formatPrimaryExts(config: AudiobooksConfig): string {
  return 'Non-' + config.primary_extension.map(e => e.toUpperCase()).join('/')
}

/**
 * Parse an author folder name into a list of individual author names.
 * Handles three formats:
 *   "J.R.R. Tolkien"                    -> ["J.R.R. Tolkien"]
 *   "Terry Pratchett, Neil Gaiman"       -> ["Terry Pratchett", "Neil Gaiman"]
 *   "Author 1, Author 2, and Author 3"  -> ["Author 1", "Author 2", "Author 3"]
 *
 * Strategy: strip " and " before the last author, then split on commas.
 */
function parseAuthors(folderName: string): string[] {
  // Remove " and " (with optional leading comma) before the last author
  const cleaned = folderName.replace(/,?\s+and\s+/gi, ', ')
  return cleaned
    .split(',')
    .map(a => a.trim())
    .filter(a => a.length > 0)
}

/**
 * Parse a chapter file stem into { disc, chapter, name } or null.
 * Single-disc files (01 - Name) are treated as disc 1.
 * Multi-disc files (101 - Name) extract the disc from leading digit(s).
 */
function parseChapterStem(stem: string): { disc: number; chapter: number; name: string } | null {
  // Try multi-disc first — it's more specific
  let m = MULTI_DISC_PATTERN.exec(stem)
  if (m) {
    return {
      disc: parseInt(m[1]!, 10),
      chapter: parseInt(m[2]!, 10),
      name: m[3]!.trim(),
    }
  }
  // Fall back to single-disc (treat as disc 1)
  m = SINGLE_DISC_PATTERN.exec(stem)
  if (m) {
    return { disc: 1, chapter: parseInt(m[1]!, 10), name: m[2]!.trim() }
  }
  return null
}

/**
 * Build a unique Map key for a book.
 * Keyed by title only — not author + title — because books are the
 * top-level item in the output and authors are stored as an array field.
 */
function makeBookKey(title: string): string {
  return title.toLowerCase()
}

/**
 * Find gaps in chapter numbers for a single disc.
 * Example: [1, 2, 4] -> [3]
 */
function findChapterGaps(numbers: number[]): number[] {
  if (numbers.length === 0) return []
  const min = Math.min(...numbers)
  const max = Math.max(...numbers)
  const gaps = []
  for (let i = min; i <= max; i++) {
    if (!numbers.includes(i)) gaps.push(i)
  }
  return gaps
}

// ─────────────────────────────────────────────
// Media type order
// ─────────────────────────────────────────────

let mediaTypeOrder: string[] = []

// ─────────────────────────────────────────────
// Media module implementation
// ─────────────────────────────────────────────

export const audiobooksModule: MediaModule<BookRecord, BookOutput, AudiobooksConfig> = {
  initTagOrder(mediaFolders: MediaFolder[]): void {
    mediaTypeOrder = mediaFolders.map(mf => mf.tag)
  },

  scanMediaFolder(
    folderPath: string,
    folderName: string,
    tag: string,
    config: AudiobooksConfig,
    warnings: WarningCollector
  ): Map<string, BookRecord> {
    const records = new Map<string, BookRecord>()

    // Each subfolder inside the media folder should be an author folder
    for (const authorEntry of fs.readdirSync(folderPath, {
      withFileTypes: true,
    })) {
      if (!authorEntry.isDirectory()) continue

      const authorPath = path.join(folderPath, authorEntry.name)
      const authorRel = path.join(folderName, authorEntry.name)

      // Parse the folder name into a list of authors
      // e.g. "Terry Pratchett, Neil Gaiman" -> ["Terry Pratchett", "Neil Gaiman"]
      const authors = parseAuthors(authorEntry.name)

      let bookEntries: fs.Dirent[]
      try {
        bookEntries = fs.readdirSync(authorPath, { withFileTypes: true })
      } catch {
        warnings.add(authorRel, 'Permission denied reading author folder')
        continue
      }

      for (const bookEntry of bookEntries) {
        if (!bookEntry.isDirectory()) continue // Skip loose files (e.g. author photo)

        const bookPath = path.join(authorPath, bookEntry.name)
        const bookRel = path.join(authorRel, bookEntry.name)
        const bookKey = makeBookKey(bookEntry.name)

        let allFiles: fs.Dirent[]
        try {
          allFiles = fs.readdirSync(bookPath, { withFileTypes: true })
        } catch {
          warnings.add(bookRel, 'Permission denied reading book folder')
          continue
        }

        const audioFiles = allFiles.filter(f => f.isFile() && isAudio(f.name, config))
        const nonPrimary = audioFiles.filter(f => !isPrimary(f.name, config))

        // Warning: no audio files at all in this book folder
        if (audioFiles.length === 0) {
          warnings.add(bookRel, 'No recognized audio files found in book folder')
          continue
        }

        // Warning: non-primary audio files present
        for (const f of nonPrimary) {
          const ext = path.extname(f.name).toLowerCase()
          warnings.add(
            path.join(bookRel, f.name),
            `${formatPrimaryExts(config)} audio file — may need re-encoding`,
            ext
          )
        }

        // Track chapter numbers per disc for gap detection: { discNum: [chapterNums] }
        const discChapters = new Map<number, number[]>()
        let chapterCount = 0

        for (const f of audioFiles) {
          const stem = path.basename(f.name, path.extname(f.name))
          const parsed = parseChapterStem(stem)

          // Warning: file name doesn't match naming convention
          if (!parsed) {
            warnings.add(
              path.join(bookRel, f.name),
              'Chapter file name does not match naming convention — ' +
                'expected: 01 - Chapter Name.ext or 101 - Chapter Name.ext (multi-disc)'
            )
            continue
          }

          const { disc, chapter } = parsed
          chapterCount++

          if (!discChapters.has(disc)) discChapters.set(disc, [])
          discChapters.get(disc)!.push(chapter)
        }

        // Warning: gaps in chapter numbers, checked per disc independently
        for (const [discNum, chapters] of [...discChapters.entries()].sort(([a], [b]) => a - b)) {
          const gaps = findChapterGaps(chapters)
          if (gaps.length > 0) {
            const gapStr = gaps.map(g => `Chapter ${String(g).padStart(2, '0')}`).join(', ')
            const discStr = discChapters.size > 1 ? `Disc ${discNum}` : 'Book'
            warnings.add(bookRel, `Potential missing chapters in ${discStr}: ${gapStr}`)
          }
        }

        // Add or merge book into records
        if (!records.has(bookKey)) {
          records.set(bookKey, {
            title: bookEntry.name,
            authors,
            chapter_count: chapterCount,
            media_type: new Set(),
          })
        } else {
          // Book already exists — update chapter count if higher
          records.get(bookKey)!.chapter_count = Math.max(
            records.get(bookKey)!.chapter_count,
            chapterCount
          )
        }

        records.get(bookKey)!.media_type.add(tag)

        // Warning: same book title found in more than one media folder
        if (records.get(bookKey)!.media_type.size > 1) {
          const existingTags = [...records.get(bookKey)!.media_type].sort().join(', ')
          warnings.add(bookRel, `Duplicate book found in multiple media folders: ${existingTags}`)
        }
      }
    }

    return records
  },

  /**
   * Merge book records across media folders.
   * Books are keyed by title — same title in multiple folders merges media_type.
   */
  merge(existing: Map<string, BookRecord>, incoming: Map<string, BookRecord>): void {
    for (const [bookKey, newBook] of incoming) {
      if (!existing.has(bookKey)) {
        existing.set(bookKey, newBook)
      } else {
        const existingBook = existing.get(bookKey)!
        for (const t of newBook.media_type) existingBook.media_type.add(t)
        existingBook.chapter_count = Math.max(existingBook.chapter_count, newBook.chapter_count)
      }
    }
  },

  /** Convert records to sorted array for JSON output. Books sorted alphabetically by title. */
  serialize(records: Map<string, BookRecord>): BookOutput[] {
    const orderMediaType = (mt: Set<string>) => mediaTypeOrder.filter(t => mt.has(t))

    return [...records.values()]
      .sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()))
      .map(book => ({
        title: book.title,
        authors: book.authors,
        chapter_count: book.chapter_count,
        media_type: orderMediaType(book.media_type),
      }))
  },
}
