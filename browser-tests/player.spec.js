import {test, expect, chromium} from "@playwright/test";
import {mkdtemp, rm, readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";

async function createTable(page, name = "Physical table A"){
  await page.getByRole("button", {name: "Create table", exact: true}).click();
  await page.locator('#tableForm [name="name"]').fill(name);
  await page.getByRole("button", {name: "Save table", exact: true}).click();
  await expect(page.locator("#playerWorkspace")).toBeVisible();
  await expect(page.locator("#bankrollValue")).toHaveText("£100.00");
}

async function result(page, number){
  await page.clock.fastForward(31000);
  if (await page.locator("#noBetButton").isEnabled()) await page.locator("#noBetButton").click();
  await page.getByRole("button", {name: `Select winning number ${number}`, exact: true}).click();
  await page.locator("#recordOutcomeButton").click();
  await expect(page.locator("#selectedNumber")).toHaveText("—");
}

async function manual(page, streets){
  await page.locator("#manualWagerButton").click();
  for (const street of streets) await page.locator(`#streetPicker input[value="${street}"]`).check();
  await page.getByRole("button", {name: "Confirm manual wager", exact: true}).click();
  await expect(page.locator("#wagerDialog")).not.toBeVisible();
}

test("complete mobile player session, audit, export, table separation and browser restart", async () => {
  const profile = await mkdtemp(path.join(tmpdir(), "bank-roll-browser-"));
  let context;
  const errors = [];
  try {
    context = await chromium.launchPersistentContext(profile, {headless: true, viewport: {width: 390, height: 844}, acceptDownloads: true});
    let page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (request.url().includes("/server/")) errors.push("Player attempted a server API request");
    });
    page.on("dialog", (dialog) => dialog.accept());
    await page.clock.install({time: new Date("2026-10-31T12:00:00Z")});
    await page.goto("http://127.0.0.1:4178/player.html");
    await createTable(page);
    await manual(page, [0]);
    await expect(page.locator("#bankrollValue")).toHaveText("£99.80");
    await result(page, 1);
    await expect(page.locator("#bankrollValue")).toHaveText("£102.20");
    await manual(page, [0]);
    await result(page, 0);
    await expect(page.locator("#bankrollValue")).toHaveText("£102.00");
    await expect(page.locator("#historyList li").first()).toContainText("lost");
    await manual(page, [0, 1]);
    await result(page, 4);
    await expect(page.locator("#bankrollValue")).toHaveText("£104.00");
    await page.locator("#undoButton").click();
    await expect(page.locator("#bankrollValue")).toHaveText("£101.60");
    await expect(page.locator("#wagerState")).toContainText("Confirmed");
    await expect(page.locator("#historyList li").first()).toContainText("undone · wager reopened");
    await result(page, 1);
    await expect(page.locator("#bankrollValue")).toHaveText("£104.00");
    await expect(page.locator("#historyList li").first()).toContainText("won");
    await expect(page.locator("#historyList li").nth(1)).toContainText("undone · wager reopened");
    await page.getByText("Detailed results, wagers and corrections", {exact: true}).click();
    await page.locator(".correction-button").first().click();
    await page.locator("#correctionOutcome").selectOption("4");
    await page.locator('#correctionForm [name="reason"]').fill("Correcting entry");
    await page.getByRole("button", {name: "Save correction", exact: true}).click();
    await expect(page.locator("#bankrollValue")).toHaveText("£104.00");
    for (const number of [5, 6, 7, 8, 9, 10, 11, 12]) await result(page, number);
    await expect(page.locator("#evidenceStatus")).toHaveText("OBSERVE ONLY");
    await page.getByText("Rules, evidence and session summary", {exact: true}).click();
    await expect(page.locator("#strategyRules")).toContainText("losses never increase");
    await expect(page.locator("#strategyRules")).toContainText("Observation (no wager) is BRI's preferred strategy");
    await expect(page.locator("#modelScores li")).toHaveCount(6);
    await page.locator(".table-controls > summary").click();
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#exportButton").click();
    const download = await downloadPromise;
    const exported = JSON.parse(await readFile(await download.path(), "utf8"));
    expect(exported.provenance).toBe("human-observed-unverified");
    expect(exported.sessions).toHaveLength(1);
    expect(exported.observations.some((entry) => entry.voided)).toBe(true);
    expect(exported.events.some((entry) => entry.eventType === "forecast-prepared")).toBe(true);
    await page.locator("#newTableButton").click();
    await page.locator('#tableForm [name="name"]').fill("Physical table B");
    await page.getByRole("button", {name: "Save table", exact: true}).click();
    await expect(page.locator("#historyList li")).toHaveCount(0);
    await page.locator("#tableSelect").selectOption({label: "Physical table A"});
    await page.locator("#switchTableButton").click();
    await expect(page.locator("#bankrollValue")).toHaveText("£104.00");
    await context.close();
    context = await chromium.launchPersistentContext(profile, {headless: true, viewport: {width: 390, height: 844}});
    page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto("http://127.0.0.1:4178/player.html");
    await expect(page.locator("#tableSelect option:checked")).toHaveText("Physical table A");
    await expect(page.locator("#bankrollValue")).toHaveText("£104.00");
    await expect(page.locator("#historyList li")).toHaveCount(12);
    await page.locator(".table-controls > summary").click();
    await page.locator("#newSessionButton").click();
    await page.locator('#tableForm [name="bankroll"]').fill("50");
    await page.getByRole("button", {name: "Save table", exact: true}).click();
    await expect(page.locator("#bankrollValue")).toHaveText("£50.00");
    await expect(page.locator("#historyList li")).toHaveCount(12);
    await page.locator("#endSessionButton").click();
    await expect(page.locator("#wagerState")).toContainText("Session ended");
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(profile, {recursive: true, force: true});
  }

});

test("research Worker executes isolated comparisons and cancels without publishing", async ({page}) => {
  await page.goto("/research.html");
  await page.locator('#experimentForm [name="spins"]').fill("100");
  await page.locator("#runExperiment").click();
  await expect(page.locator("#experimentResults tr")).toHaveCount(7);
  await expect(page.locator("#experimentStatus")).toContainText("Completed 7");
  await expect(page.locator("#experimentResults")).not.toContainText("NaN");
  await page.locator('#experimentForm [name="spins"]').fill("10000");
  await page.locator("#runExperiment").click();
  await page.locator("#cancelExperiment").click();
  await expect(page.locator("#experimentStatus")).toContainText("cancelled");
});

for (const width of [320, 375, 390, 430, 768]){
  for (const orientation of ["portrait", "landscape"]){
    test(`public pages and player keypad at ${width}px ${orientation}`, async ({page}) => {
      const viewport = orientation === "portrait" ? {width, height: 844} : {width: 844, height: width};
      await page.setViewportSize(viewport);
      await page.clock.install({time: new Date("2026-10-31T12:00:00Z")});
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("dialog", (dialog) => dialog.accept());
      await page.goto("/player.html");
      await createTable(page);
      await result(page, 36);
      if (width === 390 && orientation === "portrait") await page.screenshot({path: "test-results/player-390.png", fullPage: true});
      for (const button of await page.locator(".number-button").all()){
        const box = await button.boundingBox();
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      for (const url of ["/player.html", "/index.html", "/test-mode.html", "/research.html", "/faq", "/docs"]){
        await page.goto(url);
        await expect(page.locator("[data-app-version]").first()).toContainText("Build");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
      expect(errors).toEqual([]);
    });
  }
}
