# MOASYS-Vault

**MOASYS-Vault** is a media library scanner for [Plex](https://www.plex.tv/) collections. Point it at your media directories and it generates a clean, structured catalog of everything you own — including quality versions, alternate editions, and any files that need attention.

Built for **MOASYS** _(Mossimo's Oasis System)_ and designed to be shared — configurable by anyone using Plex naming conventions.

---

## Features

### General

- Fully config-driven — no code changes needed to adapt to your setup
- Works on Windows, macOS, and Linux
- Reads from local folders, external drives, and network shares (NAS via SMB)
- Outputs a clean JSON file per media type, ready for website use
- Outputs a `warnings.json` per media type flagging files that need attention
- Optional ffprobe pass scans the actual media for width / height / bitrate / codec, with caching and configurable quality buckets

### Movies ✓

- Scans libraries organized by quality folders (UHD, HD, SD, etc.)
- Detects when the same title exists in multiple quality versions (e.g. The Crow in both UHD and HD)
- Handles alternate editions (Theatrical, Director's Cut, Special Edition, etc.)

### Shows ✓

- Scans libraries organized by quality folders (UHD, HD, SD, etc.)
- Tracks which seasons you own per show
- Episode count per season, including multi-episode files (e.g. S01E01-E02 counts as 2)
- Per-season quality tagging (a show can have Season 1 in UHD and Season 2 in HD)
- Flags potential missing episodes when gaps are detected in episode numbers

### Music ✓

- Scans libraries organized by media folders (e.g. Music, Soundtracks, Other Music)
- Tracks artists and albums with track counts per album
- Qualities tracked per album from file extensions (e.g. FLAC, MP3)
- Supports multi-disc albums (disc + track number format)
- Flags potential missing tracks when gaps are detected in track numbers
- Tracks whether music is physical or digital via `media_type`

### Audiobooks ✓

- Scans libraries organized by media folders (e.g. Audible, Book On CD)
- Organized by book title with authors stored as a list
- Supports multiple authors per book (comma-separated or "and" format)
- Chapter count per book with gap detection for missing chapters
- Supports multi-disc Book On CD format
- Tracks whether audiobook is digital or physical via `media_type`

---

## Requirements

- [Node.js](https://nodejs.org/) v22 or higher (v24 LTS recommended)
- npm (included with Node.js)

---

## Supported Sources

MOASYS-Vault can read from any path your operating system can access:

- **Local folders** — any folder on your machine
- **External drives** — USB or Thunderbolt drives mounted to your system
- **Network shares (NAS)** — SMB shares from devices like Synology, QNAP, Ugreen, etc.

As long as the path is visible in File Explorer (Windows) or Finder (macOS), the scanner can read it. See Platform Notes below for how to format the path per operating system.

---

## Platform Notes

MOASYS-Vault works on Windows, macOS, and Linux. The only difference between platforms is how you write `root_path` in `config.json`.

**Windows**

```json
"root_path": "Z:\\Movies"
```

**macOS**

```json
"root_path": "/Volumes/Movies"
```

**Linux**

```json
"root_path": "/mnt/nas/Movies"
```

---

## Installation

Clone or download this repository and place it anywhere on your machine:

```bash
git clone https://github.com/yourname/MOASYS-Vault.git
cd MOASYS-Vault
npm install
```

---

## Configuration

Edit `config.json` before running any scans. This is the only file you need to change.

The config has one section per media type. Below are examples for each type.

### Movies & Shows

```json
{
  "movies": {
    "root_path": "Z:\\Movies",
    "media_folders": [
      { "name": "UHD", "tag": "UHD" },
      { "name": "HD", "tag": "HD" },
      { "name": "SD", "tag": "SD" },
      { "name": "Other UHD", "tag": "Other UHD" },
      { "name": "Other HD", "tag": "Other HD" },
      { "name": "Other SD", "tag": "Other SD" }
    ],
    "primary_extension": [".mp4"],
    "video_extensions": [".mp4", ".mkv", ".avi", ".m4v", ".mov", ".wmv", ".ts", ".m2ts"]
  }
}
```

### Music

```json
{
  "music": {
    "root_path": "M:\\Audio",
    "media_folders": [
      { "name": "Music", "tag": "Music" },
      { "name": "Other Music", "tag": "Other Music" },
      { "name": "Soundtracks", "tag": "Soundtracks" },
      { "name": "Other Soundtracks", "tag": "Other Soundtracks" }
    ],
    "primary_extension": [".flac"],
    "audio_extensions": [".flac", ".mp3", ".aac", ".m4a", ".wav", ".ogg"]
  }
}
```

### Audiobooks

```json
{
  "audiobooks": {
    "root_path": "M:\\Audiobooks",
    "media_folders": [
      { "name": "Audible", "tag": "Audible" },
      { "name": "Book On CD", "tag": "Book On CD" }
    ],
    "primary_extension": [".m4b"],
    "audio_extensions": [".m4b", ".mp3", ".aac", ".m4a"]
  }
}
```

**Shared fields:**

**`root_path`** — Path to your media root. See Platform Notes above for the correct format per operating system.

**`media_folders`** — List of subfolders to scan. The `name` key is the actual folder name on disk; the `tag` key is what appears in the output. Rename either to match your setup.

**`primary_extension`** — The expected primary file format(s). Files in any other format will be flagged in `warnings.json`. Always a list:

```json
"primary_extension": [".mp4"]
"primary_extension": [".mp4", ".mkv"]
```

**Movies & Shows specific:**

**`video_extensions`** — All formats considered valid video files. Anything outside this list is ignored entirely (e.g. `.nfo`, `.jpg` sidecar files).

**Music & Audiobooks specific:**

**`audio_extensions`** — All formats considered valid audio files. Anything outside this list is ignored entirely.

> Naming conventions (regex patterns, ignored season names, year ranges, warning toggles) live in `rules/*.yaml` — see the [Rules](#rules-library-conventions) section below.

---

## Rules (Library Conventions)

Configuration is split into two layers:

- **`config.json`** — your library's _location_ and _file types_: paths, extensions, media folders. You always need this. Per-user.
- **`rules/*.yaml`** — your library's _naming conventions_: regex patterns for files and folders, year ranges, ignored season names, per-warning toggles. Optional. Per-Plex-convention.

The default rules ship inside the code and match standard Plex conventions out of the box. You only need a `rules/<type>.yaml` file if you want to override something.

### Overriding defaults

Each media type ships with `rules/<type>.example.yaml` — a fully commented file showing every available option. To override:

1. Copy the example file to its non-example name:

   ```bash
   cp rules/movies.example.yaml rules/movies.yaml
   ```

2. Edit `rules/movies.yaml`. Include **only the keys you want to change** — anything you leave out keeps the code default. Partial overrides work end-to-end.
3. Run the scan as usual. The console prints `[RULES] Loaded overrides from rules/movies.yaml` so you can see at a glance whether your overrides took effect.

### What's configurable

- **`patterns`** — regex with named capture groups for parsing folder and file names. Each pattern can be a plain string or `{ pattern, flags }` for case-insensitive or other regex flags.
- **Per-type constants:**
  - Movies — `year_range` (min/max plausible film year, `max: current` resolves to this year), `acceptable_quality_combos` (cross-folder pairings that shouldn't warn).
  - Shows — `ignored_season_names` (Plex special-season folders to accept, e.g. `Specials`).
  - Music and audiobooks — patterns only (no extra constants).
- **`checks`** — per-warning toggles. Set any `warn_*` field to `false` to silence that warning without changing code.

### Validation

Rules are validated at startup against a schema (Zod). If your YAML has a typo, wrong type, or invalid regex, you get a clear error before any scanning happens:

```text
Error: rules/movies.yaml failed schema validation:
  - year_range.min: Expected number, received string
  - patterns.folder: must be a valid regular expression
```

---

## Probe (Media Properties)

The probe pass uses `ffprobe` to inspect the actual contents of each media file — width, height, codec, bitrate, sample rate, etc. — and writes a sidecar JSON file alongside the scan output. This is opt-in via separate `npm run probe:<type>` scripts so the regular scans stay fast.

A bundled copy of `ffprobe` ships with the project via `ffprobe-static`, so there's nothing to install separately.

### Running

```bash
npm run probe:movies        # Probe movies only
npm run probe:shows         # Probe shows only
npm run probe:music         # Probe music only
npm run probe:audiobooks    # Probe audiobooks only
npm run probe:all           # Probe everything in sequence
```

The first run on a fresh library is slow — ffprobe takes 100-300ms per file and a 2,500-movie library can take 15+ minutes. Subsequent runs are near-instant: every file's probe result is cached by `path|mtime|size`, so only changed or added files get re-probed.

### Output files

Each probe pass writes two files into the existing `output/<type>/` folder:

```text
output/movies/
├── movies.json           ← from the scan pass (unchanged)
├── warnings.json         ← from the scan pass (unchanged)
├── probe.json            ← NEW: per-file probe data, joinable to movies.json
└── probe-warnings.json   ← NEW: quality_mismatch and future probe-side warnings
```

The two warning files are independent — running `npm run probe:movies` does NOT touch `warnings.json` from the scan pass.

The cache lives in `cache/<type>-probe.json` at the project root and is gitignored.

### Quality buckets (movies and shows)

For video media, the probe pass can flag files whose detected dimensions don't match the quality folder they're in. Buckets are configured in `rules/<type>.yaml` under `quality_thresholds`:

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

Each bucket groups one or more folder tags and defines a pixel range that the file's **long edge** (max of width and height) must fall in. Either bound is optional — leave off `min_width` on SD or `max_width` on UHD.

If a file's long edge falls outside its bucket, a warning is emitted to `probe-warnings.json`. Useful for catching HD encodes accidentally placed in a UHD folder.

HandBrake-cropped files (e.g. 664×448 SD, 1920×800 HD) classify correctly because the long-edge comparison is forgiving by design — pick wide ranges and only the obvious mismatches fire.

`quality_thresholds` ships empty, so the check is silent for users who haven't configured buckets. See `rules/movies.example.yaml` for the full shape.

### Music and audiobooks

These types collect probe data (codec, bitrate, sample rate, bit depth, channels) but do not emit quality_mismatch warnings — quality semantics for audio depend on format (FLAC bit depth vs. MP3 bitrate vs. spoken-word audiobook bitrate) and would be noisy without per-format rules. The data is recorded in `probe.json` for the website or future analysis.

---

## Folder Structure & Naming Conventions

MOASYS-Vault expects libraries to follow Plex's documented folder and file naming conventions. This section is the authoritative reference for each media type — the regex defaults in the rules layer encode exactly what's described below.

> **Plex's official docs** for reference:
> [Naming Movie Files](https://support.plex.tv/articles/200381023-naming-movie-files/) ·
> [Naming TV Show Files](https://support.plex.tv/articles/naming-and-organizing-your-tv-show-files/) ·
> [Adding Music Media from Folders](https://support.plex.tv/articles/200265296-adding-music-media-from-folders/)

### Movies

**Hierarchy:**

```text
<media_folder>/
└── <Movie Title (YEAR)>/
    ├── <Movie Title (YEAR)>.<ext>
    └── <Movie Title (YEAR)> {edition-<Edition Name>}.<ext>
```

**Naming format:**

- **Movie folder:** `Movie Title (YEAR)` — year in parentheses
- **File stem:** matches the folder name exactly
- **Optional edition tag:** `{edition-<Name>}` between the year and the extension

**Examples:**

```text
UHD/
├── The Crow (1994)/
│   └── The Crow (1994).mp4
└── Close Encounters of the Third Kind (1977)/
    ├── Close Encounters of the Third Kind (1977).mp4
    ├── Close Encounters of the Third Kind (1977) {edition-Director's Cut}.mp4
    └── Close Encounters of the Third Kind (1977) {edition-Special Edition}.mp4
```

**Gotchas:**

- File year must match the parent folder's year — a mismatch is flagged
- File title must match the parent folder's title (case-insensitive) — a mismatch is flagged
- Empty `{edition-}` tags (no value after the dash) are flagged
- Two files in the same folder claiming the same edition are flagged as duplicates
- Same movie appearing in multiple quality folders is flagged unless that combination is listed in `acceptable_quality_combos`
- Subfolders inside a movie folder are not scanned — any video files inside are dropped from the catalog (flagged as `warn_extra_subfolders`)

### Shows

**Hierarchy:**

```text
<media_folder>/
└── <Show Title (YEAR)>/
    ├── Season 01/
    │   ├── <Show Title (YEAR)> - S01E01 - <Episode Title>.<ext>
    │   ├── <Show Title (YEAR)> - S01E02-E03 - <Episode Title>.<ext>
    │   └── ...
    └── Specials/                              ← named season per `ignored_season_names`
        └── <Show Title (YEAR)> - S00E01 - <Episode Title>.<ext>
```

**Naming format:**

- **Show folder:** `Show Title (YEAR)` — year in parens, just like movies
- **Season folder:** `Season XX` — two-digit zero-padded number (`Season 01`, not `Season 1`)
- **Episode file:** `Show Title (YEAR) - S01E01 - Episode Title.<ext>`
  - The `- Episode Title` portion is optional
  - Multi-episode files use `S01E01-E02` or `S01E01-02` (the trailing `E` is optional)

**Special seasons:**

Plex's `Specials` convention (for behind-the-scenes, pilots, etc.) is supported via `rules/shows.yaml`:

```yaml
ignored_season_names:
  - Specials
  - Champion of Champions # league/event-style named seasons
```

Folders listed here bypass the `Season XX` regex check and are accepted as-is.

**Examples:**

```text
HD/
└── Star Trek Enterprise (2001)/
    ├── Season 01/
    │   ├── Star Trek Enterprise (2001) - S01E01-E02 - Broken Bow Part 1 And 2.mp4
    │   ├── Star Trek Enterprise (2001) - S01E03 - Flight or Flight.mp4
    │   └── Star Trek Enterprise (2001) - S01E04 - Strange New World.mp4
    └── Specials/
        └── Star Trek Enterprise (2001) - S00E01 - Behind the Scenes.mp4
```

**Gotchas:**

- Season folders MUST be two-digit zero-padded (`Season 01`, not `Season 1`)
- File's show name and year must match the parent show folder
- File's season number must match the parent season folder (numeric seasons only)
- Multi-episode files (`S01E01-E02`) count as 2 episodes for gap detection
- Gaps in episode numbers within a season are flagged
- Files placed loose in a show folder (no Season XX wrapper) are skipped — flagged
- Subfolders inside a season folder are not scanned — flagged

### Music

Music conventions come directly from Plex's docs. Quoting verbatim:

> Content should have each artist in their own directory, with each album as a separate subdirectory within it.
>
> `Music/ArtistName/AlbumName/TrackNumber - TrackName.ext`
>
> For albums that span more than one disc, you simply prepend the disc number to the front of the track number. So, track two on disc three would be `302 - TrackName.ext`.
>
> `Music/ArtistName/AlbumName/DiscNumberTrackNumber - TrackName.ext`

**Hierarchy:**

```text
<media_folder>/
└── <Artist Name>/
    └── <Album Name>/
        ├── 01 - Track Name.<ext>           ← single-disc
        ├── 101 - Track Name.<ext>          ← multi-disc: disc 1, track 1
        └── 201 - Track Name.<ext>          ← multi-disc: disc 2, track 1
```

**Naming format:**

- **Artist folder:** any name. Plex does NOT specify a format; the default regex matches anything non-empty
- **Album folder:** any name. Plex does NOT specify a format (no year required in the folder — the year lives in ID3 tags)
- **Track file (single-disc):** `<2-digit track> - <Track Name>.<ext>` — e.g. `01 - In the Flesh.flac`
- **Track file (multi-disc):** `<disc><2-digit track> - <Track Name>.<ext>` — e.g. `101 - In the Flesh.flac` (disc 1, track 1)

The scanner tries the multi-disc pattern first (more specific) then falls back to single-disc.

**Compilations / "Various Artists":**

Quoting Plex verbatim:

> Sometimes, you may have compilation albums where there are tracks by multiple different artists. This is common for soundtracks or "Best of the 80s" type albums, for instance. The common way to handle this is to use an artist with the literal name "Various Artists" and to have those albums under that artist.

So:

- **Single-composer scores** (e.g. Halo OSTs by Marty O'Donnell / Michael Salvatori, Witcher 3 OST): use the composer's name as the artist folder.
- **Multi-artist compilations** (e.g. Guardians of the Galaxy: Awesome Mix, mixed-artist soundtracks, "Best of the 90s"): use the literal `Various Artists` as the artist folder.

Per Plex's recommendation, for Various Artists albums, the embedded ID3 `Album Artist` tag should be `Various Artists` and per-track `Artist` should be the actual performer.

**Examples:**

```text
Music/
├── Pink Floyd/
│   └── The Wall/
│       ├── 101 - In the Flesh.flac
│       ├── 102 - The Thin Ice.flac
│       ├── 201 - Hey You.flac
│       └── 202 - Is There Anybody Out There.flac
└── Various Artists/
    └── Guardians Of The Galaxy - Awesome Mix Vol. 1/
        ├── 01 - Hooked On A Feeling.mp3
        └── 02 - Go All The Way.mp3
Soundtracks/
└── Marty O'Donnell, Michael Salvatori/      ← composer as artist for single-composer score
    └── Halo Original Soundtrack/
        ├── 01 - Truth and Reconciliation Suite.flac
        └── ...
```

**Gotchas:**

- The scanner doesn't recurse into subfolders within an album — multi-disc albums must use the flat disc-prefixed convention (`101`, `201`, etc.)
- Trailing whitespace in artist/album folder names silently fragments your Plex library — these are now flagged via `warn_suspicious_folder_chars`
- Track files placed loose in a media folder OR in an artist folder (no album wrapper) are skipped — flagged via `warn_loose_files`
- Same album in multiple media folders is flagged as a duplicate
- Track numbers must be zero-padded to 2 digits (`01`, not `1`)
- The disc number prefix is greedy: `100 - Track` parses as disc 1, track 00 (because multi-disc is tried first)

### Audiobooks

MOASYS-Vault uses an Author / Book / chapter structure that mirrors music's Artist / Album / track shape. Plex itself doesn't have a dedicated audiobook agent — most users use Plex with [Plexamp's audiobook support](https://www.plex.tv/plexamp/) or a third-party agent — but the music-style structure works across all of them.

**Hierarchy:**

```text
<media_folder>/
└── <Author Name>/                          ← single author
    └── <Book Title>/
        ├── 01 - Chapter Name.<ext>
        └── 02 - Chapter Name.<ext>
```

**Naming format:**

- **Author folder:** single author (`J.R.R. Tolkien`) or multi-author (see below)
- **Book folder:** the book title
- **Chapter file:** same convention as music tracks (`01 - Chapter`, `101 - Chapter` for multi-disc)

**Multi-author parsing:**

The author folder name is parsed into a list of authors stored in the output JSON. Three formats are supported:

| Folder name                        | Parsed authors                         |
| ---------------------------------- | -------------------------------------- |
| `J.R.R. Tolkien`                   | `["J.R.R. Tolkien"]`                   |
| `Terry Pratchett, Neil Gaiman`     | `["Terry Pratchett", "Neil Gaiman"]`   |
| `Author 1, Author 2, and Author 3` | `["Author 1", "Author 2", "Author 3"]` |

**Examples:**

```text
Audible/
└── J.R.R. Tolkien/
    └── The Hobbit/
        ├── 01 - An Unexpected Party.m4b
        └── 02 - Roast Mutton.m4b
Book On CD/
└── Terry Pratchett, Neil Gaiman/
    └── Good Omens/
        ├── 101 - Chapter 1.mp3
        ├── 102 - Chapter 2.mp3
        ├── 201 - Chapter 1.mp3
        └── 202 - Chapter 2.mp3
```

**Gotchas:**

- Books are keyed by **title only** — the same title by different authors collides in the catalog. Intentional, but worth knowing
- Same book in multiple media folders (e.g. both Audible and Book On CD) is flagged as a duplicate
- Quality (codec, bitrate) is collected during the probe pass but no `quality_mismatch` warning fires — spoken word at modest bitrates is fine
- The same flat / disc-prefixed convention applies for multi-disc books — no per-disc subfolders

---

## Usage

All scans are run from the project root directory.

### Scan movies only

```bash
npm run movies
```

### Scan shows only

```bash
npm run shows
```

### Scan music only

```bash
npm run music
```

### Scan audiobooks only

```bash
npm run audiobooks
```

### Scan all media types at once

```bash
npm run scan:all
```

### Probe media properties (ffprobe)

The probe pass is separate from the regular scan — see the [Probe](#probe-media-properties) section above for details and what it produces.

```bash
npm run probe:movies        # Probe movies only
npm run probe:shows         # Probe shows only
npm run probe:music         # Probe music only
npm run probe:audiobooks    # Probe audiobooks only
npm run probe:all           # Probe all media types in sequence
```

### Other useful commands

```bash
npm run typecheck      # Check TypeScript types without running
npm run lint           # Check for ESLint issues in TypeScript files
npm run lint:fix       # Auto-fix ESLint issues
npm run lint:md        # Check Markdown files with markdownlint
npm run prettier       # Format TypeScript and Markdown files with Prettier
npm run prettier:check # Check formatting without making changes
```

---

## Output

Each media type writes its output to its own subfolder inside `output/`. All media types share the same structure. The `probe.json` and `probe-warnings.json` files appear only after you run the corresponding `npm run probe:<type>` command.

```text
output/
├── movies/
│   ├── movies.json           ← clean list (scan pass)
│   ├── warnings.json         ← naming/structure warnings (scan pass)
│   ├── probe.json            ← per-file probe data (probe pass)
│   └── probe-warnings.json   ← quality_mismatch warnings (probe pass)
├── shows/
│   ├── shows.json
│   └── warnings.json
├── music/
│   ├── music.json
│   └── warnings.json
└── audiobooks/
    ├── audiobooks.json
    └── warnings.json
```

### movies.json

```json
[
  {
    "title": "Close Encounters of the Third Kind",
    "year": 1977,
    "edition": null,
    "qualities": ["UHD"]
  },
  {
    "title": "The Crow",
    "year": 1994,
    "edition": null,
    "qualities": ["UHD", "HD"]
  }
]
```

### shows.json

```json
[
  {
    "title": "Star Trek Enterprise",
    "year": 2001,
    "seasons": [
      { "season": "1", "episode_count": 26, "qualities": ["HD"] },
      { "season": "2", "episode_count": 26, "qualities": ["UHD", "HD"] },
      { "season": "Specials", "episode_count": 4, "qualities": ["HD"] }
    ]
  }
]
```

### music.json

```json
[
  {
    "artist": "Pink Floyd",
    "albums": [
      {
        "album": "The Wall",
        "track_count": 26,
        "qualities": ["FLAC"],
        "media_type": ["Music"]
      }
    ]
  }
]
```

### audiobooks.json

```json
[
  {
    "title": "Good Omens",
    "authors": ["Terry Pratchett", "Neil Gaiman"],
    "chapter_count": 26,
    "media_type": ["Audible"]
  }
]
```

### warnings.json

```json
{
  "generated": "2026-04-20T10:30:00+00:00",
  "count": 1,
  "files": [
    {
      "path": "UHD/The Terminator (1984)/The Terminator (1984).mkv",
      "extension": ".mkv",
      "issue": "Non-.MP4 video file — may need re-encoding"
    }
  ]
}
```

### Warning types

#### Movies

| Warning                                         | Meaning                                                                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Non-primary video file — may need re-encoding   | File exists but isn't your configured primary format                                          |
| No recognized video files found in folder       | Folder is empty or contains only sidecar files                                                |
| File name does not match Plex naming convention | File won't be picked up by Plex correctly                                                     |
| Empty edition tag                               | File has `{edition-}` with nothing after the dash                                             |
| Suspicious year                                 | Year is before 1888 or in the future — likely a typo                                          |
| File title does not match folder title          | Title mismatch between the file name and its parent folder                                    |
| File year does not match folder year            | Year mismatch between the file name and its parent folder                                     |
| Duplicate edition                               | Two files in the same folder claim the same edition name                                      |
| Movie exists in multiple quality folders        | Same movie copy lives in two unexpected quality folders (acceptable UHD/HD pairings excluded) |
| Loose video files                               | Video files directly in a media folder, not inside a Movie Title (YEAR)/ folder; skipped      |
| Unexpected subfolder in movie folder            | Subfolders inside a Movie Title (YEAR)/ folder; files inside are not scanned                  |
| Unexpected file                                 | File isn't video, isn't a recognized Plex sidecar, and isn't a known OS artifact              |
| Quality mismatch _(probe pass)_                 | ffprobe dimensions don't fit folder's `quality_thresholds` bucket                             |

#### Shows

| Warning                                           | Meaning                                                                            |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Non-primary video file — may need re-encoding     | File exists but isn't your configured primary format                               |
| No recognized video files found in season folder  | Season folder is empty or contains only sidecar files                              |
| Show folder does not match Plex naming convention | Expected: Show Title (YEAR)                                                        |
| Season folder does not match expected format      | Expected: Season 01                                                                |
| File name does not match Plex naming convention   | Expected: Show Title (YEAR) - S01E01 or Show Title (YEAR) - S01E01 - Episode Title |
| File show/year does not match show folder         | Naming mismatch between file and its parent show folder                            |
| File season does not match season folder          | Episode file is in the wrong season folder                                         |
| Potential missing episodes                        | Gap detected in episode numbers within a season                                    |
| Loose video files                                 | Video files at unexpected nesting (media folder root or show folder); skipped      |
| Unexpected subfolder in season folder             | Subfolders inside a Season XX folder; files inside are not scanned                 |
| Unexpected file                                   | File isn't video, isn't a recognized Plex sidecar, and isn't a known OS artifact   |
| Quality mismatch _(probe pass)_                   | ffprobe dimensions don't fit folder's `quality_thresholds` bucket                  |

#### Music

| Warning                                          | Meaning                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| Non-primary audio file — may need re-encoding    | File exists but isn't your configured primary format             |
| No recognized audio files found in album folder  | Album folder is empty or contains only sidecar files             |
| Track file name does not match naming convention | Expected: `01 - Track Name.ext` or `101 - Track Name.ext`        |
| Artist folder name does not match pattern        | Artist folder doesn't match `patterns.artist_folder` regex       |
| Album folder name does not match pattern         | Album folder doesn't match `patterns.album_folder` regex         |
| Suspicious characters in folder name             | Whitespace, Windows-illegal chars, or reserved name in folder    |
| Potential missing tracks                         | Gap detected in track numbers within an album (checked per disc) |
| Duplicate album                                  | Same artist + album found in more than one media folder          |
| Loose audio files                                | Audio files in media folder root or artist folder; skipped       |
| Unexpected subfolder in album folder             | Subfolders inside an album; files inside are not scanned         |
| Unexpected file                                  | Non-audio, non-sidecar, non-OS-artifact file in a music folder   |

#### Audiobooks

| Warning                                            | Meaning                                                          |
| -------------------------------------------------- | ---------------------------------------------------------------- |
| Non-primary audio file — may need re-encoding      | File exists but isn't your configured primary format             |
| No recognized audio files found in book folder     | Book folder is empty or contains only sidecar files              |
| Chapter file name does not match naming convention | Expected: `01 - Chapter Name.ext` or `101 - Chapter Name.ext`    |
| Potential missing chapters                         | Gap detected in chapter numbers within a book (checked per disc) |
| Duplicate book                                     | Same book title found in more than one media folder              |
| Loose audio files                                  | Audio files in media folder root or author folder; skipped       |
| Unexpected subfolder in book folder                | Subfolders inside a book; files inside are not scanned           |
| Unexpected file                                    | Non-audio, non-sidecar, non-OS-artifact file in a book folder    |

---

## Project Structure

```text
MOASYS-Vault/
├── src/
│   ├── scan.ts                       ← entry point, run via npm scripts
│   ├── core/
│   │   ├── types.ts                  ← shared TypeScript interfaces
│   │   ├── scanner.ts                ← shared scanning scaffolding
│   │   ├── files.ts                  ← shared file/extension helpers
│   │   ├── gaps.ts                   ← shared numeric gap detection
│   │   └── rules/
│   │       ├── helpers.ts            ← shared Zod building blocks (PatternSchema, etc.)
│   │       ├── loader.ts             ← load + merge + validate rules YAML
│   │       ├── movies.ts             ← movies schema + defaults + type
│   │       ├── shows.ts              ← shows schema + defaults + type
│   │       ├── music.ts              ← music schema + defaults + type
│   │       └── audiobooks.ts         ← audiobooks schema + defaults + type
│   ├── media/
│   │   ├── movies.ts                 ← movie parsing factory ✓
│   │   ├── shows.ts                  ← show parsing factory ✓
│   │   ├── music.ts                  ← music parsing factory ✓
│   │   └── audiobooks.ts             ← audiobook parsing factory ✓
│   └── probe/
│       ├── runner.ts                 ← ffprobe CLI entry, run via npm run probe:*
│       ├── ffprobe.ts                ← thin wrapper around ffprobe-static binary
│       ├── cache.ts                  ← path|mtime|size cache, persisted to cache/
│       ├── helpers.ts                ← batch probing + quality bucket classification
│       ├── types.ts                  ← ProbeData + per-type output shapes
│       ├── ffprobe-static.d.ts       ← ambient declaration for ffprobe-static
│       ├── movies.ts                 ← movies probe pass
│       ├── shows.ts                  ← shows probe pass
│       ├── music.ts                  ← music probe pass
│       └── audiobooks.ts             ← audiobooks probe pass
├── rules/
│   ├── movies.example.yaml           ← templates — copy to <type>.yaml to override
│   ├── shows.example.yaml
│   ├── music.example.yaml
│   ├── audiobooks.example.yaml
│   └── <type>.yaml                   ← your overrides (optional)
├── output/                           ← generated output, not committed to git
│   ├── movies/                       ← movies.json, warnings.json, probe.json, probe-warnings.json
│   ├── shows/
│   ├── music/
│   └── audiobooks/
├── cache/                            ← ffprobe results by path|mtime|size, not committed
├── config.json                       ← your paths and file types, edit this
├── package.json
├── tsconfig.json
├── .eslintrc.json
├── .prettierrc.js
└── .gitignore
```

---

## Roadmap

Larger items on the list, in rough priority order. Smaller follow-ups live as TODO comments in the relevant files.

- **External metadata validation (TheMovieDB).** Verify movie titles + years and show episode counts/season layouts against TMDB. Cache responses to `cache/tmdb/`. Flag low-confidence matches with a `needs_review` warning rather than silently picking wrong matches. TheTVDB intentionally skipped — TMDB covers both movies and TV.
- **ID3 tag reading for music.** Read embedded artist / album / track / year / disc / albumartist tags via [`music-metadata`](https://www.npmjs.com/package/music-metadata) and cross-check against folder structure. The music equivalent of TMDB validation — catches the "folder says Pink Floyd but the tag says Pink Floyd Project" cases that fragment a Plex library. Specifically would enable:
  - **Single-composer vs multi-artist compilation detection.** Compare embedded `AlbumArtist` across tracks in an album folder. One value across all tracks → single-composer, the folder should be named after that composer. Multiple values → genuine compilation, the folder should be `Various Artists`. Recommends the right restructure per album.
  - **Folder vs tag artist/album mismatch.** Catches the silent fragmentation cases.
  - **Track-number-from-tag vs filename.** Cross-check the `01` prefix against the embedded track number.
- **Music quality summary.** Combine codec + bitrate + sample rate + bit depth from the existing ffprobe output into a normalized quality string per album (`"FLAC 16/44.1"`, `"MP3 320"`, etc.). Pure derivation from data we already collect.

---

## License

MIT
