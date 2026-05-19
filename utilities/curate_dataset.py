"""
curate_dataset.py

Creates a deployment-ready subset (~10,000 objects) from the full dataset
in full_image_archive/ and writes it back to data/.

Run this once before pushing to GitHub/Cloudflare Pages. It is NOT part of
the normal user workflow -- most installations will not have enough objects
to need paring down.

Reads from:
  full_image_archive/object_metadata.json  -- full metadata for all objects
  full_image_archive/height_index.json     -- [object_id, height_cm] pairs
      (auto-copied from data/height_index.json on first run if not present)
  full_image_archive/small_images/         -- all original images

Writes to (destructive -- replaces existing files):
  data/object_metadata.json
  data/height_index.json
  data/small_images/   (cleared and repopulated)

Selection criteria
------------------
1. Quality filter: >= 5 of 6 non-artist metadata fields must be filled.
   Fields scored: title, date, medium, department, culture, link.
   artist is excluded from scoring because anonymous authorship is legitimate
   for ancient works and should not count against them.

2. Stratified sample by height bucket, proportional to the qualified pool's
   natural distribution, so the full height range is represented.
   Objects under 2 cm are down-weighted to 0.7x (slightly under-sampled).
   Buckets with fewer objects than their target get all their objects taken.

3. Target: TARGET objects total (see constant below).

Reproducibility: set SEED to get the same sample each run.
"""

import json
import math
import os
import random
import shutil

SCRIPT_DIR  = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR    = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
ARCHIVE_DIR = os.path.join(ROOT_DIR, "full_image_archive")
DATA_DIR    = os.path.join(ROOT_DIR, "data")

ARCHIVE_META         = os.path.join(ARCHIVE_DIR, "object_metadata.json")
ARCHIVE_IMAGES       = os.path.join(ARCHIVE_DIR, "small_images")
ARCHIVE_HEIGHT_INDEX = os.path.join(ARCHIVE_DIR, "height_index.json")

DATA_HEIGHT_INDEX    = os.path.join(DATA_DIR, "height_index.json")

OUT_META    = os.path.join(DATA_DIR, "object_metadata.json")
OUT_HEIGHT  = os.path.join(DATA_DIR, "height_index.json")
OUT_IMAGES  = os.path.join(DATA_DIR, "small_images")

TARGET = 10_000
SEED   = 42  # change to get a different random sample

QUALITY_FIELDS = ["title", "date", "medium", "department", "culture", "link"]
MIN_QUALITY    = 5  # must have >= 5 of the 6 fields above

# (label, height_lo, height_hi, relative_weight)
# weight < 1.0 means under-sampled relative to pool proportion
BUCKETS = [
    ("<0.5cm",    0.0,   0.5,  1.0),
    ("0.5-2cm",   0.5,   2.0,  0.7),
    ("2-5cm",     2.0,   5.0,  1.0),
    ("5-10cm",    5.0,  10.0,  1.0),
    ("10-20cm",  10.0,  20.0,  1.0),
    ("20-50cm",  20.0,  50.0,  1.0),
    ("50-100cm", 50.0, 100.0,  1.0),
    ("100-150cm",100.0, 150.0, 1.0),
    (">150cm",   150.0, 9999,  1.0),
]


def quality_score(obj):
    return sum(1 for f in QUALITY_FIELDS if obj.get(f))


def bucket_label(height):
    for label, lo, hi, _ in BUCKETS:
        if lo <= height < hi:
            return label
    return BUCKETS[-1][0]


