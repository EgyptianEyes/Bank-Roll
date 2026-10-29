import assert from "node:assert/strict";
import test from "node:test";
import {EUROPEAN_STREET_PROBABILITY, toMinorUnits} from "../../src/core/mathematics.js";
import {mulberry32, xfnv1a} from "../../src/core/random.js";
import {isBlack, isRed, spinNumber, streetOf} from "../../src/core/roulette.js";
import {canPlaceWager, settleWager} from "../../src/bankroll/accounting.js";
import {StreetTracker} from "../../src/observation/street-tracker.js";
import {StreetPredictionEngine} from "../../src/intelligence/prediction-engine.js";
import {simulateSession} from "../../src/simulation/research-engine.js";
import {completeSession, createSessionState, prepareSessionSpin, settleSessionSpin} from "../../src/simulation/session-engine.js";
import {LiveSessionEngine} from "../../src/simulation/live-engine.js";
import {stakeForStep} from "../../src/strategies/progression.js";
import {createWager} from "../../src/strategies/strategy-engine.js";
import {bindSimulationControls} from "../../src/ui/controls.js";
import {RouletteBoard} from "../../src/ui/roulette-board.js";
import {computeSessionStatistics} from "../../src/observation/statistics.js";
import {ResearchClient, resolveTrustedApiBase} from "../../src/storage/research-client.js";

function config(overrides = {}){
  return {
    bankroll: 100,
    unit: 1,
    maxSpins: 20,
    stopLoss: 0,
    takeProfit: 0,
    betType: "streets",
    coldThreshold: 0,
    maxStreets: 1,
    progression: "flat",
    maxSteps: 10,
    ...overrides,
  };
}

test("European roulette mapping handles zero, street edges and colours", () => {
  assert.equal(streetOf(0), null);
  assert.equal(streetOf(1), 0);
  assert.equal(streetOf(3), 0);
  assert.equal(streetOf(4), 1);
  assert.equal(streetOf(36), 11);
  assert.equal(isRed(1), true);
  assert.equal(isBlack(2), true);
});

test("spin mapping assigns each unit-interval bucket to exactly one European outcome", () => {
  for (let outcome = 0; outcome < 37; outcome++){
    const midpoint = (outcome + 0.5) / 37;
    assert.equal(spinNumber(() => midpoint), outcome);
  }
  assert.equal(spinNumber(() => 0), 0);
  assert.equal(spinNumber(() => 1 - Number.EPSILON), 36);
});

test("Mulberry32 resumes from its reported state and remains deterministic", () => {
  const states = [];
  const random = mulberry32(0x12345678, (state) => states.push(state));
  random();
  const resumeState = states.at(-1);
  const uninterruptedNext = random();
  const resumedNext = mulberry32(resumeState)();
  const repeatedNext = mulberry32(0x12345678)();

  assert.equal(resumedNext, uninterruptedNext);
  assert.notEqual(repeatedNext, uninterruptedNext);
  assert.equal(states.length, 2);
});

test("street wagers use integer pence and standard gross payout", () => {
  const wager = createWager(config({unit: 0.2, maxStreets: 2}), 1, new Array(12).fill(0));
  assert.equal(wager.totalStakeCents, toMinorUnits(0.4));
  const settlement = settleWager(wager, 1);
  assert.equal(settlement.grossReturnCents, 240);
  assert.equal(settlement.netChangeCents, 200);
  assert.equal(settleWager(wager, 0).grossReturnCents, 0);
  assert.deepEqual(settleWager({kind: "redblack", color: "red", totalStakeCents: 100}, 1), {
    hit: true,
    grossReturnCents: 200,
    netChangeCents: 100,
  });
  assert.equal(settleWager({kind: "dozens", dozen: 0, totalStakeCents: 100}, 12).grossReturnCents, 300);
  assert.equal(settleWager({kind: "redblack", color: "red", totalStakeCents: 100}, 0).hit, false);
  assert.equal(canPlaceWager(100, wager, {maxExposureCents: 30}).reason, "maximum exposure");
});

