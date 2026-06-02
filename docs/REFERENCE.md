# Output & Warning Reference

This file is the catalog of every output file the scanner produces and every warning it can emit. For workflow guidance see [SCANS.md](SCANS.md). For folder/file naming conventions see [CONVENTIONS.md](CONVENTIONS.md).

---

## Output files

Each media type writes its output to its own subfolder inside `output/`. All media types share the same structure. The `probe.json` / `probe-warnings.json` files appear only after `npm run probe:<type>`. The `validation.json` / `validation-warnings.json` files appear only after `npm run validate:<type>` (movies and shows only).

```text
output/
├── movies/
│   ├── movies.json               ← clean list (scan pass)
│   ├── warnings.json             ← naming/structure warnings (scan pass)
│   ├── probe.json                ← per-file probe data (probe pass)
│   ├── probe-warnings.json       ← quality + tag warnings (probe pass)
│   ├── validation.json           ← per-movie TMDB resolution (validate pass)
│   └── validation-warnings.json  ← TMDB confidence + mismatch warnings (validate pass)
├── shows/
│   ├── shows.json
│   ├── warnings.json
│   ├── probe.json
│   ├── probe-warnings.json
│   ├── validation.json
│   └── validation-warnings.json
├── music/
│   ├── music.json
│   ├── warnings.json
│   ├── probe.json
│   └── probe-warnings.json
└── audiobooks/
    ├── audiobooks.json
    ├── warnings.json
    ├── probe.json
    └── probe-warnings.json
```

---

## Catalog shapes

### `movies.json`

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

### `shows.json`

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

### `music.json`

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

### `audiobooks.json`

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

### `warnings.json` (shape shared across scan / probe / validate)

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

---

## Warning tables

Per-warning toggles live in `rules/<type>.yaml` under `checks.warn_*`. Every warning ships enabled by default. Set any to `false` to silence.

### Movies

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
| TMDB no match _(validate pass)_                 | TMDB found nothing matching the title + year — possible typo or obscure film                  |
| TMDB low confidence _(validate pass)_           | TMDB returned a match but score was below the confidence threshold — review                   |
| TMDB year mismatch _(validate pass)_            | TMDB canonical release year disagrees with the folder year                                    |
| TMDB canonical title _(validate pass)_          | Folder title differs from TMDB's filename-safe canonical title — rename suggestion            |

### Shows

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
| TMDB no match _(validate pass)_                   | TMDB found nothing matching the title + year                                       |
| TMDB low confidence _(validate pass)_             | TMDB match score below the confidence threshold — review                           |
| TMDB episode count _(validate pass)_              | Local season has fewer episodes than TMDB lists for that season                    |
| TMDB canonical title _(validate pass)_            | Folder title differs from TMDB's filename-safe canonical title — rename suggestion |

### Music

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
| Inconsistent audio quality _(probe pass)_        | Album mixes codecs or bitrate spread > 64 kbps — probe-warnings  |
| Compilation detected _(probe pass)_              | Album has multiple AlbumArtists; should be in `Various Artists/` |
| Folder/tag mismatch _(probe pass)_               | Artist or Album folder name doesn't match the embedded tag       |
| Missing tags _(probe pass)_                      | Tracks missing required tags (title/album/artist)                |
| Track number mismatch _(probe pass)_             | Filename track number doesn't match tag's TrackNumber            |

### Audiobooks

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
