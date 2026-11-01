import test from "node:test";
import assert from "node:assert/strict";
import {IDBFactory} from "fake-indexeddb";
import {PlayerModeStore} from "../../src/storage/player-mode-store.js";
import {PlayerSession, PLAYER_DEFAULT_SETTINGS} from "../../src/simulation/player-session.js";
import {StreetPredictionEngine} from "../../src/intelligence/prediction-engine.js";
import {assessForecastEvidence, BriCoordinator} from "../../src/intelligence/bri-coordinator.js";
import {decideNextAction} from "../../src/strategies/decision-engine.js";

async function fixture(overrides = {}){
  let time = Date.UTC(2026, 9, 31);
  const store = new PlayerModeStore({indexedDBFactory: new IDBFactory(), now: () => new Date(time).toISOString()});
  const settings = {...PLAYER_DEFAULT_SETTINGS, maxStakeCents: 500, ...overrides};
  const table = await store.createTable({name: "Table A", settings});
  const session = await store.startSession(table.id, settings);
  const player = await PlayerSession.create({store, table, session});
  return {store, table, player, tick: (ms = 31000) => { time += ms; }};
}

test("all 37 outcomes settle multiple actual streets exactly, including zero", async () => {
  for (let outcome = 0; outcome <= 36; outcome++){
    const {player} = await fixture();
    await player.confirmManualStreetWager([0, 4, 11], 20);
    await player.recordOutcome(outcome);
    const win = [1, 2, 3, 13, 14, 15, 34, 35, 36].includes(outcome);
    assert.equal(player.session.bankrollCents, 10000 - 60 + (win ? 240 : 0));
    assert.equal(player.session.totalStakedCents, 60);
    assert.equal(player.session.accumulatedLossCents, win ? 0 : 60);
    assert.equal(player.session.progressionStep, 1, "flat stakes never advance");
  }
});

test("two stale tabs cannot confirm or score against a different persisted wager", async () => {
  const {store, table, player} = await fixture();
  const stale = await PlayerSession.create({store, table, session: await store.getSession(player.session.id)});
  await player.confirmManualStreetWager([0], 20);
  await assert.rejects(stale.confirmManualStreetWager([1], 20), /another tab/);
  await assert.rejects(stale.recordOutcome(4), /another tab/);
  assert.equal((await store.getSession(player.session.id)).bankrollCents, 9980);
  assert.equal((await store.listObservations(table.id)).length, 0);
  assert.equal(stale.engine.observationCount, 0);
});

test("failed outcome persistence retains the exact pre-outcome forecast for retry", async () => {
  const {player, store, tick} = await fixture();
  for (let i = 0; i < 10; i++){ tick(); await player.recordOutcome(i); }
  await player.prepareRecommendation();
  await player.confirmNoBet();
  const original = structuredClone(player.engine.pendingForecast);
  const append = store.appendOutcome;
  store.appendOutcome = async () => { throw new Error("quota exceeded"); };
  tick();
  await assert.rejects(player.recordOutcome(12), /quota/);
  assert.deepEqual(player.engine.pendingForecast, original);
  store.appendOutcome = append;
  await player.recordOutcome(12);
  assert.equal(player.engine.performance.total, 1);
});

test("cadence rejects double-entry and quarantines rapid input without training", async () => {
  const {player, tick, store, table} = await fixture();
  await player.recordOutcome(1);
  tick(1000);
  await assert.rejects(player.recordOutcome(2), /1.5 seconds/);
  tick(1000);
  const result = await player.recordOutcome(3);
  assert.equal(result.record.trustStatus, "quarantined");
  assert.equal(player.engine.observationCount, 1);
  assert.equal(player.engine.previousCategory, null);
  const restored = await PlayerSession.create({store, table, session: player.session});
  assert.deepEqual(restored.engine.snapshot(), player.engine.snapshot());
});

