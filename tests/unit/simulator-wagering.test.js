import assert from "node:assert/strict";
import test from "node:test";
import {mulberry32,xfnv1a} from "../../src/core/random.js";
import {StreetPredictionEngine} from "../../src/intelligence/prediction-engine.js";
import {BriCoordinator} from "../../src/intelligence/bri-coordinator.js";
import {AutonomousSessionEngine} from "../../src/simulation/autonomous-session-engine.js";
import {LiveSessionEngine} from "../../src/simulation/live-engine.js";
import {settleWager} from "../../src/bankroll/accounting.js";
import {stakeForStep} from "../../src/strategies/progression.js";

const base = {bankroll:1000,unit:0.2,maxSpins:120,maxSteps:50,maxStreets:2,
  progression:"flat",stopLoss:0,takeProfit:0,coldThreshold:22,betType:"streets"};
function run(overrides={},autonomous=true){
  const config={...base,...overrides};
  const prediction=new StreetPredictionEngine();
  const rng=mulberry32(xfnv1a("bank-roll-wager-pipeline-v1"));
  let calls=0;
  const random=()=>{calls++;return rng();};
  const engine=autonomous ? new AutonomousSessionEngine(config,random,prediction) : new LiveSessionEngine(config,random);
  const rows=[];
  for(let spin=0;spin<120;spin++){
    const bankroll=engine.state.bankrollCents;
    const observations=prediction.observationCount;
    const beforeCalls=calls;
    const preview=engine.previewNextSpin();
    const forecast=autonomous ? preview.forecast : prediction.forecastNext();
    const prepared=engine.prepareNextSpin();
    assert.equal(calls,beforeCalls);
    if(forecast) assert.equal(forecast.observationCount,observations);
    const decision=structuredClone(prepared);
    assert.equal(prepared.action==="stop",false);
    const wager=prepared.wager;
    assert.equal(engine.state.bankrollCents,bankroll-(wager?.totalStakeCents||0));
    const result=engine.resolveSpin(prepared);
    if(!autonomous) prediction.observe(result.outcome);
    assert.equal(prediction.observationCount,observations+1);
    const settlement=wager?settleWager(wager,result.outcome):null;
    assert.equal(engine.state.bankrollCents,bankroll-(wager?.totalStakeCents||0)+(settlement?.grossReturnCents||0));
    if(wager){
      assert.equal(result.settlement.grossReturnCents,settlement.grossReturnCents);
      if(autonomous) assert.deepEqual(wager.streetStakeCents,decision.decision.selected.financials.streetStakeCents);
    }
    rows.push({decision,result,bankroll:engine.state.bankrollCents});
  }
  return rows;
}
test("20p is a configured unit, not a forced wager: flat, linear and 50p legacy stakes",()=>{
  const flat=run({},false);
  assert.equal(flat.filter(row=>row.decision.wager).length,98);
  assert.equal(flat.filter(row=>!row.decision.wager).length,22);
  assert.ok(flat.filter(row=>row.decision.wager).every(row=>row.decision.wager.perStreetStakeCents===20));
  const linear=run({coldThreshold:0,progression:"linear"},false);
  assert.ok(linear.some(row=>row.decision.wager.perStreetStakeCents===40));
  const fifty=run({coldThreshold:0,unit:0.5},false);
  assert.ok(fifty.every(row=>row.decision.wager.perStreetStakeCents===50));
  assert.notEqual(linear.at(-1).bankroll,fifty.at(-1).bankroll);
});
test("120 evidence-gated BRI spins legitimately place no wager on weak uniform evidence",()=>{
  const rows=run();
  assert.equal(rows.length,120);
  assert.ok(rows.every(row=>row.decision.wager===null && row.bankroll===100000));
  assert.ok(rows.slice(10).every(row=>row.decision.decision.action==="stop"));
});
test("BRI maximum streets applies to actual spreads, progression and non-20p settlement",()=>{
  const coordinator=new BriCoordinator({unitCents:20,bankrollCents:100000,maximumStreetCount:1});
  const oversized=coordinator.snapshotState();
  oversized.state.currentStreets=[0,1];
  assert.throws(()=>coordinator.restoreState(oversized),/exceeds the configured maximum street count/);
  assert.deepEqual(coordinator.state.currentStreets,[]);
  for(const maxStreets of [1,2,3]){
    const rows=run({wageringMode:"strategy-research",maxStreets,progression:"linear"});
    assert.ok(rows.every(row=>!row.decision.wager || row.decision.wager.chosen.length<=maxStreets));
    assert.ok(rows.some(row=>row.decision.wager?.streetStakeCents.some(stake=>stake>20)));
  }
  const fifty=run({wageringMode:"strategy-research",unit:0.5});
  assert.ok(fifty.some(row=>row.decision.wager?.streetStakeCents.includes(50)));
});
test("BRI policy, progression, bankroll and exposure configurations change actual decisions",()=>{
  const adaptive=run({wageringMode:"strategy-research",progression:"linear"});
  const maintain=run({wageringMode:"strategy-research",progression:"linear",researchActionPolicy:"maintain"});
  assert.notDeepEqual(adaptive.map(row=>row.decision.wager),maintain.map(row=>row.decision.wager));
  const small=run({wageringMode:"strategy-research",bankroll:1});
  assert.equal(small.filter(row=>row.decision.wager).length,3);
  assert.equal(small.at(-1).bankroll,40);
  const capped=run({wageringMode:"strategy-research",maxExposure:0.1});
  assert.ok(capped.every(row=>row.decision.wager===null));
});
test("synthetic forced policies cannot bypass evidence gating and invalid progressions cannot become flat",()=>{
  assert.throws(()=>new BriCoordinator({unitCents:20,bankrollCents:10000,researchActionPolicy:"maintain"}),/require synthetic strategy-research/);
  assert.throws(()=>stakeForStep(2,"not-a-strategy"),/Unsupported progression/);
});

test("genuine synthetic outcome feedback qualifies BRI's actual model without bypassing evidence",()=>{
  const prediction=new StreetPredictionEngine();
  const engine=new AutonomousSessionEngine({...base,unit:0.5},()=>1.5/37,prediction);
  let bets=0;
  for(let spin=1;spin<=120;spin++){
    const prepared=engine.prepareNextSpin();
    if(prepared.wager){
      bets++;
      assert.ok(spin>=36);
      assert.equal(prepared.evidence.evidenceWeak,false);
      assert.ok(prepared.evidence.pairedBrierDeltaUpperBound<0);
      assert.deepEqual(prepared.wager.chosen,[0]);
      assert.deepEqual(prepared.wager.streetStakeCents,[50]);
    }
    engine.resolveSpin(prepared);
  }
  assert.equal(bets,85);
  assert.equal(engine.state.bankrollCents,146750);
});
