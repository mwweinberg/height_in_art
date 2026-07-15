// =============================================================================
// Height in Art — sketch.js
// p5.js + ml5.js (MoveNet) main application
// =============================================================================

// --- Constants ---------------------------------------------------------------

const CANVAS_W = 800;
const CANVAS_H = 600;
const LEFT_W   = 400;   // webcam panel width
const RIGHT_W  = 400;   // objects panel width

// MoveNet keypoint indices (COCO order)
const KP = {
  NOSE: 0, LEFT_EYE: 1, RIGHT_EYE: 2,
  LEFT_EAR: 3, RIGHT_EAR: 4,
  LEFT_SHOULDER: 5, RIGHT_SHOULDER: 6,
  LEFT_ELBOW: 7, RIGHT_ELBOW: 8,
  LEFT_WRIST: 9, RIGHT_WRIST: 10,
  LEFT_HIP: 11, RIGHT_HIP: 12,
  LEFT_KNEE: 13, RIGHT_KNEE: 14,
  LEFT_ANKLE: 15, RIGHT_ANKLE: 16
};

const CONFIDENCE_THRESHOLD = 0.10; // lowered to capture more samples, esp. raised wrist

// Debug overlay — enabled with ?debug in the URL (e.g. index.html?debug)
const DEBUG_MODE = new URLSearchParams(window.location.search).has('debug');

// Measurement: sample the pose for this long after the gesture, use the median
const MEASURE_WINDOW_MS  = 800;
const MEASURE_MIN_SAMPLES = 3;

// Still-frame display duration before switching back to live
const STILL_DURATION_MS = 500;

// Reset to the idle attract screen after this long with nobody in frame
const IDLE_RESET_MS = 60000;

// Object drop animation
const DROP_STAGGER_MS  = 250;  // delay between each object starting to fall
const DROP_DURATION_MS = 700;  // time for one object to reach its resting place

// Object matching
const BASE_TOLERANCE    = 0.05;
const MAX_RETRIES       = 100;
const TOLERANCE_STEP    = 0.05;
const MAX_TOLERANCE     = 0.50;
const MAX_SMALL_OBJECTS = 3;   // objects < 2 cm
const MAX_LARGE_OBJECTS = 1;   // objects > 100 cm
const MAX_STACK_OBJECTS = 25;  // keeps the stack legible and the QR payload within capacity

// Right-panel layout
const PANEL_PADDING_TOP    = 20;
const PANEL_PADDING_BOTTOM = 20;
const STACK_AREA_H = CANVAS_H - PANEL_PADDING_TOP - PANEL_PADDING_BOTTOM;

// --- App State ---------------------------------------------------------------

let appState = 'IDLE'; // 'IDLE' | 'MEASURING' | 'DISPLAYING'

// In-progress measurement: { trackerId, samples: [videoPx], occludedCount, endTime }
let measuring = null;
let stateBeforeMeasure = 'IDLE';

// Transient visitor-facing message drawn on the right panel
let statusMsg = null; // { text, until }

// --- p5 / ml5 globals --------------------------------------------------------

let bodyPose;
let video;
let poses = [];
let cameraReady = false;
let cameraError = false;
let lastPoseSeenTime = 0;

// Webcam crop params (updated each draw, used for still capture)
let cropSx = 0, cropSy = 0, cropSw = 640, cropSh = 480;

// Still frame
let stillFrame      = null;
let stillCapturedAt = 0;
let showingStill    = false;

// --- Calibration -------------------------------------------------------------
// v2 format: { version: 2, fractionPerCm, videoWidth, videoHeight }
// fractionPerCm = (person's pixel height / video height in px) per cm of real
// height — resolution-independent, measured and applied in raw video coords.

let calibration = null;

// --- Data --------------------------------------------------------------------

let heightIndex  = null;  // [[object_id, height_cm], ...]
let heightIndexError = false;
let objectMetadata = null;  // { "id": { title, artist, date, medium, department, culture, link } }
let metadataReady  = false;

// --- Gesture Tracking (shared module: gesture-tracker.js) ---------------------

let trackerSet = null;

// --- Matched Objects & Animation ---------------------------------------------

