// Pure geometry and scoring logic. No DOM, no camera, no MediaPipe types beyond
// plain {x, y, z} landmark objects, so this file can be tested with plain Node.

export const WRIST = 0;
export const THUMB_TIP = 4;
export const MIDDLE_MCP = 9;
export const PINKY_MCP = 17;
export const PINKY_PIP = 18;

// A rep's measured value has to clear these to count as "positive" (matches a
// clinical hypermobility sign). The thumb threshold approximates "touching":
// landmark noise and finger thickness mean it rarely hits exactly zero. The
// pinky threshold is a proxy for the clinical ">90 degrees from the dorsum of
// the hand" criterion (see pinkyExtensionAngleDeg below for why it isn't the
// same number), and like the thumb one, needs real-world calibration.
export const THUMB_TOUCH_NORMALIZED = 0.15;
export const PINKY_EXTENSION_DEG = 70;

// A maneuver needs at least this many positive sessions in the history before
// the recommendation escalates to "worth getting checked."
export const SESSIONS_FOR_CHECKUP_TIER = 3;

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

function length(v) {
  return Math.hypot(v.x, v.y);
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function handScale(landmarks) {
  return length(sub(landmarks[MIDDLE_MCP], landmarks[WRIST])) || 1;
}

// Distance from the thumb tip to the wrist, normalized by hand size so it
// holds regardless of how close the camera is.
//
// An earlier version tried to approximate the forearm's direction (there is
// no elbow landmark available from a hand-only model) as the ray from the
// wrist pointing away from the hand, and measured distance to that ray
// instead of to the wrist directly. That depended on the hand's 2D direction
// in frame correctly indicating where the forearm actually was, which real
// testing showed breaks down badly: a genuine full thumb-to-forearm touch
// naturally rotates the wrist away from whatever angle the hand started at,
// so the assumed ray pointed the wrong way exactly when it mattered most.
// Plain distance to the wrist itself doesn't depend on that assumption at
// all, since the wrist is an actually-tracked point rather than an inferred
// direction, at the cost of measuring "close to the wrist" rather than
// "touching the forearm specifically." Given finger thickness and landmark
// noise already blur that distinction, it's the more robust trade.
export function normalizedThumbForearmDistance(landmarks) {
  const scale = handScale(landmarks);
  const distance = length(sub(landmarks[THUMB_TIP], landmarks[WRIST]));
  return distance / scale;
}

// Angle, in degrees, between the metacarpal direction at the little finger
// (wrist -> pinky MCP) and the proximal phalanx (pinky MCP -> pinky PIP): how
// far the finger has folded back relative to the hand itself, rather than
// relative to the camera frame. That makes it work at any hand rotation or
// camera angle, unlike a measurement tied to "horizontal in frame."
//
// This is a proxy for the clinical criterion (extension beyond 90 degrees
// from the dorsum of the hand, normally checked by a second person passively
// pushing the finger back), not the same reference frame: a relaxed straight
// finger already reads as a nonzero angle here rather than 0, so the
// threshold in PINKY_EXTENSION_DEG is tuned against this metric specifically,
// not against the clinical 90-degree figure directly.
export function pinkyExtensionAngleDeg(landmarks) {
  const a = sub(landmarks[PINKY_MCP], landmarks[WRIST]);
  const b = sub(landmarks[PINKY_PIP], landmarks[PINKY_MCP]);
  const crossProd = a.x * b.y - a.y * b.x;
  const dotProd = dot(a, b);
  const radians = Math.atan2(Math.abs(crossProd), dotProd);
  return (radians * 180) / Math.PI;
}

export function handBoundingBoxWidth(landmarks) {
  const xs = landmarks.map((p) => p.x);
  return Math.max(...xs) - Math.min(...xs);
}

// Framing is intentionally permissive: it only flags cases where the
// measurement would be unreliable (no hand, too small/large to place
// landmarks accurately, or clipped at the edge). Any position between "way
// too far" and "way too close" is accepted.
export function checkFraming(landmarks, frameWidthPx, refHandWidthPx) {
  if (!landmarks) return "not_detected";

  const wrist = landmarks[WRIST];
  const margin = 0.1;
  if (wrist.x < margin || wrist.x > 1 - margin || wrist.y < margin || wrist.y > 1 - margin) {
    return "off_center";
  }

  const widthPx = handBoundingBoxWidth(landmarks) * frameWidthPx;
  if (widthPx < 0.4 * refHandWidthPx) return "too_far";
  if (widthPx > 2.2 * refHandWidthPx) return "too_close";
  return "ok";
}

// Both maneuvers normally need a second hand to push the tracked joint into
// position (that's how the clinical exam is administered too, just usually
// by a clinician rather than the person's own other hand). With the model
// watching for up to two hands, this picks out the one actually being
// measured: whichever detected hand's wrist is closest to where the tracked
// hand was last seen, so the assisting hand entering frame doesn't hijack
// tracking or cause it to flicker between the two hands frame to frame.
// Falls back to the first detected hand when there is no prior position yet
// (session start) or only one hand is visible.
export function pickPrimaryHand(handsLandmarks, previousWrist) {
  if (!handsLandmarks || handsLandmarks.length === 0) return null;
  if (handsLandmarks.length === 1 || !previousWrist) return handsLandmarks[0];

  let closest = handsLandmarks[0];
  let closestDistance = Infinity;
  for (const landmarks of handsLandmarks) {
    const wrist = landmarks[WRIST];
    const distance = Math.hypot(wrist.x - previousWrist.x, wrist.y - previousWrist.y);
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = landmarks;
    }
  }
  return closest;
}

export const FRAMING_MESSAGES = {
  not_detected: "We can't see your hand. Check your lighting or position.",
  off_center: "Keep your hand fully in frame.",
  too_far: "Move closer.",
  too_close: "Move back a little.",
  ok: "Good, you're all set.",
};

export function isThumbRepPositive(normalizedDistance) {
  return normalizedDistance <= THUMB_TOUCH_NORMALIZED;
}

export function isPinkyRepPositive(angleDeg) {
  return angleDeg >= PINKY_EXTENSION_DEG;
}

// repStatuses: array of "positive" | "negative" | "inconclusive" (one or two
// reps, where "inconclusive" means the quality gate never passed after
// retries). A single successful demonstration is enough to score positive,
// matching how the real Beighton exam scores a maneuver: the clinician does
// it once per side, not several times looking for a majority.
export function sessionManeuverStatus(repStatuses) {
  if (repStatuses.some((s) => s === "positive")) return "positive";
  if (repStatuses.some((s) => s === "negative")) return "negative";
  return "inconclusive";
}

export function countPositiveSessions(history, maneuverKey) {
  return history.filter((session) => session.results[maneuverKey] === "positive").length;
}

// "neutral" -> "note" -> "checked", based on how many separate sessions have
// come back positive for this maneuver. A single positive session should not
// read as urgent; a consistent pattern across sessions should.
export function recommendationTier(positiveSessionCount) {
  if (positiveSessionCount >= SESSIONS_FOR_CHECKUP_TIER) return "checked";
  if (positiveSessionCount >= 1) return "note";
  return "neutral";
}
