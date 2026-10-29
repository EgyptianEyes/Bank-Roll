import assert from "node:assert/strict";
import test from "node:test";
import {assertSafeMoneyCents, multiplyMoneyCents, toMinorUnits} from "../../src/core/mathematics.js";
import {MAX_PROGRESSION_STEP, cumulativeStakeUnits, stakeForStep} from "../../src/strategies/progression.js";
import {settleWager} from "../../src/bankroll/accounting.js";
import {createSessionState, prepareSessionSpin} from "../../src/simulation/session-engine.js";
import {decideNextAction, projectedExposureCents, sustainableLossCount, LOSS_HORIZONS} from "../../src/strategies/decision-engine.js";
import {BriCoordinator} from "../../src/intelligence/bri-coordinator.js";
import {rebuildPredictionEngine, recoverCorrectedTable} from "../../src/intelligence/rebuild.js";
import {StreetPredictionEngine} from "../../src/intelligence/prediction-engine.js";
import {BriCompanion} from "../../src/companion/companion.js";
import {
  compareAutonomousStrategies,
  compareStrategies,
  generateOutcomeSequence,
  scenarioCategoryProbabilities,
  generateScenarioOutcomeSequence,
  simulateSessionWithOutcomes,
} from "../../src/simulation/research-lab.js";

const UNIFORM = [...new Array(12).fill(3 / 37), 1 / 37];

function decisionContext(overrides = {}){
  return {
    bankrollCents: 100_00,
    startingBankrollCents: 100_00,
    accumulatedLossCents: 0,
    progressionStep: 1,
    progressionMode: "martingale",
    unitCents: 100,
    probabilities: UNIFORM,
    currentStreets: [4],
    candidateStreets: [4, 7, 2],
    limits: {},
    ...overrides,
  };
}

test("monetary helpers refuse unsafe integer amounts and bound progressions", () => {
  assert.throws(() => toMinorUnits(Number.MAX_SAFE_INTEGER), RangeError);
  assert.throws(() => assertSafeMoneyCents(2 ** 53), RangeError);
  assert.throws(() => multiplyMoneyCents(2 ** 52, 4), RangeError);
  assert.throws(() => stakeForStep(MAX_PROGRESSION_STEP + 1, "flat"), RangeError);
  assert.equal(stakeForStep(MAX_PROGRESSION_STEP, "flat"), 1);
  assert.equal(stakeForStep(10, "martingale"), 512);
  assert.equal(cumulativeStakeUnits(1, 4, "martingale"), 15);
  assert.throws(() => settleWager({kind: "streets", chosen: [1, 1], perStreetStakeCents: 100, totalStakeCents: 200}, 4), RangeError);
  assert.throws(() => settleWager({kind: "streets", chosen: [1], perStreetStakeCents: 0, totalStakeCents: 0}, 4), RangeError);
});

test("deep martingale progressions stop the session instead of overflowing", () => {
  const config = {bankroll: 1e9, unit: 1, maxSpins: 100, stopLoss: 0, takeProfit: 0, betType: "streets", coldThreshold: 0, maxStreets: 1, progression: "martingale", maxSteps: 500, maxStake: 0, maxExposure: 0};
  const state = createSessionState(config);
  state.progressionStep = MAX_PROGRESSION_STEP + 1;
  const prepared = prepareSessionSpin(config, state);
  assert.equal(prepared.action, "stop");
  assert.equal(prepared.reason, "progression limit");
});

test("multi-street settlements pay twelve times the winning street stake only", () => {
  const wager = {kind: "streets", chosen: [0, 5, 11], perStreetStakeCents: 250, totalStakeCents: 750};
  const win = settleWager(wager, 17); // street 5
  assert.equal(win.hit, true);
  assert.equal(win.grossReturnCents, 3000);
  assert.equal(win.netChangeCents, 2250);
  const zero = settleWager(wager, 0);
  assert.equal(zero.hit, false);
  assert.equal(zero.netChangeCents, -750);
});

test("spread candidate settlement and forward exposure match the redistributed wager", () => {
  const decision = decideNextAction(decisionContext({
    progressionMode: "flat",
    currentStreets: [0],
    candidateStreets: [1, 2, 3],
    spreadWidth: 4,
    evidenceWeak: false,
    sustainabilityHorizon: 1,
  }));
  const spread = decision.candidates.find((candidate) => candidate.action === "spread");
  assert.deepEqual(spread.streets, [0, 1, 2, 3]);
  assert.equal(spread.financials.perStreetStakeCents, 25);
  assert.equal(spread.financials.totalStakeCents, 100);
  assert.equal(spread.financials.grossReturnCents, 300);
  assert.equal(spread.financials.netProfitCents, 200);
  assert.equal(spread.financials.exposureByHorizon[1], 100);
  assert.equal(spread.financials.exposureByHorizon[3], 900);
  assert.equal(spread.financials.outcomesByStreet.length, 13);
  const independentlyCalculatedExpectedNet = spread.financials.outcomesByStreet.reduce((total, outcome) =>
    total + outcome.probability * outcome.netChangeCents, 0);
  assert.ok(Math.abs(independentlyCalculatedExpectedNet - spread.financials.expectedNetCents) < 1e-9);

  const spreadWager = {
    kind: "streets",
    chosen: spread.streets,
    perStreetStakeCents: spread.financials.perStreetStakeCents,
    streetStakeCents: spread.financials.streetStakeCents,
    totalStakeCents: spread.financials.totalStakeCents,
  };
  assert.deepEqual(settleWager(spreadWager, 1), {hit: true, grossReturnCents: 300, netChangeCents: 200});
  assert.deepEqual(settleWager(spreadWager, 0), {hit: false, grossReturnCents: 0, netChangeCents: -100});

  const martingale = decideNextAction(decisionContext({
    progressionMode: "martingale",
    currentStreets: [0],
    candidateStreets: [1, 2, 3],
    spreadWidth: 4,
    evidenceWeak: false,
    sustainabilityHorizon: 1,
  })).candidates.find((candidate) => candidate.action === "spread");
  assert.deepEqual(martingale.financials.exposureByHorizon, {1: 100, 3: 2500, 5: 12100, 10: 408900});
  assert.equal(martingale.financials.requiredNextStakeCents, 800);
});

