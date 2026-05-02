/**
 * media/music.ts
 * --------------
 * Music-specific parsing, serialization, and DB logic for MOASYS-Vault.
 *
 * Expected folder structure:
 *   <media_folder>/
 *     <Artist Name>/
 *       <Album Name>/
 *         01 - Track Name.flac
 *         101 - Track Name.flac     ← multi-disc: disc 1, track 1
 *         201 - Track Name.flac     ← multi-disc: disc 2, track 1
 */

import fs from 'fs'
import path from 'path'

import {
  MusicConfig,
  MediaFolder,
  ArtistRecord,
  ArtistOutput,
  WarningCollector,
  MediaModule,
} from '../core/types'

// ─────────────────────────────────────────────
// Regex patterns
// ─────────────────────────────────────────────

// Matches single-disc track stems: "01 - Track Name"
// Group 1 = track number (2 digits), Group 2 = track name
const SINGLE_DISC_PATTERN = /^(\d{2})\s-\s(.+)$/

// Matches multi-disc track stems: "101 - Track Name", "302 - Track Name"
// Group 1 = disc number, Group 2 = track number (2 digits), Group 3 = track name
const MULTI_DISC_PATTERN = /^(\d+)(\d{2})\s-\s(.+)$/

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function isAudio(filename: string, config: MusicConfig): boolean {
  const ext = path.extname(filename).toLowerCase()
  return config.audio_extensions.map(e => e.toLowerCase()).includes(ext)
}

function isPrimary(filename: string, config: MusicConfig): boolean {
  const ext = path.extname(filename).toLowerCase()
  return config.primary_extension.map(e => e.toLowerCase()).includes(ext)
}

function formatPrimaryExts(config: MusicConfig): string {
  return 'Non-' + config.primary_extension.map(e => e.toUpperCase()).join('/')
}

/**
 * Parse a track file stem into { disc, track, name } or null.
 * Single-disc files (01 - Name) are treated as disc 1.
 * Multi-disc files (101 - Name) extract the disc from the leading digit(s).
 */
function parseTrackStem(stem: string): { disc: number; track: number; name: string } | null {
  // Try multi-disc first — it's more specific
  let m = MULTI_DISC_PATTERN.exec(stem)
  if (m) {
    return {
      disc: parseInt(m[1]!, 10),
      track: parseInt(m[2]!, 10),
      name: m[3]!.trim(),
    }
  }
  // Fall back to single-disc (treat as disc 1)
  m = SINGLE_DISC_PATTERN.exec(stem)
  if (m) {
    return { disc: 1, track: parseInt(m[1]!, 10), name: m[2]!.trim() }
  }
  return null
}

function makeArtistKey(artist: string): string {
  return artist.toLowerCase()
}

function makeAlbumKey(artist: string, album: string): string {
  return `${artist.toLowerCase()}|${album.toLowerCase()}`
}

/**
 * Find gaps in track numbers for a single disc.
 * Example: [1, 2, 4] -> [3]
 */
