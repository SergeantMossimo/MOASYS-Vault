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
import { compilePattern } from '../core/rules/helpers'

import { ProbeCache } from './cache'
import { ProbeTask, ProbedFile, probeBatch } from './helpers'
import { ArtistProbeOutput, AlbumProbeOutput, TrackProbe } from './types'

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

  for (const mf of config.media_folders) {
    const folderPath = path.join(config.root_path, mf.name)
    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
      console.log(`    [SKIP] Media folder not found: ${folderPath}`)
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
          if (!hasExtension(f.name, config.audio_extensions)) continue
          // But only probe primary files for cache efficiency in the MVP.
          // Revisit if cross-format album analysis becomes important.
          if (!isPrimary(f.name, config)) continue

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
              relativePath: toRel(path.join(mf.name, artistEntry.name, albumEntry.name, f.name)),
              absolutePath,
              folderTag: mf.tag,
              mtime: stat.mtimeMs,
              size: stat.size,
            },
            identity: {
              artist: artistEntry.name,
              album: albumEntry.name,
              mediaType: mf.tag,
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
      album = { album: id.album, media_type: [], tracks: [] }
      artist.albums.set(albKey, album)
    }
    if (!album.media_type.includes(id.mediaType)) album.media_type.push(id.mediaType)

    const track: TrackProbe = {
      quality: task.folderTag,
      path: task.relativePath,
      disc: id.disc,
      track: id.track,
      size_bytes: data.size_bytes,
      duration_seconds: data.duration_seconds,
      bitrate: data.bitrate,
      video: data.video,
      audio: data.audio,
    }
    album.tracks.push(track)
  }

  // Sort media_type lists by configured order; sort tracks by disc then track.
  const mtIndex = (m: string) => {
    const i = mediaTypeOrder.indexOf(m)
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }
  for (const artist of artists.values()) {
    for (const album of artist.albums.values()) {
      album.media_type.sort((a, b) => mtIndex(a) - mtIndex(b))
      album.tracks.sort((a, b) => (a.disc !== b.disc ? a.disc - b.disc : a.track - b.track))
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
  _warnings: WarningCollector // No music warnings yet — kept for signature parity
): Promise<ArtistProbeOutput[]> {
  const collected = collectTasks(config, rules)
  console.log(`    [PROBE] ${collected.length} primary files to probe`)

  const identities = new Map<string, TrackIdentity>()
  for (const { task, identity } of collected) identities.set(task.relativePath, identity)

  const tasks = collected.map(c => c.task)
  const probed = await probeBatch(tasks, cache, (done, total, cached) => {
    if (done === total || done % 100 === 0) {
      console.log(`    [PROBE] ${done}/${total} (${cached} cached)`)
    }
  })

  const mediaTypeOrder = config.media_folders.map(mf => mf.tag)
  return aggregate(probed, identities, mediaTypeOrder)
}
