import {mulberry32, xfnv1a} from "../core/random.js";
import {isValidOutcome} from "../core/roulette.js";
import {BriCoordinator} from "../intelligence/bri-coordinator.js";
import {createResearchSnapshot} from "../intelligence/research-snapshot.js";
import {ResearchEventStream} from "../intelligence/research-events.js";

export const TEST_MODE_TTL_MS = 24 * 60 * 60 * 1000;
export const TEST_MODE_MAX_OBSERVATIONS = 5000;
const MAX_GENERATED_BATCH = 100;

export class TestModeSession{
  constructor({createdAt = Date.now(), now = () => Date.now(), seed = `bri-test-${globalThis.crypto.randomUUID()}`, maxObservations = TEST_MODE_MAX_OBSERVATIONS, bankrollCents = 100_00, unitCents = 100, wageringMode = "evidence-gated"} = {}){
    if (!Number.isSafeInteger(createdAt) || createdAt < 0) throw new RangeError("Test session creation time must be a non-negative safe integer.");
    if (!Number.isSafeInteger(maxObservations) || maxObservations < 1 || maxObservations > TEST_MODE_MAX_OBSERVATIONS){
      throw new RangeError(`Test sessions are limited to ${TEST_MODE_MAX_OBSERVATIONS} outcomes.`);
    }
    if (typeof seed !== "string" || !seed) throw new TypeError("A test random seed is required.");
    this.id = globalThis.crypto.randomUUID();
    this.datasetId = `test:${this.id}`;
    this.sourceType = "test";
    this.dataOrigin = "synthetic";
    this.createdAt = createdAt;
    this.expiresAt = createdAt + TEST_MODE_TTL_MS;
    this.now = now;
    this.maxObservations = maxObservations;
    this.seed = seed;
    this.random = mulberry32(xfnv1a(seed));
    this.bankrollCents = bankrollCents;
    this.unitCents = unitCents;
    this.wageringMode = wageringMode;
    this.outcomes = [];
    this.decisions = [];
    this.events = new ResearchEventStream({timelineLimit: 50, clock: () => new Date(this.now()).toISOString()});
    this.ended = false;
    this.endedAt = null;
    this.coordinator = this.#createCoordinator();
    this.pending = this.coordinator.beforeSpin();
  }

  get observationCount(){
    return this.outcomes.length;
  }

  get expired(){
    return this.ended || this.now() >= this.expiresAt;
  }

  get timeRemainingMs(){
    return Math.max(0, this.expiresAt - this.now());
  }

  get prepared(){
    this.#assertActive();
    return this.pending;
  }

  recordOutcome(outcome){
    this.#assertActive();
    if (!isValidOutcome(outcome)) throw new RangeError("Test outcome must be an integer from 0 to 36.");
    if (this.outcomes.length >= this.maxObservations) throw new RangeError(`This test is limited to ${this.maxObservations.toLocaleString()} outcomes.`);
    const prepared = this.pending;
    const result = this.coordinator.afterSpin(outcome);
    this.outcomes.push(outcome);
    if (prepared.decision){
      this.decisions.push({spinNumber: prepared.spins, action: prepared.decision.action, modelVersion: prepared.forecast?.modelVersion || null});
      if (this.decisions.length > 200) this.decisions.shift();
    }
    const snapshot = createResearchSnapshot(this.coordinator.engine, {
      datasetId: this.datasetId,
      dataOrigin: this.dataOrigin,
      sourceType: this.sourceType,
      outcome,
      evaluation: result.evaluation,
      strategy: prepared,
      updatedAt: new Date(this.now()).toISOString(),
    });
    this.events.publishObservation({...snapshot, sourceType: this.sourceType});
    this.pending = this.coordinator.beforeSpin();
    return {result, snapshot, next: this.pending};
  }

  generate(count = 1){
    this.#assertActive();
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_GENERATED_BATCH){
      throw new RangeError(`Generate between 1 and ${MAX_GENERATED_BATCH} spins per batch.`);
    }
    if (this.outcomes.length + count > this.maxObservations) throw new RangeError(`This test is limited to ${this.maxObservations.toLocaleString()} outcomes.`);
    const generated = [];
    for (let index = 0; index < count; index++){
      const outcome = Math.floor(this.random() * 37);
      this.recordOutcome(outcome);
      generated.push(outcome);
    }
    return generated;
  }

  undoLast(){
    this.#assertActive();
    if (!this.outcomes.length) return false;
    this.outcomes.pop();
    this.#rebuildFromOutcomes();
    return true;
  }

  correctLast(outcome){
    this.#assertActive();
    return this.correctAt(this.outcomes.length - 1, outcome);
  }

  correctAt(index, outcome){
    this.#assertActive();
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.outcomes.length) throw new RangeError("Choose a recent test result to correct.");
    if (!isValidOutcome(outcome)) throw new RangeError("Corrected test outcome must be an integer from 0 to 36.");
    this.outcomes[index] = outcome;
    this.#rebuildFromOutcomes();
    return this.outcomes.length;
  }

  reset(){
    this.#assertActive();
    this.outcomes.length = 0;
    this.decisions.length = 0;
    this.events.reset();
    this.random = mulberry32(xfnv1a(this.seed));
    this.coordinator = this.#createCoordinator();
    this.pending = this.coordinator.beforeSpin();
  }

  discard(){
    this.outcomes.length = 0;
    this.decisions.length = 0;
    this.events.reset();
    this.ended = true;
    this.endedAt = this.now();
    this.pending = null;
    this.coordinator = null;
  }

  expireIfDue(){
    if (!this.ended && this.now() >= this.expiresAt) this.discard();
    return this.ended;
  }

  snapshot(){
    this.#assertActive();
    return createResearchSnapshot(this.coordinator.engine, {
      datasetId: this.datasetId,
      dataOrigin: this.dataOrigin,
      sourceType: this.sourceType,
      outcome: this.outcomes.at(-1),
      strategy: this.pending,
      updatedAt: this.outcomes.length ? new Date(this.now()).toISOString() : null,
    });
  }

  #createCoordinator(){
    return new BriCoordinator({
      unitCents: this.unitCents,
      bankrollCents: this.bankrollCents,
      progressionMode: "flat",
      sustainabilityHorizon: 3,
      candidateCount: 3,
      minimumModelEvaluations: 25,
      wageringMode: this.wageringMode,
      decisionHistoryLimit: 200,
      recordDecisions: true,
      engineOptions: {historyLimit: 100},
      limits: {stopLossCents: 2_500, maxStakeCents: 500, maxExposureCents: 500, maxSteps: 5},
    });
  }

  #rebuildFromOutcomes(){
    const outcomes = [...this.outcomes];
    this.outcomes.length = 0;
    this.decisions.length = 0;
    this.events.reset();
    this.coordinator = this.#createCoordinator();
    this.pending = this.coordinator.beforeSpin();
    for (const outcome of outcomes) this.recordOutcome(outcome);
  }

  #assertActive(){
    if (this.expireIfDue()) throw new Error("This temporary Test Mode session has ended or expired; its results were discarded.");
  }
}