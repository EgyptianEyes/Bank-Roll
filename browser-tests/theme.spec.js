import {test, expect, chromium} from "@playwright/test";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {isRed} from "../src/core/roulette.js";

const routes = ["/", "/player.html", "/index.html", "/test-mode.html", "/research.html", "/faq.html", "/docs.html"];

test("homepage process is explicit, accurate and illustrative rather than live research", async ({page}) => {
  await page.goto("/");
  await expect(page.locator(".home-proof h2")).toHaveText("Observe → Predict → Evaluate");
  await expect(page.locator(".research-process h3")).toHaveText(["Observe", "Predict", "Evaluate"]);
  await expect(page.locator(".process-outcomes")).toContainText("Example only · not table data");
  await expect(page.locator(".research-process")).toContainText("before");
  await expect(page.locator(".process-baseline")).toHaveText("Fair-wheel street baseline: 3 / 37");
  expect(3 / 37).toBeCloseTo(0.081081081);
  for (const [number, colour] of [[0, "green"], [1, "red"], [2, "black"]]){
    expect(number === 0 ? "green" : isRed(number) ? "red" : "black").toBe(colour);
    await expect(page.locator(`.outcome-${colour}`)).toHaveText(String(number));
  }
  await expect(page.locator(".home-proof-wheel")).toHaveCount(0);
});

test("system follows OS changes; manual choices apply immediately and survive navigation", async ({page}) => {
  await page.emulateMedia({colorScheme: "light"});
  await page.goto("/");
  const root = page.locator("html");
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(page.getByRole("combobox", {name: "Colour theme"})).toHaveValue("system");
  expect(await page.evaluate(() => localStorage.getItem("bank-roll-theme"))).toBeNull();
  await page.emulateMedia({colorScheme: "dark"});
  await expect(root).toHaveAttribute("data-theme", "dark");
  await page.getByRole("combobox", {name: "Colour theme"}).selectOption("light");
  await expect(root).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({colorScheme: "dark"});
  await expect(root).toHaveAttribute("data-theme", "light");
  await page.goto("/research.html");
  await expect(root).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "light");
  await page.getByRole("combobox", {name: "Colour theme"}).selectOption("system");
  await expect(root).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({colorScheme: "light"});
  await expect(root).toHaveAttribute("data-theme", "light");
  await page.goto("/docs.html");
  await expect(page.getByRole("combobox", {name: "Colour theme"})).toHaveValue("system");
});

