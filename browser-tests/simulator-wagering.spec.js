import {test,expect} from "@playwright/test";
import {settleWager} from "../src/bankroll/accounting.js";

async function configure(page, overrides){
  await page.goto("/index.html");
  await page.locator("#btnConfig").click();
  for(const [id,value] of Object.entries({sessions:1,maxSpins:120,bankroll:1000,unit:0.5,
    stopLoss:0,takeProfit:0,maxSteps:50,...overrides})){
    const element=page.locator(`#${id}`);
    if(await element.evaluate(node=>node.tagName==="SELECT")) await element.selectOption(String(value));
    else await element.fill(String(value));
  }
  await page.locator("#closeConfig").click();
  for(let count=0;count<4;count++) await page.locator("#btnSpeed").click();
}

test("actual BRI runner learns before outcomes, selects 50p wagers, displays and settles those exact wagers",async({page})=>{
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.route("**/core/roulette.js*",async route=>{
    const response=await route.fetch();
    const source=await response.text();
    expect(source).toContain("return Math.floor(random() * 37);");
    await route.fulfill({response,body:source.replace("return Math.floor(random() * 37);","return 1;")});
  });
  await page.route("**/simulation/autonomous-session-engine.js*",async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:await response.text()+`
const prepare = AutonomousSessionEngine.prototype.prepareNextSpin;
const resolve = AutonomousSessionEngine.prototype.resolveOutcome;
window.wagerAudit = [];
AutonomousSessionEngine.prototype.prepareNextSpin = function(){
  const before = this.state.bankrollCents;
  const prepared = prepare.call(this);
  window.wagerAudit.push({phase:"decision",before,afterDebit:this.state.bankrollCents,prepared:structuredClone(prepared)});
  return prepared;
};
AutonomousSessionEngine.prototype.resolveOutcome = function(prepared,outcome){
  const result = resolve.call(this,prepared,outcome);
  window.wagerAudit.push({phase:"result",outcome,bankroll:this.state.bankrollCents,settlement:result.settlement});
  return result;
};`});
  });
  await page.route("**/ui/roulette-board.js*",async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:await response.text()+`
const update = RouletteBoard.prototype.updateBets;
window.displayAudit = [];
RouletteBoard.prototype.updateBets = function(wager){
  update.call(this,wager);
  window.displayAudit.push({wager:structuredClone(wager),labels:[...this.container.querySelectorAll(".street-chip")].map(chip=>chip.textContent).filter(Boolean)});
};`});
  });
  await configure(page,{simulationMode:"bri-autonomous"});
  await page.locator("#btnRunStop").click();
  await expect(page.locator("#statusText")).toHaveText("Completed all 1 sessions",{timeout:55000});
  const audit=await page.evaluate(()=>({engine:window.wagerAudit,display:window.displayAudit}));
  expect(audit.engine).toHaveLength(240);
  const decisions=audit.engine.filter(row=>row.phase==="decision");
  expect(decisions).toHaveLength(120);
  expect(decisions.filter(row=>row.prepared.wager)).toHaveLength(85);
  for(let index=0;index<120;index++){
    const decision=audit.engine[index*2];
    const result=audit.engine[index*2+1];
    const wager=decision.prepared.wager;
    expect(decision.prepared.forecast?.observationCount ?? index).toBe(index);
    expect(decision.afterDebit).toBe(decision.before-(wager?.totalStakeCents||0));
    const settlement=wager?settleWager(wager,result.outcome):null;
    expect(result.bankroll).toBe(decision.before-(wager?.totalStakeCents||0)+(settlement?.grossReturnCents||0));
    expect(audit.display[index].wager).toEqual(wager);
    expect(audit.display[index].labels).toEqual(wager?["50p"]:[]);
  }
  await expect(page.locator("#briDecisionStatus")).toHaveText("BRI CONTINUE · £0.50");
  await expect(page.locator("#liveBankroll")).toHaveText("£1467.50");
  expect(errors).toEqual([]);
});

test("legacy status reports actual 50p unit/progression exposure, not an unused BRI recommendation",async({page})=>{
  await page.route("**/core/roulette.js*",async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:(await response.text()).replace("return Math.floor(random() * 37);","return 0;")});
  });
  await configure(page,{maxSpins:3,coldThreshold:0,progression:"linear",maxStreets:1});
  await page.locator("#btnRunStop").click();
  await expect(page.locator("#statusText")).toHaveText("Completed all 1 sessions");
  await expect(page.locator("#briDecisionStatus")).toHaveText("LEGACY STREETS · £1.50");
  await expect(page.locator("#liveBankroll")).toHaveText("£997.00");
  await expect(page.locator(".street-chip").last()).toHaveText("£1.50");
});

test("BRI NO BET keeps actual bankroll/result visible and zero unit is explicitly rejected",async({page})=>{
  await configure(page,{simulationMode:"bri-autonomous"});
  await page.locator("#btnRunStop").click();
  await expect(page.locator("#statusText")).toHaveText("Completed all 1 sessions");
  await expect(page.locator("#briDecisionStatus")).toHaveText("BRI NO BET · observing");
  await expect(page.locator(".street-chip")).toHaveCount(0);
  await expect(page.locator("#liveBankroll")).toHaveText("£1000.00");
  await expect(page.locator("#wheelNumber")).toHaveText(/^\d+$/);
  await page.locator("#btnConfig").click();
  await page.locator("#unit").fill("0");
  await page.locator("#closeConfig").click();
  await page.locator("#btnRunStop").click();
  await expect(page.locator("#statusText")).toContainText("Stake unit must be at least one penny.");
});

test("a pre-spin financial refusal shows NO BET rather than stale chips",async({page})=>{
  await configure(page,{maxSpins:3,bankroll:1,unit:2,coldThreshold:0,maxStreets:1});
  await page.locator("#btnRunStop").click();
  await expect(page.locator("#statusText")).toHaveText("Completed all 1 sessions");
  await expect(page.locator("#briDecisionStatus")).toHaveText("LEGACY NO BET · insufficient funds");
  await expect(page.locator(".street-chip")).toHaveCount(0);
  await expect(page.locator("#liveBankroll")).toHaveText("£1.00");
});
