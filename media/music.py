"""
media/music.py
--------------
Music-specific parsing, serialization, and DB logic for MOASYS-Vault.

Expected Plex folder structure:
  <media_folder>/
    <Artist Name>/
      <Album Name>/
        01 - Track Name.flac
        101 - Track Name.flac     ← multi-disc: disc 1, track 1
        201 - Track Name.flac     ← multi-disc: disc 2, track 1
"""

import os
import re
import json

# ─────────────────────────────────────────────
# Regex patterns
# ─────────────────────────────────────────────

# Matches standard single-disc track file stems: "01 - Track Name"
# Group 1 = track number (2 digits), Group 2 = track name
SINGLE_DISC_PATTERN = re.compile(r'^(\d{2})\s-\s(.+)$')

# Matches multi-disc track file stems: "101 - Track Name", "302 - Track Name"
# Group 1 = disc number, Group 2 = track number (2 digits), Group 3 = track name
MULTI_DISC_PATTERN = re.compile(r'^(\d+)(\d{2})\s-\s(.+)$')


# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────

def _is_audio(filename, media_config):
    """Return True if the file extension is in the configured audio_extensions list."""
    _, ext = os.path.splitext(filename)
    return ext.lower() in [e.lower() for e in media_config["audio_extensions"]]

def _get_primary_extensions(media_config):
    """
    Return the primary extension(s) as a lowercase list.
    config value must be a list e.g. [".flac"] or [".flac", ".mp3"].
    """
    return [e.lower() for e in media_config["primary_extension"]]

def _is_primary(filename, media_config):
    """Return True if the file extension matches any configured primary_extension."""
    _, ext = os.path.splitext(filename)
    return ext.lower() in _get_primary_extensions(media_config)

def _format_primary_exts(media_config):
    """
    Return a human-readable string of primary extensions for warning messages.
    e.g. [".flac"] -> "Non-.FLAC"
         [".flac", ".mp3"] -> "Non-.FLAC/.MP3"
    """
    exts = _get_primary_extensions(media_config)
    return "Non-" + "/".join(e.upper() for e in exts)

def _parse_track_stem(stem):
    """
    Parse a track file stem into (disc_number, track_number, track_name).
    Handles both single-disc (01 - Name) and multi-disc (101 - Name) formats.

    Returns (disc, track, name) or None if the stem doesn't match either format.

    Single-disc files are treated as disc 1:
      "01 - In the Flesh"  -> (1, 1, "In the Flesh")
      "12 - Comfortably Numb" -> (1, 12, "Comfortably Numb")

    Multi-disc files extract the disc from the leading digit(s):
      "101 - In the Flesh"  -> (1, 1, "In the Flesh")
      "302 - Track Name"    -> (3, 2, "Track Name")
    """
    # Try multi-disc first — it's more specific
    m = MULTI_DISC_PATTERN.match(stem)
    if m:
        disc  = int(m.group(1))
        track = int(m.group(2))
        name  = m.group(3).strip()
        return disc, track, name

    # Fall back to single-disc
    m = SINGLE_DISC_PATTERN.match(stem)
    if m:
        track = int(m.group(1))
        name  = m.group(2).strip()
        return 1, track, name   # Treat single-disc as disc 1

    return None

def _make_artist_key(artist):
    """Unique key for an artist — lowercased to handle case differences."""
    return artist.lower()

def _make_album_key(artist, album):
    """Unique key for an album — lowercased artist + album name."""
    return (artist.lower(), album.lower())

def _find_track_gaps(track_numbers):
    """
    Given a list of track numbers for a single disc, return any missing numbers.
    Example: [1, 2, 4] -> [3]
    """
    if not track_numbers:
        return []
    full_range = set(range(min(track_numbers), max(track_numbers) + 1))
    return sorted(full_range - set(track_numbers))


# ─────────────────────────────────────────────
# Scanner (called by core/scanner.py)
# ─────────────────────────────────────────────

