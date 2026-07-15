# Height in Art — Deployment Guide

A getting-started guide for installing and operating Height in Art in a museum,
gallery, or classroom. No programming knowledge is required, but you should be
comfortable copying files and running one command in a terminal.

## What this is

Height in Art is a website that measures a visitor's height using a webcam and
builds a stack of objects from The Met's collection whose heights add up to
theirs. Everything runs locally in the browser — no images or measurements are
uploaded anywhere. Visitors can scan a QR code to see details about their
objects on their own phone.

## What you need

- **A computer** — any reasonably recent laptop or mini PC. Pose detection runs
  in the browser; a machine from the last ~5 years handles it comfortably.
- **A webcam** — built-in or USB, 640×480 or better. Mount it so a person's
  **entire body, head to feet, is visible** when standing 2–4 m away.
- **A display** for visitors to watch (the laptop screen or an external monitor).
- **A modern browser** — Chrome is recommended and is what the project is tested with.
- **Floor space** with a fixed, marked standing spot (tape works). Even,
  front-facing lighting helps pose detection considerably; avoid strong backlight
  (e.g. a window directly behind the standing spot).

Internet is only needed by *visitors' phones* when they scan the QR code — the
exhibit machine itself can run fully offline (all libraries are bundled locally).

## Two ways to run it

**Online version** — the site is hosted on Cloudflare Pages and works in any
browser at the public URL. It uses a curated subset of ~10,000 objects. Nothing
to install; skip to "Physical setup" and "Calibration."

**Local / museum install** — runs from files on the exhibit machine, optionally
with the full ~154,000-object dataset. Use this for a gallery installation.

## Setting up a local install

1. **Copy the project folder** to the exhibit machine. Keep it as a dedicated
   copy for the exhibit rather than a working development checkout.

2. **(Optional) Use the full dataset.** The repo ships with the curated 10,000
   object subset in `data/`. If you have the `full_image_archive/` folder
   (154,000 images + full metadata — not included in the git repo), replace the
   contents of `data/` on the exhibit copy with:
   - `full_image_archive/height_index.json` → `data/height_index.json`
   - `full_image_archive/object_metadata.json` → `data/object_metadata.json`
   - `full_image_archive/small_images/` → `data/small_images/`

   Do this only on the exhibit copy — don't commit the full dataset to git.

3. **Point QR codes at the public site.** This step is required. Open
   `branding.js`, find `publicInfoBaseUrl`, and set it to the public deployment
   URL (with a trailing slash), e.g.

   ```js
   publicInfoBaseUrl: "https://your-site.pages.dev/",
   ```

   Without this, QR codes generated on a local install point at the exhibit
   machine's own address (`http://localhost:8000/…`), which is a dead link on a
   visitor's phone.

4. **Start the server.** In a terminal, from the project folder:

   ```bash
   cd /path/to/height_in_art
   python3 -m http.server 8000
   ```

   Then open **http://localhost:8000** in the browser. The site must be served
   this way — opening `index.html` directly as a file will not get camera access.

   > Serving to *other* machines on the network won't work for the camera:
   > browsers only allow webcam access over `localhost` or HTTPS. Run the
   > browser on the same machine as the server.

5. **Grant camera access** when the browser asks, and choose "Allow" /
   "Remember this decision" so it doesn't re-prompt after a restart.

## Physical setup

- Mount the camera so the **full body** of a person on the standing spot is in
  frame — head and feet both visible, with some margin. Chest height, tilted
  slightly, usually works well.
- **Mark the floor spot** where visitors will stand. The measurement is only
  accurate at the distance where calibration was done, so the mark matters.
- Once the camera and mark are set, **don't move either** — if the camera is
  bumped or the spot moves, recalibrate.

## Calibration (one-time, ~2 minutes)

The app converts pixels to centimetres using a reference person of known height.

1. Open **http://localhost:8000/calibration.html** (or click the red banner on
   the home page, or the faint "Recalibrate" link at the bottom-left).
2. Have someone whose exact height you know stand on the floor mark, whole body
   visible. The live skeleton overlay and the status panel below the video show
   what the system sees.
3. They perform the gesture: starting with arms at their sides, sweep one hand
   in a full circle — across the body, above the head, and back down.
4. The system measures for about a second ("Hold still — measuring…"), then a
   form appears. Enter the person's real height (cm or ft/in) and click
   **Save Calibration**. Use "Redo gesture" if the capture looked wrong.
5. Click through to the home page — the red banner should be gone.

Calibration notes:

- Calibration is stored **in that browser on that machine**. Switching browsers,
  clearing browsing data, or serving on a different port means recalibrating.
- Recalibrate whenever the camera, its zoom/resolution, or the floor mark changes.
- Anyone of known height works as the calibrator; taller is slightly better
  (more pixels = less error).

## Daily operation

Startup checklist:

1. Start the server (step 4 above) — consider a startup script so it launches on boot.
2. Open http://localhost:8000 in the browser; full-screen it (Chrome:
   `View → Enter Full Screen`, or launch with `--kiosk http://localhost:8000`).
3. Confirm there's **no red calibration banner**.
4. Stand on the mark, make the gesture, and confirm you get a sensible stack.
5. Disable the machine's sleep/screensaver settings.

While running, the app takes care of itself: visitors gesture, see their stack
and QR code, and the display automatically returns to the "make this gesture"
screen after about a minute with nobody in frame.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Red "needs to be calibrated" banner | No calibration stored in this browser — run calibration.html. |
| "Camera unavailable" on the left panel | Camera permission denied, camera in use by another app, or page not served over localhost. Check the browser's camera permission (icon in the address bar), then reload. |
| Gesture doesn't trigger | Whole body (especially hips) must be visible and facing the camera. Check lighting/backlight. Open **index.html?debug** to see the skeleton and gesture-phase readout live, or use calibration.html's always-on status panel. |
| "We couldn't measure you" message | Feet or head out of frame during the measurement second. Re-check camera framing against the floor mark. |
| Heights are consistently wrong | Camera or floor mark moved since calibration, or visitors aren't standing on the mark. Recalibrate. |
| "For best results…" warning stays up | The last visitor's lower body was hidden; the app estimated from partial keypoints. It clears after the next full-body measurement. |
| QR code opens a dead page on phones | `publicInfoBaseUrl` isn't set in branding.js (local installs) — see step 3. |
| Everything is frozen | Reload the page. The server and browser are independent; if the terminal window with the server was closed, restart it. |

## Privacy

All pose detection runs locally in the browser on the exhibit machine. Camera
frames are never uploaded, stored, or logged. The QR code
contains only the matched objects' catalogue data, not any image of the visitor.
The site loads anonymous, cookie-free page analytics (see `analytics.js`);
remove or empty that file if your institution requires zero third-party requests.
