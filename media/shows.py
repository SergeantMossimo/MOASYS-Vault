"""
media/shows.py
--------------
Show-specific parsing, serialization, and DB logic for MOASYS-Vault.

Expected Plex folder structure:
  <quality_folder>/
    <Show Title (YEAR)>/
      Season 01/
        <Show Title (YEAR)> - S01E01 - Episode Title.mp4
        <Show Title (YEAR)> - S01E01-E02 - Multi Episode Title.mp4
      Specials/              ← named seasons defined in ignored_season_names config
        <Show Title (YEAR)> - S00E01 - Special Title.mp4
"""

import os
import re
import json

# ─────────────────────────────────────────────
# Regex patterns
# ─────────────────────────────────────────────

# Matches Plex-style show folder names: "Star Trek Enterprise (2001)"
# Group 1 = title, Group 2 = year
SHOW_FOLDER_PATTERN = re.compile(r'^(.+)\s\((\d{4})\)$')

# Matches standard Plex season folder names — requires exactly two digits (zero-padded).
# "Season 01" matches, "Season 1" does not and will be flagged as a warning.
# Group 1 = season number e.g. "01"
SEASON_FOLDER_PATTERN = re.compile(r'^Season\s(\d{2})$')

# Matches episode file stems — handles both single and multi-episode files:
#   Single:  "Star Trek Enterprise (2001) - S01E03 - Flight Or Flight"
#   Multi:   "Star Trek Enterprise (2001) - S01E01-E02 - Broken Bow Part 1 And 2"
#   Multi:   "Star Trek Enterprise (2001) - S01E01-02 - Broken Bow Part 1 And 2"
# Group 1 = title, Group 2 = year, Group 3 = season num,
# Group 4 = first episode num, Group 5 = second episode num (only present for multi-episode)
FILE_PATTERN = re.compile(
    r'^(.+)\s\((\d{4})\)\s-\sS(\d{2})E(\d{2})(?:-E?(\d{2}))?\s-\s.+$',
    re.IGNORECASE
)


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

def _parse_show_folder(name):
    """
    Parse a Plex show folder name into (title, year).
    Returns None if the name doesn't match the expected format.
    Example: "Star Trek Enterprise (2001)" -> ("Star Trek Enterprise", 2001)
    """
    m = SHOW_FOLDER_PATTERN.match(name)
    return (m.group(1).strip(), int(m.group(2))) if m else None

def _parse_season_folder(name):
    """
    Parse a standard Plex season folder name into a season number integer.
    Requires zero-padded two-digit format (e.g. "Season 01", not "Season 1").
    Returns None if the name doesn't match — triggers a warning in the scanner.
    Examples: "Season 01" -> 1, "Season 12" -> 12, "Season 1" -> None
    """
    m = SEASON_FOLDER_PATTERN.match(name)
    return int(m.group(1)) if m else None

def _parse_file_stem(stem):
    """
    Parse an episode file stem into (title, year, season, episode_count).
    Returns None if the stem doesn't match the expected format.
    episode_count is 2 for multi-episode files (e.g. S01E01-E02), 1 otherwise.
    """
    m = FILE_PATTERN.match(stem)
    if not m:
        return None
    title         = m.group(1).strip()
    year          = int(m.group(2))
    season        = int(m.group(3))
    episode_count = 2 if m.group(5) else 1   # Group 5 only exists for multi-episode files
    return title, year, season, episode_count

def _make_show_key(title, year):
    """Unique key for a show — lowercased to handle case differences."""
    return (title.lower(), year)

def _make_season_key(title, year, season_label):
    """
    Unique key for a specific season of a show.
    season_label is a string — either a number string like "1" or a name like "Specials".
    Lowercased so "specials" and "Specials" are treated as the same season.
    """
    return (title.lower(), year, season_label.lower())

def _find_episode_gaps(episode_numbers):
    """
    Given a list of episode numbers present in a season, return any missing numbers.
    Checks between the lowest and highest episode number found.
    Example: [1, 2, 4] -> [3]  (episode 3 is missing)
    Example: [1, 2, 3] -> []   (no gaps)
    """
    if not episode_numbers:
        return []
    # Build the full expected range, then subtract what we actually have
    full_range = set(range(min(episode_numbers), max(episode_numbers) + 1))
    return sorted(full_range - set(episode_numbers))

def _season_sort_key(season_label):
    """
    Sort key that puts numeric seasons first (in numeric order),
    followed by named seasons alphabetically.
    e.g. "1", "2", "10", "Champion of Champions", "Specials"
    """
    try:
        return (0, int(season_label), "")    # Numeric: sort group 0, then by number
    except ValueError:
        return (1, 0, season_label.lower())  # Named: sort group 1, then alphabetically


# ─────────────────────────────────────────────
# Scanner (called by core/scanner.py)
# ─────────────────────────────────────────────

