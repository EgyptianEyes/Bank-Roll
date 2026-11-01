import assert from "node:assert/strict";
import test from "node:test";
import {PlayerSession} from "../../src/simulation/player-session.js";

function makeStore(){
  const session = {
    id: "session-a",
    tableId: "table-a",
    status: "active",
    startingBankrollCents: 10000,
    bankrollCents: 10000,
    totalStakedCents: 0,
    totalGrossReturnsCents: 0,
    wins: 0,
    losses: 0,
    accumulatedLossCents: 0,
    currentProgressionLossCents: 0,
    recoveryAttributionKnown: true,
    progressionStep: 1,
    currentStreets: [],
    pendingForecast: null,
    pendingRecommendation: null,
    pendingActualWager: null,
    wagerStatus: "no-bet-recorded",
    gapBeforeNext: false,
  };
  const observations = [];
  const store = {
    session,
    observations,
    failCorrection: false,
    async listObservations(){ return structuredClone(observations); },
    async getSession(){ return session; },
    async savePending(id, pending){
      session.pendingForecast = structuredClone(pending.forecast);
      session.pendingRecommendation = structuredClone(pending.recommendation);
      session.wagerStatus = pending.recommendation ? "awaiting-player" : "no-bet-recorded";
      return session;
    },
    async confirmWager(id, wager){
      session.pendingActualWager = wager ? structuredClone(wager) : null;
      session.wagerStatus = wager ? "player-confirmed" : "player-no-bet";
      if (wager){
        session.bankrollCents -= wager.totalStakeCents;
        session.totalStakedCents += wager.totalStakeCents;
        session.currentStreets = [...wager.chosen];
      }
      return session;
    },
    async appendOutcome({outcome, evaluation, modelState}){
      const record = {
        id: `observation-${observations.length + 1}`,
        tableId: "table-a",
        sessionId: "session-a",
        sequence: observations.length + 1,
        outcome,
        effectiveOutcome: outcome,
        gapBefore: Boolean(session.gapBeforeNext),
        forecast: structuredClone(session.pendingForecast),
        recommendation: structuredClone(session.pendingRecommendation),
        actualWager: structuredClone(session.pendingActualWager),
        evaluation: structuredClone(evaluation),
        corrections: [],
      };
      observations.push(record);
      if (evaluation.settlement){
        session.bankrollCents += evaluation.settlement.grossReturnCents;
        session.totalGrossReturnsCents += evaluation.settlement.grossReturnCents;
        session.wins += Number(evaluation.settlement.hit);
        session.losses += Number(!evaluation.settlement.hit);
        if (evaluation.settlement.hit){
          session.accumulatedLossCents = Math.max(0, session.accumulatedLossCents - evaluation.settlement.netChangeCents);
          session.currentProgressionLossCents = Math.max(0, session.currentProgressionLossCents - evaluation.settlement.netChangeCents);
          session.progressionStep = 1;
        } else {
          session.accumulatedLossCents += record.actualWager.totalStakeCents;
          session.currentProgressionLossCents += record.actualWager.totalStakeCents;
          session.progressionStep++;
        }
      }
      Object.assign(session, {
        pendingForecast: null,
        pendingRecommendation: null,
        pendingActualWager: null,
        wagerStatus: "no-bet-recorded",
        gapBeforeNext: false,
        observationCount: observations.length,
      });
      store.modelState = modelState;
      return record;
    },
    async markGap(){
      session.gapBeforeNext = true;
      session.pendingForecast = null;
      session.pendingRecommendation = null;
      session.wagerStatus = "no-bet-recorded";
      return {eventType: "observation-gap"};
    },
    async addCorrection(id, correctedOutcome, reason, {updatedSession} = {}){
      if (store.failCorrection) throw new Error("storage unavailable");
      const record = observations.find((entry) => entry.id === id);
      record.effectiveOutcome = correctedOutcome;
      if (updatedSession) Object.assign(session, updatedSession);
      return {observationId: id, correctedOutcome};
    },
  };
  return store;
}

function makePlayer(store = makeStore()){
  const table = {
    id: "table-a",
    settings: {
      startingBankrollCents: 10000,
      unitCents: 20,
      progressionMode: "flat",
      maxStakeCents: 500,
      stopLossCents: 2500,
    },
  };
  return PlayerSession.create({store, table, session: store.session, engineOptions: {minimumObservations: 10}});
}

test("physical observations remain observation-only until prospective evidence clears the uniform baseline", async () => {
  const store = makeStore();
  const player = await makePlayer(store);
  for (let outcome = 0; outcome < 10; outcome++) await player.recordOutcome(outcome);

  const prepared = await player.prepareRecommendation();
  assert.equal(prepared.evidence.evidenceWeak, true);
  assert.equal(prepared.decision.action, "stop");
  assert.equal(prepared.recommendation.strategyAssessment.preferredStrategy, "observation-only");
  assert.equal(prepared.recommendation.strategyAssessment.progressionSource, "player-selected-exploratory-setting");
  await player.confirmNoBet();
  const result = await player.recordOutcome(10);

  assert.equal(result.record.actualWager, null);
  assert.equal(store.session.bankrollCents, 10000);
  assert.equal(store.session.totalStakedCents, 0);
  assert.equal(result.record.trustStatus, undefined);
  assert.equal(store.session.pendingRecommendation, null);
});

