#!/usr/bin/env python3
"""
Anki Collection to JSON Converter
Extracts decks, cards, notes, and tags from .colpkg files
"""

import json
import os
import re
import sqlite3
import tempfile
import shutil
import zipfile
from pathlib import Path


def extract_colpkg(colpkg_path: str, extract_dir: str) -> str:
    """Extract .colpkg file and return path to the SQLite database."""
    with zipfile.ZipFile(colpkg_path, 'r') as zip_ref:
        zip_ref.extractall(extract_dir)
    
    # Look for the database file (collection.anki21 or collection.anki2)
    for db_name in ['collection.anki21', 'collection.anki2']:
        db_path = os.path.join(extract_dir, db_name)
        if os.path.exists(db_path):
            return db_path
    
    raise FileNotFoundError("No Anki database found in the .colpkg file")


def extract_media(colpkg_path: str, output_dir: str) -> int:
    """Extract media files from .colpkg to output directory."""
    media_dir = os.path.join(output_dir, "media")
    os.makedirs(media_dir, exist_ok=True)
    
    media_count = 0
    
    with zipfile.ZipFile(colpkg_path, 'r') as zip_ref:
        # Read the media mapping file
        try:
            media_json = zip_ref.read('media').decode('utf-8')
            media_map = json.loads(media_json)
        except (KeyError, json.JSONDecodeError):
            print("No media mapping found in archive.")
            return 0
        
        # Extract each media file with its original name
        for num_name, original_name in media_map.items():
            try:
                data = zip_ref.read(num_name)
                output_path = os.path.join(media_dir, original_name)
                with open(output_path, 'wb') as f:
                    f.write(data)
                media_count += 1
            except KeyError:
                pass  # File not found in archive
    
    return media_count


def clean_html(text: str) -> str:
    """Remove HTML tags but preserve content."""
    if not text:
        return ""
    # Remove sound references
    text = re.sub(r'\[sound:[^\]]+\]', '', text)
    # Replace <br> with newlines
    text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
    # Remove other HTML tags but keep content
    text = re.sub(r'<[^>]+>', '', text)
    # Decode HTML entities
    text = text.replace('&nbsp;', ' ')
    text = text.replace('&lt;', '<')
    text = text.replace('&gt;', '>')
    text = text.replace('&amp;', '&')
    text = text.replace('&quot;', '"')
    return text.strip()


def fix_media_paths(html: str) -> str:
    """Fix image and sound paths to point to media/ folder."""
    if not html:
        return ""
    # Fix image src attributes: src="filename.jpg" -> src="media/filename.jpg"
    html = re.sub(r'src="(?!media/)(?!http)([^"]+)"', r'src="media/\1"', html)
    # Fix sound references [sound:filename.mp3] -> audio element
    html = re.sub(r'\[sound:([^\]]+)\]', r'<audio controls src="media/\1"></audio>', html)
    return html


