import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 60000,
  webServer: {
    command: "node serve.js",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: "http://localhost:4173",
    launchOptions: {
      // Fake camera device with no permission prompt, no real webcam needed.
      // Chromium's default fake feed is a synthetic test pattern with no hand
      // in it, so the "not_detected" framing state is what should show up.
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    },
  },
});