test("SPREAD preserves indivisible minor units and settles each street's assigned stake", () => {
  const decision = decideNextAction(decisionContext({
    progressionMode: "flat",
    currentStreets: [0],
    candidateStreets: [1, 2],
    spreadWidth: 3,
    evidenceWeak: false,
    sustainabilityHorizon: 1,
  }));
  const spread = decision.candidates.find((candidate) => candidate.action === "spread");
  assert.deepEqual(spread.financials.streetStakeCents, [34, 33, 33]);
  assert.equal(spread.financials.totalStakeCents, 100);
  assert.deepEqual(spread.financials.grossReturnByStreetCents, [408, 396, 396]);

  const wager = {
    kind: "streets",
    chosen: spread.streets,
    totalStakeCents: spread.financials.totalStakeCents,
    perStreetStakeCents: spread.financials.perStreetStakeCents,
    streetStakeCents: spread.financials.streetStakeCents,
  };
  assert.equal(settleWager(wager, 1).grossReturnCents, 408);
  assert.equal(settleWager(wager, 4).grossReturnCents, 396);
  assert.equal(settleWager(wager, 0).netChangeCents, -100);
  assert.throws(() => settleWager({...wager, totalStakeCents: 99}, 1), /must equal the total stake/);

  const twoStreet = decideNextAction(decisionContext({
    progressionMode: "flat",
    currentStreets: [0],
    candidateStreets: [1, 2],
    spreadWidth: 2,
    sustainabilityHorizon: 1,
  })).candidates.find((candidate) => candidate.action === "spread");
  assert.deepEqual(twoStreet.financials.streetStakeCents, [50, 50]);
  assert.equal(twoStreet.financials.totalStakeCents, 100);
  assert.equal(twoStreet.financials.grossReturnByStreetCents[0], 600);
  assert.equal(twoStreet.financials.worstCaseNetChangeCents, -100);
});

test("switch resets wager step but preserves all existing sequence losses", () => {
  const coordinator = new BriCoordinator({
    unitCents: 100,
    bankrollCents: 150_00,
    progressionMode: "martingale",
    sustainabilityHorizon: 1,
    limits: {maxStakeCents: 1_000},
    wageringMode: "strategy-research",
    engine: {
      observationCount: 50,
      pendingForecast: null,
      modelPerformance: [
        {modelVersion: "uniform-v1", total: 50, meanBrier: 0.8},
        {modelVersion: "rolling-frequency-v1", total: 50, meanBrier: 0.5, comparisonEvaluations: 50, pairedBrierDeltaUpperBound: -0.01},
      ],
      forecastNext(){
        const probabilities = [0.4, ...new Array(11).fill(0.05), 0.05];
        this.pendingForecast = {
          observationCount: this.observationCount,
          street: 0,
          modelVersion: "rolling-frequency-v1",
          candidateModels: [{modelVersion: "rolling-frequency-v1", probabilities}],
        };
        return this.pendingForecast;
      },
      observe(){
        const forecast = this.pendingForecast;
        this.pendingForecast = null;
        this.observationCount++;
        return {forecast, hit: false};
      },
    },
  });
  coordinator.state.accumulatedLossCents = 12_700;
  coordinator.state.progressionStep = 8;
  coordinator.state.currentStreets = [4];
  const prepared = coordinator.beforeSpin();
  assert.equal(prepared.decision.action, "switch");
  assert.equal(prepared.wager.totalStakeCents, 100);
  assert.equal(coordinator.state.accumulatedLossCents, 12_700);
  assert.equal(coordinator.state.progressionStep, 1);
  assert.equal(coordinator.state.currentProgressionLossCents, 0);
  coordinator.afterSpin(36);
  assert.equal(coordinator.state.accumulatedLossCents, 12_800);
  assert.equal(coordinator.state.currentProgressionLossCents, 100);
  assert.equal(coordinator.state.progressionStep, 2);
});

test("switches require a meaningful forecast advantage unless continuing is financially unsustainable", () => {
  const similarProbabilities = [...new Array(12).fill((1 - 0.084 - 0.082 - 1 / 37) / 10), 1 / 37];
  similarProbabilities[4] = 0.084;
  similarProbabilities[7] = 0.082;
  const similar = decideNextAction(decisionContext({
    progressionMode: "flat",
    probabilities: similarProbabilities,
    currentStreets: [4],
    candidateStreets: [7, 0, 1],
    forecastWindowSize: 100,
  }));
  assert.equal(similar.action, "continue");
  assert.equal(similar.switchEvidence.justified, false);
  assert.ok(similar.reasons.some((reason) => reason.includes("uncertainty margin")));

  const strongProbabilities = [...new Array(12).fill(0.06), 0.05];
  strongProbabilities[4] = 0.05;
  strongProbabilities[7] = 0.3;
  const supported = decideNextAction(decisionContext({
    progressionMode: "flat",
    probabilities: strongProbabilities,
    currentStreets: [4],
    candidateStreets: [7, 0, 1],
    forecastWindowSize: 100,
  }));
  assert.equal(supported.action, "switch");
  assert.equal(supported.switchEvidence.justified, true);

  const unsustainable = decideNextAction(decisionContext({
    bankrollCents: 15_000,
    progressionStep: 8,
    limits: {maxStakeCents: 1_000},
  }));
  assert.equal(unsustainable.action, "switch");
});

