import {test, expect} from "@playwright/test";
import {mkdir, writeFile} from "node:fs/promises";
import path from "node:path";
import {APP_VERSION} from "../src/core/version.js";

const sizes = [[320,700],[375,812],[390,844],[430,932],[667,375],[844,390],[932,430],[768,1024],[1440,1000]];
const routes = ["/", "/player.html", "/index.html", "/test-mode.html", "/research.html", "/faq.html", "/docs.html"];

for (const theme of ["light", "dark"]){
  test(`${theme}: final public console, Test touch matrix and running simulator`, async ({browser}) => {
    const context = await browser.newContext({hasTouch:true});
    const page = await context.newPage();
    const errors = [];
    const measurements = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("response", response => {
      if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
    });
    try {
      for (const [width,height] of [[390,844],[932,430],[1440,1000]]){
        await page.setViewportSize({width,height});
        for (const route of routes){
          await page.goto(route);
          await page.getByRole("combobox", {name:"Colour theme"}).selectOption(theme);
          const versions = page.locator("[data-app-version]");
          await expect(versions.first()).toContainText(APP_VERSION);
          for (const label of await versions.all()) await expect(label).toContainText(APP_VERSION);
          expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        }
      }
      await page.goto("/test-mode.html");
      await page.getByRole("button", {name:"Start Test Mode",exact:true}).click();
      for (const [index, [width,height]] of sizes.entries()){
        await page.setViewportSize({width,height});
        await page.getByRole("button", {name:"Enter roulette result 17",exact:true}).tap();
        await expect(page.locator("#testLastResult")).toHaveText("Recorded: 17");
        await expect(page.locator("#testSpinCount")).toHaveText(String(index + 1));
        await page.evaluate(() => window.scrollTo(0,0));
        measurements.push(await page.locator("#testNumberPad").evaluate(board => {
          const box = board.getBoundingClientRect();
          return {
            width:innerWidth, height:innerHeight, firstButtonTop:board.firstElementChild.getBoundingClientRect().top,
            boardWidth:box.width, boardHeight:box.height,
            minimumKeyWidth:Math.min(...[...board.children].map(key => key.getBoundingClientRect().width)),
            minimumKeyHeight:Math.min(...[...board.children].map(key => key.getBoundingClientRect().height)),
            pageWidth:document.documentElement.scrollWidth,
          };
        }));
      }
      const directory = process.env.BANKROLL_FINAL_SCREENSHOTS;
      if (directory){
        await mkdir(directory, {recursive:true});
        await writeFile(path.join(directory, `test-measurements-${theme}.json`), JSON.stringify(measurements,null,2));
      }
      for (const measurement of measurements){
        expect(measurement.minimumKeyWidth).toBeGreaterThanOrEqual(44);
        expect(measurement.minimumKeyHeight).toBeGreaterThanOrEqual(44);
        expect(measurement.pageWidth).toBeLessThanOrEqual(measurement.width);
      }
      await page.goto("/index.html");
      await page.locator("#btnConfig").click();
      await page.locator("#sessions").fill("1");
      await page.locator("#maxSpins").fill("10");
      await page.locator("#coldThreshold").fill("0");
      await page.locator("#closeConfig").click();
      await page.locator("#btnRunStop").click();
      await expect(page.locator("#liveSpin")).not.toHaveText("-");
      await expect(page.locator("#btnExportCsv")).toBeEnabled({timeout:30000});
      await expect(page.locator("#wheelNumber")).toHaveText(/^(?:[0-9]|[12][0-9]|3[0-6])$/);
      if (directory){
        await page.locator("#livePerformance").scrollIntoViewIfNeeded();
        await page.screenshot({path:path.join(directory, `simulator-completed-${theme}.png`)});
      }
      expect(errors).toEqual([]);
      if (directory) await writeFile(path.join(directory, `console-${theme}.json`), JSON.stringify({errors, publicViewports:3, routes, touchViewports:sizes.length, simulatorCompleted:true},null,2));
    } finally {
      await context.close();
    }
  });
}
