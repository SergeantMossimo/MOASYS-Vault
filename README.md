# MOASYS-Vault

**MOASYS-Vault** is a read-only scanner for a [Plex](https://www.plex.tv/) media library. Point it at your media directories and it generates a clean, structured catalog of everything you own and surfaces hygiene issues (naming mismatches, structural problems, duplicates, missing episodes, quality outliers, tag/folder mismatches, and more).

Built for **MOASYS** _(Mossimo's Oasis System)_ and designed to be shared.

> **The scanner never modifies, moves, renames, or deletes media files.** Every check produces warnings only — you do the actual library changes.

---

## Features

- **Three independent passes** — fast offline scan, optional ffprobe + ID3 probe, optional TMDB validation. Each writes its own files; you can run any combination.
- **Fully config-driven** — no code changes needed. Sensible Plex defaults; uncomment to override.
- **Library-agnostic** — Movies, Shows, Music, Audiobooks. Configurable regex patterns, extensions, sidecar lists, and per-warning toggles.
- **Schema-validated rules** — typos in your YAML fail at boot with a clear error, not a cryptic crash mid-scan.
- **Cached deep inspection** — ffprobe + TMDB calls are cached by file mtime/size and search query. Re-runs are near-instant.
- **Output is JSON** — clean catalogs + structured warnings, ready for a website to consume.

---

## Requirements

- [Node.js](https://nodejs.org/) v22 or higher (v24 LTS recommended)
- npm (included with Node.js)
- A media library to scan (local folders, external drives, or network shares are all supported)

Optional:

- A free [TMDB API v3 key](https://www.themoviedb.org/settings/api) for the validate pass

---

## Supported sources

MOASYS-Vault reads from any path your OS can access:

- **Local folders** — any folder on your machine
- **External drives** — USB or Thunderbolt drives mounted to your system
- **Network shares (NAS)** — SMB shares from devices like Synology, QNAP, Ugreen, etc.

If File Explorer (Windows) or Finder (macOS) can see the path, so can the scanner. Per-OS path formats:

| OS      | Example `root_path`                        |
| ------- | ------------------------------------------ |
| Windows | `"Z:\\Movies"` or `"\\\\NAS-NAME\\Movies"` |
| macOS   | `"/Volumes/Movies"`                        |
| Linux   | `"/mnt/nas/Movies"`                        |

---

## Installation

```bash
git clone https://github.com/yourname/MOASYS-Vault.git
cd MOASYS-Vault
npm install
```

---

## Quickstart

```bash
# 1. Configure where your library lives
#    Edit config.json — set root_path for each media type you have

# 2. First scan — fast, offline
npm run scan:all

# 3. Read output/<type>/warnings.json, fix what you want in your library, re-scan
```

That's it for the basics. The scan is fast and idempotent — re-run as often as you like while fixing things.

For deep-inspection passes (ffprobe, TMDB validation), see [docs/SCANS.md](docs/SCANS.md).

---

## The three passes

```text
SCAN ─────────► PROBE ─────────► VALIDATE
fast, offline   slow first run   TMDB API
                cached after     cached after
```

| Pass         | Command                                            | What it surfaces                                               |
| ------------ | -------------------------------------------------- | -------------------------------------------------------------- |
| **Scan**     | `npm run <type>` / `npm run scan:all`              | Naming + structure warnings, the clean catalog                 |
| **Probe**    | `npm run probe:<type>` / `npm run probe:all`       | Video/audio quality data + mismatch warnings, ID3 tag findings |
| **Validate** | `npm run validate:<type>` / `npm run validate:all` | TMDB title/year/episode-count mismatches (movies + shows only) |

Each pass writes its own data + warnings files. Running one never touches another's output. Detailed runbook + re-run scenarios in [docs/SCANS.md](docs/SCANS.md).

---

## Documentation

Deep dives live in `docs/`:

- **[docs/CONFIG.md](docs/CONFIG.md)** — `config.json` + `rules/<type>.yaml` reference and override mechanism
- **[docs/CONVENTIONS.md](docs/CONVENTIONS.md)** — Plex folder/file naming conventions per media type (with examples + gotchas)
- **[docs/SCANS.md](docs/SCANS.md)** — Full scan/probe/validate runbook + workflow + re-run scenarios
- **[docs/REFERENCE.md](docs/REFERENCE.md)** — Output file shapes + complete warning tables per media type

---

## Output

Each media type writes to its own subfolder inside `output/`:

```text
output/<type>/
├── <type>.json                ← scan: clean catalog
├── warnings.json              ← scan: naming + structure warnings
├── probe.json                 ← probe: per-file ffprobe + ID3 data
├── probe-warnings.json        ← probe: quality/tag warnings
├── validation.json            ← validate: TMDB resolution (movies + shows only)
└── validation-warnings.json   ← validate: TMDB confidence warnings
```

The probe and validate files appear only after you run the corresponding pass. Full reference in [docs/REFERENCE.md](docs/REFERENCE.md).

---

## Project structure

```text
MOASYS-Vault/
├── src/
│   ├── scan.ts                       ← scan entry point
│   ├── core/
│   │   ├── types.ts                  ← shared TypeScript interfaces
│   │   ├── scanner.ts                ← shared scanning scaffolding
│   │   ├── files.ts                  ← shared file/extension helpers
│   │   ├── gaps.ts                   ← shared numeric gap detection
│   │   └── rules/                    ← schema + defaults + loader (one file per type)
│   ├── media/                        ← per-type scan logic
│   ├── probe/                        ← per-type ffprobe + ID3 logic
│   └── validate/                     ← per-type TMDB validation logic
├── docs/                             ← deep-dive documentation
├── rules/                            ← user-editable rule overrides (commit-by-default)
├── output/                           ← generated catalog + warnings (gitignored)
├── cache/                            ← probe + TMDB caches (gitignored)
├── config.json                       ← your library paths
└── .secrets.json                     ← your TMDB API key (gitignored)
```

---

## Useful commands

```bash
# Scan passes
npm run movies           # one media type
npm run scan:all         # all four

# Probe passes (ffprobe + ID3, slow first time, cached after)
npm run probe:movies     # one type
npm run probe:all        # all four

# Validate passes (TMDB API, needs .secrets.json)
npm run validate:movies  # one type
npm run validate:all     # both movies + shows

# Dev
npm run typecheck        # TypeScript check
npm run lint             # ESLint
npm run lint:fix         # Auto-fix where possible
npm run prettier         # Format check
npm run prettier:fix     # Format write
```

---

## Roadmap

All major roadmap items are shipped. Future work lives in per-file TODO comments (if any) or here:

### Shipped

- **Music quality summary** — derived per-album `audio_quality_summary` in `output/music/probe.json` (`"FLAC 16/44.1"`, `"MP3 ~288"`, etc.) with VBR tolerance and a `warn_quality_inconsistent` warning for cross-codec or wide-spread albums.
- **ID3 tag reading for music** — `output/music/probe.json` includes per-track `tags` read via [`music-metadata`](https://www.npmjs.com/package/music-metadata). Four new warnings: `warn_compilation_detected`, `warn_folder_tag_mismatch`, `warn_missing_tags`, `warn_track_number_mismatch`. Closes the "single-composer vs Various Artists" question.
- **TMDB validation for movies and shows** — `npm run validate:movies` / `validate:shows` cross-check the scan output against TheMovieDB. Per-record results in `output/<type>/validation.json` with TMDB IDs, canonical titles/years, and alternative candidates. Confidence-scored matching with strict normalization (only filename-illegal characters bridged automatically; diacritics kept distinct). Per-season episode-count comparison for shows catches incomplete seasons even when episode numbers have no gaps.

---

## License

MIT