function findTrackGaps(numbers: number[]): number[] {
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

// Stores media folder tag order for consistent media_type sorting in output
let mediaTypeOrder: string[] = []

// ─────────────────────────────────────────────
// Media module implementation
// ─────────────────────────────────────────────

export const musicModule: MediaModule<ArtistRecord, ArtistOutput, MusicConfig> = {
  initTagOrder(mediaFolders: MediaFolder[]): void {
    mediaTypeOrder = mediaFolders.map(mf => mf.tag)
  },

  scanMediaFolder(
    folderPath: string,
    folderName: string,
    tag: string,
    config: MusicConfig,
    warnings: WarningCollector
  ): Map<string, ArtistRecord> {
    const records = new Map<string, ArtistRecord>()

    // Each subfolder inside the media folder should be an artist folder
    for (const artistEntry of fs.readdirSync(folderPath, {
      withFileTypes: true,
    })) {
      if (!artistEntry.isDirectory()) continue

      const artistPath = path.join(folderPath, artistEntry.name)
      const artistRel = path.join(folderName, artistEntry.name)
      const artistKey = makeArtistKey(artistEntry.name)

      let albumEntries: fs.Dirent[]
      try {
        albumEntries = fs.readdirSync(artistPath, { withFileTypes: true })
      } catch {
        warnings.add(artistRel, 'Permission denied reading artist folder')
        continue
      }

      for (const albumEntry of albumEntries) {
        if (!albumEntry.isDirectory()) continue // Skip loose files (e.g. artist artwork)

        const albumPath = path.join(artistPath, albumEntry.name)
        const albumRel = path.join(artistRel, albumEntry.name)
        const albumKey = makeAlbumKey(artistEntry.name, albumEntry.name)

        let allFiles: fs.Dirent[]
        try {
          allFiles = fs.readdirSync(albumPath, { withFileTypes: true })
        } catch {
          warnings.add(albumRel, 'Permission denied reading album folder')
          continue
        }

        const audioFiles = allFiles.filter(f => f.isFile() && isAudio(f.name, config))
        const nonPrimary = audioFiles.filter(f => !isPrimary(f.name, config))

        // Warning: no audio files at all
        if (audioFiles.length === 0) {
          warnings.add(albumRel, 'No recognized audio files found in album folder')
          continue
        }

        // Warning: non-primary audio files (e.g. .mp3 when primary is .flac)
        for (const f of nonPrimary) {
          const ext = path.extname(f.name).toLowerCase()
          warnings.add(
            path.join(albumRel, f.name),
            `${formatPrimaryExts(config)} audio file — may need re-encoding`,
            ext
          )
        }

        // Collect qualities from all audio file extensions (not just primary)
        // e.g. album with .flac and .mp3 -> qualities = { "FLAC", "MP3" }
        const qualities = new Set<string>()
        for (const f of audioFiles) {
          const ext = path.extname(f.name).slice(1).toUpperCase() // ".flac" -> "FLAC"
          qualities.add(ext)
        }

        // Track numbers per disc for gap detection: { discNum: [trackNums] }
        const discTracks = new Map<number, number[]>()
        let trackCount = 0

        for (const f of audioFiles) {
          const stem = path.basename(f.name, path.extname(f.name))
          const parsed = parseTrackStem(stem)

          if (!parsed) {
            warnings.add(
              path.join(albumRel, f.name),
              'Track file name does not match Plex naming convention — ' +
                'expected: 01 - Track Name.ext or 101 - Track Name.ext (multi-disc)'
            )
            continue
          }

          const { disc, track } = parsed
          trackCount++

          if (!discTracks.has(disc)) discTracks.set(disc, [])
          discTracks.get(disc)!.push(track)
        }

        // Warning: gaps in track numbers, checked per disc independently
        for (const [discNum, tracks] of [...discTracks.entries()].sort(([a], [b]) => a - b)) {
          const gaps = findTrackGaps(tracks)
          if (gaps.length > 0) {
            const gapStr = gaps.map(g => `Track ${String(g).padStart(2, '0')}`).join(', ')
            const discStr = discTracks.size > 1 ? `Disc ${discNum}` : 'Album'
            warnings.add(albumRel, `Potential missing tracks in ${discStr}: ${gapStr}`)
          }
        }

        // Add or merge album into records
        if (!records.has(artistKey)) {
          records.set(artistKey, {
            artist: artistEntry.name,
            albums: new Map(),
          })
        }

        const artistRecord = records.get(artistKey)!

        if (!artistRecord.albums.has(albumKey)) {
          artistRecord.albums.set(albumKey, {
            album: albumEntry.name,
            track_count: trackCount,
            qualities,
            media_type: new Set(),
          })
        } else {
          // Album already exists from a previous media folder — merge
          const existing = artistRecord.albums.get(albumKey)!
          for (const q of qualities) existing.qualities.add(q)
          existing.track_count = Math.max(existing.track_count, trackCount)
        }

        artistRecord.albums.get(albumKey)!.media_type.add(tag)

        // Warning: same album found in more than one media folder
        const albumRecord = artistRecord.albums.get(albumKey)!
        if (albumRecord.media_type.size > 1) {
          const existingTags = [...albumRecord.media_type].sort().join(', ')
          warnings.add(
            path.join(folderName, artistEntry.name, albumEntry.name),
            `Duplicate album found in multiple media folders: ${existingTags}`
          )
        }
      }
    }

    return records
  },

  /** Merge artist records — handles nested albums */
  merge(existing: Map<string, ArtistRecord>, incoming: Map<string, ArtistRecord>): void {
    for (const [artistKey, newArtist] of incoming) {
      if (!existing.has(artistKey)) {
        existing.set(artistKey, newArtist)
        continue
      }
      const existingArtist = existing.get(artistKey)!
      for (const [albumKey, newAlbum] of newArtist.albums) {
        if (!existingArtist.albums.has(albumKey)) {
          existingArtist.albums.set(albumKey, newAlbum)
        } else {
          const existingAlbum = existingArtist.albums.get(albumKey)!
          for (const q of newAlbum.qualities) existingAlbum.qualities.add(q)
          for (const t of newAlbum.media_type) existingAlbum.media_type.add(t)
          existingAlbum.track_count = Math.max(existingAlbum.track_count, newAlbum.track_count)
        }
      }
    }
  },

  serialize(records: Map<string, ArtistRecord>): ArtistOutput[] {
    const orderMediaType = (mt: Set<string>) => mediaTypeOrder.filter(t => mt.has(t))

    return [...records.values()]
      .sort((a, b) => a.artist.toLowerCase().localeCompare(b.artist.toLowerCase()))
      .map(artist => ({
        artist: artist.artist,
        albums: [...artist.albums.values()]
          .sort((a, b) => a.album.toLowerCase().localeCompare(b.album.toLowerCase()))
          .map(album => ({
            album: album.album,
            track_count: album.track_count,
            qualities: [...album.qualities].sort(), // Alphabetical — no config order
            media_type: orderMediaType(album.media_type),
          })),
      }))
  },
}
