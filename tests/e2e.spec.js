import { test, expect } from "@playwright/test";

// This exercises the structural flow with Chromium's fake camera device,
// which has no hand in its synthetic feed. It cannot validate real gesture
// recognition accuracy (there is no hand to recognize); that needs a person
// with an actual camera. What it can catch: broken imports, a crash on the
// "no hand detected" path, and the calibration UI never acknowledging a
// working (if empty) camera feed.
test("camera and model load, and framing feedback reacts to no hand being in view", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto("/");
  await expect(page.locator("#disclaimer")).toBeVisible();
  await expect(page.locator("#stage")).toBeHidden();

  await page.click("#start-btn");

  await expect(page.locator("#stage")).toBeVisible();
  await expect(page.locator("#disclaimer")).toBeHidden();

  // Model download + first inference on a cold cache can take a while.
  await expect(page.locator("#status-line")).toContainText(/can't see your hand|palm to the camera/i, {
    timeout: 45000,
  });

  const canvasSize = await page.locator("#overlay").evaluate((el) => ({ w: el.width, h: el.height }));
  expect(canvasSize.w).toBeGreaterThan(0);
  expect(canvasSize.h).toBeGreaterThan(0);

  // Give the "no hand" path a few extra seconds to run its course (past the
  // calibration stable-frame threshold) and confirm it never throws.
  await page.waitForTimeout(2000);

  expect(errors, `console/page errors:\n${errors.join("\n")}`).toEqual([]);
});

// A hypermobile hand, hand-placed in normalized landmark coordinates: thumb
// tip well past the wrist line, little finger folded back on itself. Both
// maneuvers should score positive on it.
const TEST_HAND = (() => {
  const p = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.6, z: 0 }));
  p[0] = { x: 0.5, y: 0.8, z: 0 }; // wrist
  p[4] = { x: 0.42, y: 0.86, z: 0 }; // thumb tip, past the wrist
  p[9] = { x: 0.5, y: 0.5, z: 0 }; // middle knuckle: the hand's axis
  p[17] = { x: 0.62, y: 0.62, z: 0 }; // pinky knuckle
  p[18] = { x: 0.56, y: 0.71, z: 0 }; // pinky PIP, folded straight back
  p[19] = { x: 0.5, y: 0.8, z: 0 }; // and straight along its own length from
  p[20] = { x: 0.44, y: 0.89, z: 0 }; // there, so it reads as pushed, not curled
  return p;
})();

// The hand doing the pushing: an ordinary open hand off to the side, which
// scores negative on both maneuvers. That's the point of it here. Both of
// these tests are passive, so this hand is in frame for every real attempt,
// and if the app ever measures it instead the session comes back negative.
const ASSISTING_HAND = (() => {
  const p = Array.from({ length: 21 }, () => ({ x: 0.2, y: 0.55, z: 0 }));
  p[0] = { x: 0.2, y: 0.7, z: 0 };
  p[4] = { x: 0.12, y: 0.5, z: 0 };
  p[9] = { x: 0.2, y: 0.45, z: 0 };
  p[17] = { x: 0.28, y: 0.5, z: 0 };
  p[18] = { x: 0.3, y: 0.42, z: 0 };
  return p;
})();

// The test above can only reach the "no hand" path. This one feeds the app
// hands by stubbing the landmarker's per-frame detection: one hand through
// calibration, as the app asks for, then both hands for the maneuvers
// themselves, which is how these maneuvers are actually performed. It covers
// the parts that matter most: the live readout, the overlay's threshold line,
// tracking the correct hand of the two, capture, scoring and the results.
test("with the assisting hand in frame, the hand being tested is the one measured", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  await page.goto("/");
  await page.evaluate(
    async ([testHand, assistingHand]) => {
      // Same module specifier the app imports, so this is the same module
      // instance and the same prototype its landmarker will inherit from.
      const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest");
      let frames = 0;
      vision.HandLandmarker.prototype.detectForVideo = () => {
        frames += 1;
        // Calibration asks for the tested hand on its own; the assisting hand
        // joins once the maneuvers start.
        return frames < 40
          ? { landmarks: [testHand], handedness: [[{ categoryName: "Right" }]] }
          : {
              landmarks: [assistingHand, testHand],
              handedness: [[{ categoryName: "Left" }], [{ categoryName: "Right" }]],
            };
      };
    },
    [TEST_HAND, ASSISTING_HAND]
  );

  await page.click("#start-btn");

  // Live readout: the number and the line it has to cross, while measuring.
  await expect(page.locator("#readout")).toBeVisible({ timeout: 45000 });
  await expect(page.locator("#readout-detail")).toContainText("the line is at", { timeout: 15000 });

  // Both maneuvers scored off the tested hand, not the one pushing it.
  await expect(page.locator("#results")).toBeVisible({ timeout: 45000 });
  await expect(page.locator(".badge-positive")).toHaveCount(2);
  await expect(page.locator(".measured").first()).toContainText("Measured:");

  expect(errors, `console/page errors:\n${errors.join("\n")}`).toEqual([]);
});

// Calibration is where the session picks the hand it measures. With two hands
// up it has nothing to pick by, so it has to ask rather than guess: guessing
// wrong means silently measuring the assisting hand for the whole session.
test("calibration refuses to start while both hands are in view", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(
    async ([testHand, assistingHand]) => {
      const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest");
      vision.HandLandmarker.prototype.detectForVideo = () => ({
        landmarks: [assistingHand, testHand],
        handedness: [[{ categoryName: "Left" }], [{ categoryName: "Right" }]],
      });
    },
    [TEST_HAND, ASSISTING_HAND]
  );

  await page.click("#start-btn");
  await expect(page.locator("#status-text")).toContainText("Show just the hand you want tested", {
    timeout: 45000,
  });
  // And it stays there rather than proceeding on a coin flip.
  await page.waitForTimeout(2000);
  await expect(page.locator("#results")).toBeHidden();
  await expect(page.locator("#status-text")).toContainText("Show just the hand you want tested");
});
