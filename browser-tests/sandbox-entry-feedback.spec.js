import {test, expect} from "@playwright/test";
import {mkdir} from "node:fs/promises";
import path from "node:path";

async function capture(page, name){
  const directory = process.env.BANKROLL_TEST_ENTRY_SCREENSHOTS;
  if (!directory) return;
  await mkdir(directory, {recursive:true});
  await page.locator(".test-input-panel").screenshot({path:path.join(directory, `${name}.png`), animations:"allow"});
  await page.screenshot({path:path.join(directory, `${name}-viewport.png`),animations:"allow"});
  await page.locator(".test-edit-row").scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(directory, `${name}-controls.png`),animations:"allow"});
}

for (const theme of ["light", "dark"]){
  test(`${theme}: immediate touch feedback, rapid repeats, keyboard and corrections`, async ({browser}) => {
    const context = await browser.newContext({hasTouch:true, viewport:{width:390, height:844}});
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.clock.install({time:new Date("2026-11-01T12:00:00Z")});
      await page.goto("/test-mode.html");
      await page.getByRole("combobox", {name:"Colour theme"}).selectOption(theme);
      await page.getByRole("button", {name:"Start Test Mode", exact:true}).click();
      await page.clock.pauseAt(new Date("2026-11-01T12:01:00Z"));
      const key = number => page.getByRole("button", {name:`Enter roulette result ${number}`, exact:true});
      await key(17).tap();
      await expect(key(17)).toHaveClass(/test-number-recorded/);
      await expect(page.locator("#testLastResult")).toHaveText("Recorded: 17");
      await expect(page.locator("#testLastResult")).toHaveCSS("background-color", "rgb(36, 40, 45)");
      await expect(page.locator("#testEntryCount")).toHaveText("1 observation");
      await expect(page.locator(".test-recording-status")).toHaveAttribute("aria-live", "polite");
      await capture(page, `pressed-${theme}`);
      await page.clock.runFor(500);
      await expect(key(17)).toHaveClass(/test-number-recorded/);
      await key(17).tap();
      await page.clock.runFor(300);
      await expect(key(17)).toHaveClass(/test-number-recorded/);
      await page.clock.runFor(350);
      await expect(key(17)).not.toHaveClass(/test-number-recorded/);
      await capture(page, `recorded-${theme}`);
      const sequence = [17,17,0,1,36,17,17,17,17,17];
      await page.locator("#testNumberPad").evaluate((pad, numbers) => {
        for (const number of numbers) pad.children[number].click();
      }, sequence);
      await expect(page.locator("#testSpinCount")).toHaveText("12");
      await expect(page.locator("#testEntryCount")).toHaveText("12 observations");
      await expect(page.locator("#testRecentResults li")).toHaveText(["17","17","17","17","17","36","1","0"]);
      await expect(page.locator("#testRecentResults li").first()).toHaveAttribute("aria-label", "Newest result, spin 12: 17");
      await key(0).focus();
      await page.keyboard.press("Enter");
      await expect(key(0)).toBeFocused();
      await page.keyboard.press("Space");
      await expect(page.locator("#testSpinCount")).toHaveText("14");
      await expect(page.locator("#testLastResult")).toHaveText("Recorded: 0");
      await expect(page.locator("#testLastResult")).toHaveCSS("background-color", "rgb(22, 119, 71)");
      await key(1).tap();
      await expect(page.locator("#testLastResult")).toHaveCSS("background-color", "rgb(158, 48, 47)");
      await page.locator("#testCorrectionNumber").selectOption("14");
      await page.locator("#testCorrectionValue").fill("2");
      await page.getByRole("button", {name:"Correct", exact:true}).click();
      await expect(page.locator("#testLastResult")).toHaveText("Latest: 2");
      await expect(page.locator("#testRecentResults li").first()).toHaveText("2");
      await page.getByRole("button", {name:"Undo last", exact:true}).click();
      await expect(page.locator("#testLastResult")).toHaveText("Latest: 0");
      await expect(page.locator("#testSpinCount")).toHaveText("14");
      await page.setViewportSize({width:932,height:430});
      await key(36).tap();
      await expect(page.locator("#testSpinCount")).toHaveText("15");
      await capture(page, `landscape-${theme}`);
      await page.emulateMedia({reducedMotion:"reduce"});
      await key(17).tap();
      await expect(key(17)).toHaveCSS("animation-name", "none");
      await expect(key(17)).toHaveClass(/test-number-recorded/);
      const geometry = await page.locator("#testNumberPad").evaluate(pad => ({
        pageWidth:document.documentElement.scrollWidth,
        keys:[...pad.children].map(button => button.getBoundingClientRect().toJSON()),
      }));
      expect(geometry.pageWidth).toBeLessThanOrEqual(932);
      expect(geometry.keys).toHaveLength(37);
      for (const box of geometry.keys){
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      await page.getByRole("button", {name:"Reset this test session", exact:true}).click();
      await expect(page.locator("#testRecentResults li")).toHaveCount(0);
      await expect(page.locator("#testLastResult")).toHaveText("No results");
      await expect(page.locator(".test-number-recorded")).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

test("failed recording never shows success or adds a recent result", async ({page}) => {
  await page.route("**/simulation/sandbox-session.js*", async route => {
    const response = await route.fetch();
    const source = await response.text();
    expect(source).toContain("recordOutcome(outcome){");
    await route.fulfill({response, body:source.replace("recordOutcome(outcome){",
      'recordOutcome(outcome){ if (outcome === 13) throw new Error("Recording unavailable");')});
  });
  await page.goto("/test-mode.html");
  await page.getByRole("button", {name:"Start Test Mode", exact:true}).click();
  await page.getByRole("button", {name:"Enter roulette result 13", exact:true}).click();
  await expect(page.locator("#testInputStatus")).toHaveText("Recording unavailable");
  await expect(page.locator("#testLastResult")).toHaveText("No results");
  await expect(page.locator("#testSpinCount")).toHaveText("0");
  await expect(page.locator("#testRecentResults li")).toHaveCount(0);
  await expect(page.locator(".test-number-recorded")).toHaveCount(0);
  await page.getByRole("button", {name:"Enter roulette result 17", exact:true}).click();
  await page.getByRole("button", {name:"Enter roulette result 13", exact:true}).click();
  await expect(page.locator("#testLastResult")).toHaveText("Latest: 17");
  await expect(page.locator("#testSpinCount")).toHaveText("1");
  await expect(page.locator("#testRecentResults li")).toHaveCount(1);
  await expect(page.locator(".test-number-recorded")).toHaveCount(0);
});
