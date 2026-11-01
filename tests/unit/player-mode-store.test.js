import assert from "node:assert/strict";
import test from "node:test";
import {IDBFactory} from "fake-indexeddb";
import {PlayerSession} from "../../src/simulation/player-session.js";
import {PlayerModeStore} from "../../src/storage/player-mode-store.js";

function createStore(){
  let id = 0;
  let timestamp = 0;
  return new PlayerModeStore({
    indexedDBFactory: new IDBFactory(),
    createId: () => `id-${++id}`,
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, timestamp++ * 31)).toISOString(),
  });
}

const settings = {
  startingBankrollCents: 10000,
  unitCents: 20,
  progressionMode: "flat",
  maxStakeCents: 500,
  maxExposureCents: 0,
  tableMaxStakeCents: 0,
  stopLossCents: 2500,
  maxSteps: 6,
  minimumModelEvaluations: 25,
  candidateCount: 3,
  sustainabilityHorizon: 3,
};

async function createPlayer(store = createStore()){
  const table = await store.createTable({name: "Physical table", venue: "Local venue", observer: "Observer A", dealer: "Dealer B", settings});
  const session = await store.startSession(table.id, settings);
  const player = await PlayerSession.create({store, table, session, engineOptions: {minimumObservations: 10}});
  return {store, table, session, player};
}

test("IndexedDB keeps physical table identity separate from resumable and new sessions", async () => {
  const store = createStore();
  const table = await store.createTable({name: "Table 8", venue: "North room", observer: "A", dealer: "B", settings});
  const first = await store.startSession(table.id, settings);
  const resumed = await store.startSession(table.id, settings);

  assert.equal(resumed.id, first.id);
  assert.equal(resumed.resumed, true);
  assert.equal((await store.getTable(table.id)).venue, "North room");
  const second = await store.startSession(table.id, settings, {newSession: true});
  assert.notEqual(second.id, first.id);
  assert.equal((await store.getSession(first.id)).status, "paused");
  assert.equal((await store.listTables()).length, 1);
});

test("only a confirmed actual wager is debited and settled in the IndexedDB session", async () => {
  const {store, table, session, player} = await createPlayer();
  await player.confirmManualStreetWager([0], 20);
  assert.equal((await store.getSession(session.id)).bankrollCents, 9980);
  await assert.rejects(store.endSession(session.id));

  const result = await player.recordOutcome(1);
  const savedSession = await store.getSession(session.id);
  const observations = await store.listObservations(table.id);
  assert.equal(result.evaluation.settlement.hit, true);
  assert.equal(savedSession.bankrollCents, 10220);
  assert.equal(savedSession.wins, 1);
  assert.equal(observations[0].actualWager.origin, "player-manual");
  assert.equal(observations[0].trustStatus, "unverified");
});

test("gap events and prepared forecasts survive persistence and restore", async () => {
  const {store, table, session, player} = await createPlayer();
  for (let outcome = 0; outcome < 10; outcome++) await player.recordOutcome(outcome);
  await player.prepareRecommendation();
  await player.confirmNoBet();
  await player.recordOutcome(10);
  await player.prepareRecommendation();
  const pending = (await store.getSession(session.id)).pendingForecast;

  const restored = await PlayerSession.create({store, table, session: await store.getSession(session.id), engineOptions: {minimumObservations: 10}});
  assert.equal(restored.engine.pendingForecast.observationCount, pending.observationCount);
  await restored.markGap({missingSpins: 2, note: "Observer returned"});
  const result = await restored.recordOutcome(12);
  assert.equal(result.record.gapBefore, true);
  assert.equal((await store.listEvents(table.id)).find((event) => event.eventType === "observation-gap").missingSpins, 2);
});

test("corrections append a revision and atomically rebuild model and session state", async () => {
  const {store, table, session, player} = await createPlayer();
  for (let outcome = 0; outcome < 10; outcome++) await player.recordOutcome(outcome);
  await player.confirmManualStreetWager([0], 20);
  await player.recordOutcome(1);
  const target = player.observations[10];
  const correction = await player.correctOutcome(target.id, 4, "Entered the wrong number");
  const refreshed = await store.listObservations(table.id);
  const savedTable = await store.getTable(table.id);
  const savedSession = await store.getSession(session.id);

  assert.equal(correction.previousOutcome, 1);
  assert.equal(refreshed[10].outcome, 1);
  assert.equal(refreshed[10].effectiveOutcome, 4);
  assert.equal(refreshed[10].corrections.length, 1);
  assert.deepEqual(savedTable.modelState, player.engine.snapshot());
  assert.equal(savedSession.bankrollCents, 9980);
  assert.equal(savedSession.losses, 1);
});
