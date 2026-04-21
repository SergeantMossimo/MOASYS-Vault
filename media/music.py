"""
media/music.py
--------------
Music scanning, parsing, serialization, and DB logic for MOASYS-Vault.

Expected Plex folder structure:
  <Artist Name>/
    <Album Name (YEAR)>/
      01 - Track Title.flac

STATUS: Not yet implemented.
"""

# TODO: implement scan_root()
# TODO: implement serialize()
# TODO: implement write_db()

def scan_root(root_path, media_config, warnings):
    raise NotImplementedError("Music scanning is not yet implemented.")

def serialize(records):
    raise NotImplementedError("Music serialization is not yet implemented.")

def write_db(conn, records):
    raise NotImplementedError("Music DB writing is not yet implemented.")
