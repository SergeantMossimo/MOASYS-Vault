# `src/` code review plan

37 TypeScript files across 5 folders. The approach is **bottom-up** — start with leaf utilities (no dependencies), then layers that build on them, ending with the orchestrators. This way each file you read is built from pieces you've already vetted.

---

## Phase 1 — Foundation (start here)

Pure utilities and shared types. No I/O, no orchestration. Easiest to review.

| File                                         | What to look for                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/core/types.ts](src/core/types.ts)       | Shared type shapes used everywhere. Are field names clear? Any `any` or `unknown` that should be tighter? Are nullable fields clearly marked? Read this first — every other file references it. `WarningCollector` lives here too: confirm `add(type, path, issue, extension?)` is the single entry point, that paths are normalized to forward slashes, and that `all()` sorts by `(type, path)` for grouped warnings.json output. |
| [src/core/files.ts](src/core/files.ts)       | Generic file/extension helpers (`hasExtension`, `isPrimary`, `findUnexpectedEntries`, `formatPrimaryExts`). Look for: defensive checks against case sensitivity (Windows vs macOS), array bounds, and that no helper here ever writes/renames.                                                                                                                                                                                      |
| [src/core/gaps.ts](src/core/gaps.ts)         | `findNumericGaps` — pure math. Read the tests next to it for edge cases (single element, empty array, gap at start/end).                                                                                                                                                                                                                                                                                                            |
| [src/core/versions.ts](src/core/versions.ts) | `finalizeVersions`, `distinctCategories`. The "collapse duplicate (category, quality) pairs" logic — confirm it actually collapses correctly and that "same category, different quality" is preserved (key insight from the shows season-versions example).                                                                                                                                                                         |
| [src/core/ignored.ts](src/core/ignored.ts)   | Path-prefix matcher for the `ignored/<type>.yaml` silence list. Check: forward-slash normalization, case-insensitivity, prefix boundary handling (so `Other HD` doesn't silence `Other HDR`).                                                                                                                                                                                                                                       |

---

## Phase 2 — Rules system

Configuration schemas + the merge loader. Skim [docs/CONFIG.md](docs/CONFIG.md) "Three configuration shapes" first if you haven't lately.

| File                                                         | What to look for                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/core/rules/helpers.ts](src/core/rules/helpers.ts)       | `compilePattern`, `resolveCategories`, `detectQuality`, `classifyQuality`. The hardcoded `KNOWN_QUALITIES = ['UHD', 'HD', 'SD']` lives here — that's a Future Work item (configurable `quality_keywords`). Look at `detectQuality` — confirm UHD-first ordering and word-boundary regex. |
| [src/core/rules/loader.ts](src/core/rules/loader.ts)         | Deep-merge order (code defaults → `<type>.yaml` → `<type>.local.yaml` → Zod). Check: does it fail loudly on schema errors? Does the `'current'` sentinel for `year_range.max` resolve correctly? Are boot-time messages clear?                                                           |
| [src/core/rules/movies.ts](src/core/rules/movies.ts)         | Zod schema + code defaults for movies. Make sure defaults match `rules/movies.yaml` exactly (the YAML is supposed to be a snapshot). Check the `acceptable_quality_combos` and `quality_thresholds` shapes.                                                                              |
| [src/core/rules/shows.ts](src/core/rules/shows.ts)           | Same pattern as movies. Extra: `ignored_season_names`.                                                                                                                                                                                                                                   |
| [src/core/rules/music.ts](src/core/rules/music.ts)           | Same pattern. No quality_thresholds — confirm.                                                                                                                                                                                                                                           |
| [src/core/rules/audiobooks.ts](src/core/rules/audiobooks.ts) | Smallest schema. Quick read.                                                                                                                                                                                                                                                             |

**Cross-check:** Each schema's defaults must match its `rules/<type>.yaml` snapshot. Worth diffing visually.

---

## Phase 3 — Probe (file inspection)

External-process boundary (ffprobe + music-metadata). Most defensive code lives here.

