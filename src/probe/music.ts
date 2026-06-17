/**
 * probe/music.ts
 * --------------
 * ffprobe pass for music — walks the library and records per-track probe data.
 *
 * No quality_mismatch logic: music quality is codec + bitrate + sample rate +
 * bit depth rather than dimensions. The probe pass collects all of those and
 * leaves analysis to the website (or a future warning pass).
 */

import fs from 'fs'
import path from 'path'

import { MusicConfig, WarningCollector } from '../core/types'
import { hasExtension, isPrimary } from '../core/files'
import { MusicRules } from '../core/rules/music'
import { compilePattern, resolveCategories } from '../core/rules/helpers'

import { stripFilenameIllegalChars } from '../core/files'

import { ProbeCache } from './cache'
import { ProbeTask, ProbedFile, probeBatch } from './helpers'
import { readTags } from './id3'
import { deriveAudioQuality, summarizeAlbumQuality } from './music-quality'
import { ArtistProbeOutput, AlbumProbeOutput, TrackProbe, ProbeData, ProbeResult } from './types'

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

interface TrackIdentity {
  artist: string
  album: string
  mediaType: string
  disc: number
  track: number
}

function parseTrackStem(
  stem: string,
  multiDiscRegex: RegExp,
  singleDiscRegex: RegExp
): { disc: number; track: number } | null {
  const mm = multiDiscRegex.exec(stem)
  if (mm?.groups) {
    const { disc, track } = mm.groups
    if (disc !== undefined && track !== undefined) {
      return { disc: parseInt(disc, 10), track: parseInt(track, 10) }
    }
  }
  const sm = singleDiscRegex.exec(stem)
  if (sm?.groups) {
    const { track } = sm.groups
    if (track !== undefined) return { disc: 1, track: parseInt(track, 10) }
  }
  return null
}

function artistKey(a: string): string {
  return a.toLowerCase()
}

function albumKey(a: string, al: string): string {
  return `${a.toLowerCase()}|${al.toLowerCase()}`
}

function toRel(p: string): string {
  return p.split(path.sep).join('/')
}

/**
 * Build a warning path for an album-level finding. Prepends the first
 * category from `media_type` so users can locate the album in libraries
 * organized by subfolder. The "default" sentinel (empty categories config)
 * is skipped so flat libraries stay clean. WarningCollector normalizes the
 * backslashes that path.join produces on Windows.
 */
function albumWarningPath(mediaType: string[], artist: string, album: string): string {
  const category = mediaType[0]
  return category && category !== 'default'
    ? path.join(category, artist, album)
    : path.join(artist, album)
}

/**
 * Pull the codec name (e.g. "FLAC", "MP3", "AAC") out of an
 * `audio_quality_summary` entry like "FLAC 16/44.1" or "MP3 ~288".
 * Entries always start with the codec followed by a space, so the first
 * whitespace-delimited token is the codec.
 */
function codecFromQualityEntry(entry: string): string {
  const space = entry.indexOf(' ')
  return space === -1 ? entry : entry.slice(0, space)
}

/** Return true if `codecs` matches one of the acceptable combos (set equality). */
function isAcceptableCodecCombo(codecs: Set<string>, combos: readonly string[][]): boolean {
  return combos.some(combo => combo.length === codecs.size && combo.every(c => codecs.has(c)))
}

// ─────────────────────────────────────────────
// Walk
// ─────────────────────────────────────────────