let matchedObjects = [];
// Each entry: { id, heightCm, title, artist, img, displayH, displayW, targetY, dropStartTime }

// --- QR Code / Info URL ------------------------------------------------------

let qrCode  = null;
let qrBuilt = false;
let infoUrl = null;  // set when QR is built; used by click handler

// =============================================================================
// p5.js lifecycle
// =============================================================================

function preload() {
  bodyPose = ml5.bodyPose('MoveNet', { multiPose: true });
}

function setup() {
  let canvas = createCanvas(CANVAS_W, CANVAS_H);
  canvas.parent('canvas-container');
  canvas.elt.setAttribute('aria-label',
    'Height in Art: webcam feed on the left, matched artworks on the right.');

  // Remove loading placeholder once model is ready
  let msg = document.getElementById('loading-message');
  if (msg) msg.remove();

  calibration = loadCalibration();
  updateCalibrationBanner();

  trackerSet = createGestureTrackerSet({
    confidence: CONFIDENCE_THRESHOLD,
    cooldownMs: 3000
  });

  // Load height index
  loadJSON('data/height_index.json', function(data) {
    heightIndex = Array.isArray(data) ? data : Object.values(data);
    loadMetadataInBackground();
  }, function(err) {
    console.error('Failed to load height_index.json:', err);
    heightIndexError = true;
  });

  // Webcam (single capture — p5 owns the stream)
  video = createCapture(VIDEO, function() {
    cameraReady = true;
    bodyPose.detectStart(video, function(results) {
      poses = results;
    });
  });
  video.size(640, 480);
  video.hide();

  video.elt.addEventListener('error', function() { cameraError = true; });
  // If the camera never becomes ready (permission denied, no device), surface it.
  setTimeout(function() { if (!cameraReady) cameraError = true; }, 15000);

  // QR widget (hidden until built)
  qrCode = new QRCode(document.getElementById('qrcode'), {
    width: 140, height: 140,
    colorDark: '#000000', colorLight: '#ffffff'
  });
}

function draw() {
  background(0, 34, 53); // #002235

  drawLeftPanel();
  drawRightPanel();

  let now = millis();
  if (poses.length > 0) lastPoseSeenTime = now;

  trackerSet.update(poses, now, videoNativeHeight());

  if (appState === 'MEASURING') {
    updateMeasurement(now);
  } else {
    let hit = trackerSet.checkTrigger(now);
    if (hit) startMeasurement(hit);
  }

  // Switch still frame back to live after STILL_DURATION_MS
  if (showingStill && now - stillCapturedAt >= STILL_DURATION_MS) {
    showingStill = false;
  }

  // Reset the display for the next visitor after a while with nobody in frame
  if (appState === 'DISPLAYING' && lastPoseSeenTime > 0 &&
      now - lastPoseSeenTime > IDLE_RESET_MS) {
    resetToIdle();
  }

  // Pointer cursor when hovering the right panel with an info URL ready
  if (infoUrl && mouseX > LEFT_W) {
    cursor(HAND);
  } else {
    cursor(ARROW);
  }
}

function mousePressed() {
  if (infoUrl && mouseX > LEFT_W) {
    window.open(infoUrl, '_blank');
  }
}

function resetToIdle() {
  appState       = 'IDLE';
  matchedObjects = [];
  measuring      = null;
  infoUrl        = null;
  qrBuilt        = false;
  stillFrame     = null;
  showingStill   = false;
  hideQR();
  showOcclusionWarning(false);
  announce('');
}

// =============================================================================
// Panel drawing
// =============================================================================

function videoNativeHeight() {
  return (video && video.elt && video.elt.videoHeight) || (video && video.height) || 480;
}

