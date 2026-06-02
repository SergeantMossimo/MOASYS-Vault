# Folder Structure & Naming Conventions

MOASYS-Vault expects libraries to follow Plex's documented folder and file naming conventions. This is the authoritative reference for each media type — the regex defaults in the rules layer encode exactly what's described below.

> **Plex's official docs** for reference:
> [Naming Movie Files](https://support.plex.tv/articles/200381023-naming-movie-files/) ·
> [Naming TV Show Files](https://support.plex.tv/articles/naming-and-organizing-your-tv-show-files/) ·
> [Adding Music Media from Folders](https://support.plex.tv/articles/200265296-adding-music-media-from-folders/)

---

## Movies

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

---

## Shows

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

---

## Music

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

Per Plex's recommendation, for Various Artists albums, the embedded ID3 `Album Artist` tag should be `Various Artists` and per-track `Artist` should be the actual performer. The probe pass with ID3 reading enabled will flag mismatches.

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

---

## Audiobooks

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
