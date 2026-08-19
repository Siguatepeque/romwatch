// Pure geometry and scoring logic. No DOM, no camera, no MediaPipe types beyond
// plain {x, y, z} landmark objects, so this file can be tested with plain Node.

export const WRIST = 0;
export const THUMB_TIP = 4;
export const MIDDLE_MCP = 9;
export const PINKY_MCP = 17;
export const PINKY_PIP = 18;
export const PINKY_DIP = 19;

// A rep's measured value has to clear these to count as "positive" (matches a
// clinical hypermobility sign). The thumb threshold is the wrist line plus a
// little slack, since landmark noise and the tip landmark sitting slightly
// distal to the actual contact point mean a real touch rarely reads as a
// clean zero (see normalizedThumbForearmReach below for the metric). The
// pinky threshold is a proxy for the clinical ">90 degrees from the dorsum of
// the hand" criterion (see pinkyExtensionAngleDeg below for why it isn't the
// same number), and like the thumb one, needs real-world calibration.
export const THUMB_PAST_WRIST_NORMALIZED = 0.1;
export const PINKY_EXTENSION_DEG = 70;

// Two limits on what counts as a measurable frame at all, both calibration
// knobs rather than derived constants, and both tuned against the geometry
// below rather than any clinical figure.
//
// A little finger being pushed back stays straight along its own length; one
// that's curled bends at the PIP joint. Past this much bend at that joint,
// the hand is gripping rather than being pushed, and the extension angle
// stops meaning what it's supposed to mean.
export const PINKY_CURL_LIMIT_DEG = 45;
// The thumb reach is a ratio along the hand's axis, so it survives the hand
// being turned, right up until the axis is pointing at the camera and its
// projection collapses. Below this much palm length per unit of hand span,
// dividing by it amplifies ordinary landmark jitter past the width of the
// threshold itself. Measured against the calibration pose, this fires at
// roughly 70 degrees of tilt away from the camera plane.
export const MIN_PALM_AXIS_FRACTION = 0.15;

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

// MediaPipe normalizes x by frame width and y by frame height, so on a
// non-square frame one normalized unit means a different real distance on
// each axis, and any measurement that depends on direction comes out skewed
// by however the hand happens to be turned. Both measurements below are
// angle-sensitive by design, so undo that first. Only the relative scaling
// matters (both measurements are ratios), not the units.
export function squareAspect(landmarks, aspect) {
  return landmarks.map((p) => ({ x: p.x * aspect, y: p.y, z: p.z }));
}

// How far the thumb tip still is from the forearm, measured along the hand's
// own axis (wrist -> middle MCP) and normalized by hand size: positive while
// the tip is still out over the palm, zero at the wrist line, negative once
// it has crossed onto the forearm. A positive Beighton sign is <= 0-ish.
//
// Two earlier versions measured plain distance instead, first to an inferred
// forearm ray and then to the wrist landmark itself, and both produced false
// negatives on real hypermobile hands. Straight distance is the wrong shape
// of measurement here: the thumb touches the forearm on the radial side and
// a couple of centimetres proximal to the wrist landmark, so a genuine full
// touch still reads as a sizeable distance, while loosening the threshold
// enough to accept it also accepts an ordinary thumb folded across the palm.
// The two cases don't differ much in distance-to-wrist, but they differ
// completely in whether the tip has crossed the wrist line, which is exactly
// what the clinical criterion (thumb apposed to the flexor forearm) is
// asking about. The sideways offset that broke the distance metric lands in
// the discarded perpendicular component here.
export function normalizedThumbForearmReach(landmarks) {
  const axis = sub(landmarks[MIDDLE_MCP], landmarks[WRIST]);
  const scale = length(axis) || 1;
  const toThumb = sub(landmarks[THUMB_TIP], landmarks[WRIST]);
  return dot(toThumb, axis) / (scale * scale);
}

// How much the path p -> q -> r turns at q, in degrees: 0 for straight
// through, 180 for doubled back. Unsigned, so it says how far something bent
// and not which way, which is fine where the two directions are told apart by
// other means (see pinkyPoseIssue) and wrong where they aren't.
function jointAngleDeg(p, q, r) {
  const a = sub(q, p);
  const b = sub(r, q);
  const radians = Math.atan2(Math.abs(a.x * b.y - a.y * b.x), dot(a, b));
  return (radians * 180) / Math.PI;
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
  return jointAngleDeg(landmarks[WRIST], landmarks[PINKY_MCP], landmarks[PINKY_PIP]);
}