def scan_quality_folder(quality_path, folder_name, tag, media_config, warnings):
    """
    Walk one quality folder (e.g. HD/) and return a dict of show records.
    Called once per quality folder by core/scanner.py.

    Season labels are stored as strings so both numeric seasons ("1", "2")
    and named seasons ("Specials", "Champion of Champions") can coexist.

    Returns:
    {
      show_key: {
        title, year,
        seasons: {
          season_key: { season_label, episode_count, qualities: set() }
        }
      }
    }
    """
    records = {}

    # Pull the ignored season names from config (case-insensitive comparison later)
    # Default to empty list if not set, so the field is optional in config.json
    ignored_names = [n.lower() for n in media_config.get("ignored_season_names", [])]

    # Each subfolder inside the quality folder should be a show folder
    for show_folder in os.scandir(quality_path):
        if not show_folder.is_dir():
            continue   # Skip any loose files in the quality folder

        show_rel    = os.path.join(folder_name, show_folder.name)
        parsed_show = _parse_show_folder(show_folder.name)

        # Warning: show folder name doesn't follow Plex convention
        if not parsed_show:
            warnings.add(
                show_rel,
                "Show folder name does not match Plex naming convention — expected: Show Title (YEAR)"
            )
            continue

        show_title, show_year = parsed_show

        # Read the season folders inside this show folder
        try:
            season_entries = list(os.scandir(show_folder.path))
        except PermissionError:
            warnings.add(show_rel, "Permission denied reading show folder")
            continue

        for season_entry in season_entries:
            if not season_entry.is_dir():
                continue   # Skip loose files (e.g. show artwork)

            season_rel  = os.path.join(show_rel, season_entry.name)
            folder_name_lower = season_entry.name.lower()

            # ── Determine the season label ─────────────────────────────────
            if folder_name_lower in ignored_names:
                # Named season from config (e.g. "Specials") — use name as label,
                # preserve original casing from the folder name
                season_label = season_entry.name
                is_named     = True

            else:
                # Try to parse as a standard "Season XX" folder
                season_number = _parse_season_folder(season_entry.name)

                if season_number is None:
                    # Doesn't match "Season XX" and isn't a known named season
                    warnings.add(
                        season_rel,
                        f"Season folder '{season_entry.name}' does not match expected format "
                        f"(expected: Season 01) and is not in ignored_season_names"
                    )
                    continue

                # Convert to plain number string — "01" -> "1", "12" -> "12"
                season_label = str(season_number)
                is_named     = False

            # ── Read episode files ─────────────────────────────────────────
            try:
                all_files = list(os.scandir(season_entry.path))
            except PermissionError:
                warnings.add(season_rel, "Permission denied reading season folder")
                continue

            video_files   = [f for f in all_files if _is_video(f.name, media_config)]
            non_primary   = [f for f in video_files if not _is_primary(f.name, media_config)]
            primary_files = [f for f in video_files if _is_primary(f.name, media_config)]

            # Warning: no video files at all in this season folder
            if not video_files:
                warnings.add(season_rel, "No recognized video files found in season folder")
                continue

            # Warning: non-primary video files found (e.g. .mkv when primary is .mp4)
            for f in non_primary:
                _, ext = os.path.splitext(f.name)
                warnings.add(
                    os.path.join(season_rel, f.name),
                    _format_primary_exts(media_config) + " video file — may need re-encoding",
                    extension=ext.lower()
                )

            # Track episode numbers seen in this season for gap detection
            episode_numbers = []
            season_ep_count = 0

            for vf in primary_files:
                stem, _ = os.path.splitext(vf.name)
                parsed  = _parse_file_stem(stem)

                # Warning: file name doesn't follow Plex naming convention
                if not parsed:
                    warnings.add(
                        os.path.join(season_rel, vf.name),
                        "File name does not match Plex naming convention — expected: Show Title (YEAR) - S01E01 - Episode Title"
                    )
                    continue

                file_title, file_year, file_season, ep_count = parsed

                # Warning: file's show title/year doesn't match parent show folder
                if file_title.lower() != show_title.lower() or file_year != show_year:
                    warnings.add(
                        os.path.join(season_rel, vf.name),
                        f"File show/year '{file_title} ({file_year})' "
                        f"does not match show folder '{show_folder.name}'"
                    )

                # Warning: file's season number doesn't match parent season folder
                # Only checked for numeric seasons — named seasons may have varied episode numbering
                if not is_named and file_season != int(season_label):
                    warnings.add(
                        os.path.join(season_rel, vf.name),
                        f"File season 'S{file_season:02d}' does not match "
                        f"season folder '{season_entry.name}'"
                    )

                # Collect episode numbers for gap detection.
                # Multi-episode files (S01E01-E02) expand into [1, 2] so
                # the gap detector sees them as two episodes rather than one.
                m = FILE_PATTERN.match(stem)
                if m:
                    first_ep  = int(m.group(4))
                    second_ep = int(m.group(5)) if m.group(5) else None
                    if second_ep:
                        for ep in range(first_ep, second_ep + 1):
                            episode_numbers.append(ep)
                    else:
                        episode_numbers.append(first_ep)

                season_ep_count += ep_count

            # Warning: gaps detected in episode numbering within this season
            gaps = _find_episode_gaps(episode_numbers)
            if gaps:
                gap_str = ", ".join(f"E{g:02d}" for g in gaps)
                warnings.add(
                    season_rel,
                    f"Potential missing episodes in {season_entry.name}: {gap_str}"
                )

            # ── Add season to records ──────────────────────────────────────
            show_key   = _make_show_key(show_title, show_year)
            season_key = _make_season_key(show_title, show_year, season_label)

            if show_key not in records:
                records[show_key] = {
                    "title":   show_title,
                    "year":    show_year,
                    "seasons": {}
                }

            if season_key not in records[show_key]["seasons"]:
                records[show_key]["seasons"][season_key] = {
                    "season_label":  season_label,
                    "episode_count": 0,
                    "qualities":     set()
                }

            records[show_key]["seasons"][season_key]["episode_count"] += season_ep_count
            records[show_key]["seasons"][season_key]["qualities"].add(tag)

    return records