function drawLeftPanel() {
  if (!cameraReady) {
    fill(30);
    noStroke();
    rect(0, 0, LEFT_W, CANVAS_H);
    if (cameraError) {
      fill(255);
      textAlign(CENTER, CENTER);
      textSize(16);
      text('Camera unavailable', LEFT_W / 2, CANVAS_H / 2 - 20);
      textSize(13);
      fill(180);
      text('Please allow camera access\nto use Height in Art', LEFT_W / 2, CANVAS_H / 2 + 20);
    }
    return;
  }

  // Crop-to-fit the webcam into the left panel
  let vidW = video.width  || 640;
  let vidH = video.height || 480;
  let vidRatio  = vidW / vidH;
  let areaRatio = LEFT_W / CANVAS_H;
  let sx, sy, sw, sh;

  if (vidRatio > areaRatio) {
    sh = vidH; sw = vidH * areaRatio;
    sx = (vidW - sw) / 2; sy = 0;
  } else {
    sw = vidW; sh = vidW / areaRatio;
    sx = 0; sy = (vidH - sh) / 2;
  }
  cropSx = sx; cropSy = sy; cropSw = sw; cropSh = sh;

  // Mirror the preview so it reads like a mirror
  push();
  translate(LEFT_W, 0);
  scale(-1, 1);
  if (showingStill && stillFrame) {
    image(stillFrame, 0, 0, LEFT_W, CANVAS_H);
  } else {
    image(video, 0, 0, LEFT_W, CANVAS_H, sx, sy, sw, sh);
  }
  pop();

  if (DEBUG_MODE) drawDebugOverlay();
}

function drawDebugOverlay() {
  if (poses.length === 0) {
    fill(0, 0, 0, 140);
    noStroke();
    rect(4, CANVAS_H - 30, 220, 24, 4);
    fill(255, 80, 80);
    textSize(11);
    textAlign(LEFT, CENTER);
    text('No poses detected', 10, CANVAS_H - 18);
    return;
  }

  for (let i = 0; i < poses.length; i++) {
    let pose = poses[i];
    if (!pose || !pose.keypoints) continue;
    let kp = pose.keypoints;

    // Video coords → canvas coords via crop params, then mirrored to match the preview
    function vx(x) { return LEFT_W - (x - cropSx) * LEFT_W / cropSw; }
    function vy(y) { return (y - cropSy) * CANVAS_H / cropSh; }
    const SKEL = [[0,1],[0,2],[1,3],[2,4],[5,6],[5,7],[7,9],[6,8],[8,10],[5,11],[6,12],[11,12],[11,13],[13,15],[12,14],[14,16]];
    for (let [a, b] of SKEL) {
      let ka = kp[a], kb = kp[b];
      if (!ka || !kb || ka.score < 0.1 || kb.score < 0.1) continue;
      stroke(0, 244, 123, 120);
      strokeWeight(2);
      line(vx(ka.x), vy(ka.y), vx(kb.x), vy(kb.y));
    }
    noStroke();

    let tracker = trackerSet.getTrackerForPose(i);
    let phase = 0;
    if (tracker && tracker.samples.length > 0) {
      for (let wKey of ['leftWristY', 'rightWristY']) {
        let p = trackerSet.gesturePhase(tracker.samples, wKey);
        if (p > phase) phase = p;
      }
    }
    let phaseDesc = ['① arm at side', '② raise arm', '③ lower arm', '✓ triggered'][phase];
    let samples = tracker ? tracker.samples.length : 0;
    let trackerId = tracker ? tracker.id : '—';

    let lHip = kp[11], rHip = kp[12];
    let hipOk = (lHip && lHip.score > 0.1) || (rHip && rHip.score > 0.1);

    let yOff = CANVAS_H - 52 - i * 56;
    fill(0, 0, 0, 160);
    noStroke();
    rect(4, yOff, 230, 50, 4);
    textSize(11);
    textAlign(LEFT, TOP);
    fill(0, 244, 123);
    text('Person #' + trackerId + '  samples:' + samples + '  hips:' + (hipOk ? '✓' : '✗'), 10, yOff + 6);
    fill(255, 220, 0);
    text(phaseDesc, 10, yOff + 22);
    fill(180);
    text('lHip:' + (lHip ? lHip.score.toFixed(2) : '—') + '  rHip:' + (rHip ? rHip.score.toFixed(2) : '—'), 10, yOff + 38);
  }
}