test("gaps break transitions and rolling context but retain lifetime observations", async () => {
  const {player, tick, store, table} = await fixture();
  await player.recordOutcome(1);
  tick();
  await player.markGap({missingSpins: 3});
  await player.recordOutcome(4);
  assert.equal(player.engine.transitionCounts[0][1], 0);
  assert.deepEqual(player.engine.continuityHistory, [4]);
  assert.equal(player.engine.observationCount, 2);
  const restored = await PlayerSession.create({store, table, session: player.session});
  assert.deepEqual(restored.engine.snapshot(), player.engine.snapshot());
});

test("historical corrections rebuild the original session, not the new session's bankroll", async () => {
  const {player, store, table, tick} = await fixture();
  await player.confirmManualStreetWager([0], 20);
  await player.recordOutcome(1);
  const oldSessionId = player.session.id;
  const observation = player.observations[0];
  tick();
  const session = await store.startSession(table.id, {...PLAYER_DEFAULT_SETTINGS, startingBankrollCents: 5000}, {newSession: true});
  const next = await PlayerSession.create({store, table, session});
  await next.correctOutcome(observation.id, 0, "Typo in previous session");
  assert.equal((await store.getSession(oldSessionId)).bankrollCents, 9980);
  assert.equal(next.session.bankrollCents, 5000);
  const exported = await next.exportHistory();
  assert.equal(exported.sessions.length, 2);
  assert.equal(exported.observations[0].outcome, 1);
  assert.equal(exported.observations[0].effectiveOutcome, 0);
});

test("undo appends a tombstone and reopens the actual wager, never cancels the player's bet", async () => {
  const {player, tick, store, table} = await fixture();
  await player.confirmManualStreetWager([0], 20);
  await player.recordOutcome(1);
  await player.undoLastOutcome();
  assert.equal(player.session.bankrollCents, 9980);
  assert.equal(player.session.pendingActualWager.totalStakeCents, 20);
  assert.equal(player.observations[0].voided, true);
  tick();
  await player.recordOutcome(1);
  assert.equal(player.session.bankrollCents, 10220);
  assert.equal(player.session.totalStakedCents, 20);
  assert.equal(player.observations[0].voided, true);
  assert.equal(player.observations[0].evaluation.settlement, null);
  assert.deepEqual(player.observations[1].evaluation.settlement, {
    hit: true,
    grossReturnCents: 240,
    netChangeCents: 220,
  });
  const restored = await PlayerSession.create({store, table, session: player.session});
  assert.equal(restored.engine.observationCount, 1);
});

test("same-timestamp corrections have deterministic revision order and reset prospective evidence", async () => {
  const {player, tick, store, table} = await fixture();
  for (let i = 0; i < 12; i++){
    tick();
    await player.prepareRecommendation();
    await player.confirmNoBet();
    await player.recordOutcome(i);
  }
  assert.equal(player.engine.performance.total, 2);
  const target = player.observations[0];
  await player.correctOutcome(target.id, 20, "first");
  await player.correctOutcome(target.id, 21, "second");
  const restored = await PlayerSession.create({store, table, session: player.session});
  assert.equal(restored.observations[0].effectiveOutcome, 21);
  assert.equal(restored.engine.performance.total, 0);
  assert.equal(restored.observations[0].corrections.length, 2);
});

test("take-profit, stop-loss floor, per-street limits and ended sessions independently block manual bets", async () => {
  const {player, store} = await fixture({takeProfitCents: 200});
  await player.confirmManualStreetWager([0], 20);
  await player.recordOutcome(1);
  await assert.rejects(player.confirmManualStreetWager([0], 20), /take-profit/);
  const capped = await fixture({stopLossCents: 10});
  await assert.rejects(capped.player.confirmManualStreetWager([0], 20), /stop-loss/);
  const tableCapped = await fixture({tableMaxStakeCents: 10});
  await assert.rejects(tableCapped.player.confirmManualStreetWager([0], 20), /per-street/);
  await store.endSession(player.session.id, player.session.revision);
  const ended = await PlayerSession.create({store, table: player.table, session: await store.getSession(player.session.id)});
  await assert.rejects(ended.confirmManualStreetWager([0], 20), /ended/);
});

