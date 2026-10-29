import assert from "node:assert/strict";
import test from "node:test";
import {TEST_MODE_MAX_OBSERVATIONS, TEST_MODE_TTL_MS, TestModeSession} from "../../src/simulation/sandbox-session.js";

function makeSession(overrides = {}){
  let now = 1_000;
  return {
    session: new TestModeSession({createdAt: now, now: () => now, seed: "test-seed", ...overrides}),
    advance: (milliseconds) => { now += milliseconds; },
    now: () => now,
  };
}

test("test mode starts without a real-table identity and uses explicit temporary provenance", () => {
  const {session} = makeSession();
  assert.equal(session.sourceType, "test");
  assert.equal(session.dataOrigin, "synthetic");
  assert.equal(Object.hasOwn(session, "tableId"), false);
  assert.equal(session.observationCount, 0);
  assert.equal(session.createdAt, 1_000);
  assert.equal(session.expiresAt, 1_000 + TEST_MODE_TTL_MS);
});

test("manual entries accept every European outcome and run the real BRI forecast/scoring lifecycle", () => {
  const {session} = makeSession();
  for (let outcome = 0; outcome < 37; outcome++){
    const prepared = session.prepared;
    if (outcome === 10){
      assert.equal(prepared.forecast.spinNumber, 11);
      assert.ok(prepared.decision, "the BRI coordinator should make a real decision after forecast warm-up");
    }
    session.recordOutcome(outcome);
  }
  assert.equal(session.observationCount, 37);
  assert.equal(session.coordinator.engine.performance.total, 27);
  assert.equal(session.snapshot().sourceType, "test");
  assert.equal(session.snapshot().dataOrigin, "synthetic");
  assert.equal(session.coordinator.engine.tracker.statistics().reduce((sum, street) => sum + street.appearances, 0), 36);
});

test("invalid entries, overlarge batches and excessive session budgets are rejected", () => {
  const {session} = makeSession();
  assert.throws(() => session.recordOutcome(37), /0 to 36/);
  assert.throws(() => session.generate(101), /between 1 and 100/);
  assert.throws(() => new TestModeSession({maxObservations: TEST_MODE_MAX_OBSERVATIONS + 1}), /limited/);
});

test("generated spins are reproducible, synthetic and processed through BRI", () => {
  const first = makeSession().session;
  const second = makeSession().session;
  const firstOutcomes = first.generate(25);
  const secondOutcomes = second.generate(25);
  assert.deepEqual(firstOutcomes, secondOutcomes);
  assert.ok(firstOutcomes.every((outcome) => Number.isInteger(outcome) && outcome >= 0 && outcome <= 36));
  assert.equal(first.observationCount, 25);
  assert.equal(first.snapshot().sourceType, "test");
  assert.equal(first.coordinator.engine.performance.total, 15);
});

test("correction and undo replay only this temporary dataset", () => {
  const {session} = makeSession();
  session.generate(15);
  const previousCount = session.observationCount;
  session.correctLast(0);
  assert.equal(session.observationCount, previousCount);
  assert.equal(session.outcomes.at(-1), 0);
  assert.equal(session.coordinator.engine.tracker.history.at(-1), 0);
  session.undoLast();
  assert.equal(session.observationCount, previousCount - 1);
  assert.equal(session.coordinator.engine.observationCount, previousCount - 1);
});

test("activity never extends the original 24-hour expiry and expired data becomes inaccessible", () => {
  const {session, advance, now} = makeSession();
  session.generate(10);
  advance(TEST_MODE_TTL_MS - 1);
  session.recordOutcome(36);
  assert.equal(session.expiresAt, 1_000 + TEST_MODE_TTL_MS);
  advance(1);
  assert.equal(now(), session.expiresAt);
  assert.throws(() => session.snapshot(), /ended or expired/);
  assert.equal(session.expireIfDue(), true);
  assert.equal(session.outcomes.length, 0);
  assert.equal(session.coordinator, null);
});

test("ending test mode immediately discards all temporary state", () => {
  const {session} = makeSession();
  session.generate(12);
  session.discard();
  assert.equal(session.ended, true);
  assert.equal(session.outcomes.length, 0);
  assert.equal(session.decisions.length, 0);
  assert.equal(session.coordinator, null);
  assert.throws(() => session.generate(1), /ended or expired/);
});

test("reset clears results without extending the original expiry deadline", () => {
  const {session, advance} = makeSession();
  const originalExpiry = session.expiresAt;
  session.generate(20);
  advance(6 * 60 * 60 * 1000);
  session.reset();
  assert.equal(session.observationCount, 0);
  assert.equal(session.expiresAt, originalExpiry);
  assert.equal(session.timeRemainingMs, TEST_MODE_TTL_MS - 6 * 60 * 60 * 1000);
});

test("separate Test Mode instances cannot access one another's outcomes or bankroll", () => {
  const first = makeSession().session;
  const second = makeSession().session;
  first.generate(12);
  assert.notEqual(first.id, second.id);
  assert.equal(second.observationCount, 0);
  assert.equal(second.coordinator.state.bankrollCents, 10_000);
  assert.equal(first.outcomes.length, 12);
});