function drawRightPanel() {
  // Dark background
  fill(10, 30, 45);
  noStroke();
  rect(LEFT_W, 0, RIGHT_W, CANVAS_H);

  let cx = LEFT_W + RIGHT_W / 2;

  if (matchedObjects.length === 0) {
    gestureStickFigure(window, cx, CANVAS_H / 2 - 10, millis(), 1.15);
    fill(255, 255, 255, 50);
    textAlign(CENTER, CENTER);
    textSize(13);
    noStroke();
    text('Make this gesture to measure\nyour height in art.',
         cx, CANVAS_H / 2 + 115);
  } else {
    // Draw each matched object with drop animation
    let now = millis();

    for (let i = 0; i < matchedObjects.length; i++) {
      let obj = matchedObjects[i];
      if (!obj.img) continue;

      let elapsed = now - obj.dropStartTime;
      if (elapsed < 0) continue; // drop hasn't started yet

      let progress = Math.min(1, elapsed / DROP_DURATION_MS);
      let eased    = progress * progress; // ease-in quad (gravity feel)
      let currentY = lerp(-obj.displayH, obj.targetY, eased);

      let imgX = LEFT_W + (RIGHT_W - obj.displayW) / 2;

      image(obj.img, imgX, currentY, obj.displayW, obj.displayH);
    }
  }

  if (appState === 'MEASURING') {
    fill(0, 244, 123, 200);
    textAlign(CENTER, CENTER);
    textSize(14);
    noStroke();
    text('Measuring…', cx, CANVAS_H - 40);
  }

  drawStatusMessage(cx);
}

function showStatus(text, durationMs) {
  statusMsg = { text: text, until: millis() + (durationMs || 6000) };
}

function drawStatusMessage(cx) {
  if (!statusMsg) return;
  if (millis() > statusMsg.until) { statusMsg = null; return; }

  fill(0, 0, 0, 180);
  noStroke();
  rect(LEFT_W + 20, CANVAS_H - 90, RIGHT_W - 40, 64, 6);
  fill(255, 200, 90);
  textAlign(CENTER, CENTER);
  textSize(13);
  text(statusMsg.text, LEFT_W + RIGHT_W / 2, CANVAS_H - 58);
}

function announce(text) {
  let el = document.getElementById('match-announcement');
  if (el) el.textContent = text;
}

// =============================================================================
// Measurement & matching
// =============================================================================

function startMeasurement(hit) {
  if (!calibration) return; // banner already tells the operator to calibrate

  if (heightIndexError || !heightIndex || heightIndex.length === 0) {
    showStatus(heightIndexError
      ? 'The artwork data failed to load.\nPlease reload the page.'
      : 'Still loading artwork data —\nplease try again in a moment.');
    return;
  }

  captureStill();
  stateBeforeMeasure = appState === 'MEASURING' ? stateBeforeMeasure : appState;
  appState  = 'MEASURING';
  measuring = {
    trackerId:     hit.trackerId,
    samples:       [],
    occludedCount: 0,
    endTime:       millis() + MEASURE_WINDOW_MS
  };
}

// Collect pose-height samples over the measurement window, then finalize.
function updateMeasurement(now) {
  if (!measuring) { appState = stateBeforeMeasure; return; }

  let tracker = trackerSet.getTrackerById(measuring.trackerId);
  if (tracker && tracker.poseIndex >= 0 && poses[tracker.poseIndex]) {
    let span = measureSpanVideoPx(poses[tracker.poseIndex]);
    if (span.pixels > 0) {
      measuring.samples.push(span.pixels);
      if (span.occluded) measuring.occludedCount++;
    }
  }

  if (now < measuring.endTime) return;

  // Finalize
  let m = measuring;
  measuring = null;

  if (m.samples.length < MEASURE_MIN_SAMPLES) {
    appState = stateBeforeMeasure;
    showStatus('We couldn’t measure you.\nStep back so your whole body\nis visible, then try again.');
    return;
  }

  showOcclusionWarning(m.occludedCount > m.samples.length / 2);

  let pixelSpan = median(m.samples);
  let heightCm  = (pixelSpan / videoNativeHeight()) / calibration.fractionPerCm;

  if (!(heightCm >= 50 && heightCm <= 280)) {
    appState = stateBeforeMeasure;
    showStatus('That measurement didn’t look right.\nStand on the marked spot\nand try again.');
    return;
  }

  let matched = matchObjects(heightCm);
  if (!matched || matched.length === 0) {
    appState = stateBeforeMeasure;
    showStatus('We couldn’t find a matching\nset of objects — please try again.');
    return;
  }

  // Reset display
  appState       = 'DISPLAYING';
  matchedObjects = [];
  qrBuilt        = false;
  infoUrl        = null;
  hideQR();

  // Scale factor: fit total stack into STACK_AREA_H
  let pxPerCm  = STACK_AREA_H / heightCm;
  let stackY   = CANVAS_H - PANEL_PADDING_BOTTOM; // current top-of-stack, working upward
  let dropTime = millis() + 300; // small delay before first drop

  // Build stack bottom-to-top (matched[0] = top of result list, drops first but lands at bottom)
  // Reverse so that drop order corresponds to bottom-first stacking
  let reversed = matched.slice().reverse();

  for (let j = 0; j < reversed.length; j++) {
    let [id, objHeightCm] = reversed[j];
    let displayH = Math.max(4, objHeightCm * pxPerCm);
    stackY -= displayH;
    let targetY = stackY;

    matchedObjects.push({
      id:            String(id),
      heightCm:      objHeightCm,
      title:         '',
      artist:        '',
      img:           null,
      displayH:      displayH,
      displayW:      RIGHT_W,  // corrected after image loads
      targetY:       targetY,
      dropStartTime: dropTime + j * DROP_STAGGER_MS
    });
  }

  announce('We found ' + matched.length + ' museum objects that stack up to your height.');
  loadMatchedImages(heightCm);
}