test("theme preference stays synchronised between open pages", async ({context, page}) => {
  await page.goto("/");
  const other = await context.newPage();
  await other.goto("/faq.html");
  await page.getByRole("combobox", {name: "Colour theme"}).selectOption("dark");
  await expect(other.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(other.getByRole("combobox", {name: "Colour theme"})).toHaveValue("dark");
  await other.getByRole("combobox", {name: "Colour theme"}).selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("theme control is keyboard-operable with a visible focus indicator", async ({page}) => {
  await page.goto("/");
  const control = page.getByRole("combobox", {name: "Colour theme"});
  await control.focus();
  await page.keyboard.press("l");
  await page.keyboard.press("Enter");
  await expect(control).toHaveValue("light");
  expect(await control.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
});

test("the research graphic remains readable without motion", async ({page}) => {
  await page.emulateMedia({reducedMotion: "reduce"});
  await page.goto("/");
  await expect(page.locator(".research-process h3")).toHaveText(["Observe", "Predict", "Evaluate"]);
  expect(await page.locator("html").evaluate((element) => getComputedStyle(element).scrollBehavior)).toBe("auto");
  expect(await page.locator(".home-proof").evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
});

test("manual theme survives a browser restart", async () => {
  const profile = await mkdtemp(path.join(tmpdir(), "bank-roll-theme-"));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {headless: true});
    let page = await context.newPage();
    await page.goto("http://127.0.0.1:4178/");
    await page.getByRole("combobox", {name: "Colour theme"}).selectOption("dark");
    await context.close();
    context = await chromium.launchPersistentContext(profile, {headless: true, colorScheme: "light"});
    page = await context.newPage();
    await page.goto("http://127.0.0.1:4178/docs.html");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("combobox", {name: "Colour theme"})).toHaveValue("dark");
  } finally {
    await context?.close();
    await rm(profile, {recursive: true, force: true});
  }
});

test("saved theme is applied before styles and page content can render", async ({page}) => {
  await page.emulateMedia({colorScheme: "light"});
  await page.addInitScript(() => {
    localStorage.setItem("bank-roll-theme", "dark");
    window.themeAtBody = null;
    const observer = new MutationObserver(() => {
      if (document.body && window.themeAtBody === null){
        window.themeAtBody = document.documentElement.dataset.theme;
        observer.disconnect();
      }
    });
    observer.observe(document, {childList: true, subtree: true});
  });
  for (const route of routes){
    await page.goto(route);
    expect(await page.evaluate(() => window.themeAtBody), route).toBe("dark");
    const order = await page.evaluate(() => {
      const theme = document.querySelector('script[src^="assets/js/theme.js"]');
      const stylesheet = document.querySelector('link[rel="stylesheet"]');
      return !theme.async && !theme.defer && Boolean(theme.compareDocumentPosition(stylesheet) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(order).toBe(true);
  }
});

for (const theme of ["light", "dark"]){
  test(`${theme} theme covers all pages at mobile and desktop sizes`, async ({page}) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const width of [320, 390, 1440]){
      await page.setViewportSize({width, height: 900});
      for (const route of routes){
        await page.goto(route);
        await page.getByRole("combobox", {name: "Colour theme"}).selectOption(theme);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        const layout = await page.evaluate(() => ({
          pageWidth: document.documentElement.scrollWidth,
          viewport: innerWidth,
          background: getComputedStyle(document.body).backgroundColor,
          control: document.querySelector("[data-theme-select]").getBoundingClientRect().toJSON(),
        }));
        expect(layout.pageWidth, `${route} at ${width}`).toBeLessThanOrEqual(layout.viewport);
        expect(layout.background).toBe(theme === "light" ? "rgb(246, 244, 237)" : "rgb(11, 16, 13)");
        expect(layout.control.height).toBeGreaterThanOrEqual(44);
        if (width === 320){
          await page.locator(".site-menu summary").focus();
          await page.keyboard.press("Enter");
          await expect(page.locator(".site-menu")).toHaveAttribute("open", "");
          await expect(page.locator(".site-menu").getByRole("link", {name: "Play", exact: true})).toBeVisible();
        }
      }
    }
    expect(errors).toEqual([]);
  });
}

test("theme changes preserve a pending Player wager, result selection and roulette colours", async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto("/player.html");
  await page.getByRole("button", {name: "Create table", exact: true}).click();
  await page.locator('#tableForm [name="name"]').fill("Theme table");
  await page.getByRole("button", {name: "Save table", exact: true}).click();
  await page.locator("#manualWagerButton").click();
  await page.locator('#streetPicker input[value="0"]').check();
  await page.getByRole("button", {name: "Confirm manual wager", exact: true}).click();
  await page.getByRole("button", {name: "Select winning number 1", exact: true}).click();
  let original;
  for (const theme of ["dark", "light"]){
    await page.getByRole("combobox", {name: "Colour theme"}).selectOption(theme);
    await expect(page.locator("#bankrollValue")).toHaveText("£99.80");
    await expect(page.locator("#wagerState")).toContainText("Confirmed");
    await expect(page.locator("#selectedNumber")).toHaveText("1");
    const colours = await page.locator(".number-button").evaluateAll((buttons) => buttons.map((button) => ({
      number: Number(button.textContent),
      background: getComputedStyle(button).backgroundColor,
      text: getComputedStyle(button).color,
    })));
    expect(colours).toHaveLength(37);
    for (const entry of colours){
      expect(entry.background).toBe(entry.number === 0 ? "rgb(22, 119, 71)" : isRed(entry.number) ? "rgb(158, 48, 47)" : "rgb(36, 40, 45)");
      expect(entry.text).toBe("rgb(255, 255, 255)");
    }
    if (original) expect(colours).toEqual(original);
    original = colours;
  }
  await page.locator("#recordOutcomeButton").click();
  await expect(page.locator("#bankrollValue")).toHaveText("£102.20");
  await expect(page.locator("#historyList li")).toHaveCount(1);
});

test("canvas charts redraw the same data with semantic theme colours without reloading", async ({page}) => {
  await page.goto("/index.html");
  await page.getByRole("combobox", {name: "Colour theme"}).selectOption("dark");
  await page.evaluate(async () => {
    const {drawLineChart, drawHistogram, drawMiniChart} = await import("/src/ui/charts.js");
    drawLineChart(document.querySelector("#chartLine"), [100, 102, 99], 100);
    drawHistogram(document.querySelector("#chartHist"), [100, 102, 99]);
    const mini = document.createElement("canvas");
    mini.id = "themeTestMini";
    document.body.append(mini);
    drawMiniChart(mini, [100, 102, 99], 100);
  });
  const images = () => page.locator("#chartLine, #chartHist, #themeTestMini").evaluateAll((canvases) => canvases.map((canvas) => canvas.toDataURL()));
  const dark = await images();
  await page.getByRole("combobox", {name: "Colour theme"}).selectOption("light");
  for (const [index, image] of (await images()).entries()) expect(image).not.toBe(dark[index]);
  await page.getByRole("combobox", {name: "Colour theme"}).selectOption("dark");
  expect(await images()).toEqual(dark);
});

test("simulator and Test Mode retain correct roulette colours in both themes", async ({page}) => {
  for (const route of ["/index.html", "/test-mode.html"]){
    await page.goto(route);
    if (route === "/test-mode.html") await page.getByRole("button", {name: "Start Test Mode"}).click();
    for (const theme of ["light", "dark"]){
      await page.getByRole("combobox", {name: "Colour theme"}).selectOption(theme);
      const numbers = await page.locator(route === "/index.html" ? ".number-cell, .zero-cell" : ".test-number-button").evaluateAll((elements) => elements.map((element) => ({
        number: Number(element.textContent),
        background: getComputedStyle(element).backgroundColor,
      })));
      expect(numbers).toHaveLength(37);
      for (const entry of numbers){
        expect(entry.background).toBe(entry.number === 0 ? "rgb(22, 119, 71)" : isRed(entry.number) ? "rgb(158, 48, 47)" : "rgb(36, 40, 45)");
      }
    }
  }
});

test("semantic text, actions and roulette labels meet normal-text contrast in both themes", async ({page}) => {
  const luminance = (channels) => channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const rgb = (value) => value.match(/\d+/g).slice(0, 3).map(Number);
  await page.goto("/");
  for (const theme of ["light", "dark"]){
    await page.getByRole("combobox", {name: "Colour theme"}).selectOption(theme);
    const pairs = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const colour = (name) => {
        const sample = document.createElement("span");
        sample.style.color = style.getPropertyValue(name);
        document.body.append(sample);
        const resolved = getComputedStyle(sample).color;
        sample.remove();
        return resolved;
      };
      return [
        ...["--text", "--muted", "--muted2", "--accent", "--accent2", "--bad"].map((name) => [name, colour(name), colour("--bg")]),
        ["primary", colour("--primary-text"), colour("--primary-fill")],
        ...["--roulette-red", "--roulette-black", "--roulette-green"].map((name) => [name, colour("--roulette-text"), colour(name)]),
      ];
    });
    for (const [label, foreground, background] of pairs){
      const values = [luminance(rgb(foreground)), luminance(rgb(background))].sort((a, b) => a - b);
      expect((values[1] + 0.05) / (values[0] + 0.05), `${theme} ${label}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("unavailable localStorage reports the limitation but keeps theme switching usable", async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {get(){throw new DOMException("Blocked", "SecurityError");}});
  });
  await page.goto("/");
  await expect(page.locator("[data-theme-status]")).toContainText("storage is unavailable");
  await page.getByRole("combobox", {name: "Colour theme"}).selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("[data-theme-status]")).toContainText("could not be saved");
});