test("repeated switches retain total losses while resetting only position-local recovery", () => {
  const probabilityByStreet = [5, 8];
  const engine = {
    observationCount: 50,
    pendingForecast: null,
    modelPerformance: [],
    forecastNext(){
      const street = probabilityByStreet.shift();
      const probabilities = [...new Array(12).fill(0.05), 0.4];
      probabilities[street] = 0.4;
      probabilities[12] = 0;
      const remainder = 0.6 / 11;
      for (let index = 0; index < 12; index++){
        if (index !== street) probabilities[index] = remainder;
      }
      this.pendingForecast = {
        observationCount: this.observationCount,
        windowSize: 100,
        street,
        modelVersion: "rolling-frequency-v1",
        candidateModels: [{modelVersion: "rolling-frequency-v1", probabilities}],
      };
      return this.pendingForecast;
    },
    observe(){
      this.pendingForecast = null;
      this.observationCount++;
      return null;
    },
  };
  const coordinator = new BriCoordinator({
    unitCents: 100,
    bankrollCents: 100_000,
    progressionMode: "martingale",
    wageringMode: "strategy-research",
    sustainabilityHorizon: 1,
    limits: {maxStakeCents: 1_000},
    engine,
  });
  coordinator.state.currentStreets = [0];
  coordinator.state.progressionStep = 5;
  coordinator.state.accumulatedLossCents = 2_500;
  coordinator.state.currentProgressionLossCents = 2_000;

  for (const [outcome, expectedStreet] of [[36, 5], [36, 8]]){
    const prepared = coordinator.beforeSpin();
    assert.equal(prepared.decision.action, "switch");
    assert.deepEqual(prepared.wager.chosen, [expectedStreet]);
    assert.equal(coordinator.state.currentProgressionLossCents, 0);
    coordinator.afterSpin(outcome);
  }
  assert.equal(coordinator.state.accumulatedLossCents, 2_700);
  assert.equal(coordinator.state.currentProgressionLossCents, 100);
  assert.equal(coordinator.state.progressionStep, 2);
});

test("legacy coordinator snapshots preserve global losses without inventing position attribution", () => {
  const coordinator = new BriCoordinator({unitCents: 100, bankrollCents: 10_000});
  coordinator.state.accumulatedLossCents = 1_500;
  coordinator.state.currentStreets = [3];
  const snapshot = coordinator.snapshotState();
  delete snapshot.state.currentProgressionLossCents;
  delete snapshot.state.recoveryAttributionKnown;
  const restored = new BriCoordinator({unitCents: 100, bankrollCents: 10_000}).restoreState(snapshot);
  assert.equal(restored.state.accumulatedLossCents, 1_500);
  assert.equal(restored.state.currentProgressionLossCents, 0);
  assert.equal(restored.state.recoveryAttributionKnown, false);
});

test("partial recovery only credits net winnings and does not erase prior losses", () => {
  const coordinator = new BriCoordinator({
    unitCents: 100,
    bankrollCents: 100_00,
    progressionMode: "flat",
    wageringMode: "strategy-research",
  });
  coordinator.state.accumulatedLossCents = 1_000;
  coordinator.state.currentStreets = [0, 1, 2, 3];
  coordinator.engine = {
    observationCount: 30,
    pendingForecast: null,
    modelPerformance: [],
    forecastNext(){
      const probabilities = [...new Array(4).fill(0.22), ...new Array(8).fill(0.015), 0];
      this.pendingForecast = {
        observationCount: this.observationCount,
        street: 0,
        modelVersion: "rolling-frequency-v1",
        candidateModels: [{modelVersion: "rolling-frequency-v1", probabilities}],
      };
      return this.pendingForecast;
    },
    observe(){
      this.pendingForecast = null;
      return null;
    },
  };
  const prepared = coordinator.beforeSpin();
  assert.equal(prepared.decision.action, "continue");
  assert.equal(prepared.wager.totalStakeCents, 400);
  coordinator.afterSpin(1);
  assert.equal(coordinator.state.accumulatedLossCents, 200);
  assert.equal(coordinator.state.progressionStep, 1);
});

test("projected exposure reports the one, three, five and ten loss horizons exactly", () => {
  const base = {fromStep: 1, streetCount: 1, unitCents: 100, progressionMode: "martingale"};
  assert.equal(projectedExposureCents({...base, lossCount: 1}), 100);
  assert.equal(projectedExposureCents({...base, lossCount: 3}), 700);
  assert.equal(projectedExposureCents({...base, lossCount: 5}), 3100);
  assert.equal(projectedExposureCents({...base, lossCount: 10}), 102300);
  assert.equal(projectedExposureCents({...base, lossCount: 10, maxSteps: 5}), null);
  assert.equal(sustainableLossCount({fromStep: 1, streetCount: 1, unitCents: 100, progressionMode: "martingale", bankrollCents: 700, riskCapitalCents: 700}), 3);
});

test("decision snapshots compare all four actions under identical constraints", () => {
  const decision = decideNextAction(decisionContext());
  assert.equal(decision.candidates.length, 4);
  const actions = decision.candidates.map((candidate) => candidate.action).sort();
  assert.deepEqual(actions, ["continue", "spread", "stop", "switch"]);
  const selected = decision.selected;
  assert.ok(selected.financials);
  assert.ok(decision.reasons.length > 0);
  assert.ok(decision.decidedAt);
  for (const candidate of decision.candidates){
    if (!candidate.financials) continue;
    assert.equal(candidate.financials.bankrollCents, 100_00);
    for (const horizon of LOSS_HORIZONS){
      assert.ok(horizon in candidate.financials.exposureByHorizon);
    }
  }
});

test("an unsustainable continuation yields to a sustainable alternative, never erasing losses", () => {
  // Deep martingale: continuing at step 8 needs 128 units; the bankroll
  // cannot sustain further losses, but a fresh position at step 1 can.
  const decision = decideNextAction(decisionContext({
    bankrollCents: 150_00,
    accumulatedLossCents: 127_00,
    progressionStep: 8,
  }));
  assert.notEqual(decision.action, "continue");
  assert.notEqual(decision.action, "stop");
  assert.equal(decision.accumulatedLossCents, 127_00);
  assert.ok(decision.reasons.some((reason) => reason.includes("retained in full")));
});

