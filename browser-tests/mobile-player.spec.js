import {test, expect} from "@playwright/test";
import {mkdir} from "node:fs/promises";
import path from "node:path";
import {isRed} from "../src/core/roulette.js";

const sizes = [
  {width:320,height:700}, {width:375,height:812}, {width:390,height:844}, {width:430,height:932},
  {width:667,height:375}, {width:844,height:390}, {width:932,height:430},
  {width:768,height:1024}, {width:1440,height:1000},
];
async function createTable(page, name){
  await page.getByRole("button", {name:"Create table",exact:true}).click();
  await page.locator('#tableForm [name="name"]').fill(name);
  await page.getByRole("button", {name:"Save table",exact:true}).click();
  await expect(page.locator("#playerWorkspace")).toBeVisible();
}
async function capture(page, name){
  const directory = process.env.BANKROLL_MOBILE_SCREENSHOTS;
  if (!directory) return;
  await mkdir(directory, {recursive:true});
  await page.screenshot({path:path.join(directory, `${name}.png`), fullPage:true});
}

for (const theme of ["light","dark"]){
  test(`${theme}: responsive entry geometry, colours and comfortable targets across all requested sizes`, async ({page}) => {
    const errors=[];
    page.on("pageerror", error=>errors.push(error.message));
    for (const route of ["/player.html","/test-mode.html"]){
      await page.goto(route);
      await page.getByRole("combobox", {name:"Colour theme"}).selectOption(theme);
      if (route==="/player.html") await createTable(page, "Geometry table");
      else await page.getByRole("button", {name:"Start Test Mode",exact:true}).click();
      const selector = route==="/player.html" ? "#rouletteBoard" : "#testNumberPad";
      for (const size of sizes){
        await page.setViewportSize(size);
        const geometry=await page.locator(selector).evaluate(element=>({
          board:element.getBoundingClientRect().toJSON(),
          viewport:innerWidth,
          pageWidth:document.documentElement.scrollWidth,
          cells:[...element.children].map(button=>({
            number:Number(button.textContent), box:button.getBoundingClientRect().toJSON(),
            transform:getComputedStyle(button).transform, colour:getComputedStyle(button).backgroundColor,
          })),
        }));
        expect(geometry.cells).toHaveLength(37);
        expect(geometry.cells.map(cell=>cell.number)).toEqual(Array.from({length:37},(_,index)=>index));
        expect(geometry.pageWidth).toBeLessThanOrEqual(size.width);
        for (const cell of geometry.cells){
          expect(cell.box.width).toBeGreaterThanOrEqual(44);
          expect(cell.box.height).toBeGreaterThanOrEqual(44);
          expect(cell.box.left).toBeGreaterThanOrEqual(geometry.board.left-1);
          expect(cell.box.right, `${route} at ${size.width}x${size.height}`).toBeLessThanOrEqual(geometry.board.right+1);
          expect(cell.transform).toBe("none");
          expect(cell.colour).toBe(cell.number===0?"rgb(22, 119, 71)":isRed(cell.number)?"rgb(158, 48, 47)":"rgb(36, 40, 45)");
        }
        const at=number=>geometry.cells[number].box;
        if (size.width>=1100 || size.width>size.height){
          expect(at(3).top).toBeLessThan(at(2).top);
          expect(at(2).top).toBeLessThan(at(1).top);
          expect(at(4).left).toBeGreaterThan(at(1).left);
          expect(at(0).right).toBeLessThanOrEqual(at(1).left);
        }else{
          expect(at(1).left).toBeLessThan(at(2).left);
          expect(at(2).left).toBeLessThan(at(3).left);
          expect(at(4).top).toBeGreaterThan(at(1).top);
          expect(at(0).bottom).toBeLessThanOrEqual(at(1).top);
        }
        if ([390,844,932].includes(size.width)){
          await capture(page,`${route==="/player.html"?"player":"test"}-${theme}-${size.width}x${size.height}`);
          if (process.env.BANKROLL_MOBILE_SCREENSHOTS){
            await page.locator(selector).screenshot({path:path.join(process.env.BANKROLL_MOBILE_SCREENSHOTS,`${route==="/player.html"?"player":"test"}-${theme}-${size.width}x${size.height}-board.png`)});
          }
        }
      }
    }
    expect(errors).toEqual([]);
  });

  test(`${theme}: live workflow, single submission, settlement, undo, table restore and rotation`, async ({page}) => {
    const errors=[];
    page.on("pageerror", error=>errors.push(error.message));
    page.on("dialog", dialog=>dialog.accept());
    await page.clock.install({time:new Date("2026-11-01T12:00:00Z")});
    await page.setViewportSize({width:390,height:844});
    await page.goto("/player.html");
    await page.getByRole("combobox", {name:"Colour theme"}).selectOption(theme);
    await createTable(page,"Workflow A");
    await expect(page.locator("#recommendation-title")).toHaveText("OBSERVE / NO BET");
    await expect(page.locator(".strategy-rules")).not.toHaveAttribute("open");
    await expect(page.locator(".wager-history")).not.toHaveAttribute("open");
    const distance=await page.evaluate(()=>document.querySelector("#rouletteBoard").getBoundingClientRect().top-document.querySelector("#playerWorkspace").getBoundingClientRect().top);
    expect(distance).toBeLessThan(400);
    await expect(page.locator("#bankrollValue")).toBeInViewport();
    await page.locator("#noBetButton").click();
    await expect(page.locator("#wagerState")).toContainText("No Bet confirmed");
    await capture(page,`no-bet-${theme}`);
    await page.getByRole("button",{name:"Select winning number 2",exact:true}).click();
    await page.getByRole("button",{name:"Select winning number 1",exact:true}).focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#selectedNumber")).toHaveText("1");
    await expect(page.locator("#historyList li")).toHaveCount(0);
    await capture(page,`selection-pending-${theme}`);
    await page.locator("#recordOutcomeButton").evaluate(button=>{button.click();button.click();});
    await expect(page.locator("#historyList li")).toHaveCount(1);
    await expect(page.locator("#entryStatus")).toContainText("Recorded 1");
    await expect(page.getByRole("button",{name:"Select winning number 1",exact:true})).toHaveAttribute("aria-pressed","false");
    await expect(page.locator("#recentResults li")).toHaveCount(1);
    await capture(page,`observation-confirmed-${theme}`);
    await page.locator("#manualWagerButton").click();
    await page.locator('#streetPicker input[value="0"]').check();
    await capture(page,`wager-pending-${theme}`);
    await page.getByRole("button",{name:"Confirm manual wager",exact:true}).click();
    await expect(page.locator("#bankrollValue")).toHaveText("£99.80");
    await expect(page.locator("#profitValue")).toHaveText("£0.00");
    await expect(page.locator("#profitValue")).not.toHaveClass(/negative/);
    await page.getByRole("button",{name:"Select winning number 1",exact:true}).click();
    const recommendation=await page.locator("#recommendationContent").innerText();
    for (const size of [{width:667,height:375},{width:844,height:390},{width:932,height:430},{width:390,height:844}]){
      await page.setViewportSize(size);
      await expect(page.locator("#selectedNumber")).toHaveText("1");
      await expect(page.locator("#activeTableName")).toHaveText("Workflow A");
      await expect(page.locator("#bankrollValue")).toHaveText("£99.80");
      await expect(page.locator("#wagerState")).toContainText("Confirmed manual wager");
      await expect(page.locator("#recommendationContent")).toHaveText(recommendation);
      await expect(page.locator("#historyList li")).toHaveCount(1);
      await capture(page,`confirmed-wager-${theme}-${size.width}x${size.height}`);
    }
    await page.reload();
    await expect(page.locator("#bankrollValue")).toHaveText("£99.80");
    await expect(page.locator("#wagerState")).toContainText("Confirmed manual wager");
    await page.clock.fastForward(31000);
    await page.getByRole("button",{name:"Select winning number 1",exact:true}).click();
    await page.locator("#recordOutcomeButton").click();
    await expect(page.locator("#bankrollValue")).toHaveText("£102.20");
    await expect(page.locator("#historyList li")).toHaveCount(2);
    await page.locator("#undoButton").click();
    await expect(page.locator("#bankrollValue")).toHaveText("£99.80");
    await expect(page.locator("#wagerState")).toContainText("Confirmed manual wager");
    await expect(page.locator("#entryStatus")).toContainText("reopened");
    await capture(page,`undone-wager-${theme}`);
    await page.clock.fastForward(31000);
    await page.getByRole("button",{name:"Select winning number 1",exact:true}).click();
    await page.locator("#recordOutcomeButton").click();
    await expect(page.locator("#bankrollValue")).toHaveText("£102.20");
    await page.locator(".table-controls > summary").click();
    await page.locator("#newTableButton").click();
    await page.locator('#tableForm [name="name"]').fill("Workflow B");
    await page.getByRole("button",{name:"Save table",exact:true}).click();
    await expect(page.locator("#bankrollValue")).toHaveText("£100.00");
    await page.locator("#tableSelect").selectOption({label:"Workflow A"});
    await page.locator("#switchTableButton").click();
    await expect(page.locator("#bankrollValue")).toHaveText("£102.20");
    await page.reload();
    await expect(page.locator("#activeTableName")).toHaveText("Workflow A");
    await expect(page.locator("#bankrollValue")).toHaveText("£102.20");
    expect(errors).toEqual([]);
  });
}
