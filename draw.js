// The only canvas-drawing code in the app. drawSkeleton renders the live
// tracked hand, a static ghost target, and an interpolated animation frame
// with the same function, just different style/opacity.

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], // thumb
  [0, 5], [5, 6], [6, 7], [7, 8], // index
  [5, 9], [9, 10], [10, 11], [11, 12], // middle
  [9, 13], [13, 14], [14, 15], [15, 16], // ring
  [13, 17], [17, 18], [18, 19], [19, 20], // pinky
  [0, 17], // palm base
];

export function drawSkeleton(ctx, landmarks, canvasWidth, canvasHeight, style = {}) {
  const { color = "#5eead4", alpha = 1, lineWidth = 3, pointRadius = 4 } = style;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lineWidth;

  ctx.beginPath();
  for (const [a, b] of HAND_CONNECTIONS) {
    const pa = landmarks[a];
    const pb = landmarks[b];
    ctx.moveTo(pa.x * canvasWidth, pa.y * canvasHeight);
    ctx.lineTo(pb.x * canvasWidth, pb.y * canvasHeight);
  }
  ctx.stroke();

  for (const p of landmarks) {
    ctx.beginPath();
    ctx.arc(p.x * canvasWidth, p.y * canvasHeight, pointRadius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// A single ring at one landmark's target position, used instead of a full
// ghost hand: two overlapping 21-point skeletons (yours and the target's)
// read as a confusing second hand rather than a guide. One point to reach is
// a clearer instruction than a whole outline to match.
export function drawTargetRing(ctx, point, canvasWidth, canvasHeight, color = "#f5c26b") {
  const x = point.x * canvasWidth;
  const y = point.y * canvasHeight;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(x, y, 16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawGuideBox(ctx, canvasWidth, canvasHeight) {
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 8]);
  const margin = 0.12;
  ctx.strokeRect(
    canvasWidth * margin,
    canvasHeight * margin,
    canvasWidth * (1 - margin * 2),
    canvasHeight * (1 - margin * 2)
  );
  ctx.restore();
}

export function drawTableEdgeLine(ctx, canvasWidth, canvasHeight, y = 0.6) {
  ctx.save();
  ctx.strokeStyle = "rgba(250, 204, 21, 0.7)";
  ctx.lineWidth = 2;
  ctx.setLineDash([14, 8]);
  ctx.beginPath();
  ctx.moveTo(0, canvasHeight * y);
  ctx.lineTo(canvasWidth, canvasHeight * y);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "rgba(250, 204, 21, 0.9)";
  ctx.font = "14px system-ui, sans-serif";
  ctx.fillText("line your forearm up along here", 12, canvasHeight * y - 10);
  ctx.restore();
}

export function drawCountdown(ctx, canvasWidth, canvasHeight, value) {
  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.font = "bold 96px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(value), canvasWidth / 2, canvasHeight / 2);
  ctx.restore();
}
