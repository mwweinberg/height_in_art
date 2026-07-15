# Height in Art — Project Notes

## Key Documents
- **`design.md`** — detailed application flow, data architecture, and design decisions. Read this before working on any feature.
- **`deployment.md`** — museum-facing getting-started guide (hardware, local install, calibration, daily operation, troubleshooting). Keep it in sync when operational behavior changes (calibration flow, QR config, debug access).

## Overview
Interactive website that measures a user's height via webcam (ml5.js + TensorFlow) and assembles a stacked display of Met museum objects whose heights sum to the user's height. Matches the visual design and workflow of the `pose_match` sibling project.

## Resolved Design Decisions

### Calibration
- **Dedicated `/calibration` page** with live webcam feed + step-by-step instructions.
- **Calibration workflow**: operator marks floor spot → calibrator stands on mark (full body visible) → performs sweep gesture → enters actual height (cm or ft/in) → pixel-to-cm ratio stored in `localStorage`.
- **No calibration**: home page shows a prominent banner linking to `/calibration`.
- **Persistence**: calibration ratio stored in `localStorage` — survives page refresh/browser restart until explicitly reset.
- **Calibration format (v2)**: `{version: 2, fractionPerCm, videoWidth, videoHeight, pixelsPerCm}`. `fractionPerCm` = (pixel span / video height in px) per cm — resolution-independent, measured and applied in raw video coordinates so the calibration page and main app don't need matching camera resolutions. `loadCalibration()` in sketch.js rejects anything that isn't valid v2 (including pre-v2 calibrations, which were saved with buggy math) and shows the banner.
- **Measurement sampling**: both calibration and the main app sample the pose for ~0.8s after the gesture (`MEASURE_WINDOW_MS`) and use the median pixel span, rather than a single noisy frame.

### Gesture Trigger
- **Same gesture for both calibration and regular users**: start with hands at sides facing forward, sweep one hand in a full circle — across body, above head, and back to side — while continuing to face forward.
- Implementation: track wrist keypoint trajectory over a rolling ~4 second window; confirm the phase sequence (hip → above shoulder → hip) in order rather than checking a single frame.
- **Shared module**: all gesture/tracking logic lives in `gesture-tracker.js` (`createGestureTrackerSet`), used by both sketch.js and calibration.html — do not reimplement it inline. Trackers are matched to poses frame-to-frame by centroid nearest-neighbor (MoveNet multi-pose output order is NOT stable), so the person who gestured is the person measured. The "at hip" margin scales with torso length (0.7 × shoulder-to-hip distance) instead of a fixed pixel count.

### Object Matching
- **Tolerance**: sum of object heights must be within ±5% of the user's height.
- **Number of objects**: no target — keep adding objects until the sum reaches the user's height (within tolerance).
- **Constraints**: no more than 3 objects shorter than 2cm; no more than 1 object taller than 100cm.
- **Algorithm failure**: retry silently up to 100 attempts; if all fail, progressively relax tolerance (in 5% steps up to 50%) until a match is found.

### Display Layout
- **User view**: captured still frame shown at the moment objects are revealed; after 0.5 seconds switches back to live webcam feed. The webcam preview is mirrored (like a mirror) on both index and calibration pages; keypoint overlays mirror their x coordinates to match.
- **Idle reset**: after 60s with nobody detected in frame (`IDLE_RESET_MS`), the display resets to the idle attract screen for the next visitor.
- **Failure feedback**: measurement/matching failures show a transient message on the right panel (`showStatus()` in sketch.js) instead of failing silently; successful matches populate the `#match-announcement` aria-live region.
- **Object stack**: single column, each image maintains its own aspect ratio; objects animate dropping one on top of the other from above without waiting for prior object to land.
- **No labels on images**: title/artist are not shown on the stacked images.
- **No height readout**: the user's measured height is not displayed.

### QR Code / Info Page
- **Approach**: object metadata is base64-encoded into the QR URL (`info.html?data=<base64 JSON>`).
- **Payload fallback**: `buildQRCode()` tries four progressively smaller payloads until one fits within QR code capacity (~2953 bytes): (1) full metadata, (2) id/title/artist/link/height_cm, (3) truncated title + link, (4) id + height_cm only. `MAX_STACK_OBJECTS = 25` in matching keeps even the minimal payload within capacity; if every level still fails, the QR box is hidden and "Link unavailable" is shown instead of an empty white square.
- **Open items (deliberately not yet addressed)**: (a) the `link` field from a QR payload is emitted into an href with only HTML-escaping — a crafted payload could carry a `javascript:` URL; (b) info.html thumbnails 404 for objects outside the deployed subset (e.g. QR from a full-dataset museum install) with no fallback image.
- **Public base URL**: `publicInfoBaseUrl` in branding.js overrides `window.location.href` as the QR link base. REQUIRED for the local/museum install — otherwise QR codes point at localhost and are dead on visitors' phones.
- **Info page behavior**: when payload contains `title` fields (levels 1–3), renders immediately — no network calls, works offline. When payload is minimal (level 4), fetches metadata from the Met Museum API in parallel for each object, shows "Loading artwork details…" during fetch.
- **Timing**: `object_metadata.json` (51.8MB) begins loading in the background immediately after `height_index.json` finishes. QR is not shown until metadata is loaded and a match has been made. While waiting, a "Preparing your link…" indicator is shown.
- **QR placement**: `#qr-sidebar` lives to the right of `#canvas-container` in a `#main-layout` flex row — completely outside the canvas, no z-index issues. Sidebar is `height: 600px` with `justify-content: flex-end` so the QR code and caption bottom-align with the canvas.