# ─────────────────────────────────────────────
# Merge (called by core/scanner.py)
# ─────────────────────────────────────────────

def merge(existing, new_records):
    """
    Merge new_records into existing records across quality folders.
    Shows need a custom merge (instead of the default in core/scanner.py)
    because their records have nested seasons rather than a flat qualities set.
    """
    for show_key, new_show in new_records.items():
        if show_key not in existing:
            existing[show_key] = new_show
        else:
            for season_key, new_season in new_show["seasons"].items():
                if season_key not in existing[show_key]["seasons"]:
                    existing[show_key]["seasons"][season_key] = new_season
                else:
                    # Merge qualities (e.g. add "UHD" to a season already tagged "HD")
                    existing[show_key]["seasons"][season_key]["qualities"].update(
                        new_season["qualities"]
                    )
                    # Use the highest episode count seen across all quality folders
                    existing[show_key]["seasons"][season_key]["episode_count"] = max(
                        existing[show_key]["seasons"][season_key]["episode_count"],
                        new_season["episode_count"]
                    )


# ─────────────────────────────────────────────
# Quality order
# ─────────────────────────────────────────────

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
    Shows are sorted alphabetically by title then year.
    Seasons are sorted with numeric seasons first (in numeric order),
    followed by named seasons alphabetically.
    """
    output = []
    for show in sorted(records.values(), key=lambda s: (s["title"].lower(), s["year"])):
        seasons = sorted(
            show["seasons"].values(),
            key=lambda s: _season_sort_key(s["season_label"])
        )
        output.append({
            "title": show["title"],
            "year":  show["year"],
            "seasons": [
                {
                    "season":        s["season_label"],   # String: "1", "2", "Specials"
                    "episode_count": s["episode_count"],
                    "qualities":     _quality_order(s["qualities"])
                }
                for s in seasons
            ]
        })
    return output


# ─────────────────────────────────────────────
# DB writer (called by core/scanner.py)
# ─────────────────────────────────────────────

def write_db(conn, records):
    """
    Write show records to SQLite using two related tables.
    season is stored as TEXT to support both numeric ("1") and named ("Specials") seasons.
    """
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS shows (
            id    INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT    NOT NULL,
            year  INTEGER NOT NULL,
            UNIQUE(title, year)
        )
    """)

    # season is TEXT not INTEGER — stores both "1" and "Specials"
    cur.execute("""
        CREATE TABLE IF NOT EXISTS show_seasons (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            show_id       INTEGER NOT NULL REFERENCES shows(id),
            season        TEXT    NOT NULL,
            episode_count INTEGER NOT NULL,
            qualities     TEXT    NOT NULL,
            UNIQUE(show_id, season)
        )
    """)

    for show in records.values():
        cur.execute("""
            INSERT INTO shows (title, year)
            VALUES (?, ?)
            ON CONFLICT(title, year) DO NOTHING
        """, (show["title"], show["year"]))

        cur.execute(
            "SELECT id FROM shows WHERE title = ? AND year = ?",
            (show["title"], show["year"])
        )
        show_id = cur.fetchone()[0]

        for season in show["seasons"].values():
            qualities_json = json.dumps(_quality_order(season["qualities"]))
            cur.execute("""
                INSERT INTO show_seasons (show_id, season, episode_count, qualities)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(show_id, season) DO UPDATE SET
                    episode_count = excluded.episode_count,
                    qualities     = excluded.qualities
            """, (show_id, season["season_label"], season["episode_count"], qualities_json))