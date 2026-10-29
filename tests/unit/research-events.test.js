import assert from "node:assert/strict";
import test from "node:test";
import {ResearchEventStream} from "../../src/intelligence/research-events.js";
import {createResearchSnapshot} from "../../src/intelligence/research-snapshot.js";
import {StreetPredictionEngine} from "../../src/intelligence/prediction-engine.js";

function eventSnapshot(observationCount, overrides = {}){
  return {
    datasetId: "test-dataset",
    dataOrigin: "synthetic",
    observationCount,
    outcome: observationCount % 37,
    updatedAt: "2026-10-29T12:00:00.000Z",
    ...overrides,
  };
}

test("research snapshot reports all street counts and number frequency from the current dataset", () => {
  const engine = new StreetPredictionEngine();
  let latestEvaluation = null;
  for (let outcome = 0; outcome < 37; outcome++){
    if (engine.observationCount >= 10) engine.forecastNext();
    latestEvaluation = engine.observe(outcome);
  }

  const snapshot = createResearchSnapshot(engine, {
    datasetId: "wheel-a",
    dataOrigin: "observed",
    outcome: 36,
    evaluation: latestEvaluation,
    updatedAt: "2026-10-29T12:00:00.000Z",
  });

  assert.equal(snapshot.observationCount, 37);
  assert.equal(snapshot.dataOrigin, "observed");
  assert.equal(snapshot.maturity, 37);
  assert.equal(snapshot.expectedFairStreetAppearances, 3);
  assert.deepEqual(snapshot.streets.map((street) => street.appearances), new Array(12).fill(3));
  assert.equal(snapshot.recentNumberWindow, 37);
  assert.deepEqual(snapshot.recentNumberCounts, new Array(37).fill(1));
  assert.equal(snapshot.latestForecast.spinNumber, 37);
  assert.equal(snapshot.evaluation.total, 27);
  assert.equal(snapshot.modelPerformance.length, 3);
});

test("research events deliver each observation before milestone events and bound the timeline", () => {
  const stream = new ResearchEventStream({timelineLimit: 2, clock: () => "2026-10-29T12:00:00.000Z"});
  const received = [];
  stream.subscribe((event) => received.push(event));
  for (let count = 1; count <= 100; count++) stream.publishObservation(eventSnapshot(count));

  const tenIndex = received.findIndex((event) => event.type === "observation" && event.snapshot.observationCount === 10);
  assert.equal(received[tenIndex + 1].type, "timeline");
  assert.equal(received[tenIndex + 1].entry.type, "milestone");
  assert.deepEqual(stream.timeline.map((event) => event.observationCount), [50, 100]);
  assert.equal(received.filter((event) => event.type === "observation").length, 100);
});

test("research timeline records state changes once and rejects invalid provenance", () => {
  const stream = new ResearchEventStream();
  const received = [];
  stream.subscribe((event) => received.push(event));
  stream.publishObservation(eventSnapshot(1, {latestForecast: {modelVersion: "uniform-v1"}}));
  stream.publishObservation(eventSnapshot(2, {latestForecast: {modelVersion: "rolling-v1"}}));
  stream.publishObservation(eventSnapshot(3, {
    latestForecast: {modelVersion: "rolling-v1"},
    integrity: {classification: "statistical_anomaly_candidate"},
    strategy: {action: "stop"},
  }));
  stream.publishObservation(eventSnapshot(4, {
    latestForecast: {modelVersion: "rolling-v1"},
    integrity: {classification: "statistical_anomaly_candidate"},
    strategy: {action: "stop"},
  }));

  assert.deepEqual(stream.timeline.map((event) => event.type), ["model-change", "integrity-candidate", "strategy-suspension"]);
  assert.throws(() => stream.publishObservation(eventSnapshot(5, {dataOrigin: "unknown"})), /provenance-labelled/);
  assert.equal(received.filter((event) => event.type === "observation").length, 4);
});

test("research listeners cannot interrupt an observation", () => {
  const stream = new ResearchEventStream();
  stream.subscribe(() => { throw new Error("presentation failure"); });
  assert.doesNotThrow(() => stream.publishObservation(eventSnapshot(1)));
});

test("switching datasets clears the prior timeline", () => {
  const stream = new ResearchEventStream();
  stream.publishObservation(eventSnapshot(10));
  assert.equal(stream.timeline.length, 1);

  stream.publishObservation(eventSnapshot(1, {datasetId: "separate-table"}));

  assert.equal(stream.timeline.length, 0);
  assert.equal(stream.datasetId, "separate-table");
});

test("restored model state publishes a view snapshot without recording a spin", () => {
  const engine = new StreetPredictionEngine();
  for (let outcome = 1; outcome <= 12; outcome++){
    if (engine.observationCount >= 10) engine.forecastNext();
    engine.observe(outcome);
  }
  const snapshot = createResearchSnapshot(engine, {
    datasetId: "restored-table",
    dataOrigin: "synthetic",
    outcome: engine.tracker.history.at(-1),
    updatedAt: null,
  });
  const stream = new ResearchEventStream();
  const received = [];
  stream.subscribe((event) => received.push(event));

  stream.publishSnapshot(snapshot);

  assert.equal(received.filter((event) => event.type === "observation").length, 0);
  assert.equal(received.at(-1).type, "snapshot");
  assert.equal(received.at(-1).snapshot.observationCount, 12);
  assert.equal(received.at(-1).snapshot.updatedAt, null);
  assert.equal(stream.timeline.length, 0);
});