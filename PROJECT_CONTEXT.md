# PROJECT CONTEXT — Anki Viewer

## Context & Goals
**Pitch :** A web-based viewer for Anki collections (.colpkg) exported from Anki, allowing users to browse decks and cards without the Anki desktop app.
**Utilisateurs :** Students and Anki users wanting a portable or simple read-only view of their collection.
**Stack :** Vanilla JS / HTML / CSS (Front), Python (Data Extraction & Local Server).

## Invariants
- **No Frameworks :** Pure Vanilla JS for the frontend.
- **Local First :** Works with a local Python server serving the directory.
- **Visuals :** Premium, dynamic, and responsive design.
- **Files :** `anki_to_json.py` extracts data; `index.html`/`app.js` runs the UI.

## Current State
- **Status :** Stable
- **Next Steps :** Create a launcher (`start_viewer.bat`) and an app icon.