def scan_quality_folder(quality_path, folder_name, tag, media_config, warnings):
    """
    Walk one media folder (e.g. Music/, Soundtracks/) and return a dict of artist records.
    Called once per media_folder entry by core/scanner.py.

    Returns:
    {
      artist_key: {
        artist,
        albums: {
          album_key: {
            album, track_count, qualities: set(), media_type: set()
          }
        }
      }
    }
    """
    records = {}

    # Each subfolder inside the media folder should be an artist folder
    for artist_entry in os.scandir(quality_path):
        if not artist_entry.is_dir():
            continue   # Skip any loose files in the media folder

        artist_name = artist_entry.name
        artist_rel  = os.path.join(folder_name, artist_name)
        artist_key  = _make_artist_key(artist_name)

        # Read album folders inside this artist folder
        try:
            album_entries = list(os.scandir(artist_entry.path))
        except PermissionError:
            warnings.add(artist_rel, "Permission denied reading artist folder")
            continue

        for album_entry in album_entries:
            if not album_entry.is_dir():
                continue   # Skip loose files (e.g. artist artwork)

            album_name = album_entry.name
            album_rel  = os.path.join(artist_rel, album_name)
            album_key  = _make_album_key(artist_name, album_name)

            # Read track files inside this album folder
            try:
                all_files = list(os.scandir(album_entry.path))
            except PermissionError:
                warnings.add(album_rel, "Permission denied reading album folder")
                continue

            audio_files   = [f for f in all_files if _is_audio(f.name, media_config)]
            non_primary   = [f for f in audio_files if not _is_primary(f.name, media_config)]
            primary_files = [f for f in audio_files if _is_primary(f.name, media_config)]

            # Warning: no audio files at all in this album folder
            if not audio_files:
                warnings.add(album_rel, "No recognized audio files found in album folder")
                continue

            # Warning: non-primary audio files present (e.g. .mp3 when primary is .flac)
            for f in non_primary:
                _, ext = os.path.splitext(f.name)
                warnings.add(
                    os.path.join(album_rel, f.name),
                    f"{_format_primary_exts(media_config)} audio file — may need re-encoding",
                    extension=ext.lower()
                )

            # Collect qualities from all audio file extensions (not just primary)
            # e.g. if album has both .flac and .mp3, qualities = {"FLAC", "MP3"}
            qualities = set()
            for f in audio_files:
                _, ext = os.path.splitext(f.name)
                qualities.add(ext.lstrip(".").upper())   # ".flac" -> "FLAC"

            # Track numbers per disc for gap detection: { disc_num: [track_nums] }
            disc_tracks = {}
            track_count = 0

            for vf in audio_files:
                stem, _ = os.path.splitext(vf.name)
                parsed  = _parse_track_stem(stem)

                # Warning: file name doesn't match Plex naming convention
                if not parsed:
                    warnings.add(
                        os.path.join(album_rel, vf.name),
                        "Track file name does not match Plex naming convention — "
                        "expected: 01 - Track Name.ext or 101 - Track Name.ext (multi-disc)"
                    )
                    continue

                disc, track, _ = parsed
                track_count += 1

                # Group track numbers by disc for per-disc gap detection
                if disc not in disc_tracks:
                    disc_tracks[disc] = []
                disc_tracks[disc].append(track)

            # Warning: gaps in track numbers, checked per disc independently
            for disc_num, tracks in sorted(disc_tracks.items()):
                gaps = _find_track_gaps(tracks)
                if gaps:
                    gap_str  = ", ".join(f"Track {g:02d}" for g in gaps)
                    disc_str = f"Disc {disc_num}" if len(disc_tracks) > 1 else "Album"
                    warnings.add(
                        album_rel,
                        f"Potential missing tracks in {disc_str}: {gap_str}"
                    )

            # Add / merge album into records
            if artist_key not in records:
                records[artist_key] = {
                    "artist": artist_name,
                    "albums": {}
                }

            if album_key not in records[artist_key]["albums"]:
                records[artist_key]["albums"][album_key] = {
                    "album":       album_name,
                    "track_count": track_count,
                    "qualities":   qualities,
                    "media_type":  set()
                }
            else:
                # Album already exists from a previous media folder — merge and warn
                existing = records[artist_key]["albums"][album_key]
                existing["qualities"].update(qualities)
                existing["track_count"] = max(existing["track_count"], track_count)

            # Warning: same album found in more than one media folder
            if len(records[artist_key]["albums"][album_key]["media_type"]) > 1:
                existing_tags = ", ".join(sorted(records[artist_key]["albums"][album_key]["media_type"]))
                warnings.add(
                    os.path.join(folder_name, artist_name, album_name),
                    f"Duplicate album found in multiple media folders: {existing_tags}"
                )

    return records