### Height Estimation
- **Partial occlusion**: use visible keypoints + body proportion estimation as fallback; show a mild persistent warning.
- **Multiple people in frame**: measure whichever person performs the trigger gesture.

### Info Page
- **Layout**: vertical scrolling list of cards, one per matched object. Gracefully handles missing fields since payload level varies.
- **Metadata enrichment**: if the payload lacks `title` (minimal fallback), fetches from the Met Museum API (`https://collectionapi.metmuseum.org/public/collection/v1/objects/{id}`) in parallel for all objects. Shows "Loading artwork details…" during fetch. Existing payload fields are never overwritten.

## Tasks

- [x] **Data pre-processing**: `utilities/height_from_met_objects.py` generates `data/height_index.json` (2.1MB) and `data/object_metadata.json` (51.8MB)
- [x] **Supporting files**: `branding.js`, `analytics.js`, `branding/` present and loaded
- [x] **`index.html` / `sketch.js`**: Pose detection, gesture trigger, object matching, drop animation, QR code, debug overlay
- [x] **`info.html`**: Multi-object card layout; handles partial payloads gracefully
- [x] **Height estimation logic**: Pixel-to-cm via calibration ratio; partial occlusion fallback
- [x] **`calibration.html`**: Webcam overlay, gesture detection, height form, localStorage persistence
- [x] **`gesture-animation.js`**: Animated stick figure; `createGestureAnimation()` uses plain canvas (no p5 dependency)
- [x] **`gesture-tracker.js`**: Shared gesture/tracking module used by sketch.js and calibration.html
- [x] **Debug overlay**: gated behind `?debug` in the URL (`index.html?debug`) — hidden from the public by default; calibration.html's debug panel is always on (operator-facing page)
- [ ] **About page**: placeholder, content TBD (Privacy section added)
- [ ] **Set `publicInfoBaseUrl`** in branding.js once the public deployment URL is final (required for museum-install QR codes)

## Known Issues & Fixes

### ml5.js initialization (calibration.html)
- **`window._incrementPreload is not a function`**: ml5 hooks into p5's preload system when p5 is loaded. `calibration.html` doesn't run a p5 global sketch, so `_incrementPreload` is never set on `window`. Fixed by removing p5.js from `calibration.html` entirely.
- **`bodyPose.detectStart is not a function`**: CDN ml5 resolved to a version without `detectStart`. Fixed by using a local copy of ml5 (`ml5.min.js` at project root).
- **`this.model is null` in detectLoop**: `detectStart` called before TF.js backend initialized. Fix: `bodyPose = await ml5.bodyPose(...); await bodyPose.ready;` then call `detectStart`.
- **`lHip.confidence is undefined`**: ml5 v1 uses `score` not `confidence`. Fixed throughout.

### Gesture animation (gesture-animation.js)
- **`createGestureAnimation` required p5**: Previously used `new p5(...)` instance mode, which forced p5.js onto every page that showed the animation. Rewritten to use a plain `<canvas>` + `requestAnimationFrame` with a thin p5-API adapter (push/pop, stroke, fill, line, ellipse). `gestureStickFigure()` itself is unchanged and still works with both a real p5 instance and the adapter.
- **Stick figure not displaying**: Fixed ctx references — `ctx.HALF_PI` → `Math.PI / 2`, `ctx.cos` → `Math.cos`, etc.
- **Drawing state bleed**: Added `ctx.push()` / `ctx.pop()` inside `gestureStickFigure`.

### Skeleton overlay misalignment (sketch.js and calibration.html)
- **Root cause**: webcam video is crop-to-fit (equivalent of `object-fit: cover`) into its display area, but keypoints were mapped using naive `kp.x * displayW / videoWidth` — ignoring the crop offset.
- **Fix in `sketch.js`**: `drawDebugOverlay()` now uses `(kp.x - cropSx) * LEFT_W / cropSw` and `(kp.y - cropSy) * CANVAS_H / cropSh` where `cropSx/cropSy/cropSw/cropSh` are computed each frame in `drawLeftPanel()`.
- **Fix in `calibration.html`**: Canvas is sized to the container's display dimensions (not raw video resolution); same crop math applied via `vx(x)` / `vy(y)` helpers in `drawOverlay()`.

