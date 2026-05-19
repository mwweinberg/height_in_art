

let bodyPose;
let connections;

// How often to update the matching image (in milliseconds)
// Lower = more responsive but more CPU usage
// Higher = less CPU but slower updates
// Recommended: 250 (4x/sec) to 1000 (1x/sec)
let MATCH_UPDATE_INTERVAL_MS = 250;
let lastMatchTime = 0;

// Reference pose data loaded from JSON (array of objects with l2_vector and metadata)
let referencePoseData = null;

// Cache for loaded images (keyed by filename)
let imageCache = {};

// Webcam and pose matching variables
let video;
let webcamPoses = [];
let bestMatchImg = null;
let bestMatchData = null;  // Full metadata for the current best match

// QR code variables
let qrCode = null;
let currentQRObjectId = null;  // Track what QR is currently showing

// Accessibility: debounce timer for screen reader announcements
let announceTimeout = null;
const ANNOUNCE_DELAY_MS = 1500;  // Wait 1.5 seconds of stable match before announcing

// Camera status
let cameraReady = false;
let cameraError = false;

// Webcam crop parameters (set during draw, used to map skeleton keypoints)
let cropSx = 0, cropSy = 0, cropSw = 640, cropSh = 480;
let cropAreaW = 400, cropAreaH = 593;

// Explore mode: penalize recently shown images to encourage variety
// Without this, the same ~15 images dominate because ~71% of the dataset
// shares a nearly identical standing pose (cosine similarity > 0.95)
let exploreMode = true;
let recentMatches = [];
// How many recently shown images to remember and penalize.
// Once an image falls off this list, it can win again.
const EXPLORE_HISTORY_SIZE = 50;
// How much to subtract from a recent image's similarity score.
// Most images in the dominant cluster score within ~0.02-0.05 of each other,
// so 0.08 is enough to let other cluster members win without suppressing
// a genuinely better match from a different pose.
const EXPLORE_PENALTY = 0.08;

// Movement-aware timing for explore mode:
// Instead of penalizing images immediately, wait a minimum display time
// so the user can see each match before it rotates away.
let matchStartTime = 0;        // When the current match first appeared
let previousPoseVector = null;  // Previous frame's pose vector for movement detection
// Minimum time (ms) to show each image before it can be penalized away.
// When standing still, images stay longer; when moving, they rotate faster.
const EXPLORE_MIN_DISPLAY_STILL_MS = 5000;   // 5 seconds when not moving
const EXPLORE_MIN_DISPLAY_MOVING_MS = 1000;  // 1 second when actively moving
// Cosine similarity between consecutive pose vectors above this threshold
// means the person is standing still (vectors are nearly identical).
const MOVEMENT_THRESHOLD = 0.98;

function preload() {
  // Load the bodyPose model
  bodyPose = ml5.bodyPose();

  // Load the pre-computed pose data for all reference images
  referencePoseData = loadJSON("input_image_metadata.json");
}

function setup() {
  // Remove loading placeholder
  let loadingMsg = document.getElementById('loading-message');
  if (loadingMsg) loadingMsg.remove();

  // Double width: webcam on left, matching image on right
  let canvas = createCanvas(800, 593);
  canvas.parent('canvas-container');

  // Accessibility: add aria-label to canvas
  canvas.elt.setAttribute('aria-label', 'Pose matching experience: your webcam feed on the left detects your pose, matched artwork appears on the right. Click the artwork or scan the QR code to learn more.');

  // Get the skeleton connection information
  connections = bodyPose.getSkeleton();

  // Set up webcam with error handling
  video = createCapture(VIDEO, function() {
    // Camera access granted
    cameraReady = true;
    // Start continuous pose detection on webcam
    bodyPose.detectStart(video, gotWebcamPoses);
  });
  video.size(640, 480);
  video.hide();

  // Handle camera permission denied
  video.elt.addEventListener('error', function() {
    cameraError = true;
  });

  // Also check via getUserMedia for permission denied
  navigator.mediaDevices.getUserMedia({ video: true })
    .catch(function(err) {
      cameraError = true;
      console.log('Camera access denied:', err.name);
    });

  // Initialize QR code (empty initially)
  qrCode = new QRCode(document.getElementById("qrcode"), {
    width: 80,
    height: 80,
    colorDark: "#000000",
    colorLight: "#ffffff"
  });

}