function median(arr) {
  let sorted = arr.slice().sort(function(a, b) { return a - b; });
  let mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function captureStill() {
  let g = createGraphics(LEFT_W, CANVAS_H);
  g.image(video, 0, 0, LEFT_W, CANVAS_H, cropSx, cropSy, cropSw, cropSh);
  stillFrame      = g;
  stillCapturedAt = millis();
  showingStill    = true;
}

// Person's pixel span in RAW VIDEO coordinates (same space calibration uses).
// Returns { pixels, occluded }; pixels <= 0 means unmeasurable this frame.
function measureSpanVideoPx(pose) {
  let kp = pose.keypoints;

  let nose     = kp[KP.NOSE];
  let leftEye  = kp[KP.LEFT_EYE];
  let rightEye = kp[KP.RIGHT_EYE];

  if (!nose || nose.score < CONFIDENCE_THRESHOLD) return { pixels: 0, occluded: false };

  // Estimate top of head from eye-nose distance
  let eyeY = null, eyeCount = 0;
  if (leftEye && leftEye.score > CONFIDENCE_THRESHOLD) { eyeY = leftEye.y; eyeCount = 1; }
  if (rightEye && rightEye.score > CONFIDENCE_THRESHOLD) {
    eyeY = eyeCount > 0 ? (eyeY + rightEye.y) / 2 : rightEye.y;
    eyeCount++;
  }

  let topY;
  if (eyeY !== null) {
    let eyeNoseGap = nose.y - eyeY; // positive: eyes are above nose in screen coords
    topY = nose.y - eyeNoseGap * 3;
  } else {
    topY = nose.y;
  }

  // Determine lowest visible body landmark
  let leftAnkle  = kp[KP.LEFT_ANKLE];
  let rightAnkle = kp[KP.RIGHT_ANKLE];
  let leftKnee   = kp[KP.LEFT_KNEE];
  let rightKnee  = kp[KP.RIGHT_KNEE];
  let leftHip    = kp[KP.LEFT_HIP];
  let rightHip   = kp[KP.RIGHT_HIP];

  let bottomY;
  let occluded = false;

  let ankleYs = [];
  if (leftAnkle  && leftAnkle.score  > CONFIDENCE_THRESHOLD) ankleYs.push(leftAnkle.y);
  if (rightAnkle && rightAnkle.score > CONFIDENCE_THRESHOLD) ankleYs.push(rightAnkle.y);

  if (ankleYs.length > 0) {
    bottomY = Math.max(...ankleYs);
  } else {
    let kneeYs = [];
    if (leftKnee  && leftKnee.score  > CONFIDENCE_THRESHOLD) kneeYs.push(leftKnee.y);
    if (rightKnee && rightKnee.score > CONFIDENCE_THRESHOLD) kneeYs.push(rightKnee.y);

    if (kneeYs.length > 0) {
      // Nose ≈ 12.5% from top, knee ≈ 75% → nose-to-knee ≈ 62.5% of height
      let kneeY = Math.max(...kneeYs);
      let pixelHeight = (kneeY - topY) / 0.625;
      bottomY = topY + pixelHeight;
      occluded = true;
    } else {
      let hipYs = [];
      if (leftHip  && leftHip.score  > CONFIDENCE_THRESHOLD) hipYs.push(leftHip.y);
      if (rightHip && rightHip.score > CONFIDENCE_THRESHOLD) hipYs.push(rightHip.y);

      if (hipYs.length > 0) {
        // Nose ≈ 12.5%, hip ≈ 50% → nose-to-hip ≈ 37.5% of height
        let hipY = Math.max(...hipYs);
        let pixelHeight = (hipY - topY) / 0.375;
        bottomY = topY + pixelHeight;
        occluded = true;
      } else {
        return { pixels: 0, occluded: false };
      }
    }
  }

  return { pixels: bottomY - topY, occluded: occluded };
}

function showOcclusionWarning(show) {
  let el = document.getElementById('occlusion-warning');
  if (el) el.style.display = show ? 'block' : 'none';
}

// =============================================================================
// Object matching algorithm
// =============================================================================

function matchObjects(targetHeightCm) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let result = tryMatch(targetHeightCm, BASE_TOLERANCE);
    if (result) return result;
  }
  for (let t = BASE_TOLERANCE + TOLERANCE_STEP; t <= MAX_TOLERANCE; t += TOLERANCE_STEP) {
    for (let attempt = 0; attempt < 20; attempt++) {
      let result = tryMatch(targetHeightCm, t);
      if (result) return result;
    }
  }
  return null;
}