### QR code not appearing (sketch.js / index.html)
- **URL too long for QR**: Full metadata for many objects easily exceeds QR code capacity (~2953 bytes). `qrCode.makeCode()` throws silently; if the exception was uncaught the div stayed hidden. Fixed with 4-level payload fallback (see QR Code section above) and unconditional `display: 'block'` after the attempt loop.
- **Canvas painted over QR div**: p5 appends its canvas after the QR div in the DOM, painting over it. Fixed by moving `#qrcode` and `#qr-loading` out of `#canvas-container` into a separate `#qr-sidebar` div in a flex row next to the canvas — no z-index involved.
- **QR sidebar vertical alignment**: sidebar previously used `padding-top: 160px` to push QR roughly mid-canvas. Changed to `height: 600px; justify-content: flex-end` so the bottom of the QR and caption align exactly with the bottom of the canvas.

### Info page blank when minimal payload (info.html)
- **Root cause**: when `buildQRCode()` falls back to level 4 (id + height_cm only), the info page had nothing to display for title, artist, etc. — it only renders what's in the payload.
- **Fix**: `info.html` detects missing `title` fields and fetches metadata from the Met Museum API in parallel for each object before rendering. Payload fields always take precedence over API data.

### Calibration produced wrong heights (fixed July 2026)
- **Units mismatch**: calibration stored pixels-per-cm in raw video coordinates, but `measureHeightCm()` converted its measurement to canvas coordinates (`CANVAS_H / cropSh` = 1.25×) before dividing — a systematic 25% overestimate. Fix: both sides now work in a resolution-independent fraction of video height (calibration format v2, `fractionPerCm`). Never mix video-space and canvas-space pixels in measurement math.
- **Eye-averaging bug**: `eyeY = (eyeY || leftEye.y + leftEye.y) / (eyeY ? 2 : 1)` doubled the left eye's y, putting the estimated head top *below* the nose whenever the left eye was visible. Rewritten as an explicit two-eye average (same logic as calibration.html always had).
- Existing localStorage calibrations from before these fixes are invalid; `loadCalibration()` rejects them and the banner prompts recalibration.

### ml5.min.js missing on Cloudflare Pages (index.html / calibration.html)
- **Root cause**: `ml5.min.js` was originally loaded from `pose_match/ml5.min.js`, but `pose_match/.gitignore` explicitly excludes `/ml5.min.js`. The file existed locally but was never committed, so Cloudflare served a 404 and `ml5` was undefined at runtime.
- **Fix**: copied `ml5.min.js` to the project root (outside `pose_match/`'s gitignore scope) and updated the `<script src>` in `index.html` and `calibration.html` to reference `ml5.min.js` directly.

## Deployment

Hosted via GitHub + Cloudflare Pages (static files only, no server).

**All libraries are vendored locally** (`p5.min.js`, `ml5.min.js`, `qrcode.min.js` at project root) — no CDN dependencies, so the museum install works without internet. Don't reintroduce CDN script tags.

**Online vs. local versions use different data slices:**
- **Online (Cloudflare Pages)**: curated subset within Cloudflare's 20,000-file and 25MB-per-file limits.
- **Local/museum install**: full dataset (154k images, 51.8MB metadata).

`utilities/MetObjectsWithHeightAndWeight.csv` (127MB) is `.gitignore`d.

## Data Files

**Deployed (committed to repo, served by Cloudflare Pages):**
- `data/height_index.json` — compact `[[object_id, height_cm], ...]` array, loaded by main app at startup (0.13MB, 10,000 objects)
- `data/object_metadata.json` — metadata keyed by object_id string (3.46MB, 10,000 objects), loaded in background; encoded into QR URL
- `data/small_images/` — 10,000 curated object images, filenames are `{object_id}.jpg`

**Local only (gitignored):**
- `full_image_archive/` — complete original dataset: 154,177 images, full `object_metadata.json` (51.8MB), and `height_index.json`. Source of truth for regenerating the deployed subset via `utilities/curate_dataset.py`.
- `utilities/MetObjectsWithHeightAndWeight.csv` — source CSV (127MB, ~206k rows), not served to browser

## Page Layout (index.html)

```
body (flex column, centered)
  #calibration-banner       — shown when no calibration in localStorage
  #page-header
  #main-layout              — flex row
    #canvas-container       — 800×600 p5 canvas (left panel: webcam, right panel: objects)
    #qr-sidebar             — hidden until match; shown to right of canvas
      #qr-caption
      #qr-loading
      #qrcode
  #recalibrate-link
  #page-footer
```

## Local Development
```bash
cd /Users/weinbergm/Documents/Programming/weight_in_art_and_height/height_in_art
python3 -m http.server 8000
# open http://localhost:8000
```
Webcam requires serving over HTTP (not `file://`).

## Reference Project
`pose_match/` — sibling project to match visual design, grammar, and workflow.
