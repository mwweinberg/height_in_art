"""
height_from_met_objects.py

Reads MetObjectsWithHeightAndWeight.csv and writes two files to ../data/:

1. height_index.json  (~3-4MB)
   Compact array used by the main app for height-matching at runtime.
   Format: [[object_id, height_cm], ...]  sorted ascending by height_cm.

2. object_metadata.json  (~30-40MB)
   Full metadata keyed by object_id (as string), loaded only by the info page
   for the small number of matched objects. Not loaded by the main app.
   Format: { "34": { "title": ..., "artist": ..., ... }, ... }

Only objects with a valid object_height_cm AND a local image file are included.
Objects with height <= 0 are excluded.
"""

import csv
import json
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_PATH    = os.path.join(SCRIPT_DIR, "MetObjectsWithHeightAndWeight.csv")
DATA_DIR    = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "data"))
IMAGES_DIR  = os.path.join(DATA_DIR, "small_images")

HEIGHT_INDEX_PATH = os.path.join(DATA_DIR, "height_index.json")
METADATA_PATH     = os.path.join(DATA_DIR, "object_metadata.json")


def main():
    height_index = []   # [[object_id, height_cm], ...]
    metadata = {}       # { str(object_id): { ... } }

    skipped_no_height = 0
    skipped_no_image  = 0
    total_rows        = 0

    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            total_rows += 1

            # Must have a valid positive numeric height
            height_raw = row.get("object_height_cm", "").strip()
            if not height_raw:
                skipped_no_height += 1
                continue
            try:
                height_cm = float(height_raw)
            except ValueError:
                skipped_no_height += 1
                continue
            if height_cm <= 0:
                skipped_no_height += 1
                continue

            # Must have a local image file
            object_id_raw = row.get("Object ID", "").strip()
            if not object_id_raw:
                skipped_no_image += 1
                continue
            if not os.path.isfile(os.path.join(IMAGES_DIR, object_id_raw + ".jpg")):
                skipped_no_image += 1
                continue

            try:
                object_id = int(object_id_raw)
            except ValueError:
                object_id = object_id_raw

            height_index.append([object_id, height_cm])

            metadata[str(object_id)] = {
                "title":       row.get("Title", "").strip() or None,
                "artist":      row.get("Artist Display Name", "").strip() or None,
                "date":        row.get("Object Date", "").strip() or None,
                "medium":      row.get("Medium", "").strip() or None,
                "department":  row.get("Department", "").strip() or None,
                "culture":     row.get("Culture", "").strip() or None,
                "link":        row.get("Link Resource", "").strip() or None,
                "image_url_small": row.get("image_url_small", "").strip() or None,
            }

    # Sort height index ascending so binary search is possible if needed later
    height_index.sort(key=lambda x: x[1])

    os.makedirs(DATA_DIR, exist_ok=True)

    with open(HEIGHT_INDEX_PATH, "w", encoding="utf-8") as f:
        json.dump(height_index, f, separators=(",", ":"), ensure_ascii=False)

    with open(METADATA_PATH, "w", encoding="utf-8") as f:
        json.dump(metadata, f, separators=(",", ":"), ensure_ascii=False)

    print(f"Total rows processed : {total_rows:,}")
    print(f"Skipped (no height)  : {skipped_no_height:,}")
    print(f"Skipped (no image)   : {skipped_no_image:,}")
    print(f"Objects written      : {len(height_index):,}")
    print(f"height_index.json    : {os.path.getsize(HEIGHT_INDEX_PATH) / 1e6:.1f} MB  →  {HEIGHT_INDEX_PATH}")
    print(f"object_metadata.json : {os.path.getsize(METADATA_PATH) / 1e6:.1f} MB  →  {METADATA_PATH}")


if __name__ == "__main__":
    main()
