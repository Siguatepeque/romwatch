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
  isThumbRepPositive,
  isPinkyRepPositive,
  movedEnoughForThumb,
  movedEnoughForPinky,
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

test("normalizedThumbForearmDistance: thumb far from forearm line is large", () => {
  const hand = makeHand();
  const d = normalizedThumbForearmDistance(hand);
  assert.ok(d > 0.5, `expected a large distance, got ${d}`);
});

test("normalizedThumbForearmDistance: thumb on the forearm ray is ~0", () => {
  const hand = makeHand();
  // forearm ray points from wrist (0.5,0.8) away from the hand, i.e. downward (+y)
  hand[THUMB_TIP] = { x: 0.5, y: 0.95, z: 0 };
  const d = normalizedThumbForearmDistance(hand);
  assert.ok(d < 0.05, `expected ~0, got ${d}`);
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

test("thumb/pinky positivity thresholds are inclusive at the boundary", () => {
  assert.equal(isThumbRepPositive(0.15), true);
  assert.equal(isThumbRepPositive(0.150001), false);
  assert.equal(isPinkyRepPositive(70), true);
  assert.equal(isPinkyRepPositive(69.999), false);
});

test("movedEnoughForThumb: rejects a rep where the hand barely moved from rest", () => {
  // Started at 0.9 (resting, far from the forearm), stayed at 0.85: not an attempt.
  assert.equal(movedEnoughForThumb(0.9, 0.85), false);
});

test("movedEnoughForThumb: accepts a rep with a real attempt even if it fell short", () => {
  // Started at 0.9, moved to 0.4: a genuine attempt, even though 0.4 is still negative.
  assert.equal(movedEnoughForThumb(0.9, 0.4), true);
});

test("movedEnoughForPinky: rejects a rep where the finger barely moved from rest", () => {
  assert.equal(movedEnoughForPinky(40, 45), false);
});

test("movedEnoughForPinky: accepts a rep with a real attempt", () => {
  assert.equal(movedEnoughForPinky(40, 75), true);
});

test("sessionManeuverStatus: two of three positive reps is positive", () => {
  assert.equal(sessionManeuverStatus(["positive", "positive", "negative"]), "positive");
});

test("sessionManeuverStatus: fewer than two valid reps is inconclusive", () => {
  assert.equal(sessionManeuverStatus(["inconclusive", "inconclusive", "negative"]), "inconclusive");
  assert.equal(sessionManeuverStatus(["inconclusive", "inconclusive", "inconclusive"]), "inconclusive");
});

test("sessionManeuverStatus: two-plus valid, fewer than two positive is negative", () => {
  assert.equal(sessionManeuverStatus(["negative", "negative", "inconclusive"]), "negative");
  assert.equal(sessionManeuverStatus(["negative", "positive", "negative"]), "negative");
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