test("progression calculators preserve configured flat, linear and Fibonacci steps", () => {
  assert.equal(stakeForStep(4, "flat"), 1);
  assert.equal(stakeForStep(4, "linear"), 4);
  assert.equal(stakeForStep(5, "fibo"), 5);
  assert.equal(stakeForStep(5, "martingale"), 16);
});

test("street tracker retains zero in its sample and updates absence statistics", () => {
  const tracker = new StreetTracker();
  tracker.record(0);
  tracker.record(1);
  tracker.record(2);
  assert.equal(tracker.count, 3);
  assert.equal(tracker.statistics()[0].appearances, 2);
  assert.equal(tracker.statistics()[0].consecutiveAppearances, 2);
  assert.equal(tracker.windowCounts(2).observationCount, 2);
  assert.throws(() => tracker.record(37), RangeError);
});

test("prediction begins before spin eleven and records an immutable, scored forecast", () => {
  const engine = new StreetPredictionEngine();
  for (let outcome = 1; outcome <= 9; outcome++){
    engine.observe(outcome);
    assert.equal(engine.forecastNext(), null);
  }
  engine.observe(10);
  const forecast = engine.forecastNext();
  assert.equal(forecast.spinNumber, 11);
  assert.equal(Object.isFrozen(forecast), true);
  assert.equal(forecast.modelVersion, "uniform-v1");
  assert.equal(forecast.probability, EUROPEAN_STREET_PROBABILITY);
  const rollingModel = forecast.candidateModels.find((model) => model.modelVersion === "rolling-frequency-v1");
  assert.equal(rollingModel.probabilities[0], (3 + 3) / (10 + 37));
  assert.equal(EUROPEAN_STREET_PROBABILITY, 3 / 37);
  assert.throws(() => engine.forecastNext(), /pending forecast/);
  const evaluation = engine.observe(2);
  assert.equal(evaluation.hit, true);
  assert.equal(evaluation.modelResults.length, 3);
  assert.equal(engine.performance.successful, 1);
  assert.equal(forecast.actual, undefined);
  assert.throws(() => engine.observe(37), RangeError);
});

test("an uncommitted forecast can be cancelled and reissued before its outcome", () => {
  const engine = new StreetPredictionEngine();
  for (let outcome = 1; outcome <= 10; outcome++) engine.observe(outcome);
  assert.equal(engine.forecastNext().spinNumber, 11);
  assert.equal(engine.cancelPendingForecast(), true);
  assert.equal(engine.forecasts.length, 0);
  assert.equal(engine.forecastNext().spinNumber, 11);
});

test("prediction engine advances its rolling window without losing longer history", () => {
  const engine = new StreetPredictionEngine();
  for (let index = 0; index < 120; index++){
    if (engine.observationCount >= 10) engine.forecastNext();
    engine.observe(index % 37);
  }
  assert.equal(engine.observationCount, 120);
  assert.equal(engine.tracker.history.length, 100);
  assert.equal(engine.tracker.windowCounts(100).observationCount, 100);
});

test("street tracker snapshots restore long-term counts with a bounded rolling history", () => {
  const first = new StreetTracker();
  for (let index = 0; index < 250; index++) first.record(index % 37);
  const restored = new StreetTracker().restore(first.snapshot());
  assert.equal(restored.count, 250);
  assert.equal(restored.history.length, 100);
  assert.deepEqual(restored.statistics(), first.statistics());
  restored.record(4);
  assert.equal(restored.count, 251);
  assert.throws(() => restored.restore({version: 9}), TypeError);
});

test("prediction engine restores compact model evidence and continues forecasting at the correct spin", () => {
  const first = new StreetPredictionEngine();
  for (let spin = 1; spin <= 40; spin++){
    const forecast = first.forecastNext();
    if (forecast) first.observe(spin % 37);
    else first.observe(spin % 37);
  }
  const restored = new StreetPredictionEngine().restore(first.snapshot());
  assert.equal(restored.observationCount, 40);
  assert.equal(restored.performance.total, first.performance.total);
  assert.deepEqual(restored.modelPerformance, first.modelPerformance);
  assert.equal(restored.forecastNext().spinNumber, 41);
});

