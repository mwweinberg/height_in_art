# Height in Art — Project Notes

## Key Documents
- **`design.md`** — detailed application flow, data architecture, and design decisions. Read this before working on any feature.

## Overview
Interactive website that measures a user's height via webcam (ml5.js + TensorFlow) and assembles a stacked display of Met museum objects whose heights sum to the user's height. Matches the visual design and workflow of the `pose_match` sibling project.

## Resolved Design Decisions

### Calibration
- **Dedicated `/calibration` page** with live webcam feed + step-by-step instructions.
- **Calibration workflow**: operator marks floor spot → calibrator stands on mark (full body visible) → performs sweep gesture → enters actual height (cm or ft/in) → pixel-to-cm ratio stored in `localStorage`.
- **No calibration**: home page shows a prominent banner linking to `/calibration`.
- **Persistence**: calibration ratio stored in `localStorage` — survives page refresh/browser restart until explicitly reset.

### Gesture Trigger
- **Same gesture for both calibration and regular users**: start with hands at sides facing forward, sweep one hand in a full circle — across body, above head, and back to side — while continuing to face forward.
- Implementation: track wrist keypoint trajectory over a rolling ~4 second window; confirm the phase sequence (hip → above shoulder → hip) in order rather than checking a single frame.

### Object Matching
- **Tolerance**: sum of object heights must be within ±5% of the user's height.
- **Number of objects**: no target — keep adding objects until the sum reaches the user's height (within tolerance).
- **Constraints**: no more than 3 objects shorter than 2cm; no more than 1 object taller than 100cm.
- **Algorithm failure**: retry silently up to 100 attempts; if all fail, progressively relax tolerance (in 5% steps up to 50%) until a match is found.

### Display Layout
- **User view**: captured still frame shown at the moment objects are revealed; after 0.5 seconds switches back to live webcam feed.
- **Object stack**: single column, each image maintains its own aspect ratio; objects animate dropping one on top of the other from above without waiting for prior object to land.
- **No labels on images**: title/artist are not shown on the stacked images.
- **No height readout**: the user's measured height is not displayed.

### QR Code / Info Page
- **Approach**: object metadata is base64-encoded into the QR URL (`info.html?data=<base64 JSON>`).
- **Payload fallback**: `buildQRCode()` tries four progressively smaller payloads until one fits within QR code capacity (~2953 bytes): (1) full metadata, (2) id/title/artist/link/height_cm, (3) truncated title + link, (4) id + height_cm only. The minimal level always fits.
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
- [ ] **Remove debug overlay**: `drawDebugOverlay()` is called in `drawLeftPanel()` — remove before public launch
- [ ] **About page**: placeholder, content TBD

## Known Issues & Fixes

### ml5.js initialization (calibration.html)
- **`window._incrementPreload is not a function`**: ml5 hooks into p5's preload system when p5 is loaded. `calibration.html` doesn't run a p5 global sketch, so `_incrementPreload` is never set on `window`. Fixed by removing p5.js from `calibration.html` entirely.
- **`bodyPose.detectStart is not a function`**: CDN ml5 resolved to a version without `detectStart`. Fixed by using local `pose_match/ml5.min.js`.
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

## Deployment

Hosted via GitHub + Cloudflare Pages (static files only, no server).

**Online vs. local versions use different data slices:**
- **Online (Cloudflare Pages)**: curated subset within Cloudflare's 20,000-file and 25MB-per-file limits.
- **Local/museum install**: full dataset (154k images, 51.8MB metadata).

`utilities/MetObjectsWithHeightAndWeight.csv` (127MB) is `.gitignore`d.

## Data Files
- `utilities/MetObjectsWithHeightAndWeight.csv` — source data (127MB, ~206k rows), not served to browser
- `data/height_index.json` — compact `[[object_id, height_cm], ...]` array, loaded by main app at startup (2.1MB)
- `data/object_metadata.json` — full metadata keyed by object_id string (51.8MB), loaded in background; encoded into QR URL
- `data/small_images/` — ~154k object images, filenames are `{object_id}.jpg`

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