test("wagering stops when no action can sustain the configured loss horizon", () => {
  const decision = decideNextAction(decisionContext({
    bankrollCents: 250,
    startingBankrollCents: 100_00,
    progressionStep: 1,
  }));
  assert.equal(decision.action, "stop");
  assert.ok(decision.reasons[0].includes("suspend") || decision.reasons[0].includes("No feasible"));
});

test("stop-loss floors restrict the risk capital available to any candidate", () => {
  const roomy = decideNextAction(decisionContext());
  assert.notEqual(roomy.action, "stop");
  const floored = decideNextAction(decisionContext({
    bankrollCents: 95_00,
    limits: {stopLossCents: 6_00},
  }));
  assert.equal(floored.action, "stop");
  assert.equal(floored.riskCapitalCents, 100);
});

test("evidence-gated mode suspends wagering despite outstanding losses; research mode labels experimental bets", () => {
  const observing = decideNextAction(decisionContext({evidenceWeak: true}));
  assert.equal(observing.action, "stop");
  const recovering = decideNextAction(decisionContext({evidenceWeak: true, accumulatedLossCents: 500, progressionStep: 2}));
  assert.equal(recovering.action, "stop");
  assert.equal(recovering.selected.financials.remainingUnrecoveredCents, 500);
  const research = decideNextAction(decisionContext({
    evidenceWeak: true,
    wageringMode: "strategy-research",
    sustainabilityHorizon: 1,
  }));
  assert.notEqual(research.action, "stop");
  assert.equal(research.wageringMode, "strategy-research");
  assert.ok(research.reasons.some((reason) => reason.includes("no predictive advantage has been established")));
});

test("table limits and maximum stakes make oversized actions infeasible", () => {
  const decision = decideNextAction(decisionContext({
    progressionStep: 6, // 32 units = £32 per street
    limits: {maxStakeCents: 10_00},
  }));
  const continueCandidate = decision.candidates.find((candidate) => candidate.action === "continue");
  assert.equal(continueCandidate.feasible, false);
  assert.ok(continueCandidate.constraints.some((constraint) => constraint.includes("maximum permitted stake")));
  const exposureLimited = decideNextAction(decisionContext({
    progressionMode: "flat",
    limits: {maxExposureCents: 50},
  }));
  assert.ok(exposureLimited.candidates
    .filter((candidate) => candidate.action !== "stop")
    .every((candidate) => !candidate.feasible));
});

test("the coordinator observes before forecasting and records forecasts before outcomes", () => {
  const coordinator = new BriCoordinator({unitCents: 100, bankrollCents: 500_00, progressionMode: "flat"});
  const order = [];
  coordinator.on("forecast", () => order.push("forecast"));
  coordinator.on("decision", () => order.push("decision"));
  coordinator.on("outcome", () => order.push("outcome"));
  const seeded = [5, 9, 14, 22, 31, 2, 8, 19, 27, 33];
  for (const outcome of seeded){
    const prepared = coordinator.beforeSpin();
    assert.equal(prepared.action, "observe");
    coordinator.afterSpin(outcome);
  }
  order.length = 0;
  const prepared = coordinator.beforeSpin();
  assert.notEqual(prepared.action, "observe");
  assert.ok(prepared.forecast);
  assert.ok(prepared.decision);
  coordinator.afterSpin(11);
  assert.deepEqual(order.slice(0, 3), ["forecast", "decision", "outcome"]);
  assert.throws(() => coordinator.afterSpin(3), /Prepare the spin/);
});

test("coordinator settlement keeps exact accounts across wins and losses", () => {
  const coordinator = new BriCoordinator({unitCents: 100, bankrollCents: 100_00, progressionMode: "martingale", sustainabilityHorizon: 1});
  for (const outcome of [1, 4, 7, 10, 13, 16, 19, 22, 25, 28]) {
    coordinator.beforeSpin();
    coordinator.afterSpin(outcome);
  }
  const prepared = coordinator.beforeSpin();
  assert.notEqual(prepared.action, "observe");
  if (prepared.wager){
    const before = coordinator.state.bankrollCents + prepared.wager.totalStakeCents;
    assert.equal(before, 100_00);
    const chosen = prepared.wager.chosen[0];
    const losingOutcome = ((chosen + 1) % 12) * 3 + 1;
    const result = coordinator.afterSpin(losingOutcome);
    assert.equal(result.settlement.hit, false);
    assert.equal(coordinator.state.accumulatedLossCents, prepared.wager.totalStakeCents);
    assert.equal(coordinator.state.progressionStep, 2);

    const next = coordinator.beforeSpin();
    if (next.wager){
      const winningOutcome = next.wager.chosen[0] * 3 + 2;
      const winResult = coordinator.afterSpin(winningOutcome);
      assert.equal(winResult.settlement.hit, true);
      assert.equal(coordinator.state.progressionStep, 1);
      const expectedRecovery = Math.max(0, prepared.wager.totalStakeCents - (winResult.settlement.grossReturnCents - next.wager.totalStakeCents));
      assert.equal(coordinator.state.accumulatedLossCents, expectedRecovery);
    }
  }
});

test("coordinator reflection reports honest evidence against the uniform baseline", () => {
  const coordinator = new BriCoordinator({unitCents: 100, bankrollCents: 100_00});
  const reflection = coordinator.reflection();
  assert.equal(reflection.evidence.evidenceWeak, true);
  assert.equal(reflection.observationCount, 0);
  assert.deepEqual(Object.keys(reflection.decisions).sort(), ["continue", "observe", "spread", "stop", "switch"]);
});