function draw() {
  // Only update the match at the configured interval (not every frame)
  let currentTime = millis();
  if (currentTime - lastMatchTime >= MATCH_UPDATE_INTERVAL_MS) {
    findBestMatch();
    lastMatchTime = currentTime;
  }

  // Draw webcam on the left side (or error message if camera denied)
  if (cameraError) {
    // Show error message
    fill(40);
    noStroke();
    rect(0, 0, 400, 593);
    fill(255);
    textAlign(CENTER, CENTER);
    textSize(18);
    text("Camera access denied", 200, 270);
    textSize(14);
    fill(180);
    text("Please allow camera access\nto use Pose Match", 200, 320);
  } else if (video) {
    // Crop-to-fit: scale webcam to fill area, clipping overflow (like object-fit: cover)
    let vidRatio = video.width / video.height;
    let areaW = 400;
    let areaH = 593;
    let areaRatio = areaW / areaH;
    let sx, sy, sw, sh;
    if (vidRatio > areaRatio) {
      // Webcam is wider than area — crop sides
      sh = video.height;
      sw = video.height * areaRatio;
      sx = (video.width - sw) / 2;
      sy = 0;
    } else {
      // Webcam is taller than area — crop top/bottom
      sw = video.width;
      sh = video.width / areaRatio;
      sx = 0;
      sy = (video.height - sh) / 2;
    }
    image(video, 0, 0, areaW, areaH, sx, sy, sw, sh);
    // Store crop params for skeleton mapping
    cropSx = sx; cropSy = sy; cropSw = sw; cropSh = sh;
    cropAreaW = areaW; cropAreaH = areaH;
  }

  // Draw skeleton on webcam feed if poses detected
  if (webcamPoses.length > 0) {
    let pose = webcamPoses[0];

    // Draw the skeleton connections
    for (let j = 0; j < connections.length; j++) {
      let pointAIndex = connections[j][0];
      let pointBIndex = connections[j][1];
      let pointA = pose.keypoints[pointAIndex];
      let pointB = pose.keypoints[pointBIndex];
      // Only draw a line if both points are confident enough
      if (pointA.confidence > 0.1 && pointB.confidence > 0.1) {
        stroke(255, 0, 0);
        strokeWeight(2);
        line(
          (pointA.x - cropSx) * (cropAreaW / cropSw),
          (pointA.y - cropSy) * (cropAreaH / cropSh),
          (pointB.x - cropSx) * (cropAreaW / cropSw),
          (pointB.y - cropSy) * (cropAreaH / cropSh)
        );
      }
    }

    // Draw all the tracked landmark points
    for (let j = 0; j < pose.keypoints.length; j++) {
      let keypoint = pose.keypoints[j];
      // Only draw a circle if the keypoint's confidence is bigger than 0.1
      if (keypoint.confidence > 0.1) {
        fill(0, 255, 0);
        noStroke();
        circle(
          (keypoint.x - cropSx) * (cropAreaW / cropSw),
          (keypoint.y - cropSy) * (cropAreaH / cropSh),
          10
        );
      }
    }
  }

  // Draw the best matching image on the right side (preserve aspect ratio)
  if (bestMatchImg) {
    let areaW = 400;
    let areaH = 593;
    let imgRatio = bestMatchImg.width / bestMatchImg.height;
    let areaRatio = areaW / areaH;
    let drawW, drawH;
    if (imgRatio > areaRatio) {
      // Image is wider than area — fit to width
      drawW = areaW;
      drawH = areaW / imgRatio;
    } else {
      // Image is taller than area — fit to height
      drawH = areaH;
      drawW = areaH * imgRatio;
    }
    let drawX = 400 + (areaW - drawW) / 2;
    let drawY = (areaH - drawH) / 2;
    // Black background behind image to fill letterbox area
    fill(0);
    noStroke();
    rect(400, 0, areaW, areaH);
    image(bestMatchImg, drawX, drawY, drawW, drawH);
  }

  // Draw label for the matching image (show title and artist from metadata)
  if (bestMatchData) {
    fill(255);
    noStroke();
    textAlign(CENTER, TOP);

    // Display title
    textSize(14);
    let title = bestMatchData.metadata.title || '';
    text(title, 410, 10, 380, 40);

    // Display artist (smaller, below title)
    textSize(12);
    fill(200);  // Slightly dimmer
    let artist = bestMatchData.metadata.artist || '';
    text(artist, 410, 55, 380, 30);
  }
}

