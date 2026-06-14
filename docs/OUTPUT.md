# Output & Warning Reference

This page is the complete reference for what the scanner writes and every warning it can emit.

- For workflow guidance see [Scans](SCANS.md).
- For folder/file naming conventions see [Conventions](CONVENTIONS.md).

---

## Output files

Every run writes its files under `output/<type>/`. There are up to five files per media type:

| File                       | Written by               | What it is                                                               |
| -------------------------- | ------------------------ | ------------------------------------------------------------------------ |
| `<type>.json`              | scan (`npm run <type>`)  | Your catalog — title, year, where each copy lives                        |
| `probe.json`               | scan                     | Raw per-file inspection data (codec, bitrate, dimensions, embedded tags) |
| `warnings.json`            | scan                     | Every hygiene finding from the scan pass                                 |
| `validation.json`          | validate (movies, shows) | TMDB cross-check results — canonical title, year, TMDB ID                |
| `validation-warnings.json` | validate (movies, shows) | TMDB confidence warnings and title/year mismatches                       |

The validate files only appear after you run `npm run validate:<type>`, and that command is movies and shows only. Music and audiobooks never produce validate files.

Full layout:

```text
output/
├── movies/
│   ├── movies.json
│   ├── probe.json
│   ├── warnings.json
│   ├── validation.json
│   └── validation-warnings.json
├── shows/
│   ├── shows.json
│   ├── probe.json
│   ├── warnings.json
│   ├── validation.json
│   └── validation-warnings.json
├── music/
│   ├── music.json
│   ├── probe.json
│   └── warnings.json
└── audiobooks/
    ├── audiobooks.json
    ├── probe.json
    └── warnings.json
```

---

## Catalog shapes

Every catalog uses the same per-record `versions: [{category, quality}]` shape. Each version represents one physical copy of the media.

- `category` is the subfolder under `root_path` where the copy lives. If your library uses subfolders (e.g. `UHD/`, `HD/`, `Anime/`), the folder name appears here. If you don't use subfolders at all, every version's `category` will be `"default"`.
- `quality` is the bucket the file's actual content falls into. For movies and shows, it's derived from the video's dimensions via your `quality_thresholds` (UHD / HD / SD or `null` when no bucket matches). For music and audiobooks, it's the file codec (FLAC, MP3, M4B, etc.).

### `movies.json`

```json
[
  {
    "title": "Close Encounters of the Third Kind",
    "year": 1977,
    "edition": null,
    "versions": [{ "category": "UHD", "quality": "UHD" }]
  },
  {
    "title": "The Crow",
    "year": 1994,
    "edition": null,
    "versions": [
      { "category": "UHD", "quality": "UHD" },
      { "category": "HD", "quality": "HD" }
    ]
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
      {
        "season": "1",
        "episode_count": 26,
        "versions": [{ "category": "HD", "quality": "HD" }]
      },
      {
        "season": "2",
        "episode_count": 26,
        "versions": [
          { "category": "UHD", "quality": "UHD" },
          { "category": "HD", "quality": "HD" }
        ]
      },
      {
        "season": "Specials",
        "episode_count": 4,
        "versions": [
          { "category": "HD", "quality": "HD" },
          { "category": "HD", "quality": "SD" }
        ]
      }
    ]
  }
]
```

**Reading a season's versions:** if a season has the same `category` listed twice with different `quality` values (like the `Specials` example above), it means episodes inside that one folder don't all share the same quality — some are HD-quality and some are SD-quality, all sitting in the `HD/` folder. This is only meaningful if your library is organized by quality. Seasons where every episode has the same quality collapse to a single version.

### `music.json`

```json
[
  {
    "artist": "Pink Floyd",
    "albums": [
      {
        "album": "The Wall",
        "track_count": 26,
        "versions": [{ "category": "Music", "quality": "FLAC" }]
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
    "versions": [{ "category": "Audible", "quality": "M4B" }]
  }
]
```

### `warnings.json` (shape shared across scan + validate)

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