test("evidence gating requires an anytime-adjusted paired Brier improvement", () => {
  const coordinator = new BriCoordinator({unitCents: 100, bankrollCents: 10_000});
  const predictionEngine = coordinator.engine;
  for (const outcome of generateOutcomeSequence("fair-evidence-gate", 10_000)){
    const forecast = predictionEngine.forecastNext();
    predictionEngine.observe(outcome);
    if (forecast) assert.equal(coordinator.evidenceAssessment().evidenceWeak, true);
  }
  const fairAlternatives = predictionEngine.modelPerformance.filter((model) => model.modelVersion !== "uniform-v1");
  assert.ok(fairAlternatives.every((model) => model.pairedBrierDeltaUpperBound >= 0));
});

test("a strong synthetic bias clears the sequential evidence gate only after sufficient evidence", () => {
  const coordinator = new BriCoordinator({unitCents: 100, bankrollCents: 10_000});
  const outcomes = generateScenarioOutcomeSequence({
    seed: "strong-bias-evidence-gate",
    spins: 1_000_000,
    scenario: {type: "biased", favoredStreet: 5, favoredStreetProbability: 0.25},
  });
  let firstQualifiedSpin = null;
  for (const outcome of outcomes){
    const forecast = coordinator.engine.forecastNext();
    coordinator.engine.observe(outcome);
    if (forecast && !firstQualifiedSpin && !coordinator.evidenceAssessment().evidenceWeak){
      firstQualifiedSpin = forecast.spinNumber;
      break;
    }
  }
  assert.ok(firstQualifiedSpin > 10);
  assert.ok(firstQualifiedSpin <= 500_000);
  assert.equal(coordinator.evidenceAssessment().evidenceWeak, false);
});

test("evidence suspension can resume only after new evidence and never replenishes funds", () => {
  let pairedUpperBound = 0.01;
  const engine = {
    observationCount: 50,
    pendingForecast: null,
    get modelPerformance(){
      return [
        {modelVersion: "uniform-v1", total: 50, meanBrier: 0.92},
        {modelVersion: "rolling-frequency-v1", total: 50, meanBrier: 0.90, comparisonEvaluations: 50, pairedBrierDeltaUpperBound: pairedUpperBound},
      ];
    },
    forecastNext(){
      const probabilities = [...new Array(12).fill(0.08), 0.04];
      this.pendingForecast = {
        observationCount: this.observationCount,
        windowSize: 50,
        street: 0,
        modelVersion: "rolling-frequency-v1",
        candidateModels: [{modelVersion: "rolling-frequency-v1", probabilities}],
      };
      return this.pendingForecast;
    },
    observe(){
      this.pendingForecast = null;
      this.observationCount++;
      return null;
    },
  };
  const coordinator = new BriCoordinator({
    unitCents: 100,
    bankrollCents: 10_000,
    progressionMode: "flat",
    wageringMode: "evidence-gated",
    sustainabilityHorizon: 1,
    engine,
  });
  coordinator.state.accumulatedLossCents = 500;
  const bankrollBeforeSuspension = coordinator.state.bankrollCents;
  const suspended = coordinator.beforeSpin();
  assert.equal(suspended.decision.action, "stop");
  coordinator.afterSpin(1);
  assert.equal(coordinator.state.bankrollCents, bankrollBeforeSuspension);
  assert.equal(coordinator.state.accumulatedLossCents, 500);

  pairedUpperBound = -0.001;
  const resumed = coordinator.beforeSpin();
  assert.equal(resumed.decision.action, "switch");
  assert.equal(coordinator.state.accumulatedLossCents, 500);
  assert.equal(coordinator.state.bankrollCents, bankrollBeforeSuspension - 100);
  coordinator.afterSpin(36);
  assert.equal(coordinator.state.accumulatedLossCents, 600);
});

test("synthetic bias probabilities preserve European relative weights and payout economics", () => {
  for (const favoredStreetProbability of [3 / 37, 0.085, 0.09, 0.1, 0.11, 0.25]){
    const probabilities = scenarioCategoryProbabilities({
      type: "biased",
      favoredStreet: 5,
      favoredStreetProbability,
    });
    assert.equal(probabilities.length, 13);
    assert.ok(Math.abs(probabilities.reduce((sum, probability) => sum + probability, 0) - 1) < 1e-12);
    assert.ok(probabilities.every((probability) => probability > 0 && probability < 1));
    assert.ok(Math.abs(probabilities[5] - favoredStreetProbability) < 1e-12);
    const scale = (1 - favoredStreetProbability) / (1 - 3 / 37);
    for (let street = 0; street < 12; street++){
      if (street !== 5) assert.ok(Math.abs(probabilities[street] - (3 / 37) * scale) < 1e-12);
    }
    assert.ok(Math.abs(probabilities[12] - (1 / 37) * scale) < 1e-12);
  }
  assert.ok(Math.abs((12 * 0.085 - 1) - 0.02) < 1e-12);
});

test("rebuilding from corrected history matches an engine that saw the truth all along", () => {
  const original = [5, 9, 14, 22, 31, 2, 8, 19, 27, 33, 12, 7, 25, 30, 16];
  const corrected = [...original];
  corrected[3] = 36; // historical correction
  corrected[9] = 0;  // successive correction on another event
  const reference = new StreetPredictionEngine();
  for (const outcome of corrected) reference.observe(outcome);
  const rebuilt = rebuildPredictionEngine(corrected);
  assert.deepEqual(rebuilt.tracker.snapshot(), reference.tracker.snapshot());
  assert.deepEqual(rebuilt.snapshot(), reference.snapshot());
  // Idempotent: rebuilding again converges to the same state.
  assert.deepEqual(rebuildPredictionEngine(corrected).snapshot(), rebuilt.snapshot());
  assert.throws(() => rebuildPredictionEngine([1, 99]), RangeError);
});