test("prequential Brier scores identify a persistent synthetic street bias", () => {
  const engine = new StreetPredictionEngine({minimumModelEvaluations: 25});
  for (let index = 0; index < 10; index++) engine.observe(1);
  assert.equal(engine.forecastNext().modelVersion, "uniform-v1");
  engine.observe(1);

  for (let index = 0; index < 25; index++){
    engine.forecastNext();
    engine.observe(1);
  }
  const scores = Object.fromEntries(engine.modelPerformance.map((model) => [model.modelVersion, model.meanBrier]));
  assert.ok(scores["rolling-frequency-v1"] < scores["uniform-v1"]);
  assert.equal(engine.forecastNext().modelVersion, "rolling-frequency-v1");
});

test("extracted session statistics retain totals and return neutral empty summaries", () => {
  const result = computeSessionStatistics({bankroll: 100}, [
    {final: 110, pl: 10},
    {final: 90, pl: -10},
  ]);
  assert.equal(result.totalProfitLoss, 0);
  assert.equal(result.totalStartingBankroll, 200);
  assert.equal(result.median, 100);
  assert.equal(result.winRate, 0.5);
  assert.deepEqual(computeSessionStatistics({bankroll: 100}, []).best, 0);
});

test("research client uses relative API paths, authenticated requests, and safe error handling", async () => {

  test("browser BRI API URLs cannot send bearer tokens to another origin or insecure hosts", () => {
    assert.equal(resolveTrustedApiBase("server/api/v1/", "https://bank-roll.uk/"), "https://bank-roll.uk/server/api/v1/");
    assert.equal(resolveTrustedApiBase("/server/api/v1/", "http://127.0.0.1:8000/"), "http://127.0.0.1:8000/server/api/v1/");
    assert.throws(() => resolveTrustedApiBase("https://attacker.example/api/", "https://bank-roll.uk/"), /same-origin/);
    assert.throws(() => resolveTrustedApiBase("https://user:pass@bank-roll.uk/api/", "https://bank-roll.uk/"), /same-origin/);
    assert.throws(() => resolveTrustedApiBase("/server/api/v1/", "http://bank-roll.uk/"), /requires HTTPS/);
  });
  const requests = [];
  const store = new Map();
  const storage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  };
  const client = new ResearchClient({
    baseUrl: "https://research.example.test/server/api/v1/",
    token: "brp_test-token",
    storage,
    fetchImpl: async (url, options) => {
      requests.push({url: String(url), options});
      return {ok: true, status: 201, json: async () => ({created: true})};
    },
  });
  await client.recordForecast({prediction_id: "prediction"});
  assert.equal(requests[0].url, "https://research.example.test/server/api/v1/forecasts.php");
  assert.equal(requests[0].options.headers.get("Authorization"), "Bearer brp_test-token");
  assert.deepEqual(JSON.parse(requests[0].options.body), {prediction_id: "prediction"});
  await client.listIntegrityChallenges();
  assert.match(requests[1].url, /integrity-challenges\.php\?limit=20$/);
  await client.getCorrectionHistory("event-id");
  assert.match(requests[2].url, /corrections\.php\?event_id=event-id$/);
  await client.getSharedAggregates("cohort-id");
  assert.match(requests[3].url, /shared-aggregates\.php\?cohort_id=cohort-id$/);
  assert.throws(() => client.getSharedAggregates(), /explicit shared cohort ID/);
  await client.setActiveTable("table-id");
  assert.equal(requests[4].url, "https://research.example.test/server/api/v1/tables.php");
  assert.equal(requests[4].options.method, "PUT");
  assert.deepEqual(JSON.parse(requests[4].options.body), {table_id: "table-id"});
  assert.throws(() => client.setActiveTable(), /owned table ID/);
  await client.createTable({id: "new-table", name: "New table", tableType: "simulated"});
  assert.equal(requests[5].options.method, "POST");
  assert.deepEqual(JSON.parse(requests[5].options.body), {
    table_id: "new-table",
    table_name: "New table",
    table_type: "simulated",
    shared_cohort_id: null,
  });
  const queued = await client.appendObservations({session_id: "session", outcomes: []});
  assert.deepEqual(queued, {stored: true, queued: false});
  assert.deepEqual(JSON.parse(store.get("bank-roll-bri-outbox")), []);

  let online = false;
  const offlineClient = new ResearchClient({
    baseUrl: "https://research.example.test/server/api/v1/",
    token: "brp_test-token",
    storage,
    outboxKey: "offline-queue",
    fetchImpl: async (url, options) => {
      if (!online) throw new Error("offline");
      requests.push({url: String(url), options});
      return {ok: true, status: 201, json: async () => ({created: true})};
    },
  });
  const queuedForecast = await offlineClient.recordForecast({prediction_id: "queued-first"});
  const queuedDecision = await offlineClient.recordDecision({decision_id: "decision", action: "stop"});
  await offlineClient.appendObservations({session_id: "session", spin_number: 11});
  assert.equal(queuedForecast.queued, true);
  assert.equal(queuedDecision.queued, true);
  assert.deepEqual(JSON.parse(store.get("offline-queue")).map((item) => item.type), ["forecast", "decision", "observations"]);
  online = true;
  await offlineClient.flushOutbox();
  assert.deepEqual(requests.slice(-3).map((request) => request.url.split("/").at(-1)), ["forecasts.php", "decisions.php", "observations.php"]);

  const failingClient = new ResearchClient({
    baseUrl: "https://research.example.test/server/api/v1/",
    fetchImpl: async () => ({ok: false, status: 409, json: async () => ({error: "Forecast conflict."})}),
  });
  await assert.rejects(() => failingClient.appendObservations({}), /Forecast conflict/);
});

