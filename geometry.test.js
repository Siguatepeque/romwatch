// Plain Node, assert-based checks. Run with: node geometry.test.js
import assert from "node:assert/strict";
import {
  WRIST,
  THUMB_TIP,
  MIDDLE_MCP,
  PINKY_MCP,
  PINKY_PIP,
  PINKY_DIP,
  normalizedThumbForearmReach,
  pinkyExtensionAngleDeg,
  squareAspect,
  thumbPoseIssue,
  pinkyPoseIssue,
  thumbTargetLine,
  describeThumbReach,
  describePinkyAngle,
  THUMB_PAST_WRIST_NORMALIZED,
  checkFraming,
  pickPrimaryHand,
  isThumbRepPositive,
  isPinkyRepPositive,
  sessionManeuverStatus,
  countPositiveSessions,
  recommendationTier,
} from "./geometry.js";
import { neutral } from "./poses.js";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

// A plain open hand: wrist at (0.5, 0.8), middle MCP straight above it, so
// hand scale (wrist -> middle MCP) is 0.3 and "up" is the hand direction.
// Bounding box across x spans 0.3 (thumb tip) to 0.5 (everything else) = 0.2.
function makeHand() {
  const landmarks = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  landmarks[WRIST] = { x: 0.5, y: 0.8, z: 0 };
  landmarks[MIDDLE_MCP] = { x: 0.5, y: 0.5, z: 0 }; // hand scale = 0.3
  landmarks[THUMB_TIP] = { x: 0.3, y: 0.6, z: 0 };
  return landmarks;
}

test("normalizedThumbForearmReach: an ordinary thumb folded across the palm stays positive", () => {
  const hand = makeHand();
  assert.ok(isThumbRepPositive(normalizedThumbForearmReach(hand)) === false);
});

// The real-world false negative this metric exists to fix: the thumb tip is
// touching the forearm, which puts it a little past the wrist line and well
// off to the radial side. Its plain distance to the wrist landmark is large
// (0.4 hand-scales here), so the old distance metric scored this negative.
test("normalizedThumbForearmReach: thumb touching the forearm scores positive despite the sideways offset", () => {
  const hand = makeHand();
  hand[THUMB_TIP] = { x: 0.3, y: 0.85, z: 0 }; // past the wrist, radial side
  const reach = normalizedThumbForearmReach(hand);
  assert.ok(reach < 0, `expected the tip past the wrist line, got ${reach}`);
  assert.ok(isThumbRepPositive(reach));
});

test("normalizedThumbForearmReach: thumb tip right at the wrist is ~0", () => {
  const hand = makeHand();
  hand[THUMB_TIP] = { x: 0.51, y: 0.81, z: 0 };
  assert.ok(Math.abs(normalizedThumbForearmReach(hand)) < 0.05);
});

test("normalizedThumbForearmReach: doesn't depend on which way the hand is pointing", () => {
  // Same hand, rotated 90 degrees about the wrist. Measuring along the hand's
  // own axis rather than the camera frame, the reading shouldn't move.
  const hand = makeHand();
  const rotated = hand.map((p) => ({ x: 0.5 + (p.y - 0.8), y: 0.8 - (p.x - 0.5), z: 0 }));
  const delta = normalizedThumbForearmReach(rotated) - normalizedThumbForearmReach(hand);
  assert.ok(Math.abs(delta) < 1e-9, `rotation changed the reading by ${delta}`);
});

test("pinkyExtensionAngleDeg: finger held straight in line with the hand reads ~0 degrees", () => {
  const hand = makeHand();
  hand[PINKY_MCP] = { x: 0.6, y: 0.6, z: 0 }; // wrist -> MCP direction: (0.1, -0.2)
  hand[PINKY_PIP] = { x: 0.65, y: 0.5, z: 0 }; // MCP -> PIP: (0.05, -0.1), same direction
  assert.ok(Math.abs(pinkyExtensionAngleDeg(hand) - 0) < 1);
});

test("pinkyExtensionAngleDeg: finger bent perpendicular to the hand reads ~90 degrees", () => {
  const hand = makeHand();
  hand[PINKY_MCP] = { x: 0.6, y: 0.6, z: 0 }; // wrist -> MCP direction: (0.1, -0.2)
  hand[PINKY_PIP] = { x: 0.8, y: 0.7, z: 0 }; // MCP -> PIP: (0.2, 0.1), perpendicular to the above
  assert.ok(Math.abs(pinkyExtensionAngleDeg(hand) - 90) < 1);
});

test("pinkyExtensionAngleDeg: finger folded back over the hand reads ~180 degrees", () => {
  const hand = makeHand();
  hand[PINKY_MCP] = { x: 0.6, y: 0.6, z: 0 };
  hand[PINKY_PIP] = { x: 0.5, y: 0.8, z: 0 }; // MCP -> PIP: (-0.1, 0.2), opposite direction
  assert.ok(Math.abs(pinkyExtensionAngleDeg(hand) - 180) < 1);
});

