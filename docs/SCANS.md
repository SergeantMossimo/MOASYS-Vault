# Scans & Validation — Runbook

MOASYS-Vault has two passes you can run against your library:

| Pass         | Command                   | What it does                                                                                          |
| ------------ | ------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Scan**     | `npm run <type>`          | Walks your folders and inspects every file. Produces your catalog plus a list of hygiene issues.      |
| **Validate** | `npm run validate:<type>` | Cross-checks your catalog against TheMovieDB to catch title typos, wrong years, and missing episodes. |

The **scan** pass runs for every media type. The **validate** pass is **movies and shows only** — it needs TMDB, and TMDB doesn't cover music or audiobooks. Validate is also fully optional; you don't need it for the scanner to work.

---

## Suggested workflow

### Initial setup (one-time)

```bash
# 1. Install dependencies
npm install

# 2. Point the scanner at your library
# Open config.json and set root_path for each media type you have

# 3. First scan — this is the slow one (every file gets inspected to build a cache)
npm run scan:all

# 3.1 (Optional) Validate movies/shows against TMDB — needs a TMDB API key
npm run validate:movies
npm run validate:shows

# 4. Review the warnings, fix what you want to fix in your library, re-scan
npm run scan:all
```

Re-runs are near-instant because the file inspection cache (`cache/<type>-probe.json`) skips anything that hasn't changed.

### Adding new media

```bash
# 1. Add the new files/folders to your library

# 2. Re-scan the affected type (existing files served from cache; only the new ones get inspected)
npm run movies        # or shows, music, audiobooks

# 3. (Optional) Re-validate movies/shows against TMDB
npm run validate:movies
```

### After cleaning up warnings

You changed something in your library — what do you need to re-run?

| You changed...                                   | Re-run                                                               |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| Renamed/moved folders or files                   | `npm run <type>` — scan                                              |
| Updated embedded music tags                      | `npm run music`                                                      |
| Replaced a media file (different format/bitrate) | `npm run <type>` — the cache invalidates on modification time + size |
| Fixed a movie/show title or year                 | `npm run <type>` then `npm run validate:<type>`                      |
| Added new content                                | `npm run <type>` — only the new files get inspected                  |

---

## Scan pass — `npm run <type>`

The scan pass for one media type does three things in order:

1. **Inspect every file.** Walks every primary file and records video dimensions, audio codec/bitrate/sample rate, and (for music) the artist/album/track info embedded in the file. Results are cached, so subsequent runs skip unchanged files.
2. **Walk the folder tree.** Goes through the configured `categories` (or `root_path` directly if no categories are set) and parses each file's name and folder structure. Combines the inspection data to derive each version's quality.
3. **Write three files per type** under `output/<type>/`:
   - `<type>.json` — your clean catalog
   - `probe.json` — the rich per-file inspection data (codec, bitrate, sample rate, embedded tags, etc.)
   - `warnings.json` — every hygiene issue from steps 1 and 2

### Speed

First run on a fresh library is the slow one — file inspection takes 100–300 ms per file:

| Library        | First run  |
| -------------- | ---------- |
| 2,500 movies   | ~12–20 min |
| 5,000 episodes | ~15–25 min |
| 7,000 tracks   | ~10 min    |
| 3,500 chapters | ~6 min     |

The cache lives at `cache/<type>-probe.json` (gitignored) and is keyed by `path | modification time | size`. Only changed or added files get re-inspected on subsequent runs.

### Quality buckets (movies and shows)

If your library is organized by quality (folders like `UHD/`, `HD/`, `SD/`), you can tell the scanner what those names mean in terms of pixel dimensions:

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

Each bucket's `name` is one of the recognized quality keywords (`UHD`, `HD`, or `SD`) — the same words the scanner auto-detects from your category names. Two things happen for every video file:

1. **Quality derivation** — the bucket whose width range contains the file's long edge becomes the version's `quality`. This happens regardless of which folder the file is in.
2. **`warn_quality_mismatch`** — every category resolves to a quality via whole-word matching of `UHD` / `HD` / `SD` in its name. So `UHD/` and `Other UHD/` both resolve to UHD, `HD/` resolves to HD, etc. Categories without any of those keywords (e.g. `Documentary/`) resolve to `null` and skip the check entirely. When a file's category-resolved quality has a matching bucket and the file's actual long edge doesn't fit, you get a warning.

So: a 480p file in `Other HD/` gets flagged (Other HD → HD bucket), but a 480p file in `Documentary/` doesn't (no quality detected — general tag).

These checks are forgiving by design — HandBrake-cropped 664×448 SD and 1920×800 HD both classify correctly. And `quality_thresholds` ships empty by default, so libraries that aren't organized by quality stay quiet.