def main():
    random.seed(SEED)

    # On first run, archive the full height_index so this script stays
    # idempotent even after data/height_index.json has been overwritten.
    if not os.path.isfile(ARCHIVE_HEIGHT_INDEX):
        if not os.path.isfile(DATA_HEIGHT_INDEX):
            raise FileNotFoundError(
                "No height_index.json found in full_image_archive/ or data/. "
                "Run height_from_met_objects.py first."
            )
        print(f"Archiving height_index.json to {ARCHIVE_HEIGHT_INDEX} ...")
        shutil.copy2(DATA_HEIGHT_INDEX, ARCHIVE_HEIGHT_INDEX)

    print("Loading archived metadata and height index...")
    with open(ARCHIVE_META, encoding="utf-8") as f:
        meta = json.load(f)
    with open(ARCHIVE_HEIGHT_INDEX, encoding="utf-8") as f:
        height_index = json.load(f)

    height_map = {str(oid): h for oid, h in height_index}
    print(f"Full archive: {len(height_index):,} objects")

    # Build eligible pool: quality filter + image present in archive
    eligible = []
    for oid_str, obj in meta.items():
        if quality_score(obj) < MIN_QUALITY:
            continue
        h = height_map.get(oid_str)
        if h is None:
            continue
        if not os.path.isfile(os.path.join(ARCHIVE_IMAGES, oid_str + ".jpg")):
            continue
        eligible.append((oid_str, h))

    print(
        f"After quality filter (>= {MIN_QUALITY} of {len(QUALITY_FIELDS)} "
        f"non-artist fields): {len(eligible):,} objects"
    )

    # Group into height buckets
    bucketed = {b[0]: [] for b in BUCKETS}
    for oid_str, h in eligible:
        bucketed[bucket_label(h)].append((oid_str, h))

    # Compute weighted targets per bucket
    bucket_weights = {
        label: len(bucketed[label]) * bw
        for label, _, _, bw in BUCKETS
    }
    total_weight = sum(bucket_weights.values())

    targets = {}
    for label in bucket_weights:
        raw = TARGET * bucket_weights[label] / total_weight
        targets[label] = min(round(raw), len(bucketed[label]))

    # Adjust for rounding so total is exactly TARGET
    total = sum(targets.values())
    delta = TARGET - total
    if delta != 0:
        # Distribute remainder to the largest uncapped buckets
        sortable = sorted(
            [(label, len(bucketed[label]) - targets[label]) for label in targets],
            key=lambda x: -x[1]
        )
        for label, headroom in sortable:
            if delta == 0:
                break
            add = min(abs(delta), headroom) * (1 if delta > 0 else -1)
            targets[label] += add
            delta -= add

    print(f"\nSampling plan (target {TARGET:,}):")
    for label, lo, hi, bw in BUCKETS:
        pool_n = len(bucketed[label])
        t = targets[label]
        weight_note = f"  weight={bw}" if bw != 1.0 else ""
        status = "ALL" if t == pool_n else f"{t:,}"
        print(f"  {label:<12}  pool={pool_n:>6,}  target={status:>6}{weight_note}")
    print(f"  Total: {sum(targets.values()):,}")

    # Sample each bucket
    selected = []
    for label, info in [(b[0], bucketed[b[0]]) for b in BUCKETS]:
        t = targets[label]
        if t >= len(info):
            selected.extend(info)
        else:
            selected.extend(random.sample(info, t))

    print(f"\nActual selected: {len(selected):,} objects")

    sel_ids = {oid for oid, _ in selected}

    new_height_index = sorted(
        [[int(oid) if oid.isdigit() else oid, h] for oid, h in selected],
        key=lambda x: x[1],
    )
    new_meta = {oid: meta[oid] for oid in sel_ids if oid in meta}

    print(f"\nWriting data/height_index.json ...")
    with open(OUT_HEIGHT, "w", encoding="utf-8") as f:
        json.dump(new_height_index, f, separators=(",", ":"), ensure_ascii=False)

    print(f"Writing data/object_metadata.json ...")
    with open(OUT_META, "w", encoding="utf-8") as f:
        json.dump(new_meta, f, separators=(",", ":"), ensure_ascii=False)

    print(f"Clearing data/small_images/ and copying {len(selected):,} images ...")
    if os.path.isdir(OUT_IMAGES):
        shutil.rmtree(OUT_IMAGES)
    os.makedirs(OUT_IMAGES)

    for i, (oid_str, _) in enumerate(selected):
        src = os.path.join(ARCHIVE_IMAGES, oid_str + ".jpg")
        dst = os.path.join(OUT_IMAGES, oid_str + ".jpg")
        shutil.copy2(src, dst)
        if (i + 1) % 1000 == 0:
            print(f"  {i + 1:,} / {len(selected):,}")

    hi_mb   = os.path.getsize(OUT_HEIGHT) / 1e6
    meta_mb = os.path.getsize(OUT_META)   / 1e6

    print(f"\nDone.")
    print(f"  data/height_index.json    : {hi_mb:.1f} MB  ({len(new_height_index):,} objects)")
    print(f"  data/object_metadata.json : {meta_mb:.1f} MB")
    print(f"  data/small_images/        : {len(selected):,} images")

    if meta_mb > 25:
        print(f"\n  WARNING: object_metadata.json is {meta_mb:.1f} MB — exceeds Cloudflare's 25 MB limit.")
        print(f"  Consider lowering TARGET or reducing metadata fields.")


if __name__ == "__main__":
    main()