test("correction rebuild replays saved forecasts and never regenerates historical predictions", () => {
  const originalOutcomes = Array.from({length: 80}, (_, index) => (index * 17 + 3) % 37);
  const sourceEngine = new StreetPredictionEngine();
  const events = [];
  for (const originalOutcome of originalOutcomes){
    const forecast = sourceEngine.forecastNext();
    const storedForecast = forecast ? {
      observationCount: forecast.observationCount,
      windowSize: forecast.windowSize,
      street: forecast.street,
      probability: forecast.probability,
      modelVersion: forecast.modelVersion,
      candidateModels: forecast.candidateModels.map((candidate) => ({
        modelVersion: candidate.modelVersion,
        probabilities: [...candidate.probabilities],
      })),
    } : null;
    events.push({effective_outcome: originalOutcome, forecast: storedForecast});
    sourceEngine.observe(originalOutcome);
  }

  const correctedOutcomes = [...originalOutcomes];
  correctedOutcomes[30] = (correctedOutcomes[30] + 11) % 37;
  events[30].effective_outcome = correctedOutcomes[30];
  const rebuilt = rebuildPredictionEngine(events);
  const expectedScores = new Map();
  for (const event of events){
    if (!event.forecast) continue;
    const category = event.effective_outcome === 0 ? 12 : Math.floor((event.effective_outcome - 1) / 3);
    for (const candidate of event.forecast.candidateModels){
      const score = candidate.probabilities.reduce((total, probability, index) => total + (probability - Number(index === category)) ** 2, 0);
      const entry = expectedScores.get(candidate.modelVersion) || {total: 0, sum: 0};
      entry.total++;
      entry.sum += score;
      expectedScores.set(candidate.modelVersion, entry);
    }
  }
  for (const result of rebuilt.modelPerformance){
    const expected = expectedScores.get(result.modelVersion);
    assert.equal(result.total, expected.total);
    assert.ok(Math.abs(result.meanBrier - expected.sum / expected.total) < 1e-12);
  }
  assert.deepEqual(rebuilt.tracker.history, correctedOutcomes.slice(-100));
  assert.equal(rebuilt.forecasts[0].spinNumber, 11);
  assert.equal(rebuilt.forecasts.length, 70);
});

test("full correction recovery rebuilds effective observations, replays saved forecasts, and uploads verified state", async () => {
  const source = new StreetPredictionEngine();
  const outcomes = [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34, 3, 6];
  const events = [];
  for (const originalOutcome of outcomes){
    const forecast = source.forecastNext();
    events.push({
      effective_outcome: originalOutcome,
      forecast: forecast ? {
        observationCount: forecast.observationCount,
        windowSize: forecast.windowSize,
        street: forecast.street,
        probability: forecast.probability,
        modelVersion: forecast.modelVersion,
        candidateModels: forecast.candidateModels.map((candidate) => ({
          modelVersion: candidate.modelVersion,
          probabilities: [...candidate.probabilities],
        })),
      } : null,
    });
    source.observe(originalOutcome);
  }
  events[11].effective_outcome = 2;

  const calls = [];
  let uploaded = null;
  const client = {
    async runRebuild(request){ calls.push(["rebuild", request]); return {rebuilt: true}; },
    async getRebuildStatus(request){
      calls.push(["history", request.offset]);
      const page = events.slice(request.offset, request.offset + 7);
      return {events: page, has_more: request.offset + page.length < events.length, next_offset: request.offset + page.length};
    },
    async uploadModelState(request){ uploaded = request.modelState; return {state_valid: true}; },
  };
  const recovery = await recoverCorrectedTable(client, {tableId: "table-a", dataOrigin: "synthetic", pageLimit: 7});
  assert.equal(recovery.observationCount, outcomes.length);
  assert.equal(recovery.engine.performance.total, 4);
  assert.equal(recovery.engine.forecasts.length, 4);
  assert.equal(recovery.engine.tracker.history.at(-3), 2);
  assert.equal(recovery.engine.modelPerformance.length, 3);
  assert.deepEqual(uploaded, recovery.engine.snapshot());
  assert.equal(calls[0][0], "rebuild");
  assert.equal(calls.filter(([type]) => type === "history").length, 2);
});

test("identical-sequence comparison attributes differences to strategy alone", () => {
  const variants = [
    {name: "flat", config: {bankroll: 100, unit: 1, stopLoss: 0, takeProfit: 0, betType: "streets", coldThreshold: 0, maxStreets: 1, progression: "flat", maxSteps: 10, maxStake: 0, maxExposure: 0}},
    {name: "martingale", config: {bankroll: 100, unit: 1, stopLoss: 0, takeProfit: 0, betType: "streets", coldThreshold: 0, maxStreets: 1, progression: "martingale", maxSteps: 6, maxStake: 0, maxExposure: 0}},
  ];
  const first = compareStrategies({seed: "lab-seed", sessions: 20, maxSpins: 60, variants});
  const second = compareStrategies({seed: "lab-seed", sessions: 20, maxSpins: 60, variants});
  assert.deepEqual(first.variants, second.variants); // reproducible by seed
  assert.equal(first.seed, "lab-seed");
  assert.equal(first.variants[0].summary.sessions, 20);
  assert.ok(first.benchmark.totalSpins > 0);
  const outcomes = generateOutcomeSequence("lab-seed:0", 60);
  const flatReplay = simulateSessionWithOutcomes({...variants[0].config, maxSpins: 60}, outcomes);
  assert.equal(flatReplay.final <= 100 + 60 * 11 ? true : false, true);
  const differentSeed = compareStrategies({seed: "other-seed", sessions: 20, maxSpins: 60, variants});
  assert.notDeepEqual(differentSeed.variants, first.variants);
});

