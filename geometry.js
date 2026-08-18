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

// A rep's extreme value alone isn't proof the person actually attempted the
// movement: holding still gets measured too, and its resting value could
// happen to land on either side of the positive threshold. These require the
// measured value to have moved a meaningful amount from wherever the hand
// started the capture window, in the direction the maneuver asks for.
export const MIN_THUMB_MOVEMENT_NORMALIZED = 0.12;
export const MIN_PINKY_MOVEMENT_DEG = 20;

export function movedEnoughForThumb(startValue, extremeValue) {
  return startValue - extremeValue >= MIN_THUMB_MOVEMENT_NORMALIZED;
}

export function movedEnoughForPinky(startValue, extremeValue) {
  return extremeValue - startValue >= MIN_PINKY_MOVEMENT_DEG;
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

function length(v) {
  return Math.hypot(v.x, v.y);
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function normalize(v) {
  const len = length(v) || 1;
  return { x: v.x / len, y: v.y / len };
}

function handScale(landmarks) {
  return length(sub(landmarks[MIDDLE_MCP], landmarks[WRIST])) || 1;
}

// Distance from the thumb tip to the forearm line, normalized by hand size so
// it holds regardless of how close the camera is. There is no elbow landmark
// available (hand-only model), so the forearm direction is approximated as the
// ray from the wrist pointing away from the hand (opposite of wrist -> middle
// MCP). That is a geometric approximation for a visual/scoring proxy, not a
// tracked limb.
export function normalizedThumbForearmDistance(landmarks) {
  const wrist = landmarks[WRIST];
  const scale = handScale(landmarks);
  const forearmDir = normalize({
    x: -(landmarks[MIDDLE_MCP].x - wrist.x),
    y: -(landmarks[MIDDLE_MCP].y - wrist.y),
  });
  const toThumb = sub(landmarks[THUMB_TIP], wrist);
  const along = Math.max(0, dot(toThumb, forearmDir)); // clamp to the ray, not the full line
  const closestPointOnRay = {
    x: wrist.x + forearmDir.x * along,
    y: wrist.y + forearmDir.y * along,
  };
  const perpDistance = length(sub(landmarks[THUMB_TIP], closestPointOnRay));
  return perpDistance / scale;
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

// repStatuses: array of "positive" | "negative" | "inconclusive" (one per rep,
// where "inconclusive" means the quality gate never passed after retries).
export function sessionManeuverStatus(repStatuses) {
  const positiveCount = repStatuses.filter((s) => s === "positive").length;
  const validCount = repStatuses.filter((s) => s !== "inconclusive").length;
  if (positiveCount >= 2) return "positive";
  if (validCount < 2) return "inconclusive";
  return "negative";
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