// Why a frame can't be scored for this maneuver, or null if it can. Separate
// from checkFraming because these are about the hand's own pose rather than
// where it sits in the camera's view, and separate from the measurement
// because a blocked frame has no meaningful value to report at all.
//
// The little finger's extension angle is unsigned: it says how far the joint
// bent, not whether it bent back toward the dorsum (the sign of hypermobility
// this test looks for) or forward into the palm (an ordinary grip). A curled
// finger measures 79 degrees, a hard fist 105, both past a 70 degree
// threshold meant to mean hyperextension. That matters here more than it
// would in an active test: this maneuver is performed by gripping the little
// finger with the other hand and pushing, and gripping curls fingers, so the
// wrong-direction pose is present in nearly every attempt and the rep keeps
// the most extreme frame it sees.
//
// The two are told apart at the finger's own PIP joint rather than by the
// direction of the bend, which in 2D is only recoverable from the palm's
// facing and degenerates exactly in the side-on view this maneuver asks for.
// Curling bends the finger along its length; being pushed back doesn't.
export function pinkyPoseIssue(landmarks) {
  const curl = jointAngleDeg(landmarks[PINKY_MCP], landmarks[PINKY_PIP], landmarks[PINKY_DIP]);
  return curl > PINKY_CURL_LIMIT_DEG ? "finger_curled" : null;
}

// The thumb reach divides by the hand's axis length, and the axis is what
// collapses when the hand points at the camera rather than across it. The
// ratio itself stays honest under that projection (both halves foreshorten
// together), but the arithmetic stops being: at a tenth of the axis length,
// one frame of ordinary landmark jitter swings the reading by twice the
// width of the whole threshold, and since the rep keeps the lowest frame,
// one such frame decides it.
export function thumbPoseIssue(landmarks) {
  const palmLength = length(sub(landmarks[MIDDLE_MCP], landmarks[WRIST]));
  return palmLength < MIN_PALM_AXIS_FRACTION * handSpan(landmarks) ? "hand_end_on" : null;
}

// Diagonal of the box around every landmark: a size estimate that barely
// moves when the hand turns. The bounding box *width* it replaces collapsed
// toward zero whenever the hand rotated edge-on to the camera, which the
// thumb maneuver forces, so a correctly performed attempt was reported as
// "too far away."
export function handSpan(landmarks) {
  const xs = landmarks.map((p) => p.x);
  const ys = landmarks.map((p) => p.y);
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

// Framing is deliberately permissive, and it is not a pose check: the
// measurements below don't care how the hand is turned, so neither does
// this. It flags only what actually degrades a reading: no hand at all, part
// of the hand outside the frame (landmarks off-screen are guesses), or a
// hand so small or so large in frame that landmark placement gets unreliable.
// Position in frame is free, and so is angle.
export function checkFraming(landmarks, frameWidthPx, refSpanPx) {
  if (!landmarks) return "not_detected";

  // Only truly off-frame counts, not "near the edge": people rest the wrist
  // low in frame, and the old check called that a framing error.
  const margin = 0.02;
  for (const p of landmarks) {
    if (p.x < margin || p.x > 1 - margin || p.y < margin || p.y > 1 - margin) return "clipped";
  }

  const spanPx = handSpan(landmarks) * frameWidthPx;
  if (spanPx < 0.35 * refSpanPx) return "too_far";
  if (spanPx > 2.5 * refSpanPx) return "too_close";
  return "ok";
}

// Both maneuvers are passive: the joint is pushed into position by someone
// else's hand, a clinician's in the real exam and the person's own other hand
// here. Two hands in frame is the normal, expected state of this app, not an
// error case, so the job is to keep measuring the right one throughout.
//
// hands: [{ landmarks, label }], where label is MediaPipe's handedness for
// that detection. tracked: { label, wrist } for the hand this session is
// measuring, either field possibly null before calibration has locked one in.
//
// Handedness does the work, and proximity to the last known position only
// breaks ties between two same-labelled detections. An earlier version used
// proximity alone, which held up while both hands were visible but failed at
// the worst possible moment: at full apposition the assisting hand covers the
// hand it's pushing, the model often reports only the assisting hand, and
// "the closest hand to where we were looking" then means the wrong hand
// entirely, silently measuring the helper in whatever pose it happens to be
// in. Returning null there instead costs a retry, on the same reasoning the
// quality gate already runs on: a bad reading is worse than no reading.
export function pickPrimaryHand(hands, tracked) {
  if (!hands || hands.length === 0) return null;

  const candidates = tracked?.label ? hands.filter((hand) => hand.label === tracked.label) : hands;
  if (candidates.length === 0) return null; // only the assisting hand is in view
  if (candidates.length === 1 || !tracked?.wrist) return candidates[0];

  let closest = candidates[0];
  let closestDistance = Infinity;
  for (const hand of candidates) {
    const wrist = hand.landmarks[WRIST];
    const distance = Math.hypot(wrist.x - tracked.wrist.x, wrist.y - tracked.wrist.y);
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = hand;
    }
  }
  return closest;
}

