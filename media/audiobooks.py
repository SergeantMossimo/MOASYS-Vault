"""
media/audiobooks.py
-------------------
Audiobook scanning, parsing, serialization, and DB logic for MOASYS-Vault.

Expected Plex folder structure:
  <Author Name>/
    <Book Title (YEAR)>/
      <Book Title (YEAR)>.m4b

STATUS: Not yet implemented.
"""

# TODO: implement scan_root()
# TODO: implement serialize()
# TODO: implement write_db()

def scan_root(root_path, media_config, warnings):
    raise NotImplementedError("Audiobook scanning is not yet implemented.")

def serialize(records):
    raise NotImplementedError("Audiobook serialization is not yet implemented.")

def write_db(conn, records):
    raise NotImplementedError("Audiobook DB writing is not yet implemented.")
