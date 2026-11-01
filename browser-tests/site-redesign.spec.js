import {test, expect} from "@playwright/test";
import {isRed} from "../src/core/roulette.js";

const publicPages = [
  "/",
  "/player.html",
  "/index.html",
  "/test-mode.html",
  "/research.html",
  "/faq.html",
  "/docs.html",
];

const viewports = [
  {label: "320 portrait", width: 320, height: 844},
  {label: "375 portrait", width: 375, height: 812},
  {label: "390 portrait", width: 390, height: 844},
  {label: "430 portrait", width: 430, height: 932},
  {label: "568 landscape", width: 568, height: 320},
  {label: "667 landscape", width: 667, height: 375},
  {label: "844 landscape", width: 844, height: 390},
  {label: "932 landscape", width: 932, height: 430},
  {label: "768 tablet", width: 768, height: 1024},
  {label: "1440 desktop", width: 1440, height: 900},
];

test("shared navigation reaches each section and remains keyboard-operable on mobile", async ({page}) => {
  await page.setViewportSize({width: 1440, height: 900});
  await page.goto("/");
  await expect(page.getByRole("heading", {name: /Can the evidence reveal/})).toBeVisible();
  for (const [label, url, title] of [
    ["Play", "/player.html", "Player Mode"],
    ["Simulate", "/index.html", "European roulette simulator"],
    ["Test", "/test-mode.html", "Try BRI with your own sequence."],
    ["Research", "/research.html", "Winning Streets."],
    ["Learn", "/faq.html", "Frequently asked questions"],
  ]){
    await page.locator(".site-nav").getByRole("link", {name: label, exact: true}).click();
    await expect(page).toHaveURL(new RegExp(`${url.replaceAll("/", "\\/")}$`));
    await expect(page.getByRole("heading", {name: title, exact: true})).toBeVisible();
  }
  await page.setViewportSize({width: 390, height: 844});
  await page.goto("/");
  const menu = page.locator(".site-menu");
  await menu.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(menu).toHaveAttribute("open", "");
  await menu.getByRole("link", {name: "Technical docs"}).click();
  await expect(page).toHaveURL(/\/docs\.html$/);
  await expect(page.getByRole("heading", {name: "Bank-Roll documentation"})).toBeVisible();
});

test("public sections fit the requested viewport matrix without horizontal page overflow", async ({page}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const viewport of viewports){
    await page.setViewportSize({width: viewport.width, height: viewport.height});
    for (const route of publicPages){
      await page.goto(route);
      await expect(page.locator(".site-header")).toBeVisible();
      const layout = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        viewport: innerWidth,
        headerHeight: document.querySelector(".site-header").getBoundingClientRect().height,
        headerOpacity: Number(getComputedStyle(document.querySelector(".site-header")).opacity),
      }));
      expect(layout.width, `${route} overflows at ${viewport.label}`).toBeLessThanOrEqual(layout.viewport);
      expect(layout.headerHeight, `${route} header is too tall at ${viewport.label}`).toBeLessThan(90);
      expect(layout.headerOpacity, `${route} header should remain fully legible`).toBe(1);
    }
  }
  expect(errors).toEqual([]);
});