def parse_anki_collection(db_path: str) -> dict:
    """Parse the Anki SQLite database and extract all relevant data."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Get collection info (contains deck configuration)
    cursor.execute("SELECT decks, tags FROM col")
    row = cursor.fetchone()
    decks_json = json.loads(row[0]) if row[0] else {}
    tags_json = json.loads(row[1]) if row[1] else {}
    
    # Build deck hierarchy (skip default deck)
    decks = {}
    for deck_id, deck_info in decks_json.items():
        deck_name = deck_info.get("name", "Unknown")
        # Skip the default deck
        if deck_name.lower() in ["default", "par défaut"]:
            continue
        decks[deck_id] = {
            "id": deck_id,
            "name": deck_name
        }
    
    # Get all notes (contains the actual content)
    cursor.execute("SELECT id, mid, flds, tags FROM notes")
    notes = {}
    for note_id, model_id, fields, note_tags in cursor.fetchall():
        # Fields are separated by \x1f (unit separator)
        field_list = fields.split('\x1f') if fields else []
        notes[note_id] = {
            "id": note_id,
            "model_id": model_id,
            "fields": field_list
        }
    
    # Get all cards and link them to notes and decks
    # Use a dict to deduplicate: keep only one card per note
    cursor.execute("SELECT id, nid, did, ord FROM cards ORDER BY ord")
    cards_by_note = {}  # noteId -> card (keep first/best card per note)
    
    for card_id, note_id, deck_id, ord_num in cursor.fetchall():
        # Skip if we already have a card for this note
        if note_id in cards_by_note:
            continue
            
        note = notes.get(note_id, {})
        fields = note.get("fields", [])
        
        # Typically: field 0 = front, remaining fields = back
        front = fields[0] if len(fields) > 0 else ""
        
        # Combine all remaining fields into back (to capture audio in other fields)
        back_parts = fields[1:] if len(fields) > 1 else []
        back = "<br>".join(part for part in back_parts if part.strip())
        
        card = {
            "deckId": str(deck_id),
            "front": fix_media_paths(front),
            "frontClean": clean_html(front),
            "back": fix_media_paths(back),
            "backClean": clean_html(back)
        }
        cards_by_note[note_id] = card
    
    cards = list(cards_by_note.values())
    
    conn.close()
    
    # Build hierarchical deck structure
    deck_tree = build_deck_tree(decks)
    
    return {
        "decks": deck_tree,
        "cards": cards
    }


def build_deck_tree(decks: dict) -> list:
    """Build a hierarchical tree structure from flat deck list."""
    # Sort decks by name for consistent ordering
    sorted_decks = sorted(decks.values(), key=lambda d: d["name"])
    
    root_nodes = []
    deck_map = {}
    
    for deck in sorted_decks:
        name = deck["name"]
        parts = name.split("::")
        
        # Create tree path
        current_path = ""
        parent = None
        
        for i, part in enumerate(parts):
            if current_path:
                current_path += "::" + part
            else:
                current_path = part
            
            if current_path not in deck_map:
                node = {
                    "id": deck["id"] if current_path == name else f"virtual_{current_path}",
                    "name": part,
                    "fullPath": current_path,
                    "children": []
                }
                deck_map[current_path] = node
                
                if parent:
                    parent["children"].append(node)
                else:
                    # Check if already in root
                    exists = False
                    for root in root_nodes:
                        if root["fullPath"] == current_path:
                            exists = True
                            break
                    if not exists:
                        root_nodes.append(node)
            
            parent = deck_map[current_path]
    
    return root_nodes


def convert_colpkg_to_json(colpkg_path: str, output_path: str = None):
    """Main function to convert .colpkg to JSON."""
    if output_path is None:
        output_path = os.path.splitext(colpkg_path)[0] + "_data.json"
    
    print(f"Converting: {colpkg_path}")
    
    with tempfile.TemporaryDirectory() as temp_dir:
        # Extract the archive
        print("Extracting .colpkg file...")
        db_path = extract_colpkg(colpkg_path, temp_dir)
        
        # Parse the database
        print("Parsing Anki database...")
        data = parse_anki_collection(db_path)
        
        # Write to JSON
        print(f"Writing to: {output_path}")
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        print(f"Done! Extracted {len(data['cards'])} cards from {len(data['decks'])} top-level decks.")
    
    # Extract media files
    print("Extracting media files...")
    output_dir = os.path.dirname(output_path)
    media_count = extract_media(colpkg_path, output_dir)
    print(f"Extracted {media_count} media files to media/ folder.")
    
    return output_path


if __name__ == "__main__":
    import sys
    
    # Default: look for .colpkg files in the current directory
    script_dir = Path(__file__).parent
    
    if len(sys.argv) > 1:
        colpkg_file = sys.argv[1]
    else:
        # Find the first .colpkg file in the directory
        colpkg_files = list(script_dir.glob("*.colpkg"))
        if not colpkg_files:
            print("No .colpkg file found. Please provide a path as argument.")
            sys.exit(1)
        colpkg_file = str(colpkg_files[0])
    
    output_file = str(script_dir / "data.json")
    convert_colpkg_to_json(colpkg_file, output_file)