| File                                                           | What to look for                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/probe/types.ts](src/probe/types.ts)                       | ProbeData shape. Are optional fields actually marked optional?                                                                                                                                                                                                                                                        |
| [src/probe/ffprobe-static.d.ts](src/probe/ffprobe-static.d.ts) | Module declaration for an untyped package. One-liner.                                                                                                                                                                                                                                                                 |
| [src/probe/cache.ts](src/probe/cache.ts)                       | Cache key = `path \| mtime \| size`. Check: does it handle file-removed-between-runs? Does it ever write cache entries that point at non-existent paths? (That's a Future Work item — orphan cleanup.)                                                                                                                |
| [src/probe/helpers.ts](src/probe/helpers.ts)                   | Shared probe-side utilities. Smaller surface.                                                                                                                                                                                                                                                                         |
| [src/probe/ffprobe.ts](src/probe/ffprobe.ts)                   | External-process wrapper. Excluded from coverage by design. Critical to read carefully: spawn error handling, timeout behavior, stderr capture, malformed JSON from ffprobe.                                                                                                                                          |
| [src/probe/id3.ts](src/probe/id3.ts)                           | Same kind of boundary — `music-metadata` library wrapper. Check: corrupt-tag handling, encoding edge cases (latin-1 vs utf-8 in old MP3s).                                                                                                                                                                            |
| [src/probe/music-quality.ts](src/probe/music-quality.ts)       | Derives `audio_quality_summary` strings. The VBR collapse logic + "wide bitrate spread → warn_quality_inconsistent" threshold. Check the bitrate-bucket tolerance constant.                                                                                                                                           |
| [src/probe/movies.ts](src/probe/movies.ts)                     | Per-type probe orchestration. Walks primary files, calls ffprobe, populates cache. Confirm no writes to media paths.                                                                                                                                                                                                  |
| [src/probe/shows.ts](src/probe/shows.ts)                       | Same pattern.                                                                                                                                                                                                                                                                                                         |
| [src/probe/music.ts](src/probe/music.ts)                       | Adds ID3 reading. Tag-extraction edge cases worth a careful read. Album-level warnings build their path via the `albumWarningPath()` helper so the first category from `album.media_type[]` is prepended — confirm every album-level `warnings.add(...)` site uses that helper, not a raw `path.join(artist, album)`. |
| [src/probe/audiobooks.ts](src/probe/audiobooks.ts)             | Smallest. Quick read.                                                                                                                                                                                                                                                                                                 |

**Red-flag scan in this phase:** grep for `fs.writeFile`, `fs.rename`, `fs.unlink`, `fs.rmdir`, `fs.cp` — confirm none target paths derived from `root_path`. The cache file writes are legitimate (under `cache/`).

---

## Phase 4 — Media (the meat)

Per-type scanning logic. This is where the warnings get emitted. Bulk of the domain logic. Each file is a factory that takes resolved rules and returns a `MediaModule`.

| File                                               | What to look for                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/media/movies.ts](src/media/movies.ts)         | Largest. Walk it section by section: root-level traversal → movie-folder traversal → file parsing → warnings. Confirm every warning is gated on its `rules.checks.warn_*` toggle. The duplicate-edition detection logic deserves attention.                                                                      |
| [src/media/shows.ts](src/media/shows.ts)           | Show folder → season folder → episode file. Per-season `warn_multi_quality` logic is different from movies (per-movie). Check the `ignored_season_names` handling and the multi-episode (`S01E01-E02`) parser.                                                                                                   |
| [src/media/music.ts](src/media/music.ts)           | Artist → Album → Track. ID3-tag-driven warnings (`warn_folder_tag_mismatch`, `warn_compilation_detected`, etc.) live here. Check the `stripFilenameIllegalChars` normalization in the tag-vs-folder comparison. The greedy multi-disc parser behavior (`100 - Track` → disc 1, track 00) is a documented gotcha. |
| [src/media/audiobooks.ts](src/media/audiobooks.ts) | `parseAuthors` (comma + "and" handling). Confirm the duplicate-book detection (keyed by title only — intentional).                                                                                                                                                                                               |

**Per-file checklist for this phase:**

- Every `warnings.add(...)` call is wrapped in `if (rules.checks.warn_*)`
- No writes to anything under `folderPath` (the media path)
- Error paths emit warnings rather than throwing (e.g. permission-denied on `fs.readdirSync`)
- The `MediaModule` factory signature matches across all four

---

## Phase 5 — Validate (TMDB)

Optional pass. Network boundary — defensive code matters.