function tryMatch(targetHeightCm, tolerance) {
  let minH = targetHeightCm * (1 - tolerance);
  let maxH = targetHeightCm * (1 + tolerance);

  let remaining  = targetHeightCm;
  let selected   = [];
  let smallCount = 0;
  let largeCount = 0;
  let usedIds    = new Set();
  let limit      = 500;

  while (remaining > 0 && limit-- > 0 && selected.length < MAX_STACK_OBJECTS) {
    let eligible = heightIndex.filter(function([id, h]) {
      if (usedIds.has(id)) return false;
      if (h > remaining * (1 + tolerance)) return false;
      if (h < 2   && smallCount >= MAX_SMALL_OBJECTS) return false;
      if (h > 100 && largeCount >= MAX_LARGE_OBJECTS) return false;
      return true;
    });

    if (eligible.length === 0) break;

    let pick = eligible[Math.floor(Math.random() * eligible.length)];
    let [id, h] = pick;
    selected.push(pick);
    usedIds.add(id);
    if (h < 2)   smallCount++;
    if (h > 100) largeCount++;
    remaining -= h;
  }

  let total = targetHeightCm - remaining;
  return (total >= minH && total <= maxH) ? selected : null;
}

// =============================================================================
// Image + metadata loading
// =============================================================================

function loadMatchedImages(userHeightCm) {
  let total  = matchedObjects.length;
  let loaded = 0;

  for (let i = 0; i < matchedObjects.length; i++) {
    let obj = matchedObjects[i]; // capture in closure
    let imgPath = 'data/small_images/' + obj.id + '.jpg';

    (function(capturedObj) {
      loadImage(imgPath, function(img) {
        capturedObj.img = img;
        // Correct width to maintain aspect ratio
        let aspect = img.width / img.height;
        capturedObj.displayW = Math.min(RIGHT_W - 10, capturedObj.displayH * aspect);

        loaded++;
        if (loaded === total) onAllImagesLoaded(userHeightCm);
      }, function() {
        // Image failed — leave img null (won't render)
        loaded++;
        if (loaded === total) onAllImagesLoaded(userHeightCm);
      });
    })(obj);
  }
}

function onAllImagesLoaded(userHeightCm) {
  applyMetadataToObjects();
  if (metadataReady) {
    buildQRCode();
  } else {
    document.getElementById('qr-sidebar').style.display = 'flex';
    document.getElementById('qr-loading').style.display = 'block';
  }
}

