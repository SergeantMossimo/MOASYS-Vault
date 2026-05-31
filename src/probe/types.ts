/**
 * probe/types.ts
 * --------------
 * Shared types for the ffprobe layer.
 *
 * ProbeData is the trimmed, normalized shape we keep — only the fields that
 * matter for library hygiene and the website display. Raw ffprobe JSON has
 * dozens of fields per stream; storing all of it would bloat the cache for
 * no benefit.
 */

// ─────────────────────────────────────────────
// Probe data
// ─────────────────────────────────────────────

/** Video stream summary. Null for audio-only files. */
export interface VideoProbe {
  codec: string // e.g. "h264", "hevc"
  width: number // pixels
  height: number // pixels
  /** Frames per second. Null when ffprobe couldn't determine it. */
  frame_rate: number | null
}

/** Audio stream summary. Null when no audio streams exist (rare for our use). */
export interface AudioProbe {
  codec: string // e.g. "flac", "mp3", "aac"
  /** Bits per second. Null for VBR/lossless where ffprobe didn't report it. */
  bitrate: number | null
  /** Hz. */
  sample_rate: number | null
  /** Bits per sample, e.g. 16 or 24 for lossless. Null for lossy. */
  bit_depth: number | null
  channels: number | null
}

/**
 * Normalized probe result for one file.
 * size_bytes / duration come from the container; video/audio from streams.
 */
export interface ProbeData {
  size_bytes: number
  duration_seconds: number | null
  /** Container-level bitrate in bits/sec. Often the only bitrate available. */
  bitrate: number | null
  video: VideoProbe | null
  audio: AudioProbe | null
}

// ─────────────────────────────────────────────
// Cache shape
// ─────────────────────────────────────────────

/**
 * One persisted cache entry. The path/mtime/size triple is the cache key —
 * if any of them differ for a file on disk, we re-probe.
 *
 * `path` is stored relative to the media root_path, with forward slashes,
 * so a cache built on Windows stays valid if the same library is mounted
 * later on macOS or Linux.
 */
export interface CacheEntry {
  path: string
  mtime: number // milliseconds since epoch
  size: number // bytes
  data: ProbeData
}

/** On-disk format of cache/<type>-probe.json */
export interface CacheFile {
  /** Schema version — bump if the ProbeData shape ever changes incompatibly. */
  version: number
  entries: CacheEntry[]
}

// Bumped to 2 when attached_pic filtering was added to summarizeVideo —
// previously cached audio-file probes incorrectly carried a `video` field
// holding the embedded cover art.
export const CACHE_VERSION = 2

// ─────────────────────────────────────────────
// Per-media probe output shapes
// ─────────────────────────────────────────────

/**
 * Single-file row used in every per-media probe output. ProbeData fields are
 * flattened in (size_bytes, video, audio, etc.) rather than nested under a
 * `data:` key — easier for the website to render.
 */
export interface FileProbe extends ProbeData {
  /** Folder tag from config.json — UHD, HD, Music, Audible, etc. */
  quality: string
  /** Path relative to the media root, forward slashes. */
  path: string
}

// Movies
export interface MovieProbeOutput {
  title: string
  year: number
  edition: string | null
  files: FileProbe[]
}

// Shows
export interface EpisodeProbe extends FileProbe {
  /** Plex-style episode identifier, e.g. "S01E01" or "S01E01-E02". */
  episode: string
}

export interface ShowSeasonProbe {
  season: string // "1", "Specials", etc.
  episodes: EpisodeProbe[]
}

export interface ShowProbeOutput {
  title: string
  year: number
  seasons: ShowSeasonProbe[]
}

// Music
export interface TrackProbe extends FileProbe {
  disc: number
  track: number
}

export interface AlbumProbeOutput {
  album: string
  media_type: string[]
  tracks: TrackProbe[]
}

export interface ArtistProbeOutput {
  artist: string
  albums: AlbumProbeOutput[]
}

// Audiobooks
export interface ChapterProbe extends FileProbe {
  disc: number
  chapter: number
}

export interface BookProbeOutput {
  title: string
  authors: string[]
  media_type: string[]
  chapters: ChapterProbe[]
}
