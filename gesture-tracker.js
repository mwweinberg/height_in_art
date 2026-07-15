// gesture-tracker.js
// Shared gesture detection for index.html (sketch.js) and calibration.html.
//
// Tracks people across frames by matching pose centroids to existing trackers
// (MoveNet multi-pose output order is NOT stable frame-to-frame), accumulates
// wrist-position samples in a rolling window, and detects the trigger gesture:
// wrist at hip level → above shoulder level → back to hip level.
//
// Usage:
//   var trackerSet = createGestureTrackerSet({ confidence: 0.10 });
//   // each frame / detection callback:
//   trackerSet.update(poses, nowMs, videoHeight);
//   var hit = trackerSet.checkTrigger(nowMs);  // {trackerId, poseIndex} | null
//   var t = trackerSet.getTrackerForPose(i);   // tracker currently bound to pose i

function createGestureTrackerSet(opts) {
  opts = opts || {};
  var CONFIDENCE  = opts.confidence  !== undefined ? opts.confidence : 0.10;
  var WINDOW_MS   = opts.windowMs    || 4000;  // rolling sample window
  var COOLDOWN_MS = opts.cooldownMs  || 3000;  // min time between triggers
  var CARRY_MS    = opts.carryMs     || 300;   // carry wrist through confidence gaps
  var MIN_SAMPLES = opts.minSamples  || 8;
  var EXPIRE_MS   = opts.expireMs    || 1500;  // drop trackers unseen this long

  // "At hip" margin scales with the person's torso so it behaves the same at
  // any camera resolution / distance. Falls back to legacy 80px if torso unknown.
  var HIP_MARGIN_TORSO_FRACTION = 0.7;
  var HIP_MARGIN_FALLBACK_PX    = 80;

  // MoveNet keypoint indices (COCO order)
  var NOSE = 0, L_SHOULDER = 5, R_SHOULDER = 6,
      L_WRIST = 9, R_WRIST = 10, L_HIP = 11, R_HIP = 12;

  var trackers = [];
  var nextId = 1;
  var lastTriggerTime = -1e9;

  function avgY(a, b) {
    var sum = 0, n = 0;
    if (a && a.score > CONFIDENCE) { sum += a.y; n++; }
    if (b && b.score > CONFIDENCE) { sum += b.y; n++; }
    return n > 0 ? sum / n : null;
  }

  // Centroid of the most reliable keypoints, for frame-to-frame identity.
  function poseCenter(kp) {
    var pts = [kp[NOSE], kp[L_SHOULDER], kp[R_SHOULDER], kp[L_HIP], kp[R_HIP]];
    var sx = 0, sy = 0, n = 0;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (p && p.score > CONFIDENCE) { sx += p.x; sy += p.y; n++; }
    }
    return n > 0 ? { x: sx / n, y: sy / n } : null;
  }

  function newTracker(center, now) {
    return {
      id: nextId++,
      samples: [],
      center: center,
      lastSeen: now,
      poseIndex: -1,
      lastLeftWristY: null,  lastLeftWristTime: 0,
      lastRightWristY: null, lastRightWristTime: 0
    };
  }

  // Match current poses to trackers (greedy nearest-neighbor), append samples.
  function update(poses, now, videoHeight) {
    var maxDist = (videoHeight || 480) * 0.35; // people don't teleport between frames

    // Expire stale trackers, clear pose bindings
    trackers = trackers.filter(function(t) { return now - t.lastSeen < EXPIRE_MS; });
    for (var i = 0; i < trackers.length; i++) trackers[i].poseIndex = -1;

    // Build candidate (pose, tracker, dist) pairs and assign greedily
    var centers = [];
    for (var p = 0; p < poses.length; p++) {
      var pose = poses[p];
      centers.push(pose && pose.keypoints ? poseCenter(pose.keypoints) : null);
    }
    var pairs = [];
    for (var p2 = 0; p2 < poses.length; p2++) {
      if (!centers[p2]) continue;
      for (var t2 = 0; t2 < trackers.length; t2++) {
        var dx = centers[p2].x - trackers[t2].center.x;
        var dy = centers[p2].y - trackers[t2].center.y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < maxDist) pairs.push({ pose: p2, tracker: t2, dist: d });
      }
    }
    pairs.sort(function(a, b) { return a.dist - b.dist; });

    var poseTaken = {}, trackerTaken = {};
    var assignment = {}; // poseIndex -> tracker
    for (var k = 0; k < pairs.length; k++) {
      var pr = pairs[k];
      if (poseTaken[pr.pose] || trackerTaken[pr.tracker]) continue;
      poseTaken[pr.pose] = true;
      trackerTaken[pr.tracker] = true;
      assignment[pr.pose] = trackers[pr.tracker];
    }

    for (var p3 = 0; p3 < poses.length; p3++) {
      if (!centers[p3]) continue;
      var tracker = assignment[p3];
      if (!tracker) {
        tracker = newTracker(centers[p3], now);
        trackers.push(tracker);
      }
      tracker.center    = centers[p3];
      tracker.lastSeen  = now;
      tracker.poseIndex = p3;
      appendSample(tracker, poses[p3].keypoints, now);
    }
  }

  function appendSample(tracker, kp, now) {
    var nose = kp[NOSE];
    if (!nose || nose.score < CONFIDENCE) return;

    var hipY = avgY(kp[L_HIP], kp[R_HIP]);
    if (hipY === null) return;

    var shoulderY = avgY(kp[L_SHOULDER], kp[R_SHOULDER]);
    var margin = shoulderY !== null
      ? (hipY - shoulderY) * HIP_MARGIN_TORSO_FRACTION
      : HIP_MARGIN_FALLBACK_PX;
    if (shoulderY === null) shoulderY = hipY - HIP_MARGIN_FALLBACK_PX;

    var leftWristY = null, rightWristY = null;
    var lWrist = kp[L_WRIST], rWrist = kp[R_WRIST];

    if (lWrist && lWrist.score > CONFIDENCE) {
      leftWristY = lWrist.y;
      tracker.lastLeftWristY = lWrist.y;
      tracker.lastLeftWristTime = now;
    } else if (tracker.lastLeftWristY !== null && now - tracker.lastLeftWristTime < CARRY_MS) {
      leftWristY = tracker.lastLeftWristY;
    }

    if (rWrist && rWrist.score > CONFIDENCE) {
      rightWristY = rWrist.y;
      tracker.lastRightWristY = rWrist.y;
      tracker.lastRightWristTime = now;
    } else if (tracker.lastRightWristY !== null && now - tracker.lastRightWristTime < CARRY_MS) {
      rightWristY = tracker.lastRightWristY;
    }

    tracker.samples.push({
      time:        now,
      leftWristY:  leftWristY,
      rightWristY: rightWristY,
      hipY:        hipY,
      shoulderY:   shoulderY,
      hipThreshY:  hipY - margin,
      noseY:       nose.y
    });

    tracker.samples = tracker.samples.filter(function(s) {
      return now - s.time < WINDOW_MS;
    });
  }

  // Replay the sample window for one wrist. Returns phase 0-3 (3 = complete).
  function gesturePhase(samples, wristKey) {
    var phase = 0;
    for (var i = 0; i < samples.length; i++) {
      var s = samples[i];
      var wy = s[wristKey];
      if (wy === null) continue;
      var atHip         = wy >= s.hipThreshY;   // screen coords: larger y = lower
      var aboveShoulder = wy <= s.shoulderY;
      if      (phase === 0 && atHip)         phase = 1;
      else if (phase === 1 && aboveShoulder) phase = 2;
      else if (phase === 2 && atHip)         return 3;
    }
    return phase;
  }

  // Returns {trackerId, poseIndex} for a completed gesture, or null.
  // Handles the cooldown and resets the triggering tracker's samples.
  function checkTrigger(now) {
    if (now - lastTriggerTime < COOLDOWN_MS) return null;

    for (var i = 0; i < trackers.length; i++) {
      var t = trackers[i];
      if (t.poseIndex < 0 || t.samples.length < MIN_SAMPLES) continue;

      var keys = ['leftWristY', 'rightWristY'];
      for (var k = 0; k < keys.length; k++) {
        if (gesturePhase(t.samples, keys[k]) === 3) {
          lastTriggerTime = now;
          var result = { trackerId: t.id, poseIndex: t.poseIndex };
          t.samples = [];
          t.lastLeftWristY = null;  t.lastLeftWristTime = 0;
          t.lastRightWristY = null; t.lastRightWristTime = 0;
          return result;
        }
      }
    }
    return null;
  }

  function getTrackerForPose(poseIndex) {
    for (var i = 0; i < trackers.length; i++) {
      if (trackers[i].poseIndex === poseIndex) return trackers[i];
    }
    return null;
  }

  function getTrackerById(id) {
    for (var i = 0; i < trackers.length; i++) {
      if (trackers[i].id === id) return trackers[i];
    }
    return null;
  }

  function reset() {
    trackers = [];
    lastTriggerTime = -1e9;
  }

  return {
    update: update,
    checkTrigger: checkTrigger,
    gesturePhase: gesturePhase,
    getTrackerForPose: getTrackerForPose,
    getTrackerById: getTrackerById,
    reset: reset,
    get trackers() { return trackers; }
  };
}