function applyMetadataToObjects() {
  if (!metadataReady) return;
  for (let obj of matchedObjects) {
    let meta = objectMetadata[obj.id];
    if (meta) {
      obj.title  = meta.title  || 'Untitled';
      obj.artist = meta.artist || '';
    }
  }
}

function loadMetadataInBackground() {
  fetch('data/object_metadata.json')
    .then(function(r) { return r.json(); })
    .then(function(data) {
      objectMetadata = data;
      metadataReady  = true;
      // If already displaying and waiting, apply now
      if (appState === 'DISPLAYING' && !qrBuilt) {
        applyMetadataToObjects();
        buildQRCode();
      }
    })
    .catch(function(err) {
      console.warn('Failed to load object_metadata.json:', err);
    });
}

function buildQRCode() {
  if (qrBuilt || !metadataReady) return;

  // A local/museum install serves from localhost, so QR codes must be able to
  // point at the public deployment instead. Set publicInfoBaseUrl in branding.js.
  var base = window.__brandPublicInfoBase ||
             window.location.href.replace(/[^/]*$/, '');
  if (base.charAt(base.length - 1) !== '/') base += '/';

  function encode(payload) {
    var json = JSON.stringify(payload);
    var b64  = btoa(unescape(encodeURIComponent(json)));
    return base + 'info.html?data=' + b64;
  }

  function obj2full(obj) {
    var m = objectMetadata[obj.id] || {};
    return { id: obj.id, height_cm: obj.heightCm,
             title: m.title||'', artist: m.artist||'', date: m.date||'',
             medium: m.medium||'', department: m.department||'', culture: m.culture||'',
             link: m.link||'' };
  }
  function obj2slim(obj) {
    var m = objectMetadata[obj.id] || {};
    return { id: obj.id, height_cm: obj.heightCm,
             title: m.title||'', artist: m.artist||'', link: m.link||'' };
  }
  function obj2terse(obj) {
    var m = objectMetadata[obj.id] || {};
    return { id: obj.id, height_cm: obj.heightCm,
             title: (m.title||'').slice(0, 40), link: m.link||'' };
  }
  function obj2min(obj) {
    return { id: obj.id, height_cm: obj.heightCm };
  }

  // Try progressively smaller payloads until one fits in a QR code.
  var levels = [obj2full, obj2slim, obj2terse, obj2min];
  var built  = false;
  for (var i = 0; i < levels.length; i++) {
    try {
      var url = encode(matchedObjects.map(levels[i]));
      qrCode.clear();
      qrCode.makeCode(url);
      infoUrl = url;
      built = true;
      break;
    } catch(e) { /* payload too large — try next level */ }
  }

  document.getElementById('qr-sidebar').style.display = 'flex';
  if (built) {
    document.getElementById('qrcode').style.display    = 'block';
    document.getElementById('qr-loading').style.display = 'none';
  } else {
    // Never leave an empty white box up
    document.getElementById('qrcode').style.display     = 'none';
    var loading = document.getElementById('qr-loading');
    loading.textContent   = 'Link unavailable — please try again.';
    loading.style.display = 'block';
    infoUrl = null;
  }
  qrBuilt = true;
}

function hideQR() {
  document.getElementById('qrcode').style.display     = 'none';
  document.getElementById('qr-loading').style.display = 'none';
  document.getElementById('qr-sidebar').style.display = 'none';
}

// =============================================================================
// Calibration
// =============================================================================

function loadCalibration() {
  try {
    let stored = localStorage.getItem('heightInArt_calibration');
    if (!stored) return null;
    let cal = JSON.parse(stored);
    // Require the v2 resolution-independent format; older/corrupt values
    // (including pre-fix calibrations, which were measured with buggy math)
    // trigger the recalibration banner.
    if (cal && cal.version === 2 &&
        typeof cal.fractionPerCm === 'number' &&
        isFinite(cal.fractionPerCm) && cal.fractionPerCm > 0) {
      return cal;
    }
  } catch(e) {}
  return null;
}

function updateCalibrationBanner() {
  let banner = document.getElementById('calibration-banner');
  if (banner) banner.style.display = calibration ? 'none' : 'block';
}