test("simulator board automatically reorients while preserving all European numbers and streets", async ({page}) => {
  await page.goto("/index.html");
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const viewport of viewports){
    await page.setViewportSize({width: viewport.width, height: viewport.height});
    const board = await page.evaluate(() => {
      const table = document.querySelector(".roulette-table");
      const grid = table.querySelector(".number-grid");
      const cells = [...grid.querySelectorAll(".number-cell")];
      const cellPosition = (number) => {
        const box = cells.find((cell) => Number(cell.textContent) === number).getBoundingClientRect();
        return {left: box.left, top: box.top, width: box.width, height: box.height};
      };
      return {
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        table: table.getBoundingClientRect().toJSON(),
        holder: table.parentElement.getBoundingClientRect().toJSON(),
        zero: table.querySelector(".zero-cell").getBoundingClientRect().toJSON(),
        grid: grid.getBoundingClientRect().toJSON(),
        numbers: cells.map((cell) => Number(cell.textContent)),
        colors: Object.fromEntries(cells.map((cell) => [cell.textContent, cell.classList.contains("red") ? "red" : "black"])),
        positions: {one: cellPosition(1), two: cellPosition(2), three: cellPosition(3), four: cellPosition(4)},
        chipPositions: [...table.querySelectorAll(".street-chip-holder")].map((holder) => ({
          column: getComputedStyle(holder).gridColumnStart,
          row: getComputedStyle(holder).gridRowStart,
        })),
        transforms: cells.map((cell) => getComputedStyle(cell).transform),
      };
    });
    expect(board.pageWidth).toBeLessThanOrEqual(board.viewportWidth);
    expect(board.numbers).toHaveLength(36);
    expect(new Set(board.numbers).size).toBe(36);
    expect([...board.numbers].sort((a, b) => a - b)).toEqual(Array.from({length: 36}, (_value, index) => index + 1));
    expect(board.colors["1"]).toBe(isRed(1) ? "red" : "black");
    expect(board.colors["2"]).toBe(isRed(2) ? "red" : "black");
    expect(board.zero.width).toBeGreaterThan(0);
    expect(board.table.left).toBeGreaterThanOrEqual(board.holder.left);
    expect(board.table.right).toBeLessThanOrEqual(board.holder.right + 1);
    expect(board.transforms.every((transform) => transform === "none")).toBe(true);
    expect(board.chipPositions).toHaveLength(12);
    expect(board.positions.one.width).toBeGreaterThan(0);
    expect(board.positions.one.height).toBeGreaterThan(0);
    if (viewport.width <= 600 && viewport.height > viewport.width){
      expect(board.zero.bottom).toBeLessThanOrEqual(board.grid.top + 1);
      expect(board.positions.one.left).toBeLessThan(board.positions.two.left);
      expect(board.positions.two.left).toBeLessThan(board.positions.three.left);
      expect(board.positions.one.top).toBeCloseTo(board.positions.two.top, 0);
      expect(board.positions.four.top).toBeGreaterThan(board.positions.one.top);
    }else if (viewport.width <= 600 && viewport.width > viewport.height){
      expect(board.zero.right).toBeLessThanOrEqual(board.grid.left + 1);
      expect(board.zero.top).toBeCloseTo(board.grid.top, 0);
      expect(board.positions.three.top).toBeLessThan(board.positions.two.top);
      expect(board.positions.two.top).toBeLessThan(board.positions.one.top);
    }
  }
  expect(errors).toEqual([]);
});

test("Test Mode keypad stays large enough to tap on narrow phones", async ({page}) => {
  for (const viewport of viewports.slice(0, 5)){
    await page.setViewportSize({width: viewport.width, height: viewport.height});
    await page.goto("/test-mode.html");
    await page.getByRole("button", {name: "Start Test Mode"}).click();
    const buttons = page.locator(".test-number-button");
    await expect(buttons).toHaveCount(37);
    for (const button of await buttons.all()){
      const box = await button.boundingBox();
      expect(box.width, `${viewport.label} keypad width`).toBeGreaterThanOrEqual(44);
      expect(box.height, `${viewport.label} keypad height`).toBeGreaterThanOrEqual(44);
    }
  }
});

test("Player Mode retains a selected result and session when the viewport rotates", async ({page}) => {
  await page.setViewportSize({width: 390, height: 844});
  await page.goto("/player.html");
  await page.getByRole("button", {name: "Create table", exact: true}).click();
  await page.locator('#tableForm [name="name"]').fill("Orientation table");
  await page.getByRole("button", {name: "Save table", exact: true}).click();
  await expect(page.locator("#playerWorkspace")).toBeVisible();
  await page.getByRole("button", {name: "Select winning number 17"}).click();
  await page.setViewportSize({width: 667, height: 375});
  await expect(page.getByRole("button", {name: "Select winning number 17"})).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#selectedNumber")).toHaveText("17");
  await page.locator("#entry-title").scrollIntoViewIfNeeded();
  const entryLayout = await page.evaluate(() => {
    const footer = document.querySelector(".entry-footer").getBoundingClientRect();
    const buttons = [...document.querySelectorAll(".number-button")].map((button) => button.getBoundingClientRect());
    return {footerTop: footer.top, lastKeyBottom: Math.max(...buttons.map((box) => box.bottom))};
  });
  expect(entryLayout.footerTop).toBeGreaterThanOrEqual(entryLayout.lastKeyBottom);
  await page.locator("#recordOutcomeButton").click();
  await expect(page.locator("#historyList li")).toHaveCount(1);
  await expect(page.locator("#bankrollValue")).toHaveText("£100.00");
  await page.setViewportSize({width: 390, height: 844});
  await expect(page.locator("#historyList li")).toHaveCount(1);
  await expect(page.locator("#tableSelect option:checked")).toHaveText("Orientation table");
  await expect(page.locator("#bankrollValue")).toHaveText("£100.00");
});
