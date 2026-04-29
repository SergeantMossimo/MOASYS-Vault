"""
media/movies.py
---------------
Movie-specific parsing, serialization, and DB logic for MOASYS-Vault.

Expected Plex folder structure:
  <quality_folder>/
    <Movie Title (YEAR)>/
      <Movie Title (YEAR)>.mp4
      <Movie Title (YEAR)> {edition-Edition Name}.mp4
"""

import os
import re
import json
from datetime import datetime

# ─────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────

EARLIEST_FILM_YEAR = 1888                  # Roundhay Garden Scene — earliest known film
CURRENT_YEAR       = datetime.now().year   # Evaluated once at startup

# ─────────────────────────────────────────────
# Regex patterns
# ─────────────────────────────────────────────

# Matches Plex-style movie folder names: "The Crow (1994)"
# Group 1 = title, Group 2 = year
FOLDER_PATTERN = re.compile(r'^(.+)\s\((\d{4})\)$')

# Matches Plex-style movie file stems, with an optional edition tag:
#   "The Crow (1994)"
#   "The Crow (1994) {edition-Director's Cut}"
#   "The Crow (1994) {edition-}"   ← empty edition, caught as a warning
# Group 1 = title, Group 2 = year, Group 3 = edition (or None if no tag)
# Note: [^}]* allows zero characters so empty {edition-} is captured rather than rejected
FILE_PATTERN = re.compile(r'^(.+)\s\((\d{4})\)(?:\s\{edition-([^}]*)\})?$')


# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────

def _is_video(filename, media_config):
    """Return True if the file extension is in the configured video_extensions list."""
    _, ext = os.path.splitext(filename)
    return ext.lower() in [e.lower() for e in media_config["video_extensions"]]

def _get_primary_extensions(media_config):
    """
    Return the primary extension(s) as a lowercase list.
    config value must be a list e.g. [".mp4"] or [".mp4", ".mkv"].
    """
    return [e.lower() for e in media_config["primary_extension"]]

def _is_primary(filename, media_config):
    """Return True if the file extension matches any configured primary_extension."""
    _, ext = os.path.splitext(filename)
    return ext.lower() in _get_primary_extensions(media_config)

def _format_primary_exts(media_config):
    """
    Return a human-readable string of primary extensions for warning messages.
    e.g. ".mp4" -> "Non-.MP4"
         [".mp4", ".mkv"] -> "Non-.MP4/.MKV"
    """
    exts = _get_primary_extensions(media_config)
    return "Non-" + "/".join(e.upper() for e in exts)

def _parse_folder(name):
    """
    Parse a Plex movie folder name into (title, year).
    Returns None if the name doesn't match the expected format.
    Example: "The Crow (1994)" -> ("The Crow", 1994)
    """
    m = FOLDER_PATTERN.match(name)
    return (m.group(1).strip(), int(m.group(2))) if m else None

def _parse_file_stem(stem):
    """
    Parse a Plex movie file stem (filename without extension) into (title, year, edition).
    Returns None if the stem doesn't match the expected format.

    edition is:
      None  — no {edition-...} tag present
      ""    — tag present but empty: {edition-}
      str   — normal edition name e.g. "Director's Cut"
    """
    m = FILE_PATTERN.match(stem)
    if m:
        edition_raw = m.group(3)
        if edition_raw is None:
            edition = None             # No edition tag at all
        elif edition_raw.strip() == "":
            edition = ""               # Empty edition tag: {edition-}
        else:
            edition = edition_raw.strip()
        return (m.group(1).strip(), int(m.group(2)), edition)
    return None

def _make_key(title, year, edition):
    """
    Build a unique dictionary key for a movie record.
    Lowercased so "The Crow" and "the crow" are treated as the same title.
    This key is used to merge duplicate entries across quality folders.
    """
    return (title.lower(), year, (edition or "").lower())


# ─────────────────────────────────────────────
# Scanner (called by core/scanner.py)
# ─────────────────────────────────────────────

