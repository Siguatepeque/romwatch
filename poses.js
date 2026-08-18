// Hand-authored normalized landmark sets (0-1 image space, y down) used only to
// draw the ghost-skeleton guide overlay. These are placed by eye to look right,
// not derived from motion-capture data, and are never read by the scoring
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

// Same hand, thumb curled down across the palm toward the forearm line below
// the wrist (the Beighton thumb-to-forearm apposition target).
export const thumbToForearmTarget = z0([
  [0.5, 0.88], // wrist
  [0.46, 0.82], [0.48, 0.85], [0.5, 0.89], [0.51, 0.93], // thumb, curled to the forearm
  [0.42, 0.6], [0.4, 0.42], [0.39, 0.3], [0.38, 0.2], // index (unchanged)
  [0.5, 0.58], [0.5, 0.38], [0.5, 0.24], [0.5, 0.12], // middle (unchanged)
  [0.58, 0.6], [0.59, 0.41], [0.6, 0.28], [0.61, 0.18], // ring (unchanged)
  [0.66, 0.64], [0.68, 0.48], [0.69, 0.37], [0.7, 0.28], // pinky (unchanged)
]);

// Forearm resting horizontally (wrist at lower left), hand bent back so the
// fingers fan up and to the right: the wrist dorsiflexion target.
export const wristExtendedTarget = z0([
  [0.25, 0.6], // wrist
  [0.3, 0.5], [0.34, 0.42], [0.37, 0.36], [0.4, 0.3], // thumb
  [0.38, 0.32], [0.42, 0.2], [0.44, 0.13], [0.46, 0.07], // index
  [0.4, 0.28], [0.44, 0.16], [0.46, 0.09], [0.48, 0.03], // middle
  [0.42, 0.32], [0.46, 0.2], [0.48, 0.13], [0.5, 0.08], // ring
  [0.44, 0.38], [0.48, 0.28], [0.5, 0.22], [0.52, 0.17], // pinky
]);

export function interpolatePose(poseA, poseB, t) {
  return poseA.map((a, i) => {
    const b = poseB[i];
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
    };
  });
}
