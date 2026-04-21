# MOASYS-Vault

**MOASYS-Vault** is a media library scanner for [Plex](https://www.plex.tv/) collections. Point it at your media directories and it generates a clean, structured catalog of everything you own — including quality versions, alternate editions, and any files that need attention.

Built for **MOASYS** *(Mossimo's Oasis System)* and designed to be shared — configurable by anyone using Plex naming conventions.

---

## Features

### General
- Fully config-driven — no code changes needed to adapt to your setup
- Works on Windows, macOS, and Linuxlear
- Reads from local folders, external drives, and network shares (NAS via SMB)
- Outputs a clean JSON file per media type, ready for website use
- Outputs a `warnings.json` per media type flagging files that need attention
- Outputs a SQLite database per media type for local querying

### Movies ✓
- Scans libraries organized by quality folders (UHD, HD, SD, etc.)
- Detects when the same title exists in multiple quality versions (e.g. The Crow in both UHD and HD)
- Handles alternate editions (Theatrical, Director's Cut, Special Edition, etc.)

### Shows *(coming soon)*
- Plex-compatible show, season, and episode scanning

### Music *(coming soon)*
- Artist and album scanning

### Audiobooks *(coming soon)*
- Author and title scanning

---

## Requirements

- Python 3.8 or higher
- No third-party packages required — standard library only

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

**Windows** — use a mapped drive letter or UNC path:
```json
"root_path": "Z:\\Movies"
"root_path": "\\\\NAS-NAME\\Movies"
```

**macOS** — SMB shares mount under `/Volumes`. Connect to your NAS via Finder first (Go → Connect to Server), then use the mounted path:
```json
"root_path": "/Volumes/Movies"
```

**Linux** — use whatever path your share is mounted at:
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

The config has one section per media type. All sections follow the same pattern — the example below shows movies. TV shows follow the same structure; music and audiobooks use `audio_extensions` instead of `video_extensions`.

```json
{
  "movies": {
    "root_path": "Z:\\Movies",
    "quality_folders": [
      { "folder": "UHD",       "tag": "UHD" },
      { "folder": "HD",        "tag": "HD" },
      { "folder": "SD",        "tag": "SD" },
      { "folder": "Other UHD", "tag": "Other UHD" },
      { "folder": "Other HD",  "tag": "Other HD" },
      { "folder": "Other SD",  "tag": "Other SD" }
    ],
    "primary_extension": ".mp4",
    "video_extensions": [".mp4", ".mkv", ".avi", ".m4v", ".mov", ".wmv", ".ts", ".m2ts"]
  }
}
```

**`root_path`** — Path to your media root. See Supported Sources and Platform Notes above for the correct format per operating system.

**`quality_folders`** — List of subfolders to scan. The `folder` key is the actual folder name on disk; the `tag` key is what appears in the output. Rename either to match your setup.

**`primary_extension`** — The expected file format. Files in any other format will be flagged in `warnings.json`.

**`video_extensions`** — All formats considered valid video files. Anything outside this list is ignored entirely (e.g. `.nfo`, `.jpg` sidecar files).

---

## Folder Structure Expected

MOASYS-Vault follows the [Plex naming convention](https://support.plex.tv/articles/naming-and-organizing-your-movie-media-files/):

```
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

---

## Usage

All scans are run from the project root directory.

### Scan movies only
```bash
python scan.py --type movies
```

### Scan shows only
```bash
python scan.py --type shows
```

### Scan music only
```bash
python scan.py --type music
```

### Scan audiobooks only
```bash
python scan.py --type audiobooks
```

### Scan all media types at once
```bash
python scan.py --all
```

### Show help
```bash
python scan.py --help
```

---

## Output

Each media type writes its output to its own subfolder inside `output/`. All media types share the same structure — the example below shows movies.

```
output/
├── movies/
│   ├── movies.json       ← clean list, ready for your website
│   ├── warnings.json     ← files that need attention
│   └── movies.db         ← SQLite database for local querying
├── shows/
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

| Warning | Meaning |
|---|---|
| Non-primary video file — may need re-encoding | File exists but isn't your configured primary format |
| No recognized video files found in folder | Folder is empty or contains only sidecar files |
| File name does not match Plex naming convention | File won't be picked up by Plex correctly |
| File title/year does not match folder | Mismatch between the folder name and the file inside it |

---

## Project Structure

```
MOASYS-Vault/
├── scan.py               ← entry point, run this
├── config.json           ← your settings, edit this
├── README.md
├── core/
│   ├── __init__.py
│   └── scanner.py        ← shared scanning scaffolding (folder walking, output writing)
├── media/
│   ├── __init__.py
│   ├── movies.py         ← movie parsing, serialization, DB logic ✓
│   ├── shows.py          ← shows (not yet implemented)
│   ├── music.py          ← music (not yet implemented)
│   └── audiobooks.py     ← audiobooks (not yet implemented)
└── output/
    ├── movies/
    ├── shows/
    ├── music/
    └── audiobooks/
```

---

## Safety

MOASYS-Vault is **strictly read-only**. It will never modify, move, rename, or delete any of your media files. It only reads folder and file names, and writes output files to the `output/` directory inside the project folder.

---

## Roadmap

- [ ] Shows scanning
- [ ] Music scanning
- [ ] Audiobook scanning
- [ ] Website with searchable media lists
- [ ] TMDB API integration (posters, genres, ratings)

---

## License

MIT