test("research sessions enforce stop-loss and produce reproducible outcomes", () => {
  const stopLoss = simulateSession(config({
    betType: "redblack",
    maxSpins: 5,
    stopLoss: 1,
  }), () => 2.5 / 37);
  assert.equal(stopLoss.reason, "stop-loss");
  assert.equal(stopLoss.final, 99);

  const run = () => simulateSession(config(), mulberry32(xfnv1a("research-seed")));
  assert.deepEqual(run(), run());
});

test("live and research orchestration share identical seeded session results", () => {
  const settings = config({maxSpins: 80, progression: "linear", maxSteps: 6, maxStreets: 2});
  const seed = xfnv1a("live-research-parity");
  const random = mulberry32(seed);
  const state = createSessionState(settings);
  while (state.spins < settings.maxSpins && !state.stopReason){
    const prepared = prepareSessionSpin(settings, state);
    if (prepared.action === "stop") break;
    settleSessionSpin(state, prepared.wager, Math.floor(random() * 37));
  }
  const liveResult = completeSession(settings, state);
  const researchResult = simulateSession(settings, mulberry32(seed));
  for (const key of ["final", "pl", "spins", "reason", "totalStaked", "totalReturned", "maxStake", "maximumDrawdown"]){
    assert.equal(liveResult[key], researchResult[key], `${key} should match`);
  }
});

