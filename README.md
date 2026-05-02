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

**`ignored_season_names`** _(Shows only)_ — Season folder names listed here are included in the output without triggering a naming convention warning. Useful for Plex special season folders like `Specials`.

```json
"ignored_season_names": ["Specials", "Champion of Champions"]
```

**Music & Audiobooks specific:**

**`audio_extensions`** — All formats considered valid audio files. Anything outside this list is ignored entirely.

---

## Folder Structure Expected

### Movies

Follows the [Plex naming convention](https://support.plex.tv/articles/naming-and-organizing-your-movie-media-files/):

```text
Movies/
└── UHD/
    └── The Crow (1994)/
        └── The Crow (1994).mp4
└── HD/
    └── The Crow (1994)/
        └── The Crow (1994).mp4
    └── Close Encounters of the Third Kind (1977)/
        ├── Close Encounters of the Third Kind (1977).mp4
        ├── Close Encounters of the Third Kind (1977) {edition-Special Edition}.mp4
        └── Close Encounters of the Third Kind (1977) {edition-Director's Cut}.mp4
```

### Shows

Follows the [Plex naming convention](https://support.plex.tv/articles/naming-and-organizing-your-tv-show-files/):

```text
Shows/
└── HD/
    └── Star Trek Enterprise (2001)/
        └── Season 01/
            ├── Star Trek Enterprise (2001) - S01E01-E02 - Broken Bow Part 1 And 2.mp4
            ├── Star Trek Enterprise (2001) - S01E03 - Flight Or Flight.mp4
            └── Star Trek Enterprise (2001) - S01E04 - Strange New World.mp4
```

### Music

Follows the [Plex music naming convention](https://support.plex.tv/articles/200265266-adding-music-media-from-folders/):

```text
Audio/
└── Music/
    └── Pink Floyd/
        └── The Wall/
            ├── 101 - In the Flesh.flac
            ├── 102 - The Thin Ice.flac
            ├── 201 - Hey You.flac
            └── 202 - Is There Anybody Out There.flac
└── Soundtracks/
    └── Various Artists/
        └── The Crow - Original Motion Picture Soundtrack/
            ├── 01 - Burn.mp3
            └── 02 - Golgotha Tenement Blues.mp3
```

### Audiobooks

```text
Audiobooks/
└── Audible/
    └── J.R.R. Tolkien/
        └── The Hobbit/
            ├── 01 - An Unexpected Party.m4b
            └── 02 - Roast Mutton.m4b
└── Book On CD/
    └── Terry Pratchett, Neil Gaiman/
        └── Good Omens/
            ├── 101 - Chapter 1.mp3
            └── 201 - Chapter 1.mp3
```

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

Each media type writes its output to its own subfolder inside `output/`. All media types share the same structure.

```text
output/
├── movies/
│   ├── movies.json       ← clean list, ready for your website
│   └── warnings.json     ← files that need attention
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

| Warning                                         | Meaning                                                    |
| ----------------------------------------------- | ---------------------------------------------------------- |
| Non-primary video file — may need re-encoding   | File exists but isn't your configured primary format       |
| No recognized video files found in folder       | Folder is empty or contains only sidecar files             |
| File name does not match Plex naming convention | File won't be picked up by Plex correctly                  |
| Empty edition tag                               | File has `{edition-}` with nothing after the dash          |
| Suspicious year                                 | Year is before 1888 or in the future — likely a typo       |
| File title does not match folder title          | Title mismatch between the file name and its parent folder |
| File year does not match folder year            | Year mismatch between the file name and its parent folder  |
| Duplicate edition                               | Two files in the same folder claim the same edition name   |

#### Shows

| Warning                                           | Meaning                                                 |
| ------------------------------------------------- | ------------------------------------------------------- |
| Non-primary video file — may need re-encoding     | File exists but isn't your configured primary format    |
| No recognized video files found in season folder  | Season folder is empty or contains only sidecar files   |
| Show folder does not match Plex naming convention | Expected: Show Title (YEAR)                             |
| Season folder does not match expected format      | Expected: Season 01                                     |
| File name does not match Plex naming convention   | Expected: Show Title (YEAR) - S01E01 - Episode Title    |
| File show/year does not match show folder         | Naming mismatch between file and its parent show folder |
| File season does not match season folder          | Episode file is in the wrong season folder              |
| Potential missing episodes                        | Gap detected in episode numbers within a season         |

#### Music

| Warning                                          | Meaning                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| Non-primary audio file — may need re-encoding    | File exists but isn't your configured primary format             |
| No recognized audio files found in album folder  | Album folder is empty or contains only sidecar files             |
| Track file name does not match naming convention | Expected: `01 - Track Name.ext` or `101 - Track Name.ext`        |
| Potential missing tracks                         | Gap detected in track numbers within an album (checked per disc) |
| Duplicate album                                  | Same artist + album found in more than one media folder          |

#### Audiobooks

| Warning                                            | Meaning                                                          |
| -------------------------------------------------- | ---------------------------------------------------------------- |
| Non-primary audio file — may need re-encoding      | File exists but isn't your configured primary format             |
| No recognized audio files found in book folder     | Book folder is empty or contains only sidecar files              |
| Chapter file name does not match naming convention | Expected: `01 - Chapter Name.ext` or `101 - Chapter Name.ext`    |
| Potential missing chapters                         | Gap detected in chapter numbers within a book (checked per disc) |
| Duplicate book                                     | Same book title found in more than one media folder              |

---

## Project Structure

```text
MOASYS-Vault/
├── src/
│   ├── scan.ts               ← entry point, run via npm scripts
│   ├── core/
│   │   ├── types.ts          ← shared TypeScript interfaces
│   │   └── scanner.ts        ← shared scanning scaffolding
│   └── media/
│       ├── movies.ts         ← movie parsing and serialization ✓
│       ├── shows.ts          ← show parsing and serialization ✓
│       ├── music.ts          ← music parsing and serialization ✓
│       └── audiobooks.ts     ← audiobook parsing and serialization ✓
├── output/                   ← generated output, not committed to git
│   ├── movies/
│   ├── shows/
│   ├── music/
│   └── audiobooks/
├── config.json               ← your settings, edit this
├── package.json
├── tsconfig.json
├── .eslintrc.json
├── .prettierrc.js
└── .gitignore
```

---

## Roadmap

- [x] Movie scanning
- [x] Show scanning
- [x] Music scanning
- [x] Audiobook scanning
- [ ] Website with searchable media lists
- [ ] TMDB API integration for movies and shows (posters, genres, ratings)

---

## License

MIT
