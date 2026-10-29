import assert from "node:assert/strict";
import test from "node:test";
import {StreetTracker} from "../../src/observation/street-tracker.js";
import {evaluateDistributionShift, inspectCorrectionHistory, inspectObservationSequence, scoreIntegrityDetections} from "../../src/intelligence/integrity/integrity-monitor.js";
import {runFalseEntryChallenge} from "../../src/intelligence/integrity/false-entry-challenge.js";

function sequence(length, tableId = "table-a"){
  return Array.from({length}, (_, index) => ({
    eventId: `event-${index + 1}`,
    sessionId: "session-a",
    spinNumber: index + 1,
    outcome: index % 37,
    tableId,
  }));
}

test("integrity inspector flags structural contradictions but accepts valid repeats", () => {
  const repeated = sequence(8);
  repeated[4].outcome = repeated[3].outcome;
  assert.equal(inspectObservationSequence(repeated, {tableId: "table-a"}).accepted, true);

  const invalid = sequence(8);
  invalid[3].outcome = "23";
  invalid[5].eventId = invalid[4].eventId;
  invalid[6].tableId = "table-b";
  const issues = inspectObservationSequence(invalid, {tableId: "table-a"}).issues;
  assert.ok(issues.some((issue) => issue.code === "invalid_outcome"));
  assert.ok(issues.some((issue) => issue.code === "event_id_conflict"));
  assert.ok(issues.some((issue) => issue.code === "table_mismatch"));

  const gap = sequence(8).filter((event) => event.spinNumber !== 4);
  assert.ok(inspectObservationSequence(gap).issues.some((issue) => issue.code === "missing_sequence"));
  const reordered = sequence(8);
  [reordered[3], reordered[4]] = [reordered[4], reordered[3]];
  assert.ok(inspectObservationSequence(reordered).issues.some((issue) => issue.code === "out_of_order"));
});

test("blind False Entry Challenge reports verifiable errors and preserves unobservable cases", () => {
  const result = runFalseEntryChallenge();
  assert.equal(result.verifiableCases.length, 9);
  assert.equal(result.metrics.truePositives, 9);
  assert.equal(result.metrics.falsePositives, 0);
  assert.equal(result.metrics.trueNegatives, 40);
  assert.equal(result.metrics.recall, 1);
  assert.equal(result.legitimateRepeatedOutcomesAccepted, true);
  assert.equal(result.validSubstitutionClassifiedAsVerifiedError, false);
  assert.equal(result.swappedValidOutcomesClassifiedAsVerifiedError, false);
  assert.ok(result.undetectableCases.every((item) => item.flagged === false));
  assert.ok(result.undetectableCases.some((item) => item.name.includes("valid number substitution")));
});

test("False Entry Challenge is reproducible from its recorded seed", () => {
  const first = runFalseEntryChallenge({seed: "audit-seed-2026"});
  const second = runFalseEntryChallenge({seed: "audit-seed-2026"});
  assert.equal(first.seed, "audit-seed-2026");
  assert.deepEqual(first.metrics, second.metrics);
  assert.deepEqual(first.verifiableCases.map(({name, detected, latency}) => ({name, detected, latency})), second.verifiableCases.map(({name, detected, latency}) => ({name, detected, latency})));
});

test("correction history preserves originals and flags incorrect prior values", () => {
  const events = sequence(2);
  const correction = {
    correctionId: "correction-1",
    eventId: events[0].eventId,
    sessionId: events[0].sessionId,
    tableId: events[0].tableId,
    revision: 1,
    previousOutcome: events[0].outcome,
    correctedOutcome: 23,
  };
  const valid = inspectCorrectionHistory(events, [correction]);
  assert.equal(valid.accepted, true);
  assert.equal(events[0].outcome, 0);
  assert.equal(valid.effectiveOutcomes.get(events[0].eventId), 23);

  const conflict = inspectCorrectionHistory(events, [{...correction, previousOutcome: 12}]);
  assert.equal(conflict.issues[0].code, "correction_chain_conflict");
});

test("distribution shifts remain candidates rather than verified errors", () => {
  const fair = new StreetTracker();
  for (let index = 0; index < 740; index++) fair.record(index % 37);
  const fairAssessment = evaluateDistributionShift(fair, {baselineMinimum: 500, recentWindow: 100});
  assert.equal(fairAssessment.classification, "no_distribution_shift_detected");

  const changed = new StreetTracker();
  for (let index = 0; index < 600; index++) changed.record(index % 37);
  for (let index = 0; index < 100; index++) changed.record(index % 3 + 1);
  const assessment = evaluateDistributionShift(changed, {baselineMinimum: 500, recentWindow: 100});
  assert.equal(assessment.classification, "statistical_anomaly_candidate");
  assert.equal(assessment.verifiedError, false);
  assert.match(assessment.explanation, /does not prove/);
});

test("integrity metrics expose confusion counts and false-positive rate", () => {
  const metrics = scoreIntegrityDetections(["a", "b"], ["a", "c"], {controlCount: 4, latencies: {a: 1}});
  assert.deepEqual({tp: metrics.truePositives, fp: metrics.falsePositives, tn: metrics.trueNegatives, fn: metrics.falseNegatives}, {tp: 1, fp: 1, tn: 3, fn: 1});
  assert.equal(metrics.precision, 0.5);
  assert.equal(metrics.recall, 0.5);
  assert.equal(metrics.falsePositiveRate, 0.25);
});