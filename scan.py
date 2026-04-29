"""
scan.py
-------
MOASYS-Vault — Media Library Scanner
Entry point for scanning your Plex media library and generating
structured JSON, warnings, and SQLite output per media type.

Usage:
  python scan.py --type movies
  python scan.py --type shows
  python scan.py --type music
  python scan.py --type audiobooks
  python scan.py --all
"""

import os
import json
import argparse
from datetime import datetime

# ─────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────

# __file__ is the path to this script. We use it to build paths relative
# to wherever the project folder lives, so the script works regardless of
# where on your machine you put it.
SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(SCRIPT_DIR, "config.json")
OUTPUT_DIR  = os.path.join(SCRIPT_DIR, "output")

# Load config.json once at startup. CONFIG is a dict like:
# { "movies": { "root_path": ..., "media_folders": [...], ... }, "shows": { ... } }
with open(CONFIG_PATH, "r", encoding="utf-8") as f:
    CONFIG = json.load(f)

# ─────────────────────────────────────────────
# Media type registry
# ─────────────────────────────────────────────

# Import each media module. Each module handles its own parsing,
# serialization, and DB logic — the core scanner just calls into them.
from media import movies, shows, music, audiobooks
from core.scanner import WarningCollector, scan, write_json, write_warnings, write_db

# Registry of all supported media types. To add a new type in the future:
#   1. Create media/newtype.py implementing the required functions
#   2. Import it above
#   3. Add an entry here
MEDIA_TYPES = {
    "movies": {
        "module":     movies,
        "output_dir": os.path.join(OUTPUT_DIR, "movies"),
        "label":      "Movies",
    },
    "shows": {
        "module":     shows,
        "output_dir": os.path.join(OUTPUT_DIR, "shows"),
        "label":      "Shows",
    },
    "music": {
        "module":     music,
        "output_dir": os.path.join(OUTPUT_DIR, "music"),
        "label":      "Music",
    },
    "audiobooks": {
        "module":     audiobooks,
        "output_dir": os.path.join(OUTPUT_DIR, "audiobooks"),
        "label":      "Audiobooks",
    },
}

# ─────────────────────────────────────────────
# Runner
# ─────────────────────────────────────────────

def run_scan(media_type):
    """Run a full scan for a single media type and write all output files."""
    entry        = MEDIA_TYPES[media_type]
    module       = entry["module"]
    label        = entry["label"]
    output_dir   = entry["output_dir"]

    # Pull this media type's section from config.json (e.g. CONFIG["movies"])
    media_config = CONFIG.get(media_type)

    print(f"\n{'─' * 50}")
    print(f"  MOASYS-Vault — {label}")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'─' * 50}")

    # Bail out early if the config section is missing
    if not media_config:
        print(f"  [ERROR] No config section found for '{media_type}' in config.json")
        return

    # Some modules (movies, shows) need to know the quality folder order
    # so they can sort qualities in the output (UHD before HD before SD, etc.)
    if hasattr(module, "init_quality_order"):
        module.init_quality_order(media_config.get("media_folders", []))

    # Create the output folder if it doesn't already exist
    # exist_ok=True means no error is raised if it's already there
    os.makedirs(output_dir, exist_ok=True)

    # WarningCollector gathers issues found during scanning.
    # It's passed into the scan so each module can add warnings as it goes.
    warnings = WarningCollector()

    print(f"\n  Root : {media_config['root_path']}")
    print()

    # Run the scan — walks folders and returns a dict of records.
    # If the module isn't implemented yet it raises NotImplementedError.
    try:
        records = scan(media_config, module, warnings)
    except NotImplementedError:
        print(f"  [SKIP] {label} scanning is not yet implemented.")
        return

    # Write the three output files for this media type
    print(f"\n  Writing output...")
    write_json(
        records, module,
        os.path.join(output_dir, f"{media_type}.json")   # e.g. output/movies/movies.json
    )
    write_warnings(
        warnings,
        os.path.join(output_dir, "warnings.json")         # e.g. output/movies/warnings.json
    )
    write_db(
        records, module,
        os.path.join(output_dir, f"{media_type}.db")      # e.g. output/movies/movies.db
    )

    print(f"\n  Done — {len(records)} entries, {warnings.count()} warnings.")
    if warnings.count():
        print(f"  → Review output/{media_type}/warnings.json for files needing attention.")


# ─────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────

def main():
    """Parse command line arguments and kick off the appropriate scan(s)."""

    # argparse handles --type and --help automatically
    parser = argparse.ArgumentParser(
        prog="scan.py",
        description="MOASYS-Vault — Plex Media Library Scanner"
    )

    # mutually_exclusive_group means you can pass --type OR --all, but not both
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--type",
        choices=list(MEDIA_TYPES.keys()),
        metavar="TYPE",
        help=f"Media type to scan. Choices: {', '.join(MEDIA_TYPES.keys())}"
    )
    group.add_argument(
        "--all",
        action="store_true",   # --all is a flag, no value needed after it
        help="Scan all configured media types"
    )

    args = parser.parse_args()

    if args.all:
        # Loop through every registered media type
        for media_type in MEDIA_TYPES:
            run_scan(media_type)
    else:
        run_scan(args.type)

    print()


# This block only runs when you execute the file directly (e.g. python scan.py).
# It won't run if another file imports scan.py as a module.
if __name__ == "__main__":
    main()