See [Configuration](CONFIG.md#three-configuration-shapes) for the full configuration matrix.

### Audio quality summary (music)

Each album in `output/music/probe.json` gets a derived `audio_quality_summary` field — short, human-readable strings like `"FLAC 16/44.1"`, `"MP3 ~288"`, or `"AAC 256"`. The summary collapses tracks that share a codec and roughly the same bitrate target into one entry, so a VBR-encoded album doesn't list ten different bitrates.

Albums where the tracks have truly mismatched quality (FLAC mixed with MP3, or a very wide bitrate spread) get a `warn_quality_inconsistent` warning so you know which albums to clean up.

### Embedded music tags

Music files carry metadata embedded inside them — title, artist, album, year, track number, genre, and so on. The scanner reads these tags during the file inspection pass and stores them per track in `output/music/probe.json` under a `tags` field.

Four warnings are driven from the tag data:

- **`warn_compilation_detected`** — the album has multiple distinct AlbumArtist values, which usually means it belongs under `Various Artists/`
- **`warn_folder_tag_mismatch`** — the folder name (artist or album) disagrees with what's embedded in the file
- **`warn_missing_tags`** — required tag fields (title / album / artist) are blank
- **`warn_track_number_mismatch`** — the track number in the filename (`01 - ...`) doesn't match the track number embedded in the file

#### A known false positive: hip-hop / collaboration-heavy albums

Hip-hop and other collaboration-heavy albums often tag each track's `AlbumArtist` as `<Primary Artist> feat. <Different Guest>` — so every track has a _different_ AlbumArtist string, even though it's really one artist's album with rotating guests. (Example: 2Pac's _All Eyez on Me_ has 10 distinct AlbumArtist values like "2Pac feat. Outlaw Immortalz", "2Pac feat. Danny Boy", etc.)

This trips `warn_compilation_detected` because the scanner can't tell "10 different artists collaborating" from "one artist with 10 different guests" — both look the same in the tag data.

The right fix is **not** to move these albums under `Various Artists/`. Instead, fix the tags so every track lists the primary artist as `AlbumArtist`, with the featured guest staying in the per-track `Artist` field. That makes the album consistent under one artist — which is what Plex recommends for single-artist albums with guest features.

If you find a stack of these in your warnings, that's the pattern.

---

## Validate pass — `npm run validate:<type>`

Cross-checks your scan output against TheMovieDB. **Movies and shows only** — TMDB doesn't cover music or audiobooks.

Writes:

- `output/<type>/validation.json` — per-record TMDB resolution (canonical title, year, TMDB ID, alternatives)
- `output/<type>/validation-warnings.json` — confidence warnings and canonical-title rename suggestions

### Setup

1. Get a free [TMDB API v3 key](https://developer.themoviedb.org/docs/getting-started)
2. Copy `.secrets.json.example` to `.secrets.json`
3. Paste your key into the `tmdb.api_key` field

See [Configuration](CONFIG.md#secretsjson) for details.

### What it catches

**For movies:**

- Title typos (`Justice League Unlimitied` → no match)
- Year off by one (Casablanca 1942 vs TMDB's 1943 — premiere vs wide release)
- Title canonicalization opportunities (your `Alice In Wonderland` → TMDB's `Alice in Wonderland`)
- Obscure films that aren't in TMDB at all

**For shows (everything above plus):**

- **Missing episode counts** — your local gap detection only catches missing-in-the-middle episodes. TMDB validation catches "TMDB says season 5 has 23 episodes; you have 22." That trailing missing episode finally gets flagged.
- **Episode title mismatches** — each episode file's trailing `- Episode Title` is compared (strict, filename-safe) against TMDB's episode title for that S/E number. Multi-episode files (`S01E01-E02`) are skipped by default because their combined titles rarely match strictly; enable `warn_tmdb_episode_name_multi_episode` if you want them checked too. Costs one extra TMDB call per season — cached in `cache/tmdb-show-seasons.json`.

### How matching works

Matching is **strict** — only characters that are illegal in filenames (`<>:"|?*\/`) are stripped before comparison. Diacritics are NOT stripped: your `Amelie` won't match TMDB's `Amélie` because `é` is legal in filenames. The scanner surfaces these as `no_match` so you can decide whether to add the accent.

When a match is found:

- A `tmdb_title_filename_safe` field is included in the output — a copy-pasteable rename target
- If your folder differs from that target, `warn_tmdb_title_canonical` fires

Confidence is scored from title-match strength (exact / prefix / substring) plus year-match closeness (exact / off-by-1 / off-by-2 / wider). Thresholds:

- **high** (≥ 150) — title exact + year exact
- **medium** (≥ 110) — usually title exact + year off by one, or prefix + year exact
- **low** (≥ 60) — partial title match + close year
- **none** (< 60) — no plausible candidate; warning fires

### Caching

Four caches keep TMDB calls minimal:

- `cache/tmdb-search.json` — search-query to resolved-match lookup
- `cache/tmdb-movies.json` — full movie records by TMDB ID
- `cache/tmdb-shows.json` — full show records by TMDB ID
- `cache/tmdb-show-seasons.json` — per-season episode details (titles, air dates), only populated when `warn_tmdb_episode_name_mismatch` is enabled

All gitignored. Re-runs are near-instant. Total first-run cost for the example library: ~10 min for movies, ~3 min for shows.

#### Refreshing stale entries

Every cache entry is timestamped at fetch time. By default, no entry ever expires — the cache file grows until you delete it. TMDB metadata does change occasionally (year corrections, added seasons, episode title fixes), so you may want to re-fetch entries older than some threshold:

```bash
# Re-fetch any TMDB record fetched more than 30 days ago
npm run validate:movies -- --refresh-older-than=30d
npm run validate:shows -- --refresh-older-than=30d
```

The flag accepts a number of days with optional `d` suffix (`30` and `30d` are equivalent). Without it, every cached entry is used regardless of age. A sensible cadence is once a month or so — the rate limiter throttles re-fetches the same way as fresh ones, so a full refresh is the same wall-clock cost as your first run.

### Rate limiting

The scanner throttles to 4 requests per second (TMDB allows 40 per 10 seconds). Well under the limit, so no tuning needed. If TMDB ever returns a 429, the throttle honors the `Retry-After` header automatically.
