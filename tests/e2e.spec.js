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
