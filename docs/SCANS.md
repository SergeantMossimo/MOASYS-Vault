# Scans, Probes & Validation — Runbook

MOASYS-Vault has three independent passes you can run against your library. Each one is opt-in, runs on its own schedule, and writes to its own files.

| Pass         | Command                   | Speed                                       | What it does                                                                               |
| ------------ | ------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Scan**     | `npm run <type>`          | Fast (seconds)                              | Walks the library, builds the catalog, surfaces naming/structure warnings. Offline.        |
| **Probe**    | `npm run probe:<type>`    | Slow first time, instant cached             | Runs ffprobe on every file. Surfaces quality data + mismatch warnings. ID3 tags for music. |
| **Validate** | `npm run validate:<type>` | ~10 min for movies first time, cached after | Cross-checks scan output against TMDB. Catches title/year/episode mismatches.              |

The **scan** pass is what `<type>` and `scan:all` run. The other two are explicit (`probe:`, `validate:` prefixes).

---

## Suggested workflow

### Initial setup (one-time)

```bash
# 1. Install dependencies
npm install

# 2. Point the scanner at your library (edit root_path per media type)
# Open config.json and set root_path for each media type you have

# 3. First scan
npm run scan:all

# 4. Review warnings, fix what you want to fix in your library, re-scan
npm run scan:all
```

The scan pass is fast and idempotent. Re-run as many times as you want while fixing naming/structure issues.

### Adding new media

```bash
# 1. Add the new files/folders to your library

# 2. Re-scan the affected type (fast)
npm run movies        # or shows, music, audiobooks

# 3. (Optional) Probe just the new files (existing files served from cache)
npm run probe:movies

# 4. (Optional) Validate the new entries against TMDB (existing cached)
npm run validate:movies
```

The probe and validate caches are keyed by file content (probe) and search query (validate), so they automatically skip work you've already done.

### After cleaning up warnings

You changed something in your library — what do you need to re-run?

| You changed...                                   | Re-run                                                                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Renamed/moved folders or files                   | `npm run <type>` — scan                                                                                                |
| Updated ID3 tags in music                        | `npm run probe:music`                                                                                                  |
| Replaced a media file (different format/bitrate) | `npm run probe:<type>`                                                                                                 |
| Fixed a movie/show title or year                 | `npm run validate:<type>`                                                                                              |
| Added new content                                | scan first; probe and validate are optional                                                                            |
| Nothing changed but want fresh data              | Scan is always fresh. Probe + validate use caches keyed by file mtime/size and search query — both are safe to re-run. |

---

## Scan pass — `npm run <type>`

Walks the configured `media_folders` (or `root_path` if `media_folders` is empty), parses each file's name and folder structure, builds a clean catalog, and writes:

- `output/<type>/<type>.json` — the catalog
- `output/<type>/warnings.json` — naming/structure findings

What gets flagged: file/folder names that don't match Plex conventions, missing episodes (gaps in episode numbers), duplicate albums/books across media folders, files in unexpected locations, unrecognized file types, suspicious folder characters, and more. Full list in [REFERENCE.md](REFERENCE.md).

The scan is fully offline and reads only metadata (size, modification time, directory structure). It never opens the files themselves.

### Variants

```bash
npm run movies        # scan movies only
npm run shows         # scan shows only
npm run music         # scan music only
npm run audiobooks    # scan audiobooks only
npm run scan:all      # all four sequentially
```

---

## Probe pass — `npm run probe:<type>`

Uses `ffprobe` (bundled via `ffprobe-static`, no install needed) to inspect each file's actual contents: codec, bitrate, dimensions, sample rate, bit depth, channels. For music specifically, also reads ID3 / Vorbis / MP4 tags via the `music-metadata` package.

Writes:

- `output/<type>/probe.json` — per-file probe data, joinable to the scan output by title/album/etc.
- `output/<type>/probe-warnings.json` — quality and tag findings

### When you'd run this

- Confirm video quality matches your folder structure (HD movie in UHD folder?)
- Find albums where the ID3 AlbumArtist disagrees with the folder name
- Surface compilation albums that should be under `Various Artists/`
- Detect intra-album quality inconsistencies (FLAC + MP3 in the same album)

### Speed

First run on a fresh library is slow — ffprobe takes 100-300 ms per file:

| Library        | First run  | Cached re-run |
| -------------- | ---------- | ------------- |
| 2,500 movies   | ~12-20 min | Seconds       |
| 5,000 episodes | ~15-25 min | Seconds       |
| 7,000 tracks   | ~10 min    | Seconds       |
| 3,500 chapters | ~6 min     | Seconds       |

The cache lives in `cache/<type>-probe.json` (gitignored) and is keyed by `path|mtime|size`. Only changed/added files get re-probed.

### Quality buckets (movies and shows)

For video media, you can configure pixel-range buckets per folder tag in `rules/<type>.yaml`:

```yaml
quality_thresholds:
  - name: UHD
    tags: [UHD, 'Other UHD']
    min_width: 2000
  - name: HD
    tags: [HD, 'Other HD']
    min_width: 1000
    max_width: 2000
  - name: SD
    tags: [SD, 'Other SD']
    max_width: 1000
```

Files whose long edge (`max(width, height)`) falls outside the bucket get a `quality_mismatch` warning. Forgiving by design — HandBrake-cropped 664×448 SD and 1920×800 HD still classify correctly. Ships empty by default so libraries without quality buckets stay quiet.

### Music quality summary

Each album in `probe.json` gets a derived `audio_quality_summary` array — strings like `"FLAC 16/44.1"`, `"MP3 ~288"`, `"AAC 256"`. VBR tolerance collapses same-codec same-target tracks into one entry. Albums with truly mixed quality (FLAC + MP3, or wide-spread bitrate) get a `warn_quality_inconsistent` warning.

### ID3 tags

Per-track `tags` field with title, artist, album_artist, album, year, track number, disc, genre. Four warnings driven from those:

- `warn_compilation_detected` — multiple distinct AlbumArtists in one album folder
- `warn_folder_tag_mismatch` — folder name disagrees with tag
- `warn_missing_tags` — required fields blank
- `warn_track_number_mismatch` — filename `01 -` doesn't match tag's track number

---

## Validate pass — `npm run validate:<type>`

Cross-checks the scan output against TheMovieDB. Movies and shows only.

Writes:

- `output/<type>/validation.json` — per-record TMDB resolution (canonical title, year, TMDB ID, alternatives)
- `output/<type>/validation-warnings.json` — confidence warnings + canonical-title suggestions

### Setup

1. Get a free v3 API key from https://www.themoviedb.org/settings/api
2. Copy `.secrets.json.example` to `.secrets.json`
3. Paste your key into the `tmdb.api_key` field

See [CONFIG.md → .secrets.json](CONFIG.md#secretsjson).

### What it catches

**For movies:**

- Title typos (`Justice League Unlimitied` → no match)
- Year off by 1 (Casablanca 1942 vs TMDB's 1943 — premiere vs wide release)
- Title canonicalization opportunities (your `Alice In Wonderland` → TMDB's `Alice in Wonderland`)
- Obscure films that aren't in TMDB

**For shows (in addition to all of the above):**

- **Episode count gaps** — your gap detection only finds missing-in-the-middle. This catches "TMDB says season 5 has 23 episodes; you have 22." That single missing episode flagged.

### Matching strategy

The matching is **strict** — only filename-illegal characters (`<>:"|?*\/`) are stripped before comparison. Diacritics are NOT stripped: your `Amelie` ≠ TMDB's `Amélie` because `é` is legal in filenames, and we surface that as `no_match` so you can decide whether to add the accent.

When a match is found:

- `tmdb_title_filename_safe` is included in the output — a copy-pasteable rename target
- If your folder differs from that target, `warn_tmdb_title_canonical` fires

Confidence is scored from title match (exact/prefix/substring) + year match (exact/off-by-1/off-by-2/wider). Thresholds:

- **high** (≥ 150) — title exact + year exact
- **medium** (≥ 110) — usually title exact + year off by 1, or prefix + year exact
- **low** (≥ 60) — partial title match + close year
- **none** (< 60) — no plausible candidate; warning fires

### Caching

- `cache/tmdb-search.json` — search-query → resolved-match lookup
- `cache/tmdb-movies.json` / `cache/tmdb-shows.json` — full entity records by TMDB ID

All gitignored. Re-runs are near-instant. Total first-run cost for the example library: ~10 min movies, ~3 min shows.

### Rate limiting

Hardcoded throttle: 4 requests/sec (TMDB allows 40 req/10 sec). Well under the limit, no need to tune. 429 responses honor `Retry-After`.