// Callback for continuous webcam pose detection
function gotWebcamPoses(results) {
  webcamPoses = results;
}

// Find the reference pose that best matches the webcam pose
function findBestMatch() {
  // Need webcam pose and reference poses to compare
  if (webcamPoses.length === 0 || referencePoseData === null) {
    return;
  }

  // Process the webcam pose
  let webcamProcessed = processPose(webcamPoses[0]);
  if (webcamProcessed === null) {
    return;
  }

  let bestSimilarity = -Infinity;
  let bestData = null;

  // Convert to array if needed (p5.js loadJSON returns object with numeric keys for arrays)
  let poseArray = Array.isArray(referencePoseData) ? referencePoseData : Object.values(referencePoseData);

  // Loop through all reference poses and find the best match
  for (let i = 0; i < poseArray.length; i++) {
    let reference = poseArray[i];

    // Skip if no l2_vector
    if (!reference.l2_vector) {
      continue;
    }

    let similarity = cosineSimilarity(webcamProcessed.l2Vector, reference.l2_vector);

    // In explore mode, penalize recently shown images so other similar images get a turn
    if (exploreMode && recentMatches.indexOf(reference.filename) !== -1) {
      similarity -= EXPLORE_PENALTY;
    }

    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestData = reference;
    }
  }

  // If we found a match, update the display
  if (bestData !== null) {
    let matchChanged = bestData.filename !== (bestMatchData && bestMatchData.filename);

    if (matchChanged) {
      // A different image wants to win — only allow the switch if the current image
      // has been shown for the minimum display time. This prevents rapid cycling when
      // the pose naturally fluctuates between a few similar images.
      let isMoving = previousPoseVector !== null &&
        cosineSimilarity(webcamProcessed.l2Vector, previousPoseVector) < MOVEMENT_THRESHOLD;
      let minDisplay = isMoving ? EXPLORE_MIN_DISPLAY_MOVING_MS : EXPLORE_MIN_DISPLAY_STILL_MS;

      if (bestMatchData === null || millis() - matchStartTime >= minDisplay) {
        // Allowed to switch — penalize the outgoing image now that we're done with it
        if (exploreMode && bestMatchData &&
            recentMatches.indexOf(bestMatchData.filename) === -1) {
          recentMatches.push(bestMatchData.filename);
          if (recentMatches.length > EXPLORE_HISTORY_SIZE) {
            recentMatches.shift();
          }
        }
        matchStartTime = millis();
        bestMatchData = bestData;
      }
      // else: minimum display time not yet elapsed — keep showing the current match
    }

    // Store current pose vector for next frame's movement detection
    previousPoseVector = webcamProcessed.l2Vector;

    // Update QR code and image using bestMatchData (which may not have changed above)
    updateQRCode(bestMatchData.object_id);

    // Check if image is already cached
    let filename = bestMatchData.filename;
    if (imageCache[filename]) {
      // Use cached image
      bestMatchImg = imageCache[filename];
    } else {
      // Load the image and cache it
      loadImage("input_images/" + filename, function(img) {
        imageCache[filename] = img;
        // Only update bestMatchImg if this is still the best match
        if (bestMatchData && bestMatchData.filename === filename) {
          bestMatchImg = img;
        }
      });
    }
  }
}

// Compute bounding box from keypoints with confidence threshold
function computeBoundingBox(keypoints, confidenceThreshold = 0.1) {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;

  for (let keypoint of keypoints) {
    if (keypoint.confidence > confidenceThreshold) {
      xMin = Math.min(xMin, keypoint.x);
      xMax = Math.max(xMax, keypoint.x);
      yMin = Math.min(yMin, keypoint.y);
      yMax = Math.max(yMax, keypoint.y);
    }
  }

  return { xMin, xMax, yMin, yMax };
}