# ─────────────────────────────────────────────
# Merge (called by core/scanner.py)
# ─────────────────────────────────────────────

def merge(existing, new_records):
    """
    Merge new_records into existing records across media folders.
    Music needs a custom merge because albums have nested qualities and media_type sets.
    Also fires a warning if the same album appears in more than one media folder.
    """
    for artist_key, new_artist in new_records.items():
        if artist_key not in existing:
            existing[artist_key] = new_artist
        else:
            for album_key, new_album in new_artist["albums"].items():
                if album_key not in existing[artist_key]["albums"]:
                    existing[artist_key]["albums"][album_key] = new_album
                else:
                    # Merge qualities and media_type sets
                    existing[artist_key]["albums"][album_key]["qualities"].update(
                        new_album["qualities"]
                    )
                    existing[artist_key]["albums"][album_key]["media_type"].update(
                        new_album["media_type"]
                    )
                    existing[artist_key]["albums"][album_key]["track_count"] = max(
                        existing[artist_key]["albums"][album_key]["track_count"],
                        new_album["track_count"]
                    )


# ─────────────────────────────────────────────
# Serializer (called by core/scanner.py)
# ─────────────────────────────────────────────

_QUALITY_ORDER  = []   # Not used for music — qualities come from file extensions
_MEDIA_TYPE_ORDER = [] # Order media_type tags as defined in config

def init_quality_order(media_folders):
    """Called by scan.py at startup — stores media folder tag order for media_type sorting."""
    global _MEDIA_TYPE_ORDER
    _MEDIA_TYPE_ORDER = [mf["tag"] for mf in media_folders]

def _order_media_type(media_type_set):
    """Sort media_type tags in config-defined order."""
    return [t for t in _MEDIA_TYPE_ORDER if t in media_type_set]

def _order_qualities(qualities_set):
    """Sort quality strings alphabetically — no config order for music qualities."""
    return sorted(qualities_set)

def serialize(records):
    """
    Convert the internal records dict into a sorted list of dicts for JSON output.
    Artists sorted alphabetically, albums sorted alphabetically within each artist.
    """
    output = []
    for artist in sorted(records.values(), key=lambda a: a["artist"].lower()):
        albums = sorted(artist["albums"].values(), key=lambda a: a["album"].lower())
        output.append({
            "artist": artist["artist"],
            "albums": [
                {
                    "album":       a["album"],
                    "track_count": a["track_count"],
                    "qualities":   _order_qualities(a["qualities"]),
                    "media_type":  _order_media_type(a["media_type"])
                }
                for a in albums
            ]
        })
    return output


# ─────────────────────────────────────────────
# DB writer (called by core/scanner.py)
# ─────────────────────────────────────────────

def write_db(conn, records):
    """
    Write music records to SQLite using two related tables:
      - artists: one row per artist
      - albums:  one row per album, linked to its artist via artist_id
    qualities and media_type are stored as JSON strings.
    """
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS artists (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT    NOT NULL,
            UNIQUE(name)
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS albums (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            artist_id   INTEGER NOT NULL REFERENCES artists(id),
            album       TEXT    NOT NULL,
            track_count INTEGER NOT NULL,
            qualities   TEXT    NOT NULL,   -- JSON string e.g. '["FLAC", "MP3"]'
            media_type  TEXT    NOT NULL,   -- JSON string e.g. '["Music"]'
            UNIQUE(artist_id, album)
        )
    """)

    for artist in records.values():
        cur.execute("""
            INSERT INTO artists (name)
            VALUES (?)
            ON CONFLICT(name) DO NOTHING
        """, (artist["artist"],))

        cur.execute("SELECT id FROM artists WHERE name = ?", (artist["artist"],))
        artist_id = cur.fetchone()[0]

        for album in artist["albums"].values():
            qualities_json  = json.dumps(_order_qualities(album["qualities"]))
            media_type_json = json.dumps(_order_media_type(album["media_type"]))
            cur.execute("""
                INSERT INTO albums (artist_id, album, track_count, qualities, media_type)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(artist_id, album) DO UPDATE SET
                    track_count = excluded.track_count,
                    qualities   = excluded.qualities,
                    media_type  = excluded.media_type
            """, (artist_id, album["album"], album["track_count"], qualities_json, media_type_json))