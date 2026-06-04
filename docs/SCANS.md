# Scans & Validation — Runbook

MOASYS-Vault has two independent passes you can run against your library. The first builds the catalog (with quality data + every hygiene warning); the second is an optional online cross-check against TheMovieDB.

| Pass         | Command                   | Speed                                       | What it does                                                                                       |
| ------------ | ------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Scan**     | `npm run <type>`          | Slow first time, instant cached             | Probe (ffprobe + ID3) + folder walk in one pass. Catalog, quality, naming/structure, tag warnings. |
| **Validate** | `npm run validate:<type>` | ~10 min for movies first time, cached after | Cross-checks the catalog against TMDB. Catches title/year/episode mismatches.                      |

The **scan** pass is what `<type>` and `scan:all` run.

---

## Suggested workflow

### Initial setup (one-time)

```bash
# 1. Install dependencies
npm install

# 2. Point the scanner at your library (edit root_path per media type)
# Open config.json and set root_path for each media type you have

# 3. First scan — slow first time (ffprobe walks every primary file)
npm run scan:all

# 4. Review warnings, fix what you want to fix in your library, re-scan
npm run scan:all
```

The probe cache (gitignored, `cache/<type>-probe.json`) makes re-runs near-instant. Only new / modified / removed files trigger a fresh ffprobe call.

### Adding new media

```bash
# 1. Add the new files/folders to your library

# 2. Re-scan the affected type (existing files served from cache; only the new
#    ones get probed)
npm run movies        # or shows, music, audiobooks

# 3. (Optional) Validate the new entries against TMDB
npm run validate:movies
```

### After cleaning up warnings

You changed something in your library — what do you need to re-run?

| You changed...                                   | Re-run                                                                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Renamed/moved folders or files                   | `npm run <type>` — scan                                                                                                |
| Updated ID3 tags in music                        | `npm run music`                                                                                                        |
| Replaced a media file (different format/bitrate) | `npm run <type>` — probe cache invalidates by mtime/size                                                               |
| Fixed a movie/show title or year                 | `npm run <type>` then `npm run validate:<type>`                                                                        |
| Added new content                                | `npm run <type>` — probe handles only the new files                                                                    |
| Nothing changed but want fresh data              | Scan is always fresh. Probe + validate use caches keyed by file mtime/size and search query — both are safe to re-run. |

---

## Scan pass — `npm run <type>`

One merged pipeline per type:

1. **Probe** — walks every primary file with `ffprobe` (bundled via `ffprobe-static`, no install needed). For music, also reads ID3 / Vorbis / MP4 tags via the `music-metadata` package. Cache-aware, so repeat runs only touch changed files.
2. **Scan** — walks the configured `categories` (or `root_path` if `categories` is empty) and parses each file's name and folder structure. Looks up the probe data per file to derive each version's `quality` from dimensions.
3. **Write** — three artifacts per type:
   - `output/<type>/<type>.json` — the catalog (with `versions: [{category, quality}]`)
   - `output/<type>/probe.json` — rich per-file probe data (codec, bitrate, sample rate, ID3 tags, etc.) for debugging or alternate website views
   - `output/<type>/warnings.json` — every hygiene finding from both passes

### Variants

```bash
npm run movies        # one type
npm run shows
npm run music
npm run audiobooks
npm run scan:all      # all four sequentially
```

### Speed

First run on a fresh library is slow — ffprobe takes 100–300 ms per file:

| Library        | First run  | Cached re-run |
| -------------- | ---------- | ------------- |
| 2,500 movies   | ~12–20 min | Seconds       |
| 5,000 episodes | ~15–25 min | Seconds       |
| 7,000 tracks   | ~10 min    | Seconds       |
| 3,500 chapters | ~6 min     | Seconds       |

The cache lives in `cache/<type>-probe.json` (gitignored) and is keyed by `path|mtime|size`. Only changed/added files get re-probed.

### Quality buckets (movies and shows)

For video media, you can configure pixel-range buckets in `rules/<type>.yaml`:

```yaml
quality_thresholds:
  - name: UHD
    min_width: 2000
  - name: HD
    min_width: 1000
    max_width: 2000
  - name: SD
    max_width: 1000
```

Each bucket's `name` must match a category name to take effect. Two things happen per probed file:

1. **Quality derivation** — the bucket whose dimension range contains the file's long edge (`max(width, height)`) becomes the version's `quality`. Independent of the file's category.
2. **`warn_quality_mismatch`** — if the file's category name ALSO matches a bucket and the derived quality differs from the category, the file is flagged. Categories without a matching bucket (e.g. `Other UHD` when no bucket of that name exists) are silently passed.

Forgiving by design: HandBrake-cropped 664×448 SD and 1920×800 HD still classify correctly. Ships empty by default so libraries without quality buckets stay quiet.

### Music quality summary

Each album in `probe.json` gets a derived `audio_quality_summary` array — strings like `"FLAC 16/44.1"`, `"MP3 ~288"`, `"AAC 256"`. VBR tolerance collapses same-codec same-target tracks into one entry. Albums with truly mixed quality (FLAC + MP3, or wide-spread bitrate) get a `warn_quality_inconsistent` warning.

### ID3 tags

Per-track `tags` field with title, artist, album_artist, album, year, track number, disc, genre. Four warnings driven from those:

- `warn_compilation_detected` — multiple distinct AlbumArtists in one album folder
- `warn_folder_tag_mismatch` — folder name disagrees with tag
- `warn_missing_tags` — required fields blank
- `warn_track_number_mismatch` — filename `01 -` doesn't match tag's track number

#### `warn_compilation_detected` — known false-positive pattern

Hip-hop and other collaboration-heavy albums often tag each track's `AlbumArtist` as `<Primary Artist> feat. <Different Guest>` — so every track has a _different_ AlbumArtist string, even though it's one artist's album with rotating guests (e.g. 2Pac's _All Eyez on Me_ has 10 distinct AlbumArtist values like "2Pac feat. Outlaw Immortalz", "2Pac feat. Danny Boy", etc.).

This triggers `warn_compilation_detected` because the algorithm can't distinguish "10 different artists collaborating" from "one artist with 10 different guests." Both look like multi-artist albums from the tag data alone.

The right fix for these albums is **not** to move them under `Various Artists/`. Instead, fix the tags so every track has the primary artist as `AlbumArtist` (with the featured guest staying in the per-track `Artist` field). That makes the album consistent under one artist, which is what Plex's docs recommend for single-artist albums with guest features.

If you find a stack of these in your warnings, that's the pattern.

---

## Validate pass — `npm run validate:<type>`

Cross-checks the scan output against TheMovieDB. Movies and shows only.

Writes:

- `output/<type>/validation.json` — per-record TMDB resolution (canonical title, year, TMDB ID, alternatives)
- `output/<type>/validation-warnings.json` — confidence warnings + canonical-title suggestions

### Setup

1. Get a free v3 API key from <https://www.themoviedb.org/settings/api>
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