test("six candidates are normalized, forward-scored, bounded and restored without leakage", () => {
  const engine = new StreetPredictionEngine({historyLimit: 10});
  for (let i = 0; i < 1000; i++){
    const forecast = engine.forecastNext();
    if (forecast){
      assert.equal(forecast.candidateModels.length, 6);
      for (const model of forecast.candidateModels) assert.ok(Math.abs(model.probabilities.reduce((a, b) => a + b, 0) - 1) < 1e-10);
    }
    engine.observe(i % 37);
  }
  assert.equal(engine.performance.total, 990);
  assert.equal(engine.forecasts.length, 10);
  assert.ok(engine.modelPerformance.every((model) => model.recentDifferences.length <= 100));
  assert.ok(engine.modelPerformance.every((model) => model.pairedRangeSquaredTotal >= 0 && model.pairedRangeSquaredTotal <= 16 * model.comparisonEvaluations));
  const restored = new StreetPredictionEngine().restore(engine.snapshot());
  assert.deepEqual(restored.forecastNext().candidateModels, engine.forecastNext().candidateModels);
});

test("model checkpoint validation rejects malformed continuity and prospective score state", () => {
  const engine = new StreetPredictionEngine();
  for (let i = 0; i < 12; i++){ engine.forecastNext(); engine.observe(i); }
  const invalid = engine.snapshot();
  invalid.transitionCounts[0][0] = -1;
  assert.throws(() => new StreetPredictionEngine().restore(invalid), /transition/);
  const invalidScores = engine.snapshot();
  invalidScores.modelPerformance[1].recentDifferences = new Array(101).fill(0);
  assert.throws(() => new StreetPredictionEngine().restore(invalidScores), /prospective/);
});

test("another model's evidence cannot authorize the selected model, and deterioration suspends wagers", () => {
  const modelPerformance = [
    {modelVersion: "uniform-v1", total: 500},
    {modelVersion: "lifetime-frequency-v1", total: 500, comparisonEvaluations: 500, pairedBrierDeltaUpperBound: -0.1, recentMeanBrierDelta: -0.1},
  ];
  assert.equal(assessForecastEvidence({modelPerformance}, 25, "rolling-frequency-v1").evidenceWeak, true);
  assert.equal(assessForecastEvidence({modelPerformance}, 25, "lifetime-frequency-v1").evidenceWeak, false);
  modelPerformance[1].recentMeanBrierDelta = 0.01;
  assert.equal(assessForecastEvidence({modelPerformance}, 25, "lifetime-frequency-v1").evidenceWeak, true);
});

test("Brier evidence alone cannot authorize a negative-expectation street bet", () => {
  const decision = decideNextAction({
    unitCents: 20, bankrollCents: 10000, progressionMode: "flat", currentStreets: [], candidateStreets: [0, 1, 2],
    probabilities: [...new Array(12).fill(3 / 37), 1 / 37], wageringMode: "evidence-gated", evidenceWeak: false,
  });
  assert.equal(decision.action, "stop");
});

test("shared BRI flat staking does not accumulate fictitious progression steps after losses", () => {
  const coordinator = new BriCoordinator({
    unitCents: 20, bankrollCents: 10000, progressionMode: "flat", wageringMode: "strategy-research",
    sustainabilityHorizon: 1, limits: {maxSteps: 1}, engineOptions: {minimumObservations: 0},
  });
  for (let i = 0; i < 25; i++){
    const pending = coordinator.beforeSpin();
    assert.notEqual(pending.decision.action, "stop");
    coordinator.afterSpin(0);
    assert.equal(coordinator.state.progressionStep, 1);
  }
});