// The little finger's extension angle can't tell which way the joint bent, so
// a curled finger reads as a large "extension." That pose isn't hypothetical
// here: this maneuver is performed by gripping the finger and pushing it, and
// gripping curls fingers.
test("pinkyPoseIssue: a curled little finger is not measurable as extension", () => {
  const hand = makeHand();
  hand[PINKY_MCP] = { x: 0.62, y: 0.62, z: 0 };
  hand[PINKY_PIP] = { x: 0.6, y: 0.6, z: 0 };
  hand[PINKY_DIP] = { x: 0.58, y: 0.62, z: 0 }; // doubling back: a curl
  assert.ok(isPinkyRepPositive(pinkyExtensionAngleDeg(hand)), "the angle alone reads as a positive");
  assert.equal(pinkyPoseIssue(hand), "finger_curled");
});

test("pinkyPoseIssue: a finger pushed straight back is measurable", () => {
  const hand = makeHand();
  hand[PINKY_MCP] = { x: 0.62, y: 0.62, z: 0 };
  hand[PINKY_PIP] = { x: 0.56, y: 0.71, z: 0 };
  hand[PINKY_DIP] = { x: 0.5, y: 0.8, z: 0 }; // straight along the finger
  assert.ok(isPinkyRepPositive(pinkyExtensionAngleDeg(hand)));
  assert.equal(pinkyPoseIssue(hand), null);
});

test("thumbPoseIssue: a hand across the camera is measurable, one pointing at it isn't", () => {
  const hand = makeHand();
  assert.equal(thumbPoseIssue(hand), null);

  // Same hand foreshortened along its own axis, as when it turns to point at
  // the camera. The reach stays the same number, but it's now a ratio of two
  // tiny projections and one frame of jitter swings it past the threshold.
  const wristY = hand[WRIST].y;
  const endOn = hand.map((p) => ({ x: p.x, y: wristY + (p.y - wristY) * 0.1, z: 0 }));
  assert.ok(
    Math.abs(normalizedThumbForearmReach(endOn) - normalizedThumbForearmReach(hand)) < 1e-9,
    "the reach itself is unchanged, which is exactly why it needs a separate guard"
  );
  assert.equal(thumbPoseIssue(endOn), "hand_end_on");
});

test("checkFraming: no landmarks is not_detected", () => {
  assert.equal(checkFraming(null, 1000, 200), "not_detected");
});

// Hand span (bounding-box diagonal) for makeHand is hypot(0.2, 0.3) = 0.36.
test("checkFraming: a hand resting low in frame is fine, not a framing error", () => {
  const hand = makeHand();
  hand[WRIST] = { x: 0.5, y: 0.95, z: 0 }; // near the bottom edge but still visible
  assert.equal(checkFraming(hand, 1000, 360), "ok");
});

test("checkFraming: a landmark actually outside the frame is clipped", () => {
  const hand = makeHand();
  hand[THUMB_TIP] = { x: -0.02, y: 0.6, z: 0 };
  assert.equal(checkFraming(hand, 1000, 360), "clipped");
});

test("checkFraming: hand much smaller than reference is too_far", () => {
  const hand = makeHand();
  // spanPx = 0.36 * 1000 = 360, well under 0.35 * 2000 = 700
  assert.equal(checkFraming(hand, 1000, 2000), "too_far");
});

test("checkFraming: hand much larger than reference is too_close", () => {
  const hand = makeHand();
  // spanPx = 360, well over 2.5 * 50 = 125
  assert.equal(checkFraming(hand, 1000, 50), "too_close");
});

test("checkFraming: hand within tolerance is ok", () => {
  const hand = makeHand();
  assert.equal(checkFraming(hand, 1000, 360), "ok");
});

// The framing gate must not double as a pose gate: turning the hand edge-on
// shrinks its bounding box in one axis, which the old width-based size check
// read as "you moved too far away" in the middle of a correct attempt.
test("checkFraming: a hand turned edge-on to the camera is still ok", () => {
  const hand = makeHand();
  const flattened = hand.map((p) => ({ x: 0.5 + (p.x - 0.5) * 0.15, y: p.y, z: 0 }));
  assert.equal(checkFraming(flattened, 1000, 360), "ok");
});

test("squareAspect: measurements survive a non-square frame", () => {
  // The same hand seen on a 16:9 frame: normalized y units cover less real
  // distance than x units, which skews any angle-dependent measurement unless
  // it's undone first.
  const hand = makeHand();
  hand[THUMB_TIP] = { x: 0.34, y: 0.74, z: 0 }; // off-axis, so skew would show
  const aspect = 16 / 9;
  const square = normalizedThumbForearmReach(squareAspect(hand, 1));
  const widescreen = normalizedThumbForearmReach(squareAspect(hand, aspect));
  assert.ok(Math.abs(square - widescreen) < 1e-9, `aspect skewed the reading: ${square} vs ${widescreen}`);
});

test("thumbTargetLine: the drawn line is exactly the pass/fail boundary", () => {
  const hand = makeHand();
  const aspect = 16 / 9;
  const [a, b] = thumbTargetLine(hand, aspect);
  for (const t of [0, 0.37, 1]) {
    hand[THUMB_TIP] = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: 0 };
    const reach = normalizedThumbForearmReach(squareAspect(hand, aspect));
    assert.ok(
      Math.abs(reach - THUMB_PAST_WRIST_NORMALIZED) < 1e-9,
      `a thumb tip on the drawn line should read exactly at the threshold, got ${reach}`
    );
  }
});

