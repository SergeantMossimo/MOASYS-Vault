# Folder Structure & Naming Conventions

MOASYS-Vault follows Plex's documented folder and file naming conventions. This page is the day-to-day reference for what your library should look like and what the scanner flags when it doesn't.

If you already follow Plex's conventions, you're good — the defaults in `rules/<type>.yaml` match Plex exactly. If you want to tighten or loosen anything for your library, see [Configuration](CONFIG.md).

> **Plex's official docs** (for reference):
> [Naming Movie Files](https://support.plex.tv/articles/200381023-naming-movie-files/) ·
> [Naming TV Show Files](https://support.plex.tv/articles/naming-and-organizing-your-tv-show-files/) ·
> [Adding Music Media from Folders](https://support.plex.tv/articles/200265296-adding-music-media-from-folders/)

---

## Movies

**Folder layout:**

```text
<Movies>/
└── <Movie Title (YEAR)>/
    ├── <Movie Title (YEAR)>.<ext>
    └── <Movie Title (YEAR)> {edition-<Edition Name>}.<ext>
```

**Naming rules:**

- **Movie folder:** `Movie Title (YEAR)` — the year goes in parentheses
- **File name:** matches the folder name
- **Optional edition tag:** `{edition-<Name>}` between the year and the extension (e.g. `{edition-Director's Cut}`)

**Examples:**

```text
Movies/
├── The Crow (1994)/
│   └── The Crow (1994).mp4
└── Close Encounters of the Third Kind (1977)/
    ├── Close Encounters of the Third Kind (1977).mp4
    ├── Close Encounters of the Third Kind (1977) {edition-Director's Cut}.mp4
    └── Close Encounters of the Third Kind (1977) {edition-Special Edition}.mp4
```

**What gets flagged:**

- The file's year doesn't match the parent folder's year (`warn_year_mismatch`)
- The file's title doesn't match the parent folder's title, case-insensitive (`warn_title_mismatch`)
- An empty `{edition-}` tag with no value after the dash (`warn_empty_edition`)
- Two files in the same folder claim the same edition (`warn_duplicate_edition`)
- The same movie appears in more than one quality folder — _only fires if your `categories` are organized by quality_ — unless the combination is whitelisted in `acceptable_quality_combos` (`warn_multi_quality`)
- Subfolders inside a movie folder (`warn_extra_subfolders`). **Heads up:** any video files inside those subfolders are NOT added to the catalog — the scanner only reads direct children of the movie folder. You'll see the subfolder name in `warnings.json` so you know what got skipped.

---

## Shows

**Folder layout:**

```text
<Shows>/
└── <Show Title (YEAR)>/
    ├── Season 01/
    │   ├── <Show Title (YEAR)> - S01E01 - <Episode Title>.<ext>
    │   ├── <Show Title (YEAR)> - S01E02-E03 - <Episode Title>.<ext>
    │   └── ...
    └── Specials/
        └── <Show Title (YEAR)> - S00E01 - <Episode Title>.<ext>
```

**Naming rules:**

- **Show folder:** `Show Title (YEAR)` — year in parentheses
- **Season folder:** `Season XX` — two-digit zero-padded number (`Season 01`, not `Season 1`)
- **Episode file:** `Show Title (YEAR) - S01E01 - Episode Title.<ext>`
  - The trailing `- Episode Title` portion is optional
  - Multi-episode files use `S01E01-E02`

**Special seasons:**

Plex's `Specials` convention (behind-the-scenes, pilots, etc.) is supported via `rules/shows.yaml`. Folders listed here bypass the `Season XX` regex check and are accepted as-is:

```yaml
ignored_season_names:
  - Specials
  - Champion of Champions
```

**Examples:**

```text
Shows/
└── Star Trek Enterprise (2001)/
    ├── Season 01/
    │   ├── Star Trek Enterprise (2001) - S01E01-E02 - Broken Bow Part 1 And 2.mp4
    │   ├── Star Trek Enterprise (2001) - S01E03 - Flight or Flight.mp4
    │   └── Star Trek Enterprise (2001) - S01E04 - Strange New World.mp4
    └── Specials/
        └── Star Trek Enterprise (2001) - S00E01 - Behind the Scenes.mp4
```

**What gets flagged:**

- Season folder isn't two-digit zero-padded (e.g. `Season 1` instead of `Season 01`) and isn't in `ignored_season_names` (`warn_bad_season_folder`)
- File's show name or year doesn't match the parent show folder (`warn_show_year_mismatch`)
- File's season number doesn't match the parent season folder (`warn_season_mismatch`)
- Gaps in episode numbers within a season — multi-episode files (`S01E01-E02`) count as 2 (`warn_episode_gaps`)
- Episode files placed directly in a show folder, without a `Season XX` wrapper (`warn_loose_files`) — those files are NOT added to the catalog
- Subfolders inside a season folder (`warn_extra_subfolders`). **Same heads-up as movies:** files inside those subfolders are NOT scanned. You'll see the subfolder name in `warnings.json`.

---

## Music

Music follows Plex's `Artist / Album / Track` layout, quoted directly from their docs:

> Content should have each artist in their own directory, with each album as a separate subdirectory within it.
>
> `Music/ArtistName/AlbumName/TrackNumber - TrackName.ext`
>
> For albums that span more than one disc, you simply prepend the disc number to the front of the track number. So, track two on disc three would be `302 - TrackName.ext`.

**Folder layout:**

```text
<Music>/
└── <Artist Name>/
    └── <Album Name>/
        ├── 01 - Track Name.<ext>           ← single-disc
        ├── 101 - Track Name.<ext>          ← multi-disc: disc 1, track 1
        └── 201 - Track Name.<ext>          ← multi-disc: disc 2, track 1
```

**Naming rules:**

- **Artist folder:** any name. Plex doesn't enforce a format; the default regex matches anything non-empty
- **Album folder:** any name. Plex doesn't enforce a format (no year required — the year lives in the embedded music tag)
- **Track file (single-disc):** `<2-digit track> - <Track Name>.<ext>` — e.g. `01 - In the Flesh.flac`
- **Track file (multi-disc):** `<disc><2-digit track> - <Track Name>.<ext>` — e.g. `101 - In the Flesh.flac` (disc 1, track 1)

The scanner tries the multi-disc pattern first (it's more specific) and falls back to single-disc.

**Compilations and multi-artist albums:**

Quoting Plex verbatim:

> Sometimes, you may have compilation albums where there are tracks by multiple different artists. This is common for soundtracks or "Best of the 80s" type albums, for instance. The common way to handle this is to use an artist with the literal name "Various Artists" and to have those albums under that artist.

So:

- **Single-composer scores** (e.g. Halo OSTs by Marty O'Donnell and Michael Salvatori): use a comma-separated artist folder like `Marty O'Donnell, Michael Salvatori`. This matches how audiobooks handle multi-author folders and avoids the slash character, which isn't legal in folder names.
- **Multi-artist compilations** (e.g. Guardians of the Galaxy: Awesome Mix, "Best of the 90s", mixed-artist soundtracks): use the literal `Various Artists` as the artist folder.

For Various Artists albums, the embedded `Album Artist` tag should be `Various Artists` and the per-track `Artist` should be the actual performer. The scanner flags mismatches via `warn_folder_tag_mismatch`.

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
└── Marty O'Donnell, Michael Salvatori/      ← two composers, comma-separated
    └── Halo Original Soundtrack/
        ├── 01 - Truth and Reconciliation Suite.flac
        └── ...
```

**What gets flagged:**

- Track file name doesn't match any pattern (`warn_bad_track_name`)
- Track numbers aren't zero-padded to 2 digits (e.g. `1` instead of `01`) — falls under `warn_bad_track_name`
- Trailing whitespace or Windows-illegal characters in artist/album folders (`warn_suspicious_folder_chars`) — these silently fragment your Plex library, so the scanner flags them aggressively
- Gaps in track numbers within a disc (`warn_track_gaps`)
- The same artist + album combination appears in more than one category (`warn_duplicate_album`)
- Audio files placed loose in a category folder OR in an artist folder without an album wrapper (`warn_loose_files`) — those files are NOT added to the catalog
- The embedded music tag disagrees with the folder name (`warn_folder_tag_mismatch`)

A few gotchas worth knowing:

- The scanner doesn't recurse into subfolders inside an album — multi-disc albums must use the flat disc-prefixed convention (`101`, `201`, etc.)
- The disc number prefix is greedy: a file named `100 - Track` parses as disc 1, track 00 (because the multi-disc pattern is tried first)

---

## Audiobooks

MOASYS-Vault uses an `Author / Book / Chapter` structure that mirrors music's Artist / Album / Track shape. Plex doesn't have a dedicated audiobook agent, but this music-style structure works for properly organized audiobooks.

**Folder layout:**

```text
<Audiobooks>/
└── <Author Name>/
    └── <Book Title>/
        ├── 01 - Chapter Name.<ext>
        └── 02 - Chapter Name.<ext>
```

**Naming rules:**

- **Author folder:** single author (`J.R.R. Tolkien`) or multi-author — see below
- **Book folder:** the book title (no year required)
- **Chapter file:** same convention as music tracks (`01 - Chapter` single-disc, `101 - Chapter` for multi-disc)

**Multi-author folders:**

The author folder name is parsed into a list of individual authors stored in your catalog JSON. Three formats are supported:

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

**What gets flagged:**

- Chapter file name doesn't match any pattern (`warn_bad_chapter_name`)
- Gaps in chapter numbers within a disc (`warn_chapter_gaps`)
- The same book title appears in more than one category (`warn_duplicate_book`) — books are keyed by **title only**, so different authors with the same title will collide
- Audio files at unexpected nesting (`warn_loose_files`)
- Subfolders inside a book folder (`warn_extra_subfolders`)

A few gotchas worth knowing:

- Books are keyed by title only — the same title by different authors collides in the catalog. Intentional, but worth knowing.
- No quality dimension check applies to audiobooks — spoken word at modest bitrates is fine. Codec and bitrate are still collected during the file inspection pass.
- The same flat / disc-prefixed convention applies for multi-disc books — no per-disc subfolders.
