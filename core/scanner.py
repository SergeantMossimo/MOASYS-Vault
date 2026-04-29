"""
core/scanner.py
---------------
Shared scanning scaffolding used by all media type modules.
Handles folder walking, warning collection, and output writing (JSON + SQLite).
Media-specific parsing is delegated to the media module passed in at runtime.

This file should rarely need to be edited. Adding a new media type means
creating a new file in media/ and registering it in scan.py — not changing this.
"""

import os
import json
import sqlite3
from datetime import datetime, timezone


# ─────────────────────────────────────────────
# Warning collector
# ─────────────────────────────────────────────

class WarningCollector:
    """
    Accumulates warning messages during a scan.
    Passed into each media module so warnings can be added from anywhere
    in the scanning process and written to warnings.json at the end.
    """

    def __init__(self):
        # Simple list — warnings are added in the order they're found
        self._warnings = []

    def add(self, path, issue, **extra):
        """
        Add a warning. path and issue are required.
        Any additional keyword arguments (e.g. extension=".mkv") are
        merged into the warning dict so they appear in warnings.json.
        """
        entry = {"path": path, "issue": issue}
        entry.update(extra)   # Merge in any optional extra fields
        self._warnings.append(entry)

    def all(self):
        """Return a copy of all warnings as a list of dicts."""
        return list(self._warnings)

    def count(self):
        """Return the total number of warnings collected."""
        return len(self._warnings)


# ─────────────────────────────────────────────
# Core scanner
# ─────────────────────────────────────────────

def scan(media_config, media_module, warnings):
    """
    Walk the quality folders defined in media_config and delegate
    per-folder parsing to media_module.scan_quality_folder().

    Returns a dict of { unique_key: record } where the structure
    of each record is defined by the media module.

    media_module must implement:
        scan_quality_folder(quality_path, folder_name, tag, media_config, warnings)
            -> dict of { key: record }

    Optionally, media_module may implement:
        merge(existing, new_records) — for types with nested data (e.g. shows)
        scan_root(root_path, media_config, warnings) — for types with no quality folders
    """
    records = {}

    root_path       = media_config["root_path"]
    media_folders = media_config.get("media_folders", [])

    if not media_folders:
        # Music and audiobooks don't use quality folders — they scan the root directly
        results = media_module.scan_root(root_path, media_config, warnings)
        records.update(results)
        return records

    # Walk each quality folder (UHD, HD, SD, etc.) one at a time
    for qf in media_folders:
        folder_name  = qf["name"]   # Actual folder name on disk e.g. "UHD"
        tag          = qf["tag"]      # Label used in output e.g. "UHD"
        quality_path = os.path.join(root_path, folder_name)

        # Skip gracefully if the folder doesn't exist on this machine
        if not os.path.isdir(quality_path):
            print(f"    [SKIP] Quality folder not found: {quality_path}")
            continue

        print(f"    [SCAN] {folder_name} ({tag})")

        # Ask the media module to scan this quality folder and return its records
        results = media_module.scan_quality_folder(
            quality_path, folder_name, tag, media_config, warnings
        )

        # Merge the results from this quality folder into the main records dict.
        # Shows define a custom merge() because their records have nested seasons.
        # Movies use the default logic below which just combines quality sets.
        if hasattr(media_module, "merge"):
            media_module.merge(records, results)
            continue

        for key, record in results.items():
            if key in records:
                # Record already exists from a previous quality folder —
                # add this quality tag to the existing set (e.g. add "HD" to a record that already has "UHD")
                records[key]["qualities"].update(record["qualities"])
            else:
                # First time we've seen this title — add it fresh
                records[key] = record

    return records


# ─────────────────────────────────────────────
# Output writers
# ─────────────────────────────────────────────

def write_json(records, media_module, output_path):
    """
    Serialize records to a JSON file using the media module's serializer.

    media_module.serialize() is responsible for:
      - Converting sets to sorted lists (JSON doesn't support sets)
      - Sorting the records for consistent output
      - Shaping the final dict structure

    ensure_ascii=False allows non-ASCII characters (e.g. accented titles)
    to be written as-is rather than escaped as \\uXXXX sequences.
    """
    data = media_module.serialize(records)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"    [OUT] {output_path}  ({len(data)} entries)")
    return data


def write_warnings(warnings, output_path):
    """Write all collected warnings to a JSON file."""
    out = {
        "generated": datetime.now(timezone.utc).isoformat(),  # UTC timestamp
        "count":     warnings.count(),
        "files":     warnings.all()
    }
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)

    print(f"    [OUT] {output_path}  ({warnings.count()} warnings)")


def write_db(records, media_module, db_path):
    """
    Write records to a SQLite database file using the media module's DB writer.

    SQLite creates the .db file automatically if it doesn't exist.
    Each media module defines its own table schema and upsert logic.

    conn (connection) is opened here and passed into the module.
    commit() saves the changes, close() releases the file.
    """
    conn = sqlite3.connect(db_path)
    media_module.write_db(conn, records)
    conn.commit()
    conn.close()
    print(f"    [OUT] {db_path}")