// Normalize keypoints: center around bounding box and scale to unit square
function normalizeKeypoints(keypoints, confidenceThreshold = 0.1) {
  let box = computeBoundingBox(keypoints, confidenceThreshold);

  // Compute center and size of bounding box
  let centerX = (box.xMin + box.xMax) / 2;
  let centerY = (box.yMin + box.yMax) / 2;
  let boxWidth = box.xMax - box.xMin;
  let boxHeight = box.yMax - box.yMin;

  // Use the larger dimension to maintain aspect ratio
  let scale = Math.max(boxWidth, boxHeight);

  // Avoid division by zero
  if (scale === 0) {
    scale = 1;
  }

  // Normalize each keypoint: center and scale to [-0.5, 0.5] range
  let normalized = [];
  for (let keypoint of keypoints) {
    normalized.push({
      name: keypoint.name,
      x: (keypoint.x - centerX) / scale,
      y: (keypoint.y - centerY) / scale,
      confidence: keypoint.confidence
    });
  }

  return normalized;
}

// Flatten keypoints to a vector [x1, y1, x2, y2, ...] for L2 normalization
function keypointsToVector(keypoints) {
  let vector = [];
  for (let keypoint of keypoints) {
    vector.push(keypoint.x);
    vector.push(keypoint.y);
  }
  return vector;
}

// L2 normalize a vector (divide by magnitude to create unit vector)
function l2Normalize(vector) {
  let sumOfSquares = 0;
  for (let val of vector) {
    sumOfSquares += val * val;
  }
  let magnitude = Math.sqrt(sumOfSquares);

  // Avoid division by zero
  if (magnitude === 0) {
    return vector;
  }

  return vector.map(val => val / magnitude);
}

// Process a pose: normalize keypoints and apply L2 normalization
function processPose(pose) {
  if (!pose || !pose.keypoints) {
    return null;
  }

  let normalizedKeypoints = normalizeKeypoints(pose.keypoints);
  let vector = keypointsToVector(normalizedKeypoints);
  let l2Vector = l2Normalize(vector);

  return {
    normalizedKeypoints: normalizedKeypoints,
    l2Vector: l2Vector
  };
}

// Compute cosine similarity between two L2-normalized vectors
// Returns a value from -1 to 1 (1 = identical, 0 = unrelated)
function cosineSimilarity(vectorA, vectorB) {
  if (vectorA.length !== vectorB.length) {
    console.error("Vectors must have the same length");
    return 0;
  }

  let dotProduct = 0;
  for (let i = 0; i < vectorA.length; i++) {
    dotProduct += vectorA[i] * vectorB[i];
  }

  return dotProduct;
}

// Update the QR code when the match changes
function updateQRCode(objectId) {
  if (qrCode && objectId !== currentQRObjectId) {
    currentQRObjectId = objectId;
    // Build the URL for the info page
    let infoUrl = window.location.href.replace(/[^/]*$/, '') + 'info.html?id=' + objectId;
    qrCode.clear();
    qrCode.makeCode(infoUrl);

    // Debounced screen reader announcement - only announce after match is stable for a period of time (avoids a barrage of announcements)
    if (announceTimeout) {
      clearTimeout(announceTimeout);
    }
    announceTimeout = setTimeout(announceMatch, ANNOUNCE_DELAY_MS);
  }
}

// Announce the current match to screen readers
function announceMatch() {
  let announcement = document.getElementById('match-announcement');
  if (announcement && bestMatchData) {
    let title = bestMatchData.metadata.title || 'Untitled';
    let artist = bestMatchData.metadata.artist || 'Unknown artist';
    announcement.textContent = 'Matched artwork: ' + title + ' by ' + artist;
  }
}

// Click on matched image to open info page
function mousePressed() {
  // Only respond to left-clicks (allow right-click context menu)
  if (mouseButton !== LEFT) {
    return;
  }

  // Only respond to clicks on the right side (matched image area)
  if (mouseX > 400 && mouseX < 800 && mouseY > 0 && mouseY < 593) {
    if (bestMatchData) {
      let infoUrl = window.location.href.replace(/[^/]*$/, '') + 'info.html?id=' + bestMatchData.object_id;
      window.open(infoUrl, '_blank');
    }
  }
}