function collectTasks(
  config: MusicConfig,
  rules: MusicRules
): Array<{ task: ProbeTask; identity: TrackIdentity }> {
  const multiDiscRegex = compilePattern(rules.patterns.multi_disc)
  const singleDiscRegex = compilePattern(rules.patterns.single_disc)
  const out: Array<{ task: ProbeTask; identity: TrackIdentity }> = []

  for (const cat of resolveCategories(rules.categories)) {
    const folderPath = path.join(config.root_path, cat.folderName)
    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
      console.log(`    [SKIP] Category folder not found: ${folderPath}`)
      continue
    }

    for (const artistEntry of fs.readdirSync(folderPath, { withFileTypes: true })) {
      if (!artistEntry.isDirectory()) continue
      const artistPath = path.join(folderPath, artistEntry.name)

      let albumEntries: fs.Dirent[]
      try {
        albumEntries = fs.readdirSync(artistPath, { withFileTypes: true })
      } catch {
        continue
      }

      for (const albumEntry of albumEntries) {
        if (!albumEntry.isDirectory()) continue
        const albumPath = path.join(artistPath, albumEntry.name)

        let files: fs.Dirent[]
        try {
          files = fs.readdirSync(albumPath, { withFileTypes: true })
        } catch {
          continue
        }

        for (const f of files) {
          if (!f.isFile()) continue
          // Music probes ALL audio extensions (not just primary) because the
          // probe data itself is the signal — non-primary files often still
          // matter for the album-quality picture.
          if (!hasExtension(f.name, rules.audio_extensions)) continue
          // But only probe primary files for cache efficiency in the MVP.
          // Revisit if cross-format album analysis becomes important.
          if (!isPrimary(f.name, rules.primary_extension)) continue

          const stem = path.basename(f.name, path.extname(f.name))
          const parsed = parseTrackStem(stem, multiDiscRegex, singleDiscRegex)
          if (!parsed) continue

          const absolutePath = path.join(albumPath, f.name)
          let stat: fs.Stats
          try {
            stat = fs.statSync(absolutePath)
          } catch {
            continue
          }

          out.push({
            task: {
              relativePath: toRel(
                path.join(cat.folderName, artistEntry.name, albumEntry.name, f.name)
              ),
              absolutePath,
              category: cat.name,
              quality: cat.quality,
              mtime: stat.mtimeMs,
              size: stat.size,
            },
            identity: {
              artist: artistEntry.name,
              album: albumEntry.name,
              mediaType: cat.name,
              disc: parsed.disc,
              track: parsed.track,
            },
          })
        }
      }
    }
  }

  return out
}

// ─────────────────────────────────────────────
// Aggregation
// ─────────────────────────────────────────────

function aggregate(
  probed: ProbedFile[],
  identities: Map<string, TrackIdentity>,
  mediaTypeOrder: string[]
): ArtistProbeOutput[] {
  const artists = new Map<string, { artist: string; albums: Map<string, AlbumProbeOutput> }>()

  for (const { task, data } of probed) {
    const id = identities.get(task.relativePath)
    if (!id) continue

    const aKey = artistKey(id.artist)
    let artist = artists.get(aKey)
    if (!artist) {
      artist = { artist: id.artist, albums: new Map() }
      artists.set(aKey, artist)
    }

    const albKey = albumKey(id.artist, id.album)
    let album = artist.albums.get(albKey)
    if (!album) {
      album = { album: id.album, media_type: [], audio_quality_summary: [], tracks: [] }
      artist.albums.set(albKey, album)
    }
    if (!album.media_type.includes(id.mediaType)) album.media_type.push(id.mediaType)

    const track: TrackProbe = {
      quality: task.category,
      path: task.relativePath,
      disc: id.disc,
      track: id.track,
      size_bytes: data.size_bytes,
      duration_seconds: data.duration_seconds,
      bitrate: data.bitrate,
      video: data.video,
      audio: data.audio,
      tags: data.tags,
      audio_quality: deriveAudioQuality(data.audio, data.bitrate),
    }
    album.tracks.push(track)
  }

  // Sort media_type lists by configured order; sort tracks by disc then track.
  // Derive each album's audio_quality_summary via summarizeAlbumQuality which
  // collapses VBR variance and only surfaces real inconsistencies.
  const mtIndex = (m: string) => {
    const i = mediaTypeOrder.indexOf(m)
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }
  for (const artist of artists.values()) {
    for (const album of artist.albums.values()) {
      album.media_type.sort((a, b) => mtIndex(a) - mtIndex(b))
      album.tracks.sort((a, b) => (a.disc !== b.disc ? a.disc - b.disc : a.track - b.track))
      album.audio_quality_summary = summarizeAlbumQuality(album.tracks)
    }
  }

  return [...artists.values()]
    .sort((a, b) => a.artist.toLowerCase().localeCompare(b.artist.toLowerCase()))
    .map(artist => ({
      artist: artist.artist,
      albums: [...artist.albums.values()].sort((a, b) =>
        a.album.toLowerCase().localeCompare(b.album.toLowerCase())
      ),
    }))
}

// ─────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────

