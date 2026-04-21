"""
core/scanner.py
---------------
Shared scanning scaffolding used by all media type modules.
Handles folder walking, warning collection, and output writing (JSON + SQLite).
Media-specific parsing is delegated to the media module passed in at runtime.
"""

import os
import json
import sqlite3
from datetime import datetime, timezone


# ─────────────────────────────────────────────
# Warning collector
# ─────────────────────────────────────────────

class WarningCollector:
    def __init__(self):
        self._warnings = []

    def add(self, path, issue, **extra):
        entry = {"path": path, "issue": issue}
        entry.update(extra)
        self._warnings.append(entry)

    def all(self):
        return list(self._warnings)

    def count(self):
        return len(self._warnings)


# ─────────────────────────────────────────────
# Core scanner
# ─────────────────────────────────────────────

def scan(media_config, media_module, warnings):
    """
    Walk the quality folders defined in media_config and delegate
    per-folder parsing to media_module.scan_quality_folder().

    Returns a dict of { unique_key: record } where record structure
    is defined by the media module.

    media_module must implement:
        scan_quality_folder(quality_path, folder_name, tag, media_config, warnings)
            -> dict of { key: record }
    """
    records = {}

    root_path       = media_config["root_path"]
    quality_folders = media_config.get("quality_folders", [])

    if not quality_folders:
        # Media types like music/audiobooks that don't use quality folders
        results = media_module.scan_root(root_path, media_config, warnings)
        records.update(results)
        return records

    for qf in quality_folders:
        folder_name  = qf["folder"]
        tag          = qf["tag"]
        quality_path = os.path.join(root_path, folder_name)

        if not os.path.isdir(quality_path):
            print(f"    [SKIP] Quality folder not found: {quality_path}")
            continue

        print(f"    [SCAN] {folder_name} ({tag})")
        results = media_module.scan_quality_folder(
            quality_path, folder_name, tag, media_config, warnings
        )

        # Merge results — if key already exists, merge qualities
        for key, record in results.items():
            if key in records:
                records[key]["qualities"].update(record["qualities"])
            else:
                records[key] = record

    return records


# ─────────────────────────────────────────────
# Output writers
# ─────────────────────────────────────────────

def write_json(records, media_module, output_path):
    """
    Serialize records to JSON using the media module's serializer.
    media_module must implement:
        serialize(records) -> list of dicts (sorted, qualities as lists)
    """
    data = media_module.serialize(records)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"    [OUT] {output_path}  ({len(data)} entries)")
    return data


def write_warnings(warnings, output_path):
    out = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "count":     warnings.count(),
        "files":     warnings.all()
    }
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)

    print(f"    [OUT] {output_path}  ({warnings.count()} warnings)")


def write_db(records, media_module, db_path):
    """
    Write records to SQLite using the media module's DB writer.
    media_module must implement:
        write_db(conn, records)
    """
    conn = sqlite3.connect(db_path)
    media_module.write_db(conn, records)
    conn.commit()
    conn.close()
    print(f"    [OUT] {db_path}")
