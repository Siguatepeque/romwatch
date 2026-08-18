// Plain Node, assert-based checks. Run with: node geometry.test.js
import assert from "node:assert/strict";
import {
  WRIST,
  THUMB_TIP,
  MIDDLE_MCP,
  PINKY_MCP,
  PINKY_PIP,
  normalizedThumbForearmDistance,
  pinkyExtensionAngleDeg,
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

test("normalizedThumbForearmDistance: thumb far from the wrist is large", () => {
  const hand = makeHand();
  const d = normalizedThumbForearmDistance(hand);
  assert.ok(d > 0.5, `expected a large distance, got ${d}`);
});

test("normalizedThumbForearmDistance: thumb tip right at the wrist is ~0", () => {
  const hand = makeHand();
  hand[THUMB_TIP] = { x: 0.51, y: 0.81, z: 0 };
  const d = normalizedThumbForearmDistance(hand);
  assert.ok(d < 0.05, `expected ~0, got ${d}`);
});

test("normalizedThumbForearmDistance: doesn't depend on which way the hand is rotated", () => {
  // Same thumb-near-wrist distance, but the rest of the hand (via middle MCP)
  // points in a completely different direction. The old ray-based version
  // would have measured this differently depending on hand rotation; the
  // wrist-distance version shouldn't care.
  const hand = makeHand();
  hand[MIDDLE_MCP] = { x: 0.9, y: 0.9, z: 0 }; // hand rotated off to the side
  hand[THUMB_TIP] = { x: 0.51, y: 0.81, z: 0 };
  const d = normalizedThumbForearmDistance(hand);
  assert.ok(d < 0.05, `expected ~0 regardless of rotation, got ${d}`);
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

test("checkFraming: no landmarks is not_detected", () => {
  assert.equal(checkFraming(null, 1000, 200), "not_detected");
});

test("checkFraming: wrist near the frame edge is off_center", () => {
  const hand = makeHand();
  hand[WRIST] = { x: 0.05, y: 0.5, z: 0 };
  assert.equal(checkFraming(hand, 1000, 200), "off_center");
});

test("checkFraming: hand much smaller than reference is too_far", () => {
  const hand = makeHand();
  // widthPx = 0.2 * 1000 = 200, well under 0.4 * 2000 = 800
  assert.equal(checkFraming(hand, 1000, 2000), "too_far");
});

test("checkFraming: hand much larger than reference is too_close", () => {
  const hand = makeHand();
  // widthPx = 200, well over 2.2 * 50 = 110
  assert.equal(checkFraming(hand, 1000, 50), "too_close");
});

test("checkFraming: hand within tolerance is ok", () => {
  const hand = makeHand();
  // widthPx = 200, refHandWidthPx = 200: right in the middle of the tolerance band
  assert.equal(checkFraming(hand, 1000, 200), "ok");
});

test("pickPrimaryHand: no hands detected returns null", () => {
  assert.equal(pickPrimaryHand([], { x: 0.5, y: 0.5 }), null);
  assert.equal(pickPrimaryHand(null, { x: 0.5, y: 0.5 }), null);
});

test("pickPrimaryHand: a single detected hand is returned regardless of prior position", () => {
  const hand = makeHand();
  assert.equal(pickPrimaryHand([hand], { x: 0, y: 0 }), hand);
});

test("pickPrimaryHand: no prior position defaults to the first detected hand", () => {
  const handA = makeHand();
  const handB = makeHand();
  handB[WRIST] = { x: 0.1, y: 0.1, z: 0 };
  assert.equal(pickPrimaryHand([handA, handB], null), handA);
});

test("pickPrimaryHand: sticks with whichever hand is closest to the last known position", () => {
  const testHand = makeHand(); // wrist at (0.5, 0.8)
  const assistingHand = makeHand();
  assistingHand[WRIST] = { x: 0.05, y: 0.05, z: 0 }; // entering from a corner
  // Even listed first, the assisting hand shouldn't hijack tracking from the
  // hand that was actually being measured a moment ago.
  const picked = pickPrimaryHand([assistingHand, testHand], { x: 0.5, y: 0.8 });
  assert.equal(picked, testHand);
});

test("thumb/pinky positivity thresholds are inclusive at the boundary", () => {
  assert.equal(isThumbRepPositive(0.15), true);
  assert.equal(isThumbRepPositive(0.150001), false);
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