export async function probeMusic(
  config: MusicConfig,
  rules: MusicRules,
  cache: ProbeCache,
  warnings: WarningCollector
): Promise<ProbeResult<ArtistProbeOutput[]>> {
  const collected = collectTasks(config, rules)
  console.log(`    [PROBE] ${collected.length} primary files to probe`)

  const identities = new Map<string, TrackIdentity>()
  for (const { task, identity } of collected) identities.set(task.relativePath, identity)

  const tasks = collected.map(c => c.task)
  const probed = await probeBatch(
    tasks,
    cache,
    (done, total, cached) => {
      if (done === total || done % 100 === 0) {
        console.log(`    [PROBE] ${done}/${total} (${cached} cached)`)
      }
    },
    readTags
  )

  const mediaTypeOrder = resolveCategories(rules.categories).map(c => c.name)
  const aggregated = aggregate(probed, identities, mediaTypeOrder)

  // Quality inconsistency check — runs after aggregation since we need the
  // full per-album audio_quality_summary to know if there's a mismatch.
  //
  // Codec-mix cases that match `acceptable_codec_combos` are silently passed.
  // Bitrate-spread cases within a single codec still fire — the whitelist
  // only suppresses codec-mix noise (FLAC + MP3 etc.).
  if (rules.checks.warn_quality_inconsistent) {
    for (const artist of aggregated) {
      for (const album of artist.albums) {
        if (album.audio_quality_summary.length <= 1) continue

        const codecs = new Set(album.audio_quality_summary.map(codecFromQualityEntry))
        const isCodecMix = codecs.size > 1
        if (isCodecMix && isAcceptableCodecCombo(codecs, rules.acceptable_codec_combos)) {
          continue
        }

        warnings.add(
          'warn_quality_inconsistent',
          albumWarningPath(album.media_type, artist.artist, album.album),
          `Album has inconsistent audio quality across tracks: ${album.audio_quality_summary.join(', ')}. ` +
            `Usually means a mid-album re-encode or files added at different bitrates. ` +
            `Re-encode the outliers to match the album's primary quality.`
        )
      }
    }
  }

  // Tag-driven checks — only run when at least one track in any album has
  // tags. Saves time on libraries without ID3 data (rare but possible).
  analyzeTags(aggregated, rules, warnings)

  const byPath = new Map<string, ProbeData>()
  for (const { task, data } of probed) byPath.set(task.relativePath, data)

  return { output: aggregated, byPath }
}

// ─────────────────────────────────────────────
// Tag analysis (compilation, mismatch, missing, track-number)
// ─────────────────────────────────────────────

/**
 * Match a tag value against a folder name, allowing for Windows-illegal
 * characters in the tag that the user had to drop from the folder.
 *
 * Example: ID3 `AlbumArtist` is `AC/DC` but the folder is `ACDC` because
 * forward slashes can't appear in folder names. We strip illegal chars
 * from the tag side before comparing — the folder is the filename-safe
 * form of the tag, and that's a legitimate match.
 *
 * Comparison is case-insensitive and trim-tolerant.
 */
function tagMatchesFolder(tagValue: string, folderName: string): boolean {
  const tagSafe = stripFilenameIllegalChars(tagValue).trim().toLowerCase()
  const folder = folderName.trim().toLowerCase()
  return tagSafe === folder
}

/**
 * Pick the form of a tag value the user could actually use as a folder name.
 * For tags with no illegal characters this is just the tag itself; for tags
 * like `AC/DC` it's the stripped `ACDC` form so the recommended-fix message
 * doesn't tell the user to do something impossible.
 */
function suggestedFolderName(tagValue: string): string {
  const safe = stripFilenameIllegalChars(tagValue)
  return safe === tagValue ? tagValue : safe
}

/** Is this string the literal Plex "Various Artists" convention? */
function isVariousArtists(s: string): boolean {
  return s.trim().toLowerCase() === 'various artists'
}

/**
 * Run all four ID3-driven checks against the aggregated probe results.
 * Each toggle is gated by its own `rules.checks.warn_*` so users can silence
 * individual checks without losing the others.
 */