// Everything that can stop a frame from being scored, in the words shown on
// screen when it does. Framing states, tracking states and per-maneuver pose
// states all land here, because from the user's side they're one question:
// what do I change so this counts?
export const FRAME_ISSUE_MESSAGES = {
  not_detected: "We can't see your hand. Check your lighting, or move it into view.",
  other_hand_only: "We can only see your assisting hand. This session measures the hand you calibrated with, so keep that one visible too.",
  two_hands: "Show just the hand you want tested for now, so we know which one to measure. Your other hand joins in once we start.",
  clipped: "Part of your hand is outside the frame. Any angle is fine, it just has to be all visible.",
  too_far: "Move your hand closer to the camera.",
  too_close: "Move your hand back a little.",
  finger_curled: "Keep your little finger straight while you push it back, rather than curling it in.",
  hand_end_on: "Your hand is pointing at the camera. Turn it so the camera sees it more side-on.",
  ok: "Good, you're all set.",
};

export function isThumbRepPositive(normalizedReach) {
  return normalizedReach <= THUMB_PAST_WRIST_NORMALIZED;
}

export function isPinkyRepPositive(angleDeg) {
  return angleDeg >= PINKY_EXTENSION_DEG;
}

// Plain-language versions of the live measurements, shown on screen while the
// maneuver is being performed and again next to the recorded result. The
// point is that the number the app is actually deciding on is visible at the
// moment it disagrees with you: "my thumb is touching and it still says 38%"
// is a reportable bug, "it said no" isn't.
function percent(fraction) {
  return `${Math.round(fraction * 100)}%`;
}

export function describeThumbReach(reach) {
  const met = isThumbRepPositive(reach);
  return {
    met,
    text: met ? "Thumb has reached the wrist line." : "Thumb is short of the wrist line.",
    // Phrased as two positions rather than a number and a rule, because the
    // second position is drawn on the overlay: "the line is at 10%" is the
    // dashed line the person can see across their wrist.
    detail: `thumb tip sits ${percent(Math.abs(reach))} of a palm length ${
      reach >= 0 ? "out from" : "past"
    } the wrist; the line is at ${percent(THUMB_PAST_WRIST_NORMALIZED)}`,
  };
}

export function describePinkyAngle(angleDeg) {
  const met = isPinkyRepPositive(angleDeg);
  return {
    met,
    text: met ? "Little finger is past the reference angle." : "Little finger is short of the reference angle.",
    detail: `bent back ${Math.round(angleDeg)}° from the knuckle, counts at ${PINKY_EXTENSION_DEG}° or more`,
  };
}

// The decision boundary itself, as two endpoints in normalized frame
// coordinates, so the overlay can draw the line the thumb has to cross
// instead of leaving people to guess where the app thinks their wrist is.
// Derived from the same numbers the scoring uses, aspect correction included,
// so what's drawn is the actual threshold rather than an illustration of it.
export function thumbTargetLine(landmarks, aspect = 1) {
  const square = squareAspect(landmarks, aspect);
  const axis = sub(square[MIDDLE_MCP], square[WRIST]);
  const perpendicular = { x: -axis.y, y: axis.x };
  const cx = square[WRIST].x + axis.x * THUMB_PAST_WRIST_NORMALIZED;
  const cy = square[WRIST].y + axis.y * THUMB_PAST_WRIST_NORMALIZED;
  const half = 0.85; // palm lengths to either side, enough to read as a line
  return [
    { x: (cx - perpendicular.x * half) / aspect, y: cy - perpendicular.y * half },
    { x: (cx + perpendicular.x * half) / aspect, y: cy + perpendicular.y * half },
  ];
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
