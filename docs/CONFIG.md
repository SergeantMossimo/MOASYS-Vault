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
- **`quality_thresholds`** (movies + shows) — each bucket's `name` matches an auto-detected quality keyword (`UHD`, `HD`, or `SD`) extracted from category names via whole-word matching. So `Other UHD` resolves to quality `UHD` and gets checked against the `UHD` bucket. Categories with no UHD/HD/SD substring (`Documentary`, `Music`, etc.) are general-purpose tags — `warn_quality_mismatch` doesn't apply to them. See the [Three configuration shapes](#three-configuration-shapes) section below.
- **`acceptable_quality_combos`** (movies + shows) — list of quality sets that are explicitly OK to coexist. After category-to-quality mapping, a movie in `{Other UHD, Other HD}` resolves to quality set `{UHD, HD}` and is silenced by a single `[UHD, HD]` combo. For shows, the combo applies per-season (different seasons in different qualities are fine on their own).
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

## Three configuration shapes

How you set up `categories` (and the related `quality_thresholds` / `acceptable_quality_combos`) depends on what you want the scanner to do with each subfolder. There are three common shapes:

### A. Quality-organized categories (e.g. your movies + shows by UHD/HD/SD)

You have subfolders like `UHD/`, `HD/`, `SD/`, possibly with `Other UHD/`, `Other HD/`, `Other SD/` variants. You want the scanner to:

- Flag files whose actual dimensions don't match the quality their folder implies (`warn_quality_mismatch`)
- Flag the same media stored across multiple distinct qualities (`warn_multi_quality`)

**Configure**:

```yaml
# rules/movies.local.yaml
categories:
  - { name: UHD }
  - { name: HD }
  - { name: SD }
  - { name: Other UHD } # quality auto-detected as UHD
  - { name: Other HD } # quality auto-detected as HD
  - { name: Other SD } # quality auto-detected as SD

quality_thresholds:
  - { name: UHD, min_width: 2000 }
  - { name: HD, min_width: 1000, max_width: 2000 }
  - { name: SD, max_width: 1000 }

acceptable_quality_combos:
  - [UHD, HD] # auto-detect collapses "Other UHD"+"Other HD" into the same set
```

**Quality auto-detection rule**: each category name is scanned for the whole-word, case-insensitive substring `UHD`, `HD`, or `SD` (UHD checked first so it wins over the contained `HD`). Matching is on word boundaries — `USD`, `Standard`, or `Hi-Def` do NOT match.

### B. General-purpose tag categories (e.g. your audiobooks: Audible, Book On CD)

Your subfolder names are concepts (a format, an imprint, a vendor) that aren't quality buckets. You want each record tagged with which folder it's in, but no dimension checks should apply.

**Configure**:

```yaml
# rules/audiobooks.local.yaml
categories:
  - { name: Audible }
  - { name: Other Audible }
  - { name: Book On CD }
# Leave quality_thresholds out / empty — nothing to check against.
# acceptable_quality_combos doesn't exist on audiobooks; warn_duplicate_book
# fires for any cross-category dup. Use `ignored/audiobooks.yaml` for
# legitimate exceptions.
```

Because none of these names contain `UHD`/`HD`/`SD`, all categories resolve to `quality: null`. `warn_quality_mismatch` never fires. `warn_duplicate_book` still fires if the same book exists across multiple categories.

### C. No categories — flat library

Your media just lives directly under `root_path` with no subfolders for organization.

**Configure**:

```yaml
categories: [] # or omit entirely
```

The scanner walks `root_path` directly and labels every record's category as `"default"`. No quality or duplicate checks fire. Naming hygiene checks still work.

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
