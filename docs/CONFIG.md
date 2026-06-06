# Configuration & Rules

Configuration is split between two layers:

- **`config.json`** — the per-machine path to each media library. The bare minimum to point the scanner at your files.
- **`rules/<type>.yaml`** — everything about how your library is organized: which subfolders to scan, file extensions, regex patterns, year ranges, ignored season names, sidecar lists, per-warning toggles.

Sensible Plex defaults ship in code for every rules field. You only edit `rules/<type>.yaml` to override something. `config.json` you always edit (to set `root_path`).

---

## `config.json`

One section per media type, each with one field:

```json
{
  "movies": { "root_path": "Z:\\Movies" },
  "shows": { "root_path": "Z:\\Shows" },
  "music": { "root_path": "M:\\Audio" },
  "audiobooks": { "root_path": "M:\\Audiobooks" }
}
```

**`root_path`** — absolute path to that media type's library root. Platform notes:

- **Windows:** `"Z:\\Movies"` (double backslashes inside JSON)
- **macOS:** `"/Volumes/Movies"`
- **Linux:** `"/mnt/nas/Movies"`

The scanner walks the subfolders defined in `rules/<type>.yaml` under `categories`, or — if `categories` is empty — walks `root_path` directly and labels every record's category as `"default"`.

That's it for `config.json`. Everything else lives in `rules/<type>.yaml`.

---

## Rules: `rules/<type>.yaml` and `rules/<type>.local.yaml`

Each media type has up to two files:

```text
rules/
├── movies.yaml             ← committed defaults (every option visible, uncommented)
├── movies.local.yaml       ← gitignored personal overrides (optional)
├── shows.yaml
├── shows.local.yaml
├── music.yaml
├── music.local.yaml
├── audiobooks.yaml
└── audiobooks.local.yaml
```

**`rules/<type>.yaml`** ships with every option set to the code default — fully visible, no comment-block tricks. Edit a value to change the project-wide default for this checkout. Comment a line out to fall back to whatever the current code default is (useful when you want to "ignore" a setting and let the code decide).

**`rules/<type>.local.yaml`** is for personal library-specific overrides — your folder structure, your quality buckets, anything that wouldn't apply to a generic Plex library. This file is gitignored so it never gets committed.

### How the loader merges them

Top to bottom, each layer wins over the one above:

```text
code defaults  →  rules/<type>.yaml  →  rules/<type>.local.yaml  →  Zod-validated result
```

Boot-time logs make it clear which files contributed:

```text
[RULES] Loaded rules/movies.yaml + 3 override(s) from rules/movies.local.yaml
[RULES] Loaded rules/shows.yaml (no local overrides)
[RULES] Using code defaults (no rules/audiobooks.yaml found)
```

### What's configurable

- **`categories`** — list of `{ name }` entries for subfolders under `root_path` to scan. The `name` is both the literal folder name on disk AND the label that appears in each version's `category` field. Leave empty (or commented) to scan `root_path` directly and label everything `"default"` — useful for flat libraries.
- **`patterns`** — regex with named capture groups for parsing folder and file names. Each pattern can be a plain string or `{ pattern, flags }` for case-insensitive or other regex flags.
- **`primary_extension`** — the formats you expect for this media type. Files with any other extension trigger `warn_non_primary` (so you can spot ones that need re-encoding).
- **`video_extensions` / `audio_extensions`** — every extension the scanner recognizes as that media type. Anything outside this list AND outside `sidecar_extensions` triggers `warn_unexpected_entries`.
- **`sidecar_extensions`** — file extensions silently allowed alongside media (Plex NFO, posters, subtitles for video; cover art, lyrics, PDF booklets for audio).
- **Per-type constants:**
  - Movies — `year_range` (min/max plausible film year, `max: current` resolves to this year), `acceptable_quality_combos` (cross-category pairings that shouldn't warn), `quality_thresholds` (pixel-range buckets keyed by category name).
  - Shows — `ignored_season_names` (Plex special-season folders to accept, e.g. `Specials`), `quality_thresholds`.
  - Music and audiobooks — patterns and extensions only (no extra constants).
- **`quality_thresholds`** (movies + shows) — each bucket's `name` must match a category name to take effect. A file's `quality` is the bucket whose dimension range contains its long edge; if its category also matches a bucket name (e.g. a file in the `UHD` category) and the derived quality differs from the category, `warn_quality_mismatch` fires. Buckets named `Other UHD` etc. would match nothing in a typical setup, so categories like `Other UHD` are silently passed.
- **`checks`** — per-warning toggles. Set any `warn_*` field to `false` to silence that warning without changing code.

### Validation

Rules are validated at startup against a Zod schema. If your YAML has a typo, wrong type, or invalid regex, you get a clear error before any scanning happens:

```text
Error: rules/movies.yaml failed schema validation:
  - year_range.min: Expected number, received string
  - patterns.folder: must be a valid regular expression
```

The defaults live in code at `src/core/rules/<type>.ts` alongside the schema, so changes ship as a single coordinated update.

---

## `ignored/<type>.yaml` — silencing specific warnings

For warnings you can't or don't want to fix (an incomplete season that never aired, a folder name you've decided not to change), drop a per-type ignore file in the `ignored/` folder. It's a flat list of path prefixes — any warning whose `path` matches one is silently dropped from `warnings.json` and counted in the run summary.

```text
ignored/
├── movies.yaml.example         ← committed, reference (commented examples)
├── movies.yaml                 ← gitignored, what the user actually writes
├── shows.yaml.example
├── shows.yaml
├── music.yaml.example
├── music.yaml
├── audiobooks.yaml.example
└── audiobooks.yaml
```

Each `.yaml.example` ships with commented usage patterns. To use: copy it to `<type>.yaml` (drop the `.example` suffix) and uncomment / edit the entries you need.

```yaml
# ignored/shows.yaml — gitignored, per-user
- HD/Channel 4 Catchup (2024) # silences every warning under this show
- HD/Some Show (2020)/Season 2 # silences just one season
- SD/Old VHS Rip (1995)
```

Matching rules:

- **Prefix-based**: an entry like `HD/Show (2020)` silences `HD/Show (2020)` itself plus everything under it (`HD/Show (2020)/Season 1`, `HD/Show (2020)/Season 1/file.mp4`).
- **Path-boundary respected**: `HD/Show` does _not_ silence `HD/Show 2 (2020)` — the prefix has to be followed by `/` or be an exact match.
- **Case-insensitive + separator-normalized**: `HD/Show` matches both `HD/Show/...` and `hd\show\...`, so the same file works on Windows and macOS/Linux.

Get path values from `output/<type>/warnings.json` (and `validation-warnings.json` for movies/shows). The `<type>.yaml` files are **gitignored** since they encode per-library decisions that don't belong in the shared repo. Missing or comments-only files are treated as "no ignores."

The run summary surfaces how many warnings were silenced:

```text
Done — 131 entries, 18 warnings, 5 silenced via ignore list.
```

---

## `.secrets.json`

The TMDB validation pass ([docs/SCANS.md](SCANS.md)) needs an API key. It lives in `.secrets.json` at the project root, gitignored.

To set it up:

1. Get a free v3 API key from <https://www.themoviedb.org/settings/api>
2. Copy the template: `cp .secrets.json.example .secrets.json`
3. Paste your key into the `tmdb.api_key` field

```json
{
  "tmdb": {
    "api_key": "your-tmdb-v3-api-key-here"
  }
}
```

The loader validates the key shape at startup and exits with a clear error if it's missing or unedited.
