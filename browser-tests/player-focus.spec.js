import {test, expect} from "@playwright/test";
import {mkdir, writeFile} from "node:fs/promises";
import path from "node:path";

const sizes = [[320,700],[375,812],[390,844],[430,932],[667,375],[844,390],[932,430],[768,1024],[1440,1000]];
async function setup(page){
  await page.goto("/player.html");
  await page.getByRole("button", {name:"Create table",exact:true}).click();
  await page.locator('#tableForm [name="name"]').fill("Focus review table");
  await page.getByRole("button", {name:"Save table",exact:true}).click();
  await expect(page.locator("#playerWorkspace")).toBeVisible();
}
async function capture(page, name){
  if (!process.env.BANKROLL_FOCUS_SCREENSHOTS) return;
  await mkdir(process.env.BANKROLL_FOCUS_SCREENSHOTS,{recursive:true});
  await page.screenshot({path:path.join(process.env.BANKROLL_FOCUS_SCREENSHOTS,`${name}.png`),fullPage:true});
  await page.screenshot({path:path.join(process.env.BANKROLL_FOCUS_SCREENSHOTS,`${name}-viewport.png`)});
}
async function measure(page){
  await page.evaluate(()=>window.scrollTo(0,0));
  return page.evaluate(()=>{
    const rect=id=>document.getElementById(id).getBoundingClientRect();
    const board=rect("rouletteBoard");
    const recommendation=rect("recommendationContent");
    const button=document.querySelector("#rouletteBoard button").getBoundingClientRect();
    const submit=rect("recordOutcomeButton");
    const visibleHeight=Math.max(0,Math.min(innerHeight,board.bottom)-Math.max(0,board.top));
    const toolbar=document.querySelector(".focus-toolbar").getBoundingClientRect();
    return {
      width:innerWidth,height:innerHeight,firstButtonTop:button.top,
      boardWidth:board.width,boardHeight:board.height,
      initiallyVisiblePercent:100*visibleHeight/board.height,
      recommendationToEntry:board.top-recommendation.bottom,
      recommendationToEntryGap:Math.hypot(
        Math.max(0,board.left-recommendation.right,recommendation.left-board.right),
        Math.max(0,board.top-recommendation.bottom,recommendation.top-board.bottom)),
      scrollToBoardAndConfirmation:Math.max(0,Math.max(board.bottom,submit.bottom)-innerHeight),
      stickyStatusHeight:document.body.classList.contains("player-focus")?toolbar.height:0,
    };
  });
}
for (const theme of ["light","dark"]){
  test(`${theme}: Focus Mode geometry, preference and complete preserved live workflow`, async ({page})=>{
    const errors=[];
    page.on("pageerror",error=>errors.push(error.message));
    page.on("dialog",dialog=>dialog.accept());
    await page.clock.install({time:new Date("2026-11-01T12:00:00Z")});
    await setup(page);
    await page.getByRole("combobox",{name:"Colour theme"}).selectOption(theme);
    const measurements=[];
    for (const [width,height] of sizes){
      await page.setViewportSize({width,height});
      const normal=await measure(page);
      if ([390,932].includes(width)) await capture(page,`normal-${theme}-${width}x${height}`);
      await page.locator("#focusModeButton").focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("#focusModeButton")).toHaveText("Exit Focus Mode");
      await expect(page.locator("#focusModeButton")).toBeFocused();
      await expect(page.locator("#focusBankroll")).toHaveText("£100.00");
      const focus=await measure(page);
      measurements.push({theme,normal,focus});
      expect(focus.firstButtonTop).toBeLessThan(normal.firstButtonTop);
      await page.getByRole("button",{name:"Select winning number 36",exact:true}).focus();
      await page.getByRole("button",{name:"Select winning number 36",exact:true}).scrollIntoViewIfNeeded();
      const visibility=await page.evaluate(()=>({
        key:document.querySelector('#rouletteBoard button:last-child').getBoundingClientRect().toJSON(),
        status:document.querySelector('.focus-toolbar').getBoundingClientRect().toJSON(),
      }));
      expect(visibility.key.top).toBeGreaterThanOrEqual(visibility.status.bottom);
      expect(visibility.key.bottom).toBeLessThanOrEqual(height);
      await page.evaluate(()=>window.scrollTo(0,0));
      const geometry=await page.locator("#rouletteBoard button").evaluateAll(buttons=>buttons.map(button=>{
        const box=button.getBoundingClientRect();
        return {width:box.width,height:box.height,left:box.left,right:box.right,transform:getComputedStyle(button).transform};
      }));
      expect(geometry).toHaveLength(37);
      for (const box of geometry){
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(width);
        expect(box.transform).toBe("none");
      }
      expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await capture(page,`focus-${theme}-${width}x${height}`);
      await page.locator("#focusModeButton").click();
    }
    if(process.env.BANKROLL_FOCUS_SCREENSHOTS) await writeFile(path.join(process.env.BANKROLL_FOCUS_SCREENSHOTS,`measurements-${theme}.json`),JSON.stringify(measurements,null,2));
    await page.setViewportSize({width:390,height:844});
    await page.locator("#focusModeButton").click();
    await page.locator("#noBetButton").click();
    await expect(page.locator("#wagerState")).toContainText("No Bet confirmed");
    await page.getByRole("button",{name:"Select winning number 1",exact:true}).click();
    await capture(page,`selected-${theme}`);
    await page.locator("#recordOutcomeButton").evaluate(button=>{button.click();button.click();});
    await expect(page.locator("#historyList li")).toHaveCount(1);
    await expect(page.locator("#entryStatus")).toContainText("Recorded 1");
    await capture(page,`recorded-${theme}`);
    await page.locator("#manualWagerButton").click();
    await page.locator('#streetPicker input[value="0"]').check();
    await capture(page,`pending-wager-${theme}`);
    await page.getByRole("button",{name:"Confirm manual wager",exact:true}).click();
    await expect(page.locator("#focusBankroll")).toHaveText("£99.80");
    await page.getByRole("button",{name:"Select winning number 1",exact:true}).click();
    await page.locator("#focusModeButton").click();
    await expect(page.locator("#selectedNumber")).toHaveText("1");
    await expect(page.locator("#wagerState")).toContainText("Confirmed manual wager");
    await page.locator("#focusModeButton").click();
    for(const [width,height] of [[932,430],[667,375],[390,844]]){
      await page.setViewportSize({width,height});
      await expect(page.locator("#selectedNumber")).toHaveText("1");
      await expect(page.locator("#wagerState")).toContainText("Confirmed manual wager");
      await expect(page.locator("#focusTable")).toHaveText("Focus review table");
      await expect(page.locator("#focusAction")).toHaveText("OBSERVE / NO BET");
      await capture(page,`confirmed-wager-${theme}-${width}x${height}`);
    }
    await page.reload();
    await expect(page.locator("#focusModeButton")).toHaveText("Exit Focus Mode");
    await expect(page.locator("#focusBankroll")).toHaveText("£99.80");
    await page.clock.fastForward(31000);
    await page.getByRole("button",{name:"Select winning number 1",exact:true}).click();
    await page.locator("#recordOutcomeButton").click();
    await expect(page.locator("#focusBankroll")).toHaveText("£102.20");
    await expect(page.locator("#focusProfit")).toHaveText("+£2.20");
    await page.locator("#undoButton").click();
    await expect(page.locator("#focusBankroll")).toHaveText("£99.80");
    await expect(page.locator("#entryStatus")).toContainText("reopened");
    await page.clock.fastForward(31000);
    await page.getByRole("button",{name:"Select winning number 1",exact:true}).click();
    await page.locator("#recordOutcomeButton").click();
    await expect(page.locator("#focusBankroll")).toHaveText("£102.20");
    await page.getByText("Detailed results, wagers and corrections",{exact:true}).click();
    await page.locator(".correction-button").first().click();
    await page.locator("#correctionOutcome").selectOption("2");
    await page.locator('#correctionForm [name="reason"]').fill("Review correction");
    await page.getByRole("button",{name:"Save correction",exact:true}).click();
    await expect(page.locator("#entryStatus")).toContainText("Correction appended");
    await expect(page.locator("#historyList li")).toHaveCount(3);
    await page.locator(".table-controls > summary").click();
    await page.locator("#newTableButton").click();
    await page.locator('#tableForm [name="name"]').fill("Second focused table");
    await page.getByRole("button",{name:"Save table",exact:true}).click();
    await expect(page.locator("#focusTable")).toHaveText("Second focused table");
    await page.locator("#tableSelect").selectOption({label:"Focus review table"});
    await page.locator("#switchTableButton").click();
    await expect(page.locator("#focusTable")).toHaveText("Focus review table");
    await expect(page.locator("#historyList li")).toHaveCount(3);
    await page.locator("#focusModeButton").click();
    await expect(page.locator("header.site-header")).toBeVisible();
    await expect(page.locator("#bankrollValue")).toHaveText("£102.20");
    expect(errors).toEqual([]);
  });
}
test("blocked display storage is reported without affecting the session",async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(window,"localStorage",{get(){throw new DOMException("Blocked","SecurityError");}}));
  await setup(page);
  await expect(page.locator("#focusStorageStatus")).toContainText("cannot be saved");
  await page.locator("#focusModeButton").click();
  await expect(page.locator("#focusModeButton")).toHaveText("Exit Focus Mode");
  await expect(page.locator("#focusBankroll")).toHaveText("£100.00");
});
test("small keyboard-like viewport leaves manual confirmation and exit accessible",async({page})=>{
  await setup(page);
  await page.locator("#focusModeButton").click();
  await page.locator("#manualWagerButton").click();
  await page.setViewportSize({width:390,height:260});
  const confirmation=page.getByRole("button",{name:"Confirm manual wager",exact:true});
  await confirmation.scrollIntoViewIfNeeded();
  await expect(confirmation).toBeInViewport();
  await expect(page.locator("#wagerDialog")).toBeVisible();
  await page.locator('#wagerDialog button[aria-label="Close"]').click();
  expect(await page.locator(".focus-toolbar").evaluate(element=>getComputedStyle(element).position)).toBe("static");
  await page.locator("#focusModeButton").click();
  await expect(page.locator("#focusModeButton")).toHaveText("Focus Mode");
});
