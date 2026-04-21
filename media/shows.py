"""
media/shows.py
-----------
Show scanning, parsing, serialization, and DB logic for MOASYS-Vault.

Expected Plex folder structure:
  <quality_folder>/
    <Show Title (YEAR)>/
      Season 01/
        <Show Title (YEAR)> - S01E01 - Episode Title.mp4

STATUS: Not yet implemented.
"""

# TODO: implement scan_quality_folder()
# TODO: implement serialize()
# TODO: implement init_quality_order()
# TODO: implement write_db()

def scan_quality_folder(quality_path, folder_name, tag, media_config, warnings):
    raise NotImplementedError("TV scanning is not yet implemented.")

def serialize(records):
    raise NotImplementedError("Shows serialization is not yet implemented.")

def init_quality_order(quality_folders):
    pass

def write_db(conn, records):
    raise NotImplementedError("Shows DB writing is not yet implemented.")
