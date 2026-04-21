"""
scan.py
-------
MOASYS-Vault — Media Library Scanner
Entry point for scanning your Plex media library and generating
structured JSON, warnings, and SQLite output per media type.

Usage:
  python scan.py --type movies
  python scan.py --type tv
  python scan.py --type music
  python scan.py --type audiobooks
  python scan.py --all
"""

import os
import sys
import json
import argparse
from datetime import datetime

# ─────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────

SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(SCRIPT_DIR, "config.json")
OUTPUT_DIR  = os.path.join(SCRIPT_DIR, "output")

with open(CONFIG_PATH, "r", encoding="utf-8") as f:
    CONFIG = json.load(f)

# ─────────────────────────────────────────────
# Media type registry
# Registers each supported media type with its module and output folder.
# To add a new media type: import its module and add an entry here.
# ─────────────────────────────────────────────

from media import movies, shows, music, audiobooks
from core.scanner import WarningCollector, scan, write_json, write_warnings, write_db

MEDIA_TYPES = {
    "movies": {
        "module":      movies,
        "output_dir":  os.path.join(OUTPUT_DIR, "movies"),
        "label":       "Movies",
    },
    "shows": {
        "module":      shows,
        "output_dir":  os.path.join(OUTPUT_DIR, "shows"),
        "label":       "Shows",
    },
    "music": {
        "module":      music,
        "output_dir":  os.path.join(OUTPUT_DIR, "music"),
        "label":       "Music",
    },
    "audiobooks": {
        "module":      audiobooks,
        "output_dir":  os.path.join(OUTPUT_DIR, "audiobooks"),
        "label":       "Audiobooks",
    },
}

# ─────────────────────────────────────────────
# Runner
# ─────────────────────────────────────────────

def run_scan(media_type):
    entry        = MEDIA_TYPES[media_type]
    module       = entry["module"]
    label        = entry["label"]
    output_dir   = entry["output_dir"]
    media_config = CONFIG.get(media_type)

    print(f"\n{'─' * 50}")
    print(f"  MOASYS-Vault — {label}")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'─' * 50}")

    if not media_config:
        print(f"  [ERROR] No config section found for '{media_type}' in config.json")
        return

    # Initialize quality order if the module supports it
    if hasattr(module, "init_quality_order"):
        module.init_quality_order(media_config.get("quality_folders", []))

    # Ensure output directory exists
    os.makedirs(output_dir, exist_ok=True)

    warnings = WarningCollector()

    print(f"\n  Root : {media_config['root_path']}")
    print()

    # Run the scan
    try:
        records = scan(media_config, module, warnings)
    except NotImplementedError:
        print(f"  [SKIP] {label} scanning is not yet implemented.")
        return

    # Write outputs
    print(f"\n  Writing output...")
    write_json(
        records, module,
        os.path.join(output_dir, f"{media_type}.json")
    )
    write_warnings(
        warnings,
        os.path.join(output_dir, "warnings.json")
    )
    write_db(
        records, module,
        os.path.join(output_dir, f"{media_type}.db")
    )

    print(f"\n  Done — {len(records)} entries, {warnings.count()} warnings.")
    if warnings.count():
        print(f"  → Review output/{media_type}/warnings.json for files needing attention.")


# ─────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        prog="scan.py",
        description="MOASYS-Vault — Plex Media Library Scanner"
    )

    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--type",
        choices=list(MEDIA_TYPES.keys()),
        metavar="TYPE",
        help=f"Media type to scan. Choices: {', '.join(MEDIA_TYPES.keys())}"
    )
    group.add_argument(
        "--all",
        action="store_true",
        help="Scan all configured media types"
    )

    args = parser.parse_args()

    if args.all:
        for media_type in MEDIA_TYPES:
            run_scan(media_type)
    else:
        run_scan(args.type)

    print()


if __name__ == "__main__":
    main()
