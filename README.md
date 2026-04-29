# MOASYS-Vault

**MOASYS-Vault** is a media library scanner for [Plex](https://www.plex.tv/) collections. Point it at your media directories and it generates a clean, structured catalog of everything you own — including quality versions, alternate editions, and any files that need attention.

Built for **MOASYS** *(Mossimo's Oasis System)* and designed to be shared — configurable by anyone using Plex naming conventions.

---

## Features

### General

- Fully config-driven — no code changes needed to adapt to your setup
- Works on Windows, macOS, and Linux
- Reads from local folders, external drives, and network shares (NAS via SMB)
- Outputs a clean JSON file per media type, ready for website use
- Outputs a `warnings.json` per media type flagging files that need attention
- Outputs a SQLite database per media type for local querying

### Movies

- Scans libraries organized by quality folders (UHD, HD, SD, etc.)
- Detects when the same title exists in multiple quality versions (e.g. The Crow in both UHD and HD)
- Handles alternate editions (Theatrical, Director's Cut, Special Edition, etc.)

### Shows

- Scans libraries organized by quality folders (UHD, HD, SD, etc.)
- Tracks which seasons you own per show
- Episode count per season, including multi-episode files (e.g. S01E01-E02 counts as 2)
- Per-season quality tagging (a show can have Season 1 in UHD and Season 2 in HD)
- Flags potential missing episodes when gaps are detected in episode numbers

### Music *(coming soon)*

- Artist and album scanning

### Audiobooks *(coming soon)*

- Author and title scanning

---

## Requirements

- Python 3.8 or higher — download from [python.org](https://www.python.org/downloads/) if not already installed
  - **Windows:** installer available at python.org — check **"Add Python to PATH"** during installation. Run with `python`
  - **macOS:** likely pre-installed. Check with `python3 --version` in Terminal. Run with `python3`
- No third-party packages required — standard library only

---

## Platform Notes

MOASYS-Vault works on Windows, macOS, and Linux. The only difference between platforms is how you write `root_path` in `config.json`.

**Windows**

```json
"root_path": "Z:\\Movies"
"root_path": "\\\\NAS-NAME\\Movies"
```

**macOS**

```json
"root_path": "/Volumes/Movies"
```

**Linux**

```json
"root_path": "/mnt/nas/Movies"
```

Everything else — the Python code, folder walking, output files — works identically across all platforms.

---

## Installation

Clone or download this repository and place it anywhere on your machine:

```bash
git clone https://github.com/yourname/MOASYS-Vault.git
cd MOASYS-Vault
```

---

## Configuration

Edit `config.json` before running any scans. This is the only file you need to change.

The config has one section per media type. All sections follow the same pattern — the example below shows movies. Shows follow the same structure; music and audiobooks use `audio_extensions` instead of `video_extensions`.

```json
{
  "movies": {
    "root_path": "Z:\\Movies",
    "media_folders": [
      { "name": "UHD",       "tag": "UHD" },
      { "name": "HD",        "tag": "HD" },
      { "name": "SD",        "tag": "SD" },
      { "name": "Other UHD", "tag": "Other UHD" },
      { "name": "Other HD",  "tag": "Other HD" },
      { "name": "Other SD",  "tag": "Other SD" }
    ],
    "primary_extension": [".mp4"],
    "video_extensions": [".mp4", ".mkv", ".avi", ".m4v", ".mov", ".wmv", ".ts", ".m2ts"]
  }
}
```

**`root_path`** — Path to your media root. See Supported Sources and Platform Notes above for the correct format per operating system.

**`media_folders`** — List of subfolders to scan. The `name` key is the actual folder name on disk; the `tag` key is what appears in the output. Rename either to match your setup.

**`primary_extension`** — The expected primary file format(s). Files in any other format will be flagged in `warnings.json`. Always a list:

```json
"primary_extension": [".mp4"]
"primary_extension": [".mp4", ".mkv"]
```

**Movies**
**`video_extensions`** — All formats considered valid video files.

**Shows**
**`ignored_season_names`** — Season folder names listed here are included in the output without triggering a naming convention warning. Useful for Plex special season folders like `Specials`.

```json
"ignored_season_names": ["Specials", "Champion of Champions"]
```

---

## Folder Structure Expected

MOASYS-Vault follows the [Plex naming convention](https://support.plex.tv/articles/naming-and-organizing-your-movie-media-files/):

### Movies

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

```text
Shows/
└── HD/
    └── Star Trek Enterprise (2001)/
        └── Season 01/
            ├── Star Trek Enterprise (2001) - S01E01-E02 - Broken Bow Part 1 And 2.mp4
            ├── Star Trek Enterprise (2001) - S01E03 - Flight Or Flight.mp4
            └── Star Trek Enterprise (2001) - S01E04 - Strange New World.mp4
```

---

## Usage

All scans are run from the project root directory.

> **Windows:** use `python` — **macOS/Linux:** use `python3`

### Scan movies only

Windows:

```bash
python scan.py --type movies
```

macOS / Linux:

```bash
python3 scan.py --type movies
```

### Scan shows only

```bash
# Windows
python scan.py --type shows

# macOS / Linux
python3 scan.py --type shows
```

### Scan music only

```bash
# Windows
python scan.py --type music

# macOS / Linux
python3 scan.py --type music
```

### Scan audiobooks only

```bash
# Windows
python scan.py --type audiobooks

# macOS / Linux
python3 scan.py --type audiobooks
```

### Scan all media types at once

```bash
# Windows
python scan.py --all

# macOS / Linux
python3 scan.py --all
```

---

## Output

Each media type writes its output to its own subfolder inside `output/`. All media types share the same structure.

```text
output/
├── movies/
│   ├── movies.json       ← clean list, ready for your website
│   ├── warnings.json     ← files that need attention
│   └── movies.db         ← SQLite database for local querying
├── shows/
│   ├── shows.json
│   ├── warnings.json
│   └── shows.db
├── music/
└── audiobooks/
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
    "title": "Close Encounters of the Third Kind",
    "year": 1977,
    "edition": "Director's Cut",
    "qualities": ["HD"]
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
      { "season": "2", "episode_count": 26, "qualities": ["UHD", "HD"] }
    ]
  }
]
```

### warnings.json

```json
{
  "generated": "2026-04-20T10:30:00+00:00",
  "count": 2,
  "files": [
    {
      "path": "UHD/The Terminator (1984)/The Terminator (1984).mkv",
      "extension": ".mkv",
      "issue": "Non-MP4 video file — may need re-encoding"
    },
    {
      "path": "HD/Somefolder",
      "issue": "No recognized video files found in folder"
    }
  ]
}
```

### Warning types

#### Movies

| Warning | Meaning |
| --- | --- |
| Non-primary video file — may need re-encoding | File exists but isn't your configured primary format |
| No recognized video files found in folder | Folder is empty or contains only sidecar files |
| File name does not match Plex naming convention | File won't be picked up by Plex correctly |
| Empty edition tag | File has `{edition-}` with nothing after the dash |
| Suspicious year | Year is before 1888 or in the future — likely a typo |
| File title does not match folder title | Title mismatch between the file name and its parent folder |
| File year does not match folder year | Year mismatch between the file name and its parent folder |
| Duplicate edition | Two files in the same folder claim the same edition name |

#### Shows

| Warning | Meaning |
| --- | --- |
| Non-primary video file — may need re-encoding | File exists but isn't your configured primary format |
| No recognized video files found in season folder | Season folder is empty or contains only sidecar files |
| Show folder does not match Plex naming convention | Expected: Show Title (YEAR) |
| Season folder does not match expected format | Expected: Season 01 |
| File name does not match Plex naming convention | Expected: Show Title (YEAR) - S01E01 - Episode Title |
| File show/year does not match show folder | Naming mismatch between file and its parent show folder |
| File season does not match season folder | Episode file is in the wrong season folder |
| Potential missing episodes | Gap detected in episode numbers within a season |

---

## Roadmap

- [x] Movie scanning
- [x] Show scanning
- [ ] Music scanning
- [ ] Audiobook scanning
- [ ] Website with searchable media lists
- [ ] TMDB API integration (posters, genres, ratings)
