the /data folder has MetObjectsWithHeightAndWeight.csv and the accompanying small_images folder copied from the met_cleaner folder on 20260309

## full_image_archive/

`full_image_archive/` contains the complete original dataset as copied from met_cleaner:
- `small_images/` — all ~154,000 object images, named `{object_id}.jpg`
- `object_metadata.json` — full metadata for all objects (51.8MB)

This folder is excluded from git (via `.gitignore`) because it exceeds Cloudflare Pages' 20,000-file and 25MB-per-file limits. The working `data/` directory holds the curated deployment subset. Preserve `full_image_archive/` locally as the source of truth when regenerating subsets.