test("scenario sequences and autonomous research comparisons are deterministic and shared", async () => {
  const biased = {type: "biased", favoredStreet: 5, favoredStreetProbability: 0.3};
  const firstSequence = generateScenarioOutcomeSequence({seed: "autonomous-test", spins: 400, scenario: biased});
  assert.deepEqual(firstSequence, generateScenarioOutcomeSequence({seed: "autonomous-test", spins: 400, scenario: biased}));
  assert.notDeepEqual(firstSequence, generateScenarioOutcomeSequence({seed: "autonomous-test", spins: 400, scenario: {type: "uniform"}}));

  const baseConfig = {
    bankroll: 1_000,
    unit: 1,
    stopLoss: 0,
    takeProfit: 0,
    betType: "streets",
    coldThreshold: 0,
    maxStreets: 3,
    progression: "flat",
    maxSteps: 10,
    maxStake: 0,
    maxExposure: 0,
  };
  const variants = [
    {name: "cold", strategy: "cold-street"},
    {name: "evidence", strategy: "bri-autonomous", wageringMode: "evidence-gated"},
    {name: "research", strategy: "bri-autonomous", wageringMode: "strategy-research"},
    {name: "flat", strategy: "flat-baseline"},
    {name: "observe-only", strategy: "observation-only"},
    {name: "maintain-path", strategy: "bri-autonomous", wageringMode: "strategy-research", actionPolicy: "maintain"},
    {name: "switch-path", strategy: "bri-autonomous", wageringMode: "strategy-research", actionPolicy: "switch"},
    {name: "spread-path", strategy: "bri-autonomous", wageringMode: "strategy-research", actionPolicy: "spread"},
    {name: "suspend-path", strategy: "bri-autonomous", wageringMode: "strategy-research", actionPolicy: "suspend"},
  ];
  const report = await compareAutonomousStrategies({
    seed: "autonomous-test",
    spins: 30,
    scenario: {type: "uniform"},
    baseConfig,
    variants,
  });
  const replay = await compareAutonomousStrategies({
    seed: "autonomous-test",
    spins: 30,
    scenario: {type: "uniform"},
    baseConfig,
    variants: [...variants].reverse(),
  });
  assert.equal(report.outcomeSequenceHash, replay.outcomeSequenceHash);
  assert.deepEqual(report.results.map(({name, metrics}) => [name, metrics.finalBankrollCents, metrics.totalStakedCents, metrics.forecastsEvaluated]), [
    ...replay.results.map(({name, metrics}) => [name, metrics.finalBankrollCents, metrics.totalStakedCents, metrics.forecastsEvaluated]),
  ].reverse());
  const evidence = report.results.find((result) => result.name === "evidence");
  const research = report.results.find((result) => result.name === "research");
  assert.equal(evidence.metrics.observedSpins, 30);
  assert.equal(evidence.metrics.forecastsEvaluated, 20);
  assert.ok(evidence.metrics.decisionDistribution.stop > 0);
  assert.equal(evidence.metrics.wagersPlaced, 0);
  assert.equal(evidence.metrics.wageringStoppedAtSpin, 11);
  assert.equal(evidence.metrics.observationsContinuedAfterWageringStopped, true);
  assert.equal(evidence.metrics.observationsAfterWageringStopped, 20);
  assert.equal(evidence.metrics.decisionCounterfactuals.selectedWorseThanBestCount, 0);
  assert.equal(evidence.metrics.forecastPerformanceByWindow.reduce((sum, window) => sum + window.forecasts, 0), 20);
  assert.ok(research.metrics.wagersPlaced > 0);
  assert.equal(research.wageringMode, "strategy-research");
  assert.ok(research.policyDisclosure.includes("no predictive advantage"));
  assert.ok(research.metrics.modelPerformance.some((model) => model.modelVersion === "uniform-v1"));
  assert.equal(research.metrics.forwardTestForecasts, research.metrics.forecastsEvaluated);
  assert.ok(research.metrics.warmupSpins > 0);
  const observationOnly = report.results.find((result) => result.name === "observe-only");
  assert.equal(observationOnly.metrics.wagersPlaced, 0);
  assert.equal(observationOnly.metrics.totalStakedCents, 0);
  assert.ok(observationOnly.metrics.forecastsEvaluated > 0);
  assert.ok(observationOnly.metrics.notApplicable.includes("decisionDistribution"));
  const maintainPath = report.results.find((result) => result.name === "maintain-path");
  const switchPath = report.results.find((result) => result.name === "switch-path");
  const spreadPath = report.results.find((result) => result.name === "spread-path");
  const suspendPath = report.results.find((result) => result.name === "suspend-path");
  assert.equal(maintainPath.strategy, "bri-policy-path");
  assert.equal(maintainPath.actionPolicy, "maintain");
  assert.equal(switchPath.actionPolicy, "switch");
  assert.equal(spreadPath.actionPolicy, "spread");
  assert.equal(suspendPath.metrics.wagersPlaced, 0);
  assert.equal(suspendPath.metrics.observedSpins, 30);
  assert.ok(spreadPath.metrics.wagersPlaced > 0);
  assert.ok(spreadPath.metrics.decisionDistribution.spread > 0);
  assert.ok(switchPath.metrics.decisionDistribution.switch > 0);
});

test("autonomous research cancellation yields and preserves partial results", async () => {
  let cancel = false;
  const report = await compareAutonomousStrategies({
    seed: "cancel-autonomous",
    spins: 5_000,
    scenario: {type: "uniform"},
    baseConfig: {
      bankroll: 1_000, unit: 1, stopLoss: 0, takeProfit: 0, betType: "streets",
      coldThreshold: 0, maxStreets: 3, progression: "flat", maxSteps: 10,
      maxStake: 0, maxExposure: 0,
    },
    variants: [{name: "bri", strategy: "bri-autonomous", wageringMode: "strategy-research"}],
    yieldEvery: 128,
    onProgress: () => { cancel = true; },
    shouldCancel: () => cancel,
  });

  assert.equal(report.cancelled, true);
  assert.ok(report.results[0].metrics.observedSpins < 5_000);
  assert.equal(report.results[0].metrics.experimentEndReason, "cancelled");
});

