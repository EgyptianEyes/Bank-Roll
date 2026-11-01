import {defineConfig} from "@playwright/test";

export default defineConfig({
  testDir: "./browser-tests",
  timeout: 60000,
  workers: 2,
  use: {baseURL: "http://127.0.0.1:4178", headless: true, trace: "retain-on-failure"},
  webServer: {
    command: "node scripts/browser-server.mjs",
    url: "http://127.0.0.1:4178/player.html",
    reuseExistingServer: false,
  },
});
