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

# ─────────────────────────────────────────────
# Regex
# ─────────────────────────────────────────────

# Matches folder names: "The Crow (1994)"
FOLDER_PATTERN = re.compile(r'^(.+)\s\((\d{4})\)$')

# Matches file stems with optional edition:
#   "The Crow (1994)"
#   "Close Encounters of the Third Kind (1977) {edition-Director's Cut}"
FILE_PATTERN = re.compile(r'^(.+)\s\((\d{4})\)(?:\s\{edition-([^}]+)\})?$')


# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────

def _is_video(filename, media_config):
    _, ext = os.path.splitext(filename)
    return ext.lower() in [e.lower() for e in media_config["video_extensions"]]

def _is_primary(filename, media_config):
    _, ext = os.path.splitext(filename)
    return ext.lower() == media_config["primary_extension"].lower()

def _parse_folder(name):
    """Returns (title, year) or None."""
    m = FOLDER_PATTERN.match(name)
    return (m.group(1).strip(), int(m.group(2))) if m else None

def _parse_file_stem(stem):
    """Returns (title, year, edition_or_None) or None."""
    m = FILE_PATTERN.match(stem)
    if m:
        return (
            m.group(1).strip(),
            int(m.group(2)),
            m.group(3).strip() if m.group(3) else None
        )
    return None

def _make_key(title, year, edition):
    return (title.lower(), year, (edition or "").lower())


# ─────────────────────────────────────────────
# Scanner (called by core/scanner.py)
# ─────────────────────────────────────────────

def scan_quality_folder(quality_path, folder_name, tag, media_config, warnings):
    """
    Walk one quality folder (e.g. UHD/) and return a dict of movie records.
    { key: { title, year, edition, qualities: set } }
    """
    records = {}

    for movie_folder in os.scandir(quality_path):
        if not movie_folder.is_dir():
            continue

        folder_rel    = os.path.join(folder_name, movie_folder.name)
        parsed_folder = _parse_folder(movie_folder.name)

        # Read folder contents
        try:
            all_files = list(os.scandir(movie_folder.path))
        except PermissionError:
            warnings.add(folder_rel, "Permission denied reading folder")
            continue

        video_files   = [f for f in all_files if _is_video(f.name, media_config)]
        non_primary   = [f for f in video_files if not _is_primary(f.name, media_config)]
        primary_files = [f for f in video_files if _is_primary(f.name, media_config)]

        # Warning: no video files at all
        if not video_files:
            warnings.add(folder_rel, "No recognized video files found in folder")
            continue

        # Warning: non-primary video files (need re-encoding)
        for f in non_primary:
            _, ext = os.path.splitext(f.name)
            warnings.add(
                os.path.join(folder_rel, f.name),
                f"Non-{media_config['primary_extension'].upper()} video file — may need re-encoding",
                extension=ext.lower()
            )

        # Process each primary video file
        for vf in primary_files:
            stem, _ = os.path.splitext(vf.name)
            parsed  = _parse_file_stem(stem)

            # Warning: file name doesn't match Plex convention
            if not parsed:
                warnings.add(
                    os.path.join(folder_rel, vf.name),
                    "File name does not match Plex naming convention"
                )
                continue

            file_title, file_year, edition = parsed

            # Warning: folder name doesn't match Plex convention
            if not parsed_folder:
                warnings.add(folder_rel, "Folder name does not match Plex naming convention")
            else:
                folder_title, folder_year = parsed_folder
                if file_title.lower() != folder_title.lower() or file_year != folder_year:
                    warnings.add(
                        os.path.join(folder_rel, vf.name),
                        f"File title/year '{file_title} ({file_year})' "
                        f"does not match folder '{movie_folder.name}'"
                    )

            # Add / merge record
            key = _make_key(file_title, file_year, edition)
            if key not in records:
                records[key] = {
                    "title":     file_title,
                    "year":      file_year,
                    "edition":   edition,
                    "qualities": set()
                }
            records[key]["qualities"].add(tag)

    return records


# ─────────────────────────────────────────────
# Serializer (called by core/scanner.py)
# ─────────────────────────────────────────────

def serialize(records):
    """Return a sorted list of dicts ready for JSON output."""
    from media.movies import _quality_order
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

# Populated at runtime from config via init_quality_order()
_QUALITY_ORDER = []

def init_quality_order(quality_folders):
    global _QUALITY_ORDER
    _QUALITY_ORDER = [qf["tag"] for qf in quality_folders]

def _quality_order(qualities_set):
    return [q for q in _QUALITY_ORDER if q in qualities_set]


# ─────────────────────────────────────────────
# DB writer (called by core/scanner.py)
# ─────────────────────────────────────────────

def write_db(conn, records):
    cur = conn.cursor()
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
        qualities_json = json.dumps(_quality_order(r["qualities"]))
        cur.execute("""
            INSERT INTO movies (title, year, edition, qualities)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(title, year, edition) DO UPDATE SET
                qualities = excluded.qualities
        """, (r["title"], r["year"], r["edition"], qualities_json))
