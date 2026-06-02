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

The scanner walks the subfolders defined in `rules/<type>.yaml` under `media_folders`, or — if `media_folders` is empty — walks `root_path` directly with a `"default"` tag.

That's it for `config.json`. Everything else lives in `rules/<type>.yaml`.

---

## `rules/<type>.yaml`

Each media type has one file at `rules/<type>.yaml`. Every available option is present in the file as a commented block; uncomment a line to override the code default. The shipped file shows the defaults verbatim so you can see what you'd be overriding.

```text
rules/
├── movies.yaml
├── shows.yaml
├── music.yaml
└── audiobooks.yaml
```

### How overrides work

1. Open `rules/<type>.yaml` for the media type you want to customize.
2. Uncomment the keys you want to override. Anything that stays commented out keeps the code default.
3. Run the scan. The console prints one of three messages so you can see at a glance whether your overrides took effect:

   ```text
   [RULES] Loaded 2 override(s) from rules/shows.yaml
   [RULES] Using code defaults (rules/music.yaml has no active overrides)
   [RULES] Using code defaults (no rules/audiobooks.yaml)
   ```

### What's configurable

- **`media_folders`** — list of `{ name, tag }` pairs for subfolders under `root_path` to scan. The `name` is the literal folder name on disk; the `tag` is the label used in output (and referenced by `quality_thresholds` below). Leave empty (or commented) to scan `root_path` directly with a `"default"` tag — useful for flat libraries without quality buckets.
- **`patterns`** — regex with named capture groups for parsing folder and file names. Each pattern can be a plain string or `{ pattern, flags }` for case-insensitive or other regex flags.
- **`primary_extension`** — the formats you expect for this media type. Files with any other extension trigger `warn_non_primary` (so you can spot ones that need re-encoding).
- **`video_extensions` / `audio_extensions`** — every extension the scanner recognizes as that media type. Anything outside this list AND outside `sidecar_extensions` triggers `warn_unexpected_entries`.
- **`sidecar_extensions`** — file extensions silently allowed alongside media (Plex NFO, posters, subtitles for video; cover art, lyrics, PDF booklets for audio).
- **Per-type constants:**
  - Movies — `year_range` (min/max plausible film year, `max: current` resolves to this year), `acceptable_quality_combos` (cross-folder pairings that shouldn't warn), `quality_thresholds` (ffprobe-driven pixel-range buckets per folder tag).
  - Shows — `ignored_season_names` (Plex special-season folders to accept, e.g. `Specials`), `quality_thresholds`.
  - Music and audiobooks — patterns and extensions only (no extra constants).
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

## `.secrets.json`

The TMDB validation pass ([docs/SCANS.md](SCANS.md)) needs an API key. It lives in `.secrets.json` at the project root, gitignored.

To set it up:

1. Get a free v3 API key from https://www.themoviedb.org/settings/api
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