test("only a manually confirmed actual wager changes bankroll and settles against the reported result", async () => {
  const store = makeStore();
  const player = await makePlayer(store);
  for (let outcome = 0; outcome < 10; outcome++) await player.recordOutcome(outcome);

  await player.confirmManualStreetWager([0], 20);
  assert.equal(store.session.bankrollCents, 9980);
  const result = await player.recordOutcome(1);

  assert.equal(result.evaluation.settlement.hit, true);
  assert.equal(result.evaluation.settlement.grossReturnCents, 240);
  assert.equal(store.session.bankrollCents, 10220);
  assert.equal(store.session.wins, 1);
  assert.equal(result.record.actualWager.origin, "player-manual");
});

test("a recorded gap survives restore without discarding valid prospective forecast history", async () => {
  const store = makeStore();
  const player = await makePlayer(store);
  for (let outcome = 0; outcome < 10; outcome++) await player.recordOutcome(outcome);
  await player.prepareRecommendation();
  await player.confirmNoBet();
  await player.recordOutcome(10);
  await player.prepareRecommendation();
  await player.confirmNoBet();
  await player.markGap({missingSpins: null});
  const result = await player.recordOutcome(12);

  assert.equal(result.record.gapBefore, true);
  const restored = await makePlayer(store);
  assert.equal(restored.engine.observationCount, 12);
  assert.equal(restored.engine.modelPerformance.find((model) => model.modelVersion === "uniform-v1").total, 1);
});

test("an unscored prepared forecast survives reload and blocks result entry until the player chooses no bet", async () => {
  const store = makeStore();
  const player = await makePlayer(store);
  for (let outcome = 0; outcome < 10; outcome++) await player.recordOutcome(outcome);
  await player.prepareRecommendation();

  const restored = await makePlayer(store);
  assert.ok(restored.engine.pendingForecast);
  await assert.rejects(restored.recordOutcome(10), /Confirm the BRI wager or explicitly record no bet/);
  await restored.confirmNoBet();
  const result = await restored.recordOutcome(10);
  assert.ok(result.record.forecast);
});

test("correcting a prior result invalidates a prepared recommendation for the next spin", async () => {
  const store = makeStore();
  const player = await makePlayer(store);
  for (let outcome = 0; outcome < 11; outcome++) await player.recordOutcome(outcome);
  await player.prepareRecommendation();
  assert.ok(store.session.pendingRecommendation);

  await player.correctOutcome(store.observations[0].id, 36, "corrected entry");
  assert.equal(store.session.pendingForecast, null);
  assert.equal(store.session.pendingRecommendation, null);
  assert.equal(player.engine.pendingForecast, null);
});

test("PlayerSession switch screening uses selected-model support rather than its rolling window", async () => {
  const store = makeStore();
  const player = await makePlayer(store);
  for (let outcome = 0; outcome < 11; outcome++) await player.recordOutcome(outcome);
  store.session.currentStreets = [4];
  const probabilities = [...new Array(12).fill(0.06), 0.05];
  probabilities[4] = 0.05;
  probabilities[7] = 0.3;
  const forecast = {
    observationCount: 11,
    windowSize: 10_000,
    modelSampleSize: 1,
    street: 7,
    modelVersion: "street-transition-v1",
    candidateModels: [{modelVersion: "street-transition-v1", probabilities}],
    forecastedAt: null,
  };
  player.engine.forecastNext = () => {
    player.engine.pendingForecast = forecast;
    return forecast;
  };

  const prepared = await player.prepareRecommendation();
  const switchCandidate = prepared.decision.candidates.find((candidate) => candidate.action === "switch");
  assert.equal(prepared.decision.switchEvidence.modelSampleSize, 1);
  assert.equal(prepared.decision.switchEvidence.justified, false);
  assert.equal(switchCandidate.selectionEligible, false);
});

test("a failed append-only correction restores the effective outcome and rebuilt learner", async () => {
  const store = makeStore();
  const player = await makePlayer(store);
  for (let outcome = 0; outcome < 10; outcome++) await player.recordOutcome(outcome);
  const observationId = store.observations[4].id;
  const trackerBefore = player.engine.tracker.history;
  store.failCorrection = true;

  await assert.rejects(player.correctOutcome(observationId, 36, "mistyped"), /storage unavailable/);
  assert.equal(player.observations[4].effectiveOutcome, 4);
  assert.deepEqual(player.engine.tracker.history, trackerBefore);
});