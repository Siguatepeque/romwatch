// Plain Node, assert-based checks. Run with: node geometry.test.js
import assert from "node:assert/strict";
import {
  WRIST,
  THUMB_TIP,
  MIDDLE_MCP,
  normalizedThumbForearmDistance,
  wristExtensionAngleDeg,
  checkFraming,
  isThumbRepPositive,
  isWristRepPositive,
  sessionManeuverStatus,
  countPositiveSessions,
  recommendationTier,
} from "./geometry.js";
import { neutral, thumbToForearmTarget, wristExtendedTarget, interpolatePose } from "./poses.js";

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

test("wristExtensionAngleDeg: vertical hand reads ~90 degrees", () => {
  const hand = makeHand();
  hand[MIDDLE_MCP] = { x: 0.5, y: 0.4, z: 0 }; // straight up from wrist
  assert.ok(Math.abs(wristExtensionAngleDeg(hand) - 90) < 1);
});

test("wristExtensionAngleDeg: horizontal hand reads ~0 degrees", () => {
  const hand = makeHand();
  hand[MIDDLE_MCP] = { x: 0.8, y: 0.8, z: 0 }; // straight right from wrist
  assert.ok(wristExtensionAngleDeg(hand) < 1);
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

test("thumb/wrist positivity thresholds are inclusive at the boundary", () => {
  assert.equal(isThumbRepPositive(0.15), true);
  assert.equal(isThumbRepPositive(0.150001), false);
  assert.equal(isWristRepPositive(90), true);
  assert.equal(isWristRepPositive(89.999), false);
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

test("interpolatePose: t=0 and t=1 return the endpoints, t=0.5 is the midpoint", () => {
  const at0 = interpolatePose(neutral, thumbToForearmTarget, 0);
  const at1 = interpolatePose(neutral, thumbToForearmTarget, 1);
  const atHalf = interpolatePose(neutral, thumbToForearmTarget, 0.5);
  assert.deepEqual(at0[THUMB_TIP], neutral[THUMB_TIP]);
  assert.deepEqual(at1[THUMB_TIP], thumbToForearmTarget[THUMB_TIP]);
  const expectedMidX = (neutral[THUMB_TIP].x + thumbToForearmTarget[THUMB_TIP].x) / 2;
  assert.ok(Math.abs(atHalf[THUMB_TIP].x - expectedMidX) < 1e-9);
});

test("pose data has exactly 21 landmarks per pose", () => {
  for (const pose of [neutral, thumbToForearmTarget, wristExtendedTarget]) {
    assert.equal(pose.length, 21);
  }
});

console.log(`\n${passed} passed`);
