"""
media/audiobooks.py
-------------------
Audiobook-specific parsing, serialization, and DB logic for MOASYS-Vault.

Expected folder structure:
  <media_folder>/
    <Author Name>/                          ← single author
    <Author 1, Author 2>/                   ← multiple authors, comma-separated
    <Author 1, Author 2, and Author 3>/     ← multiple authors with "and"
      <Book Title>/
        01 - Chapter Name.m4b
        101 - Chapter Name.mp3   ← multi-disc (Book On CD)
"""

import os
import re
import json

# ─────────────────────────────────────────────
# Regex patterns
# ─────────────────────────────────────────────

# Matches standard chapter file stems: "01 - Chapter Name"
# Group 1 = chapter number (2 digits), Group 2 = chapter name
SINGLE_DISC_PATTERN = re.compile(r'^(\d{2})\s-\s(.+)$')

# Matches multi-disc chapter file stems: "101 - Chapter Name", "201 - Chapter Name"
# Group 1 = disc number, Group 2 = chapter number (2 digits), Group 3 = chapter name
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
    config value must be a list e.g. [".m4b"] or [".m4b", ".mp3"].
    """
    return [e.lower() for e in media_config["primary_extension"]]

def _is_primary(filename, media_config):
    """Return True if the file extension matches any configured primary_extension."""
    _, ext = os.path.splitext(filename)
    return ext.lower() in _get_primary_extensions(media_config)

def _format_primary_exts(media_config):
    """
    Return a human-readable string of primary extensions for warning messages.
    e.g. [".m4b"] -> "Non-.M4B"
         [".m4b", ".mp3"] -> "Non-.M4B/.MP3"
    """
    exts = _get_primary_extensions(media_config)
    return "Non-" + "/".join(e.upper() for e in exts)

def _parse_authors(folder_name):
    """
    Parse an author folder name into a list of individual author names.
    Handles three formats:
      "J.R.R. Tolkien"                        -> ["J.R.R. Tolkien"]
      "Terry Pratchett, Neil Gaiman"           -> ["Terry Pratchett", "Neil Gaiman"]
      "Author 1, Author 2, and Author 3"       -> ["Author 1", "Author 2", "Author 3"]

    Strategy:
      1. Strip trailing " and " from the last segment
      2. Split on commas
      3. Strip whitespace from each name
    """
    # Remove " and " that may appear before the last author
    # e.g. "Author 1, Author 2, and Author 3" -> "Author 1, Author 2, Author 3"
    cleaned = re.sub(r',?\s+and\s+', ', ', folder_name, flags=re.IGNORECASE)
    authors = [a.strip() for a in cleaned.split(',') if a.strip()]
    return authors

def _parse_chapter_stem(stem):
    """
    Parse a chapter file stem into (disc_number, chapter_number, chapter_name).
    Handles both single-disc (01 - Name) and multi-disc (101 - Name) formats.

    Returns (disc, chapter, name) or None if no match.

    Single-disc treated as disc 1:
      "01 - The Shadow of the Past" -> (1, 1, "The Shadow of the Past")

    Multi-disc extracts disc from leading digit(s):
      "101 - Chapter Name" -> (1, 1, "Chapter Name")
      "302 - Chapter Name" -> (3, 2, "Chapter Name")
    """
    # Try multi-disc first — it's more specific
    m = MULTI_DISC_PATTERN.match(stem)
    if m:
        disc    = int(m.group(1))
        chapter = int(m.group(2))
        name    = m.group(3).strip()
        return disc, chapter, name

    # Fall back to single-disc
    m = SINGLE_DISC_PATTERN.match(stem)
    if m:
        chapter = int(m.group(1))
        name    = m.group(2).strip()
        return 1, chapter, name   # Treat as disc 1

    return None

def _make_book_key(title):
    """
    Unique key for a book — lowercased title only.
    Books are keyed by title since they're the top-level item in the output.
    The same book shouldn't appear under different author folders.
    """
    return title.lower()

def _find_chapter_gaps(chapter_numbers):
    """
    Given a list of chapter numbers for a single disc, return any missing numbers.
    Example: [1, 2, 4] -> [3]
    """
    if not chapter_numbers:
        return []
    full_range = set(range(min(chapter_numbers), max(chapter_numbers) + 1))
    return sorted(full_range - set(chapter_numbers))


# ─────────────────────────────────────────────
# Scanner (called by core/scanner.py)
# ─────────────────────────────────────────────

def scan_quality_folder(quality_path, folder_name, tag, media_config, warnings):
    """
    Walk one media folder (e.g. Audible/, Book On CD/) and return a dict of book records.
    Called once per media_folder entry by core/scanner.py.

    Returns:
    {
      book_key: {
        title, authors: list, chapter_count, media_type: set()
      }
    }

    Note: Unlike music, books are keyed by title only — not author + title.
    This is because a book is the primary searchable item, and authors
    are stored as an array field on the book record.
    """
    records = {}

    # Each subfolder inside the media folder should be an author folder
    for author_entry in os.scandir(quality_path):
        if not author_entry.is_dir():
            continue   # Skip loose files in the media folder

        author_folder = author_entry.name
        author_rel    = os.path.join(folder_name, author_folder)

        # Parse the folder name into a list of authors
        # e.g. "Terry Pratchett, Neil Gaiman" -> ["Terry Pratchett", "Neil Gaiman"]
        authors = _parse_authors(author_folder)

        # Read book folders inside this author folder
        try:
            book_entries = list(os.scandir(author_entry.path))
        except PermissionError:
            warnings.add(author_rel, "Permission denied reading author folder")
            continue

        for book_entry in book_entries:
            if not book_entry.is_dir():
                continue   # Skip loose files (e.g. author photo)

            book_title = book_entry.name
            book_rel   = os.path.join(author_rel, book_title)
            book_key   = _make_book_key(book_title)

            # Read chapter files inside this book folder
            try:
                all_files = list(os.scandir(book_entry.path))
            except PermissionError:
                warnings.add(book_rel, "Permission denied reading book folder")
                continue

            audio_files   = [f for f in all_files if _is_audio(f.name, media_config)]
            non_primary   = [f for f in audio_files if not _is_primary(f.name, media_config)]

            # Warning: no audio files at all in this book folder
            if not audio_files:
                warnings.add(book_rel, "No recognized audio files found in book folder")
                continue

            # Warning: non-primary audio files present
            for f in non_primary:
                _, ext = os.path.splitext(f.name)
                warnings.add(
                    os.path.join(book_rel, f.name),
                    f"{_format_primary_exts(media_config)} audio file — may need re-encoding",
                    extension=ext.lower()
                )

            # Track chapter numbers per disc for gap detection: { disc_num: [chapter_nums] }
            disc_chapters = {}
            chapter_count = 0

            for vf in audio_files:
                stem, _ = os.path.splitext(vf.name)
                parsed  = _parse_chapter_stem(stem)

                # Warning: file name doesn't match naming convention
                if not parsed:
                    warnings.add(
                        os.path.join(book_rel, vf.name),
                        "Chapter file name does not match naming convention — "
                        "expected: 01 - Chapter Name.ext or 101 - Chapter Name.ext (multi-disc)"
                    )
                    continue

                disc, chapter, _ = parsed
                chapter_count += 1

                # Group chapter numbers by disc for per-disc gap detection
                if disc not in disc_chapters:
                    disc_chapters[disc] = []
                disc_chapters[disc].append(chapter)

            # Warning: gaps in chapter numbers, checked per disc independently
            for disc_num, chapters in sorted(disc_chapters.items()):
                gaps = _find_chapter_gaps(chapters)
                if gaps:
                    gap_str  = ", ".join(f"Chapter {g:02d}" for g in gaps)
                    disc_str = f"Disc {disc_num}" if len(disc_chapters) > 1 else "Book"
                    warnings.add(
                        book_rel,
                        f"Potential missing chapters in {disc_str}: {gap_str}"
                    )

            # Add / merge book into records
            if book_key not in records:
                records[book_key] = {
                    "title":         book_title,
                    "authors":       authors,
                    "chapter_count": chapter_count,
                    "media_type":    set()
                }
            else:
                # Book already exists — update chapter count if higher
                records[book_key]["chapter_count"] = max(
                    records[book_key]["chapter_count"],
                    chapter_count
                )

            records[book_key]["media_type"].add(tag)

            # Warning: same book found in more than one media folder
            if len(records[book_key]["media_type"]) > 1:
                existing_tags = ", ".join(sorted(records[book_key]["media_type"]))
                warnings.add(
                    book_rel,
                    f"Duplicate book found in multiple media folders: {existing_tags}"
                )

    return records


# ─────────────────────────────────────────────
# Merge (called by core/scanner.py)
# ─────────────────────────────────────────────

def merge(existing, new_records):
    """
    Merge new_records into existing records across media folders.
    Books are keyed by title — if the same title appears in multiple
    media folders, media_type accumulates both tags.
    """
    for book_key, new_book in new_records.items():
        if book_key not in existing:
            existing[book_key] = new_book
        else:
            # Merge media_type sets and keep highest chapter count
            existing[book_key]["media_type"].update(new_book["media_type"])
            existing[book_key]["chapter_count"] = max(
                existing[book_key]["chapter_count"],
                new_book["chapter_count"]
            )


# ─────────────────────────────────────────────
# Quality order / media type order
# ─────────────────────────────────────────────

_MEDIA_TYPE_ORDER = []

def init_quality_order(media_folders):
    """Called by scan.py at startup — stores media folder tag order for media_type sorting."""
    global _MEDIA_TYPE_ORDER
    _MEDIA_TYPE_ORDER = [mf["tag"] for mf in media_folders]

def _order_media_type(media_type_set):
    """Sort media_type tags in config-defined order."""
    return [t for t in _MEDIA_TYPE_ORDER if t in media_type_set]


# ─────────────────────────────────────────────
# Serializer (called by core/scanner.py)
# ─────────────────────────────────────────────

def serialize(records):
    """
    Convert the internal records dict into a sorted list of dicts for JSON output.
    Books are sorted alphabetically by title.
    Authors list preserves the order parsed from the folder name.
    """
    return sorted(
        [
            {
                "title":         r["title"],
                "authors":       r["authors"],
                "chapter_count": r["chapter_count"],
                "media_type":    _order_media_type(r["media_type"])
            }
            for r in records.values()
        ],
        key=lambda x: x["title"].lower()
    )


# ─────────────────────────────────────────────
# DB writer (called by core/scanner.py)
# ─────────────────────────────────────────────

def write_db(conn, records):
    """
    Write audiobook records to SQLite.
    Single table — books are the top-level item.
    authors and media_type stored as JSON strings.
    """
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS books (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            title         TEXT    NOT NULL,
            authors       TEXT    NOT NULL,   -- JSON array e.g. '["J.R.R. Tolkien"]'
            chapter_count INTEGER NOT NULL,
            media_type    TEXT    NOT NULL,   -- JSON array e.g. '["Audible"]'
            UNIQUE(title)
        )
    """)

    for r in records.values():
        authors_json    = json.dumps(r["authors"])
        media_type_json = json.dumps(_order_media_type(r["media_type"]))
        cur.execute("""
            INSERT INTO books (title, authors, chapter_count, media_type)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(title) DO UPDATE SET
                authors       = excluded.authors,
                chapter_count = excluded.chapter_count,
                media_type    = excluded.media_type
        """, (r["title"], authors_json, r["chapter_count"], media_type_json))