test("describe*: the reading says the number and the bar it has to clear", () => {
  const short = describeThumbReach(0.38);
  assert.equal(short.met, false);
  assert.match(short.detail, /38%/);
  assert.match(short.detail, /10%/);
  assert.equal(describeThumbReach(-0.04).met, true);

  const pinky = describePinkyAngle(54);
  assert.equal(pinky.met, false);
  assert.match(pinky.detail, /54/);
  assert.equal(describePinkyAngle(88).met, true);
});

// Two hands in frame is the normal state for these maneuvers, since both are
// administered by pushing the joint with the other hand.
function detect(...hands) {
  return hands.map(([landmarks, label]) => ({ landmarks, label }));
}

test("pickPrimaryHand: no hands detected returns null", () => {
  assert.equal(pickPrimaryHand([], { label: "Right", wrist: { x: 0.5, y: 0.5 } }), null);
  assert.equal(pickPrimaryHand(null, { label: "Right", wrist: { x: 0.5, y: 0.5 } }), null);
});

test("pickPrimaryHand: before calibration locks a hand in, the first detection is it", () => {
  const hand = makeHand();
  const picked = pickPrimaryHand(detect([hand, "Left"]), { label: null, wrist: null });
  assert.equal(picked.landmarks, hand);
});

test("pickPrimaryHand: the assisting hand doesn't hijack tracking", () => {
  const testHand = makeHand(); // wrist at (0.5, 0.8)
  const assisting = makeHand();
  assisting[WRIST] = { x: 0.05, y: 0.05, z: 0 };
  // Listed first, and it's the same handedness as the tracked hand here, so
  // only position separates them.
  const picked = pickPrimaryHand(detect([assisting, "Right"], [testHand, "Right"]), {
    label: "Right",
    wrist: { x: 0.5, y: 0.8 },
  });
  assert.equal(picked.landmarks, testHand);
});

// The failure this guards against happens at the exact moment that matters:
// at full apposition the assisting hand covers the hand it's pushing, so the
// model often reports only the assisting hand. Measuring it would mean
// scoring a stranger's pose as this person's range of motion.
test("pickPrimaryHand: the assisting hand alone in view is not measured", () => {
  const assisting = makeHand();
  assisting[WRIST] = { x: 0.52, y: 0.79, z: 0 }; // right next to where the tracked hand was
  const picked = pickPrimaryHand(detect([assisting, "Left"]), {
    label: "Right",
    wrist: { x: 0.5, y: 0.8 },
  });
  assert.equal(picked, null);
});

test("pickPrimaryHand: handedness outranks being closer to the last known position", () => {
  const testHand = makeHand();
  testHand[WRIST] = { x: 0.7, y: 0.75, z: 0 }; // drifted away
  const assisting = makeHand();
  assisting[WRIST] = { x: 0.5, y: 0.8, z: 0 }; // exactly where we last looked
  const picked = pickPrimaryHand(detect([assisting, "Left"], [testHand, "Right"]), {
    label: "Right",
    wrist: { x: 0.5, y: 0.8 },
  });
  assert.equal(picked.landmarks, testHand);
});

test("thumb/pinky positivity thresholds are inclusive at the boundary", () => {
  assert.equal(isThumbRepPositive(0.1), true);
  assert.equal(isThumbRepPositive(0.100001), false);
  assert.equal(isPinkyRepPositive(70), true);
  assert.equal(isPinkyRepPositive(69.999), false);
});

test("sessionManeuverStatus: a single positive rep is enough", () => {
  assert.equal(sessionManeuverStatus(["positive"]), "positive");
  assert.equal(sessionManeuverStatus(["negative", "positive"]), "positive");
});

test("sessionManeuverStatus: no valid reps is inconclusive", () => {
  assert.equal(sessionManeuverStatus(["inconclusive"]), "inconclusive");
  assert.equal(sessionManeuverStatus(["inconclusive", "inconclusive"]), "inconclusive");
});

test("sessionManeuverStatus: a valid negative with no positive is negative", () => {
  assert.equal(sessionManeuverStatus(["negative"]), "negative");
  assert.equal(sessionManeuverStatus(["negative", "inconclusive"]), "negative");
});

test("countPositiveSessions and recommendationTier escalate with history", () => {
  const history = [
    { results: { thumb: "positive" } },
    { results: { thumb: "negative" } },
    { results: { thumb: "positive" } },
    { results: { thumb: "positive" } },
  ];
  const count = countPositiveSessions(history, "thumb");
  assert.equal(count, 3);
  assert.equal(recommendationTier(0), "neutral");
  assert.equal(recommendationTier(1), "note");
  assert.equal(recommendationTier(count), "checked");
});

test("neutral pose has exactly 21 landmarks", () => {
  assert.equal(neutral.length, 21);
});

console.log(`\n${passed} passed`);