function analyzeTags(
  aggregated: ArtistProbeOutput[],
  rules: MusicRules,
  warnings: WarningCollector
): void {
  for (const artist of aggregated) {
    for (const album of artist.albums) {
      const albumPath = albumWarningPath(album.media_type, artist.artist, album.album)

      // Collect distinct album_artist values (fall back to artist when
      // album_artist is missing — many older rips only set artist).
      const albumArtistSet = new Set<string>()
      const albumNameSet = new Set<string>()
      let tracksWithTags = 0
      const missingTagsTracks: string[] = []
      const trackNumberMismatches: Array<{ filename: string; tag: number; expected: number }> = []

      for (const t of album.tracks) {
        if (!t.tags) continue
        tracksWithTags++

        const albumArtist = (t.tags.album_artist ?? t.tags.artist)?.trim()
        if (albumArtist) albumArtistSet.add(albumArtist)
        if (t.tags.album) albumNameSet.add(t.tags.album.trim())

        // Missing required tags: title and album always needed; artist OR
        // album_artist needed.
        const hasArtistish = (t.tags.artist || t.tags.album_artist)?.trim()
        if (!t.tags.title || !t.tags.album || !hasArtistish) {
          missingTagsTracks.push(t.path)
        }

        // Track-number mismatch: only flag when the tag is present and
        // differs from the filename track number.
        if (t.tags.track !== null && t.tags.track !== t.track) {
          trackNumberMismatches.push({
            filename: t.path,
            tag: t.tags.track,
            expected: t.track,
          })
        }
      }

      // Skip the album entirely when no tracks had readable tags — nothing
      // to compare against.
      if (tracksWithTags === 0) continue

      // ── Compilation detection ────────────────────────────────────────
      // Multiple distinct album_artist values = real compilation. Should
      // live under "Various Artists" per Plex docs.
      if (
        rules.checks.warn_compilation_detected &&
        albumArtistSet.size > 1 &&
        !isVariousArtists(artist.artist)
      ) {
        const sample = [...albumArtistSet].slice(0, 5).join(', ')
        const more = albumArtistSet.size > 5 ? `, ... +${albumArtistSet.size - 5} more` : ''
        warnings.add(
          'warn_compilation_detected',
          albumPath,
          `Album has tracks by ${albumArtistSet.size} distinct artists (per AlbumArtist tag: ${sample}${more}) ` +
            `but isn't in a 'Various Artists' folder. ` +
            `Recommended fix: move this album to '<category>/Various Artists/${album.album}/' and ensure ` +
            `each track's AlbumArtist tag is set to 'Various Artists' (per-track Artist tag stays the actual performer).`
        )
      }

      // ── Folder/tag mismatch ──────────────────────────────────────────
      // Single consistent album_artist that disagrees with the artist
      // folder name. Common Plex library fragmentation cause.
      if (rules.checks.warn_folder_tag_mismatch && albumArtistSet.size === 1) {
        const tagValue = [...albumArtistSet][0]!
        if (!tagMatchesFolder(tagValue, artist.artist)) {
          warnings.add(
            'warn_folder_tag_mismatch',
            albumPath,
            `Folder/tag mismatch: artist folder is '${artist.artist}' but AlbumArtist tag is '${tagValue}'. ` +
              `Recommended fix: rename folder to '${suggestedFolderName(tagValue)}' (or update the tag if the folder is correct). ` +
              `Without this, Plex may catalog the album under one name while users browse under the other.`
          )
        }
      }

      // Album name mismatch — same idea, different field.
      if (rules.checks.warn_folder_tag_mismatch && albumNameSet.size === 1) {
        const tagValue = [...albumNameSet][0]!
        if (!tagMatchesFolder(tagValue, album.album)) {
          warnings.add(
            'warn_folder_tag_mismatch',
            albumPath,
            `Folder/tag mismatch: album folder is '${album.album}' but Album tag is '${tagValue}'. ` +
              `Recommended fix: rename folder to '${suggestedFolderName(tagValue)}' or update the tag.`
          )
        }
      }

      // ── Missing tags ─────────────────────────────────────────────────
      if (rules.checks.warn_missing_tags && missingTagsTracks.length > 0) {
        const sample = missingTagsTracks
          .slice(0, 3)
          .map(p => `'${p}'`)
          .join(', ')
        const more = missingTagsTracks.length > 3 ? `, +${missingTagsTracks.length - 3} more` : ''
        warnings.add(
          'warn_missing_tags',
          albumPath,
          `${missingTagsTracks.length} track(s) missing required tags (title, album, or artist/album_artist). ` +
            `Affected: ${sample}${more}. ` +
            `Plex will fall back to filename parsing for these tracks. Tag them properly for cleaner library metadata.`
        )
      }

      // ── Track-number mismatch ────────────────────────────────────────
      if (rules.checks.warn_track_number_mismatch && trackNumberMismatches.length > 0) {
        const sample = trackNumberMismatches
          .slice(0, 3)
          .map(m => `'${m.filename}' (filename=${m.expected}, tag=${m.tag})`)
          .join('; ')
        const more =
          trackNumberMismatches.length > 3 ? `; +${trackNumberMismatches.length - 3} more` : ''
        warnings.add(
          'warn_track_number_mismatch',
          albumPath,
          `${trackNumberMismatches.length} track(s) with track-number mismatch between filename and tag. ` +
            `${sample}${more}. ` +
            `Usually an accidental rename — verify the tag is right, then rename the file.`
        )
      }
    }
  }
}
