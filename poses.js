// A hand-authored normalized landmark set (0-1 image space, y down) used only
// to draw the calibration ghost outline. Placed by eye to look like an open
// hand, not derived from motion-capture data, and never read by the scoring
// logic in geometry.js, which only ever measures the live tracked hand.

function z0(points) {
  return points.map(([x, y]) => ({ x, y, z: 0 }));
}

// Palm to camera, fingers relaxed and spread, wrist low: the calibration pose.
export const neutral = z0([
  [0.5, 0.88], // wrist
  [0.42, 0.8], [0.35, 0.72], [0.3, 0.64], [0.26, 0.57], // thumb
  [0.42, 0.6], [0.4, 0.42], [0.39, 0.3], [0.38, 0.2], // index
  [0.5, 0.58], [0.5, 0.38], [0.5, 0.24], [0.5, 0.12], // middle
  [0.58, 0.6], [0.59, 0.41], [0.6, 0.28], [0.61, 0.18], // ring
  [0.66, 0.64], [0.68, 0.48], [0.69, 0.37], [0.7, 0.28], // pinky
]);