| File                                               | What to look for                                                                                                                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/validate/types.ts](src/validate/types.ts)     | Type shapes.                                                                                                                                                              |
| [src/validate/secrets.ts](src/validate/secrets.ts) | `.secrets.json` loader. Confirm clear error message if the file is missing or the API key is empty. **Critical:** never logs the key.                                     |
| [src/validate/cache.ts](src/validate/cache.ts)     | Three caches: search, movies, shows. The Future Work item is "no TTL" — confirm it's truly never-expiring (no hidden timestamp logic).                                    |
| [src/validate/tmdb.ts](src/validate/tmdb.ts)       | TMDB API wrapper. Throttle (4 req/sec), `Retry-After` handling, error responses. Excluded from coverage by design — read carefully.                                       |
| [src/validate/helpers.ts](src/validate/helpers.ts) | Confidence scoring, title canonicalization. Look at the score thresholds (60 / 110 / 150) — they're tuned for a specific library, check the math holds for general cases. |
| [src/validate/movies.ts](src/validate/movies.ts)   | Per-movie validation. The `tmdb_title_filename_safe` derivation + `warn_tmdb_title_canonical` check.                                                                      |
| [src/validate/shows.ts](src/validate/shows.ts)     | Same plus per-season `warn_tmdb_episode_count`.                                                                                                                           |
| [src/validate/runner.ts](src/validate/runner.ts)   | Orchestrator. Excluded from coverage.                                                                                                                                     |

---

## Phase 6 — Orchestrators (last)

By the time you reach these, every dependency is reviewed. The orchestrators should be thin glue.

| File                                                   | What to look for                                                                                                                                                                              |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/core/scanner.ts](src/core/scanner.ts)             | Generic scan loop: iterates `module.getCategories()`, calls `module.scanCategory()`, collects results. This is the "merged runner" referenced in `CLAUDE.md`. Confirm it stays type-agnostic. |
| [src/core/runner-shared.ts](src/core/runner-shared.ts) | Shared boilerplate the per-type runners use. Output writing, warning collection, the `WarningCollector` class.                                                                                |
| [src/core/config.ts](src/core/config.ts)               | `config.json` loader + Zod validation. Boot-time fail-fast behavior.                                                                                                                          |
| [src/scan.ts](src/scan.ts)                             | Top-level entry point. Should be lean — load rules, run probe, run scan, write output. If this file has clever logic, that's a smell; clever logic belongs in the module it serves.           |

---

## Cross-cutting concerns to look for in every file

These are the things worth scanning _every_ file for, regardless of phase:

1. **Read-only constraint** — no `fs.writeFile`, `fs.rename`, `fs.unlink`, `fs.rmdir`, `fs.cp`, `fs.appendFile` against any path derived from `root_path`. Writes to `output/`, `cache/`, and `rules/` are legitimate.
2. **TypeScript strictness** — no `any`. No `as` casts that bypass type safety. No `!` non-null assertions where a guard would be safer.
3. **Error boundaries** — `fs.readdirSync`, `fs.statSync`, `ffprobe`, `fetch` calls wrapped so failures emit warnings rather than crashing the run.
4. **Warning toggles** — every `warnings.add(...)` gated on its `rules.checks.warn_*` toggle.
5. **Path handling** — `path.join` (never string concat), forward-slash normalization at boundaries (for `ignored/` matching, TMDB filename-safe titles).
6. **Naming** — function and variable names map cleanly to docs. If you find a name that's a clear improvement, rename it (small PRs welcome).
7. **Comments** — comments explain _why_, not _what_. If a comment restates the code, delete it. If a hidden constraint isn't commented, add one.
8. **Test coverage** — for each `src/foo.ts`, glance at `test/unit/foo.test.ts` (if it exists) and check that edge cases match the file's surface area.

---

## Suggested workflow per file

For each file:

1. **Read top-to-bottom once** without editing — get the shape.
2. **Run the unit test file** if one exists (`npx vitest run test/unit/<path>`) — confirms behavior matches expectations.
3. **Grep for callers** (search for the exported function names) — confirms how it's used downstream.
4. **Note issues in a scratch list** rather than fixing inline. Batch fixes by theme (naming pass, error-handling pass, etc.) to keep diffs small.
5. **Mark the file done** before moving on.

---

Total surface: 37 files but many are tiny (types files, small schemas). Realistic time at a steady pace: **~4–6 hours total** spread across sessions. Phases 4 (media) and 5 (validate) are the meatiest; Phases 1, 2, 6 should be quick passes.
