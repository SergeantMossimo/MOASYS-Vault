# Working on MOASYS-Vault

Context for Claude (and any other AI assistant) when working in this repo.

## Hard rule: READ-ONLY access to media files

**The scanner — and you while modifying it — must never modify, move, rename, or delete files under any user's `root_path`.** The user owns all changes to their media library.

This rule applies to:

- Movies (`config.movies.root_path`, default `M:\Movies`)
- Shows (`config.shows.root_path`, default `M:\Shows`)
- Music (`config.music.root_path`, default `M:\Audio`)
- Audiobooks (`config.audiobooks.root_path`, default `M:\Audiobooks`)
- Any other path configured in `config.json`

What the scanner does instead: **emits warnings** in `output/<type>/warnings.json` describing what it would suggest changing, with recommended fixes. The user reads the warnings and does the actual filesystem changes themselves.

What this means for you when working in this repo:

- Never write code that calls `fs.rename`, `fs.unlink`, `fs.rmdir`, `fs.cp`, `fs.writeFile`, etc. against any path derived from `config.<type>.root_path`.
- Never suggest a "fix-up script" or "rename helper" that auto-corrects library issues. Even if it would be useful. Warnings only.
- If a user asks for an auto-fix feature, decline with the rationale: the read-only constraint is a deliberate safety guarantee.
- Reading is fine. `fs.readdir`, `fs.stat`, `fs.readFile` against media files (ffprobe metadata, ID3 tags, etc.) is the expected pattern.

Project files (source code, rules YAMLs, `config.json`, README, etc.) are fair game — that constraint only applies to the user's media library.

## What this project is

A read-only scanner for a Plex media library. Two purposes:

1. Build a clean JSON catalog of movies / shows / music / audiobooks for a future personal website.
2. Surface library hygiene issues (naming mismatches, structural problems, missing files, duplicates, etc.) so the user can fix them manually.

The user already has Plex; the point isn't to replicate Plex's functionality. It's a side project focused on library hygiene + catalog generation.

## Architecture in one paragraph

`config.json` carries per-machine "where" data (`root_path` per media type). `rules/<type>.yaml` carries "how" data (regex patterns, file extensions, naming conventions, per-warning toggles, the `media_folders` list of subfolders to walk). Each media module (`src/media/<type>.ts`) is a **factory** that takes the validated rules and returns a `MediaModule` object. The core scanner (`src/core/scanner.ts`) iterates `module.getMediaFolders()` and calls `module.scanMediaFolder()` for each. Validation is via Zod in `src/core/rules/`. Optional ffprobe pass in `src/probe/` writes sidecar `probe.json` + `probe-warnings.json` files.

## Rules system

- One `rules/<type>.yaml` per media type. Every option is present but commented out by default; users uncomment to override.
- Code defaults live in `src/core/rules/<type>.ts` alongside the Zod schema.
- The loader (`src/core/rules/loader.ts`) deep-merges user overrides on top of defaults, resolves the `'current'` sentinel for year ranges, validates the result, and prints one of three boot-time messages:
  - `[RULES] Loaded N override(s) from rules/<type>.yaml`
  - `[RULES] Using code defaults (rules/<type>.yaml has no active overrides)`
  - `[RULES] Using code defaults (no rules/<type>.yaml)`

## Warnings philosophy

Every check emits warnings only. Never auto-fix. Warning messages should include a **recommended fix** when possible (see existing `warn_loose_files` / `warn_quality_mismatch` messages for the pattern). Each warning is gated by a `rules.checks.warn_*` toggle so the user can silence noise.

## Useful commands

```bash
npm run movies        # Scan one media type
npm run shows
npm run music
npm run audiobooks
npm run scan:all      # All four sequentially

npm run probe:movies  # ffprobe pass (separate from scan)
npm run probe:all     # All four probes

npm run typecheck     # tsc --noEmit
npm run lint          # eslint
npm run lint:fix
```

The smoke test pattern is to run the scan against the user's real library on `M:\` and confirm entry counts + warning counts don't regress.

## Don't waste tokens

The user's library: ~2,500 movies, ~130 shows, ~220 music albums, ~110 audiobooks. The first ffprobe pass over movies is 12–20 minutes — defer running it unless the user explicitly asks. Use the existing cache (`cache/<type>-probe.json`) for re-runs.

When making bulk changes across all 4 media types, use `Edit` with `replace_all: true` rather than reading each file separately. Most cross-cutting changes have an identical shape per file.

## Roadmap (in `README.md` under `## Roadmap`)

The three big-ticket items are all shipped:

- **Music quality summary** — per-album `audio_quality_summary` in `output/music/probe.json` (`"FLAC 16/44.1"`, `"MP3 ~288"`). VBR tolerance collapses same-codec same-quality-target tracks into one entry.
- **ID3 tag reading for music** — per-track `tags` in `output/music/probe.json` via `music-metadata`. Four warnings: compilation_detected, folder_tag_mismatch, missing_tags, track_number_mismatch.
- **TMDB validation for movies + shows** — `npm run validate:movies` / `validate:shows`. Cross-checks titles, years, and (for shows) per-season episode counts. API key in `.secrets.json` (gitignored). Cache in `cache/tmdb-*.json`.

Future ideas not formally on the roadmap: deeper music quality analysis (per-track bitrate distribution, encoding metadata), audiobook chapter/duration validation, custom user-defined checks via a DSL.

## Documentation layout

Docs are split between README and `docs/`. When the user asks something or you need to point them at existing docs, use this map:

- **README.md** — quickstart, the three passes overview, project structure, roadmap
- **docs/CONFIG.md** — `config.json` + `rules/<type>.yaml` reference, override mechanism, `.secrets.json` setup
- **docs/CONVENTIONS.md** — Plex folder/file naming per media type (hierarchies, examples, gotchas)
- **docs/SCANS.md** — Runbook for scan / probe / validate. Suggested workflow + re-run scenarios.
- **docs/REFERENCE.md** — Output file shapes + complete warning tables per media type

When you add a new feature/warning/rule, update the relevant docs/ file AND any related warning table. Don't put deep reference content in README — it's intentionally lean.

## External references

- Plex naming: [Movies](https://support.plex.tv/articles/200381023-naming-movie-files/), [TV](https://support.plex.tv/articles/naming-and-organizing-your-tv-show-files/), [Music](https://support.plex.tv/articles/200265296-adding-music-media-from-folders/)
