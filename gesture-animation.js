// gesture-animation.js
// Animated stick figure showing the trigger gesture.
//
// gestureStickFigure(ctx, cx, cy, tMs, scale)
//   ctx   — p5 instance (instance mode) or window (p5 global mode)
//   cx/cy — center of the figure
//   tMs   — current time in ms (pass millis() or p.millis())
//   scale — 1.0 = default size (~170px tall)
//
// createGestureAnimation(containerId)
//   Creates a standalone p5 instance-mode animation inside the given container element.

function gestureStickFigure(ctx, cx, cy, tMs, scale) {
  scale = scale || 1;
  ctx.push();

  var HEAD_R   = 13  * scale;
  var SHY      = cy  - 52 * scale;   // shoulder Y
  var SW       = 21  * scale;        // shoulder half-width from cx
  var HIP_Y    = cy  - 2  * scale;   // hip Y
  var ANKLE_Y  = cy  + 60 * scale;   // ankle Y
  var ARM_LEN  = 40  * scale;
  var HEAD_Y   = cy  - 85 * scale;

  var HALF_PI  = Math.PI / 2;
  var TWO_PI   = Math.PI * 2;

  var CYCLE    = 3600;    // ms per full sweep
  var PAUSE    = 0.18;    // fraction spent at rest before sweep starts

  var tc = (tMs % CYCLE) / CYCLE;
  var sweepT = tc < PAUSE ? 0 : (tc - PAUSE) / (1 - PAUSE);
  // ease-in-out cubic
  sweepT = sweepT < 0.5
    ? 4 * sweepT * sweepT * sweepT
    : 1 - Math.pow(-2 * sweepT + 2, 3) / 2;

  // Arm angle: arm hangs slightly right of straight down, sweeps CCW (crosses body, rises, returns)
  var RSX        = cx + SW;
  var LSX        = cx - SW;
  var startAngle = HALF_PI - 0.25;
  var armAngle   = startAngle + sweepT * TWO_PI;

  var tipX = RSX + Math.cos(armAngle) * ARM_LEN;
  var tipY = SHY + Math.sin(armAngle) * ARM_LEN;

  var lTipX = LSX - 4 * scale;
  var lTipY = SHY + ARM_LEN * 0.9;

  // Ghost trail showing the path swept so far
  ctx.noFill();
  ctx.strokeWeight(1.5 * scale);
  for (var a = startAngle; a <= armAngle - 0.05; a += 0.06) {
    var alpha = 8 + (a - startAngle) / (armAngle - startAngle) * 47;
    ctx.stroke(0, 244, 123, alpha);
    var tx  = RSX + Math.cos(a) * ARM_LEN;
    var ty  = SHY + Math.sin(a) * ARM_LEN;
    var tx2 = RSX + Math.cos(a + 0.06) * ARM_LEN;
    var ty2 = SHY + Math.sin(a + 0.06) * ARM_LEN;
    ctx.line(tx, ty, tx2, ty2);
  }

  // Static body parts
  ctx.stroke(0, 244, 123);
  ctx.strokeWeight(2.5 * scale);
  ctx.noFill();

  // Head
  ctx.ellipse(cx, HEAD_Y, HEAD_R * 2, HEAD_R * 2);

  // Body
  ctx.line(cx, HEAD_Y + HEAD_R, cx, HIP_Y);

  // Shoulders
  ctx.line(LSX, SHY, RSX, SHY);

  // Static left arm (dim)
  ctx.stroke(0, 244, 123, 120);
  ctx.strokeWeight(2 * scale);
  ctx.line(LSX, SHY, lTipX, lTipY);

  // Animated right arm (full brightness)
  ctx.stroke(0, 244, 123);
  ctx.strokeWeight(3 * scale);
  ctx.line(RSX, SHY, tipX, tipY);

  // Hips
  ctx.strokeWeight(2.5 * scale);
  ctx.line(cx - SW + 5 * scale, HIP_Y, cx + SW - 5 * scale, HIP_Y);

  // Legs
  ctx.line(cx - 2 * scale, HIP_Y, cx - SW + 5 * scale, ANKLE_Y);
  ctx.line(cx + 2 * scale, HIP_Y, cx + SW - 5 * scale, ANKLE_Y);

  // Wrist highlight dot
  ctx.fill(255, 220, 0);
  ctx.noStroke();
  ctx.ellipse(tipX, tipY, 9 * scale, 9 * scale);

  ctx.pop();
}

// Creates a standalone canvas animation inside containerId.
// Uses no p5 dependency so it works on pages that don't run a p5 sketch.
function createGestureAnimation(containerId) {
  var W = 140, H = 220;
  var container = document.getElementById(containerId);
  if (!container) return;

  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  container.appendChild(canvas);
  var c = canvas.getContext('2d');

  // Thin adapter presenting the p5-like API that gestureStickFigure expects.
  var _doFill = false, _fillColor = 'transparent';
  var _doStroke = true, _strokeColor = '#000';

  function toRgba(r, g, b, a) {
    return 'rgba(' + r + ',' + g + ',' + b + ',' + (a === undefined ? 1 : a / 255) + ')';
  }

  var ctx = {
    push: function() {
      c.save();
      _doFill = false; _fillColor = 'transparent';
      _doStroke = true; _strokeColor = '#000';
    },
    pop: function() { c.restore(); },
    noFill: function() { _doFill = false; },
    fill: function(r, g, b, a) { _doFill = true; _fillColor = toRgba(r, g, b, a); },
    noStroke: function() { _doStroke = false; },
    stroke: function(r, g, b, a) { _doStroke = true; _strokeColor = toRgba(r, g, b, a); },
    strokeWeight: function(w) { c.lineWidth = w; },
    line: function(x1, y1, x2, y2) {
      if (!_doStroke) return;
      c.strokeStyle = _strokeColor;
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
    },
    ellipse: function(x, y, w, h) {
      c.beginPath(); c.ellipse(x, y, w / 2, h / 2, 0, 0, Math.PI * 2);
      if (_doFill)   { c.fillStyle   = _fillColor;   c.fill();   }
      if (_doStroke) { c.strokeStyle = _strokeColor; c.stroke(); }
    }
  };

  var start = Date.now();
  function render() {
    c.fillStyle = 'rgb(10,30,45)';
    c.fillRect(0, 0, W, H);
    gestureStickFigure(ctx, W / 2, H * 0.54, Date.now() - start, 1.0);
    c.fillStyle = 'rgba(255,255,255,0.35)';
    c.font = '9px sans-serif';
    c.textAlign = 'center';
    c.fillText('make this gesture', W / 2, H - 4);
    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);
}