test("live session engine separates preparation from outcome and resumes deterministically", () => {
  const settings = config({maxSpins: 20});
  const firstRandom = mulberry32(xfnv1a("live-resume"));
  const firstPart = new LiveSessionEngine(settings, firstRandom);
  for (let spin = 0; spin < 7; spin++){
    const preview = firstPart.previewNextSpin();
    assert.equal(preview.spinNumber, spin + 1);
    assert.equal(firstPart.spins, spin);
    const prepared = firstPart.prepareNextSpin();
    assert.equal(prepared.spinNumber, spin + 1);
    assert.equal(prepared.action, preview.action);
    firstPart.resolveSpin(prepared);
  }
  const savedState = firstPart.snapshot();
  const uninterrupted = new LiveSessionEngine(settings, mulberry32(xfnv1a("live-resume")));
  for (let spin = 0; spin < settings.maxSpins; spin++){
    const prepared = uninterrupted.prepareNextSpin();
    uninterrupted.resolveSpin(prepared);
  }
  const resumedRandom = mulberry32(xfnv1a("live-resume"));
  for (let spin = 0; spin < 7; spin++) resumedRandom();
  const resumed = new LiveSessionEngine(settings, resumedRandom, savedState);
  for (let spin = 7; spin < settings.maxSpins; spin++){
    const prepared = resumed.prepareNextSpin();
    resumed.resolveSpin(prepared);
  }
  assert.equal(resumed.result.final, uninterrupted.result.final);
  assert.equal(resumed.result.spins, uninterrupted.result.spins);
  assert.equal(resumed.result.totalStaked, uninterrupted.result.totalStaked);
  assert.equal(savedState.spins, 7);
});

test("Run/Stop and Reset controls dispatch safely through explicit callbacks", () => {
  const listeners = new Map();
  const button = () => ({
    addEventListener(type, listener){ listeners.set(`${this.name}:${type}`, listener); },
    removeEventListener(type){ listeners.delete(`${this.name}:${type}`); },
    click(){ listeners.get(`${this.name}:click`)?.(); },
  });
  const runButton = Object.assign(button(), {name: "run"});
  const resetButton = Object.assign(button(), {name: "reset"});
  const events = [];
  let confirm = true;
  const controls = bindSimulationControls({
    runButton,
    resetButton,
    onStart: () => events.push("start"),
    onStop: () => events.push("stop"),
    onReset: () => events.push("reset"),
    confirmReset: () => confirm,
  });

  runButton.click();
  controls.setRunning(true);
  runButton.click();
  resetButton.click();
  controls.setRunning(false);
  confirm = false;
  resetButton.click();
  confirm = true;
  resetButton.click();
  controls.dispose();

  assert.deepEqual(events, ["start", "stop", "reset"]);
  assert.equal(listeners.size, 0);
});

test("roulette board keeps its original 3x12 order, chip layer and highlights", () => {
  class Element{
    constructor(){
      this.children = [];
      this.style = {};
      this.textContent = "";
      this.className = "";
      this.classNames = new Set();
      this.classList = {
        add: (...names) => names.forEach((name) => this.classNames.add(name)),
        remove: (...names) => names.forEach((name) => this.classNames.delete(name)),
        contains: (name) => this.classNames.has(name),
      };
    }
    set innerHTML(value){
      if (value === "") this.children = [];
    }
    appendChild(child){ this.children.push(child); }
    append(...children){ this.children.push(...children); }
  }
  const previousDocument = globalThis.document;
  globalThis.document = {createElement: () => new Element()};
  try {
    const container = new Element();
    const board = new RouletteBoard(container, {
      isRed: (number) => [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].includes(number),
      streetOf,
      fromMinorUnits: (value) => value / 100,
    });
    board.build();
    assert.deepEqual(container.children[1].children.slice(0, 12).map((cell) => cell.textContent), [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36].map(String));
    assert.equal(container.children[2].children.length, 12);
    assert.equal(container.children[2].children[11].style.gridColumn, "12");
    board.updateBets({kind: "streets", chosen: [0], stakeUnits: 1, perStreetStakeCents: 20});
    assert.equal(container.children[2].children[0].children[0].children[0].textContent, "20p");
    board.highlightWinningNumber(4);
    assert.equal(board.numberCells[4].classList.contains("winner"), true);
    assert.equal(board.numberCells[4].classList.contains("street-winner"), true);
    board.reset();
    assert.equal(board.numberCells[4].classList.contains("winner"), false);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});