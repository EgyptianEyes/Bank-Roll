import assert from "node:assert/strict";
import {mkdirSync, writeFileSync, openSync, writeSync, closeSync} from "node:fs";
import path from "node:path";
import {mulberry32, xfnv1a} from "../src/core/random.js";
import {StreetPredictionEngine} from "../src/intelligence/prediction-engine.js";
import {AutonomousSessionEngine} from "../src/simulation/autonomous-session-engine.js";
import {LiveSessionEngine} from "../src/simulation/live-engine.js";
import {settleWager} from "../src/bankroll/accounting.js";

const directory = process.argv[2];
if (!directory) throw new Error("Pass an evidence output directory.");
mkdirSync(directory, {recursive:true});
const seed = "bank-roll-wager-pipeline-v1";
const base = {bankroll:1000, unit:0.2, maxSpins:120, maxSteps:50, maxStreets:2,
  progression:"flat", stopLoss:0, takeProfit:0, coldThreshold:22, betType:"streets"};
const variants = [
  ["legacy-default", {simulationMode:"cold-street"}],
  ["legacy-linear", {simulationMode:"cold-street", coldThreshold:0, progression:"linear"}],
  ["legacy-50p", {simulationMode:"cold-street", coldThreshold:0, unit:0.5}],
  ["legacy-red", {simulationMode:"cold-street", betType:"redblack"}],
  ["legacy-dozen", {simulationMode:"cold-street", betType:"dozens"}],
  ["bri-gated-20p", {simulationMode:"bri-autonomous"}],
  ["bri-gated-controlled-street", {simulationMode:"bri-autonomous", controlledStreet:true}],
  ["bri-gated-controlled-50p", {simulationMode:"bri-autonomous", controlledStreet:true,unit:0.5}],
  ["bri-research-flat", {simulationMode:"bri-autonomous", wageringMode:"strategy-research"}],
  ["bri-research-linear", {simulationMode:"bri-autonomous", wageringMode:"strategy-research", progression:"linear"}],
  ["bri-research-martingale", {simulationMode:"bri-autonomous", wageringMode:"strategy-research", progression:"martingale", maxSteps:8}],
  ["bri-research-50p", {simulationMode:"bri-autonomous", wageringMode:"strategy-research", unit:0.5}],
  ["bri-research-one-street", {simulationMode:"bri-autonomous", wageringMode:"strategy-research", maxStreets:1}],
  ["bri-research-small-bankroll", {simulationMode:"bri-autonomous", wageringMode:"strategy-research", bankroll:1}],
  ["bri-research-exposure-limit", {simulationMode:"bri-autonomous", wageringMode:"strategy-research", maxExposure:0.1}],
  ["bri-research-maintain", {simulationMode:"bri-autonomous", wageringMode:"strategy-research", researchActionPolicy:"maintain", progression:"linear"}],
];
const summaries = [];
for (const [name, overrides] of variants){
  const config = {...base,...overrides};
  const autonomous = config.simulationMode === "bri-autonomous";
  let randomCalls = 0;
  const rng = mulberry32(xfnv1a(seed));
  const random = () => {randomCalls++; return config.controlledStreet ? 1.5 / 37 : rng();};
  const prediction = new StreetPredictionEngine();
  const engine = autonomous ? new AutonomousSessionEngine(config,random,prediction) : new LiveSessionEngine(config,random);
  const rows = [];
  const events = openSync(path.join(directory, `${name}.jsonl`), "w");
  try {
    for (let spin = 1; spin <= 120; spin++){
      const bankrollCents = engine.state.bankrollCents;
      const callsBefore = randomCalls;
      const observations = prediction.observationCount;
      const preview = engine.previewNextSpin();
      const forecast = autonomous ? preview.forecast : prediction.forecastNext();
      const prepared = engine.prepareNextSpin();
      assert.equal(randomCalls,callsBefore,"No outcome may be drawn before recording the decision");
      if (forecast) assert.equal(forecast.observationCount,observations);
      const wager = prepared.wager;
      const decision = {
        spinNumber:spin, availableObservations:observations, selectedStrategy:config.simulationMode,
        wageringMode:autonomous ? config.wageringMode || "evidence-gated" : "legacy",
        progression:config.progression, action:prepared.decision?.action || prepared.action,
        selectedStreets:wager?.chosen || [], streetStakeCents:wager?.kind === "streets"
          ? wager.streetStakeCents || wager.chosen.map(() => wager.perStreetStakeCents) : [],
        wager:structuredClone(wager), totalExposureCents:wager?.totalStakeCents || 0,
        bankrollBeforeCents:bankrollCents, bankrollAfterDebitCents:engine.state.bankrollCents,
        progressionStage:prepared.decision?.selected.step ?? engine.state.progressionStep,
        explanation:prepared.decision?.reasons || [autonomous ? "No forecast yet; observe."
          : prepared.action === "observe" ? "No street meets the configured cold threshold."
          : `Legacy ${config.betType}: configured ${config.progression} unit progression, not a BRI-selected wager.`],
        forecast:structuredClone(forecast), decision:structuredClone(prepared.decision || null),
      };
      writeSync(events,JSON.stringify({phase:"decision-before-result",...decision}) + "\n");
      if (prepared.action === "stop"){
        rows.push({...decision, result:null, settlement:null, updatedBankrollCents:engine.state.bankrollCents});
        break;
      }
      assert.equal(engine.state.bankrollCents,bankrollCents - (wager?.totalStakeCents || 0));
      const resolved = engine.resolveSpin(prepared);
      if (!autonomous) prediction.observe(resolved.outcome);
      assert.equal(prediction.observationCount, observations + 1);
      const expected = wager ? settleWager(wager,resolved.outcome) : null;
      assert.equal(engine.state.bankrollCents,bankrollCents - (wager?.totalStakeCents || 0) + (expected?.grossReturnCents || 0));
      if (expected) assert.equal(resolved.settlement.grossReturnCents,expected.grossReturnCents);
      const outcome = {result:resolved.outcome, settlement:resolved.settlement,
        updatedBankrollCents:engine.state.bankrollCents,
        progressionStageAfter:autonomous ? engine.coordinator.state.progressionStep : engine.state.progressionStep};
      writeSync(events,JSON.stringify({phase:"result-after-decision",spinNumber:spin,...outcome}) + "\n");
      rows.push({...decision,...outcome});
    }
  } finally {
    closeSync(events);
  }
  const actualRows = rows.filter(row => row.result !== null);
  const bets = actualRows.filter(row => row.totalExposureCents > 0);
  summaries.push({name,config,spins:actualRows.length,bets:bets.length,
    noBet:actualRows.length - bets.length, streetsMaximum:Math.max(0,...bets.map(row => row.selectedStreets.length)),
    streetStakeCents:[...new Set(bets.flatMap(row => row.streetStakeCents))].sort((a,b)=>a-b),
    exposuresCents:[...new Set(bets.map(row => row.totalExposureCents))].sort((a,b)=>a-b),
    actions:Object.fromEntries([...new Set(actualRows.map(row=>row.action))].map(action=>[action,actualRows.filter(row=>row.action===action).length])),
    finalBankrollCents:engine.state.bankrollCents});
  writeFileSync(path.join(directory,`${name}.json`),JSON.stringify({seed,synthetic:true,config,rows},null,2)+"\n");
}
writeFileSync(path.join(directory,"summary.json"),JSON.stringify({seed,spins:120,synthetic:true,
  note:"Research variants deliberately permit synthetic behavioural wagers; they are not evidence-gated predictions or real-wheel evidence. Each JSONL decision was synchronously written before drawing its result. All actual monetary fields are integer pence.",
  summaries},null,2)+"\n");
console.log(JSON.stringify(summaries.map(({name,spins,bets,noBet,streetsMaximum,streetStakeCents,finalBankrollCents}) =>
  ({name,spins,bets,noBet,streetsMaximum,streetStakeCents,finalBankrollCents})),null,2));
