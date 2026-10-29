import assert from "node:assert/strict";
import test from "node:test";
import {AutonomousSessionEngine} from "../../src/simulation/autonomous-session-engine.js";
import {StreetPredictionEngine} from "../../src/intelligence/prediction-engine.js";
import {mulberry32} from "../../src/core/random.js";

function config(overrides = {}){
  return {
    bankroll: 100,
    unit: 1,
    maxSpins: 30,
    stopLoss: 0,
    takeProfit: 0,
    progression: "flat",
    maxSteps: 10,
    maxStreets: 1,
    ...overrides,
  };
}

class EvidencedPredictionEngine{
  constructor(){
    this.observationCount = 50;
    this.pendingForecast = null;
    this.modelPerformance = [
      {modelVersion: "uniform-v1", total: 50, meanBrier: 0.8},
      {
        modelVersion: "rolling-frequency-v1",
        total: 50,
        meanBrier: 0.5,
        comparisonEvaluations: 50,
        pairedBrierDeltaUpperBound: -0.1,
      },
    ];
  }

  forecastNext(){
    const probabilities = [0.4, ...new Array(11).fill(0.05), 0.05];
    this.pendingForecast = {
      observationCount: this.observationCount,
      street: 0,
      probability: probabilities[0],
      modelVersion: "rolling-frequency-v1",
      candidateModels: [
        {modelVersion: "uniform-v1", probabilities: [...new Array(12).fill(3 / 37), 1 / 37]},
        {modelVersion: "rolling-frequency-v1", probabilities},
      ],
    };
    return this.pendingForecast;
  }

  observe(outcome){
    const forecast = this.pendingForecast;
    this.pendingForecast = null;
    this.observationCount++;
    return forecast ? {forecast, actual: outcome, hit: outcome >= 1 && outcome <= 3} : null;
  }

  cancelPendingForecast(){
    this.pendingForecast = null;
    return true;
  }

  snapshot(){
    return {observationCount: this.observationCount};
  }
}

test("autonomous mode turns weak-evidence STOP into observation without placing a bet", () => {
  const engine = new StreetPredictionEngine();
  const session = new AutonomousSessionEngine(config(), mulberry32(10), engine);
  const prepared = session.prepareNextSpin();
  assert.equal(prepared.action, "observe");
  assert.equal(prepared.decision, null);
  assert.equal(prepared.wager, null);

  const resolved = session.resolveSpin(prepared);
  assert.equal(resolved.settlement, null);
  assert.equal(engine.observationCount, 1);
  assert.equal(session.bankroll, 100);
});

test("autonomous bets use coordinator decisions and settle exact bankroll amounts", () => {
  const session = new AutonomousSessionEngine(config(), () => 0.1, new EvidencedPredictionEngine());
  const prepared = session.prepareNextSpin();
  assert.ok(prepared.decision);
  assert.equal(prepared.action, "bet");
  assert.equal(prepared.wager.totalStakeCents, 100);
  assert.equal(session.bankroll, 99);

  const resolved = session.resolveSpin(prepared);
  assert.equal(resolved.outcome, 3);
  assert.equal(resolved.settlement.hit, true);
  assert.equal(resolved.settlement.grossReturnCents, 1200);
  assert.equal(resolved.settlement.bankroll, 111);
  assert.equal(session.profitLossCents, 1100);
  assert.equal(session.state.totalStakedCents, 100);
  assert.equal(session.state.totalReturnedCents, 1200);
});

test("autonomous preview creates a forecast without committing a wager or advancing spin state", () => {
  const session = new AutonomousSessionEngine(config(), () => 0.1, new EvidencedPredictionEngine());
  const preview = session.previewNextSpin();
  assert.equal(preview.action, "prepare");
  assert.ok(preview.forecast);
  assert.equal(session.spins, 0);
  assert.equal(session.bankroll, 100);
  assert.equal(session.coordinator.state.bankrollCents, 10_000);

  const prepared = session.prepareNextSpin();
  assert.equal(prepared.forecast, preview.forecast);
  assert.equal(session.spins, 1);
  assert.equal(session.bankroll, 99);
});

test("autonomous mode independently respects wager approval limits", () => {
  const session = new AutonomousSessionEngine(config({maxStake: 0.5}), () => 0.1, new EvidencedPredictionEngine());
  const prepared = session.prepareNextSpin();
  assert.equal(prepared.action, "observe");
  assert.equal(prepared.decision.action, "stop");
  assert.equal(prepared.wager, null);
  session.resolveSpin(prepared);
  assert.equal(session.bankroll, 100);
});

test("autonomous snapshots restore coordinator, bankroll, and prediction state", () => {
  const engine = new StreetPredictionEngine();
  let savedRandomState = 12;
  const firstRandom = mulberry32(savedRandomState, (state) => { savedRandomState = state; });
  const first = new AutonomousSessionEngine(config(), firstRandom, engine);
  for (let spin = 0; spin < 12; spin++){
    const prepared = first.prepareNextSpin();
    first.resolveSpin(prepared);
  }
  const snapshot = first.snapshot();
  const savedObservationCount = first.predictionEngine.observationCount;
  const resumeRandomState = savedRandomState;
  const uninterruptedPrepared = first.prepareNextSpin();
  const uninterruptedResult = first.resolveSpin(uninterruptedPrepared);

  const restored = new AutonomousSessionEngine(config(), mulberry32(resumeRandomState), new StreetPredictionEngine(), snapshot);
  assert.deepEqual(restored.coordinator.snapshotState(), snapshot.coordinatorState);
  assert.equal(restored.spins, snapshot.spins);
  assert.equal(restored.bankroll, snapshot.bankrollCents / 100);
  assert.equal(restored.predictionEngine.observationCount, savedObservationCount);

  const next = restored.prepareNextSpin();
  const resolved = restored.resolveSpin(next);
  assert.equal(next.action, uninterruptedPrepared.action);
  assert.deepEqual(next.wager, uninterruptedPrepared.wager);
  assert.equal(resolved.outcome, uninterruptedResult.outcome);
  assert.equal(restored.bankroll, first.bankroll);
  assert.equal(restored.spins, 13);
});

test("session stop-loss suspends the autonomous session before another wager", () => {
  const session = new AutonomousSessionEngine(config({stopLoss: 1}), () => 0.5, new EvidencedPredictionEngine());
  session.coordinator.sustainabilityHorizon = 1;
  const prepared = session.prepareNextSpin();
  assert.equal(prepared.action, "bet");
  session.resolveSpin(prepared);
  assert.equal(session.bankroll, 99);
  const preview = session.previewNextSpin();
  assert.equal(preview.action, "stop");
  assert.equal(preview.reason, "stop-loss");
});