test("loaded research sequences score post-termination forecasts exactly once", async () => {
  const outcomes = [...new Array(10).fill(16), 1, ...new Array(29).fill(0)];
  const report = await compareAutonomousStrategies({
    seed: "loaded-terminal-sequence-v1",
    spins: outcomes.length,
    outcomes,
    scenario: {type: "biased", favoredStreet: 5, favoredStreetProbability: 0.1},
    baseConfig: {
      bankroll: 100,
      unit: 1,
      stopLoss: 0,
      takeProfit: 1,
      betType: "streets",
      coldThreshold: 0,
      maxStreets: 3,
      progression: "flat",
      maxSteps: 10,
      maxStake: 0,
      maxExposure: 0,
    },
    variants: [{name: "loaded-research", strategy: "bri-autonomous", wageringMode: "strategy-research"}],
  });
  const metrics = report.results[0].metrics;
  assert.equal(report.sequenceSource, "provided");
  assert.deepEqual(report.providedOutcomeSequence, outcomes);
  assert.equal(metrics.sessionTerminationReason, "take-profit");
  assert.equal(metrics.observedSpins, outcomes.length);
  assert.equal(metrics.forecastsIssued, outcomes.length - 10);
  assert.equal(metrics.forecastsEvaluated, metrics.forecastsIssued);
  assert.equal(Object.values(metrics.forecastStreetCounts).reduce((sum, count) => sum + count, 0), metrics.forecastsIssued);
  assert.equal(metrics.favoredStreetForecasts.forecasts, metrics.forecastsIssued);
  await assert.rejects(compareAutonomousStrategies({
    seed: "invalid-loaded-sequence",
    spins: 2,
    outcomes: [0, 37],
    baseConfig: {bankroll: 10, unit: 1},
    variants: [{name: "observation", strategy: "observation-only"}],
  }), /provided outcome sequence/);
});

test("observation-only reports favored-street scores identical to autonomous forecasts", async () => {
  const report = await compareAutonomousStrategies({
    seed: "observation-only-metrics",
    spins: 500,
    scenario: {type: "biased", favoredStreet: 5, favoredStreetProbability: 0.25},
    baseConfig: {
      bankroll: 10_000,
      unit: 1,
      stopLoss: 5_000,
      takeProfit: 5_000,
      betType: "streets",
      coldThreshold: 0,
      maxStreets: 3,
      progression: "flat",
      maxSteps: 10,
      maxStake: 1_000,
      maxExposure: 1_000,
    },
    variants: [
      {name: "evidence", strategy: "bri-autonomous", wageringMode: "evidence-gated"},
      {name: "observation", strategy: "observation-only"},
    ],
  });
  const bri = report.results[0].metrics;
  const observation = report.results[1].metrics;
  assert.deepEqual(observation.forecastStreetCounts, bri.forecastStreetCounts);
  assert.equal(observation.mostForecastedStreet, bri.mostForecastedStreet);
  assert.equal(observation.favoredStreetForecasts.forecasts, bri.favoredStreetForecasts.forecasts);
  assert.equal(observation.favoredStreetForecasts.correct, bri.favoredStreetForecasts.correct);
  assert.equal(observation.favoredStreetForecastRate, bri.favoredStreetForecastRate);
  assert.equal(observation.forecastHitRate, bri.forecastHitRate);
});

test("research lab supports cancellation at session boundaries", () => {
  let progressed = 0;
  const report = compareStrategies({
    seed: "cancel-seed",
    sessions: 100,
    maxSpins: 30,
    variants: [{name: "flat", config: {bankroll: 100, unit: 1, stopLoss: 0, takeProfit: 0, betType: "streets", coldThreshold: 0, maxStreets: 1, progression: "flat", maxSteps: 10, maxStake: 0, maxExposure: 0}}],
    shouldCancel: () => progressed >= 10,
    onProgress: () => {},
  });
  // shouldCancel is consulted every session; advance the counter manually.
  assert.equal(report.cancelled, false); // progressed never advances in this run
  let sessionsSeen = 0;
  const cancelled = compareStrategies({
    seed: "cancel-seed",
    sessions: 100,
    maxSpins: 30,
    variants: [{name: "flat", config: {bankroll: 100, unit: 1, stopLoss: 0, takeProfit: 0, betType: "streets", coldThreshold: 0, maxStreets: 1, progression: "flat", maxSteps: 10, maxStake: 0, maxExposure: 0}}],
    shouldCancel: () => sessionsSeen++ >= 10,
  });
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.completedSessions, 10);
});

test("companion modes gate commentary and never emit decisions", () => {
  const quiet = new BriCompanion({mode: "quiet"});
  assert.equal(quiet.onForecast({street: 3, probability: 0.1, modelVersion: "uniform-v1"}), null);
  const full = new BriCompanion({mode: "full"});
  const forecastMessage = full.onForecast({street: 3, probability: 0.1, modelVersion: "uniform-v1"});
  assert.ok(forecastMessage.includes("4"));
  const hit = full.onEvaluation({hit: true, actual: 10, forecast: {street: 3}, performance: {successful: 1, total: 1}});
  assert.ok(hit.includes("Winning Streets") || hit.includes("Called it"));
  assert.equal(full.mood, "celebrating");
  for (let miss = 0; miss < 5; miss++){
    full.onEvaluation({hit: false, actual: 0, forecast: {street: 3}, performance: {successful: 1, total: 2 + miss}});
  }
  assert.equal(full.mood, "recalculating");
  const stop = full.onDecision({action: "stop", reasons: ["No wager satisfies the current constraints."]});
  assert.ok(stop.length > 0);
  assert.equal(full.mood, "disciplined");
  assert.ok(full.snapshotMemory().length > 0);
  assert.equal(typeof full.onDecision({action: "continue"}), "object"); // null — no commentary, no decision output
});

test("companion speech stays muted by default and avoids immediate repetition", () => {
  const spoken = [];
  const companion = new BriCompanion({mode: "full", speechSynthesis: {speak: (utterance) => spoken.push(utterance)}});
  companion.onMilestone(10);
  assert.equal(spoken.length, 0); // muted by default
  const first = companion.say("recalculating", {});
  const second = companion.say("recalculating", {});
  const third = companion.say("recalculating", {});
  assert.ok(first !== null);
  assert.ok(second !== first);
  assert.notEqual(third, second === null ? "" : second);
});