def scan_quality_folder(quality_path, folder_name, tag, media_config, warnings):
    """
    Walk one quality folder (e.g. UHD/) and return a dict of movie records.
    Called once per quality folder by core/scanner.py.

    Returns: { key: { title, year, edition, qualities: set() } }
    The qualities set starts with just this folder's tag (e.g. {"UHD"}).
    core/scanner.py merges records from multiple quality folders together.
    """
    records = {}

    # Each subfolder inside a quality folder should be a movie folder
    for movie_folder in os.scandir(quality_path):
        if not movie_folder.is_dir():
            continue   # Skip any loose files sitting in the quality folder

        folder_rel    = os.path.join(folder_name, movie_folder.name)   # e.g. "UHD/The Crow (1994)"
        parsed_folder = _parse_folder(movie_folder.name)

        # Read all files inside this movie folder
        try:
            all_files = list(os.scandir(movie_folder.path))
        except PermissionError:
            warnings.add(folder_rel, "Permission denied reading folder")
            continue

        # Separate files into video and non-video, then primary and non-primary
        video_files   = [f for f in all_files if _is_video(f.name, media_config)]
        non_primary   = [f for f in video_files if not _is_primary(f.name, media_config)]
        primary_files = [f for f in video_files if _is_primary(f.name, media_config)]

        # Warning: folder has no video files at all (maybe only .nfo or .jpg files)
        if not video_files:
            warnings.add(folder_rel, "No recognized video files found in folder")
            continue

        # Warning: video files found in a non-primary format (e.g. .mkv when primary is .mp4)
        for f in non_primary:
            _, ext = os.path.splitext(f.name)
            warnings.add(
                os.path.join(folder_rel, f.name),
                _format_primary_exts(media_config) + " video file — may need re-encoding",
                extension=ext.lower()
            )

        # Track seen editions within this folder to detect duplicates
        # Key = lowercased edition name, Value = filename of first file with that edition
        seen_editions = {}

        # Process each primary video file in the folder
        for vf in primary_files:
            stem, _ = os.path.splitext(vf.name)   # Strip the .mp4 extension
            parsed  = _parse_file_stem(stem)

            # Warning: file name doesn't follow Plex naming convention
            if not parsed:
                warnings.add(
                    os.path.join(folder_rel, vf.name),
                    "File name does not match Plex naming convention"
                )
                continue

            file_title, file_year, edition = parsed

            # Warning: empty edition tag found — {edition-} with nothing after the dash
            if edition == "":
                warnings.add(
                    os.path.join(folder_rel, vf.name),
                    "Empty edition tag found — {edition-} has no value after the dash"
                )
                edition = None   # Treat as no edition so the file still gets catalogued

            # Warning: suspicious year (before cinema existed, or in the future)
            if file_year < EARLIEST_FILM_YEAR or file_year > CURRENT_YEAR:
                warnings.add(
                    os.path.join(folder_rel, vf.name),
                    f"Suspicious year ({file_year}) — expected between {EARLIEST_FILM_YEAR} and {CURRENT_YEAR}"
                )

            if not parsed_folder:
                # Warning: the parent folder name doesn't follow Plex convention
                warnings.add(folder_rel, "Folder name does not match Plex naming convention")
            else:
                folder_title, folder_year = parsed_folder

                # Warning: file title doesn't match the folder it lives in
                if file_title.lower() != folder_title.lower():
                    warnings.add(
                        os.path.join(folder_rel, vf.name),
                        f"File title '{file_title}' does not match folder title '{folder_title}'"
                    )

                # Warning: file year doesn't match the folder year (checked independently of title)
                if file_year != folder_year:
                    warnings.add(
                        os.path.join(folder_rel, vf.name),
                        f"File year ({file_year}) does not match folder year ({folder_year}) in '{movie_folder.name}'"
                    )

            # Warning: two files in the same folder claim the same edition
            edition_key = (edition or "").lower()
            if edition_key in seen_editions:
                warnings.add(
                    os.path.join(folder_rel, vf.name),
                    f"Duplicate edition — another file in this folder already claims "
                    f"{'no edition' if not edition else repr(edition)}: '{seen_editions[edition_key]}'"
                )
            else:
                seen_editions[edition_key] = vf.name   # Record this edition as seen

            # Add the movie to records, or update an existing entry
            key = _make_key(file_title, file_year, edition)
            if key not in records:
                records[key] = {
                    "title":     file_title,
                    "year":      file_year,
                    "edition":   edition,
                    "qualities": set()   # set() automatically handles duplicates
                }
            records[key]["qualities"].add(tag)   # e.g. add "UHD" to this movie's quality set

    return records


# ─────────────────────────────────────────────
# Quality order
# ─────────────────────────────────────────────

# Populated at startup by init_quality_order() so qualities always appear
# in the same order as defined in config.json (e.g. UHD before HD before SD)
_QUALITY_ORDER = []

def init_quality_order(media_folders):
    """Called by scan.py at startup to set the canonical quality sort order."""
    global _QUALITY_ORDER
    _QUALITY_ORDER = [qf["tag"] for qf in media_folders]

def _quality_order(qualities_set):
    """Convert a set of quality tags to a sorted list matching config order."""
    return [q for q in _QUALITY_ORDER if q in qualities_set]


# ─────────────────────────────────────────────
# Serializer (called by core/scanner.py)
# ─────────────────────────────────────────────

def serialize(records):
    """
    Convert the internal records dict into a sorted list of dicts for JSON output.
    JSON doesn't support Python sets, so qualities is converted to a sorted list here.
    Records are sorted alphabetically by title, then year, then edition.
    """
    return sorted(
        [
            {
                "title":     r["title"],
                "year":      r["year"],
                "edition":   r["edition"],
                "qualities": _quality_order(r["qualities"])
            }
            for r in records.values()
        ],
        key=lambda x: (x["title"].lower(), x["year"], x["edition"] or "")
    )


# ─────────────────────────────────────────────
# DB writer (called by core/scanner.py)
# ─────────────────────────────────────────────

def write_db(conn, records):
    """
    Write movie records to the SQLite database.

    Uses an upsert pattern (INSERT ... ON CONFLICT DO UPDATE) so re-running
    the scanner updates existing rows rather than erroring on duplicates.
    The UNIQUE constraint on (title, year, edition) is what triggers the conflict.
    """
    cur = conn.cursor()

    # Create the movies table if it doesn't already exist
    cur.execute("""
        CREATE TABLE IF NOT EXISTS movies (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            title     TEXT    NOT NULL,
            year      INTEGER NOT NULL,
            edition   TEXT,
            qualities TEXT    NOT NULL,
            UNIQUE(title, year, edition)
        )
    """)

    for r in records.values():
        # SQLite doesn't have a list type, so qualities is stored as a JSON string
        # e.g. '["UHD", "HD"]' — parse it with json.loads() when reading
        qualities_json = json.dumps(_quality_order(r["qualities"]))
        cur.execute("""
            INSERT INTO movies (title, year, edition, qualities)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(title, year, edition) DO UPDATE SET
                qualities = excluded.qualities
        """, (r["title"], r["year"], r["edition"], qualities_json))