Every warning has a per-type toggle in `rules/<type>.yaml` under `checks.warn_*`. All warnings ship enabled; set any toggle to `false` to silence one. To silence on specific paths only, use `ignored/<type>.yaml` instead — see [Configuration](CONFIG.md#ignoredtypeyaml).

The tables below show the human-readable issue text you'll see in `warnings.json` alongside what triggered it. Warnings marked _(validate pass)_ only appear after `npm run validate:<type>`.

### Movies

| Warning                                         | What it means                                                                                                                     |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Non-primary video file — may need re-encoding   | The file exists but isn't your preferred format (set via `primary_extension`)                                                     |
| No recognized video files found in folder       | A movie folder has no video files (just sidecars or nothing at all)                                                               |
| File name does not match Plex naming convention | The file won't be picked up by Plex correctly                                                                                     |
| Empty edition tag                               | The file has `{edition-}` with nothing after the dash                                                                             |
| Suspicious year                                 | The year is before 1888 or in the future — likely a typo                                                                          |
| File title does not match folder title          | The file name's title doesn't match its parent folder                                                                             |
| File year does not match folder year            | The file name's year doesn't match its parent folder                                                                              |
| Duplicate edition                               | Two files in the same folder claim the same `{edition-Name}`                                                                      |
| Movie exists in multiple qualities              | The same movie is in two quality folders (whitelist the combo via `acceptable_quality_combos`)                                    |
| Loose video files                               | Video files sitting directly in a category folder, not inside a `Movie Title (YEAR)/` folder — these are NOT added to the catalog |
| Unexpected subfolder in movie folder            | Subfolders found inside a `Movie Title (YEAR)/` folder — files inside them are NOT scanned                                        |
| Unexpected file                                 | A non-video file that isn't a recognized Plex sidecar                                                                             |
| Quality mismatch                                | The file's actual dimensions don't fit the bucket its category implies                                                            |
| TMDB no match _(validate pass)_                 | TMDB found nothing matching the title + year — possible typo or an obscure film                                                   |
| TMDB low confidence _(validate pass)_           | TMDB returned a match but the score was below the confidence threshold                                                            |
| TMDB year mismatch _(validate pass)_            | TMDB's release year disagrees with your folder year                                                                               |
| TMDB canonical title _(validate pass)_          | Your folder title differs from TMDB's filename-safe canonical — a rename suggestion                                               |

### Shows

| Warning                                           | What it means                                                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Non-primary video file — may need re-encoding     | The file exists but isn't your preferred format                                                                     |
| No recognized video files found in season folder  | A season folder has no video files                                                                                  |
| Show folder does not match Plex naming convention | Expected: `Show Title (YEAR)`                                                                                       |
| Season folder does not match expected format      | Expected: `Season 01`. Special-season names like `Specials` are whitelisted in `ignored_season_names`               |
| File name does not match Plex naming convention   | Expected: `Show Title (YEAR) - S01E01 - Episode Title` (episode title optional)                                     |
| File show/year does not match show folder         | The episode file's show name or year doesn't match its parent show folder                                           |
| File season does not match season folder          | The episode file is in the wrong season folder                                                                      |
| Potential missing episodes                        | A gap was detected in episode numbers within a season                                                               |
| Loose video files                                 | Episode files directly in a category folder or in a show folder (no `Season XX` wrapper) — NOT added to the catalog |
| Unexpected subfolder in season folder             | Subfolders found inside a `Season XX/` folder — files inside them are NOT scanned                                   |
| Unexpected file                                   | A non-video file that isn't a recognized Plex sidecar                                                               |
| Quality mismatch                                  | The file's actual dimensions don't fit the bucket its category implies                                              |
| Season exists in multiple qualities               | A single season has copies in two quality folders (whitelist via `acceptable_quality_combos`)                       |
| TMDB no match _(validate pass)_                   | TMDB found nothing matching the title + year                                                                        |
| TMDB low confidence _(validate pass)_             | TMDB match score below the confidence threshold                                                                     |
| TMDB episode count _(validate pass)_              | Your local season has fewer episodes than TMDB lists                                                                |
| TMDB canonical title _(validate pass)_            | Your folder title differs from TMDB's filename-safe canonical — a rename suggestion                                 |

### Music

| Warning                                          | What it means                                                                                              |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Non-primary audio file — may need re-encoding    | The file exists but isn't one of your preferred formats                                                    |
| No recognized audio files found in album folder  | An album folder has no audio files                                                                         |
| Track file name does not match naming convention | Expected: `01 - Track Name.ext` (single-disc) or `101 - Track Name.ext` (multi-disc)                       |
| Artist folder name does not match pattern        | The artist folder doesn't match `patterns.artist_folder` (default is permissive)                           |
| Album folder name does not match pattern         | The album folder doesn't match `patterns.album_folder` (default is permissive)                             |
| Suspicious characters in folder name             | Trailing whitespace, Windows-illegal characters, or a reserved name — these silently fragment Plex         |
| Potential missing tracks                         | A gap was detected in track numbers within an album (checked per-disc)                                     |
| Duplicate album                                  | The same artist + album appears in more than one category                                                  |
| Loose audio files                                | Audio files in a category folder root or in an artist folder (no album wrapper) — NOT added to the catalog |
| Unexpected subfolder in album folder             | Subfolders found inside an album — files inside them are NOT scanned                                       |
| Unexpected file                                  | A non-audio file that isn't a recognized sidecar                                                           |
| Inconsistent audio quality                       | The album mixes codecs (FLAC + MP3) or has a wide bitrate spread (>64 kbps)                                |
| Compilation detected                             | The album has multiple distinct AlbumArtist values — likely belongs under `Various Artists/`               |
| Folder/tag mismatch                              | The folder name disagrees with the embedded tag (artist or album)                                          |
| Missing tags                                     | Tracks are missing required embedded tags (title, album, or artist)                                        |
| Track number mismatch                            | The filename's track number disagrees with the embedded tag's track number                                 |

### Audiobooks

| Warning                                            | What it means                                                                                             |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Non-primary audio file — may need re-encoding      | The file exists but isn't one of your preferred formats                                                   |
| No recognized audio files found in book folder     | A book folder has no audio files                                                                          |
| Chapter file name does not match naming convention | Expected: `01 - Chapter Name.ext` (single-disc) or `101 - Chapter Name.ext` (multi-disc)                  |
| Potential missing chapters                         | A gap was detected in chapter numbers within a book (checked per-disc)                                    |
| Duplicate book                                     | The same book title appears in more than one category                                                     |
| Loose audio files                                  | Audio files in a category folder root or in an author folder (no book wrapper) — NOT added to the catalog |
| Unexpected subfolder in book folder                | Subfolders found inside a book — files inside them are NOT scanned                                        |
| Unexpected file                                    | A non-audio file that isn't a recognized sidecar                                                          |
