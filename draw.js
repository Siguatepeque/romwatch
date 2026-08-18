// The only canvas-drawing code in the app. drawSkeleton renders both the live
// tracked hand and the static calibration ghost with the same function, just
// different style/opacity.

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

export function drawCountdown(ctx, canvasWidth, canvasHeight, value) {
  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.font = "bold 96px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(value), canvasWidth / 2, canvasHeight / 2);
  ctx.restore();
}
