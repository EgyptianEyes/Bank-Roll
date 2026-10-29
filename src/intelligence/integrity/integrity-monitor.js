import {isValidOutcome, streetOf} from "../../core/roulette.js";

const CATEGORY_COUNT = 13;
export const DISTRIBUTION_SHIFT_THRESHOLD = 32.91;

export function inspectObservationSequence(events, {expectedFirstSpin = 1, tableId = null} = {}){
  const issues = [];
  const seenEventIds = new Map();
  const seenSpins = new Map();
  let previousSpin = expectedFirstSpin - 1;

  const report = (event, index, code, level, details = {}) => {
    issues.push({eventId: event?.eventId ?? null, spinNumber: event?.spinNumber ?? null, index, code, level, details});
  };

  for (let index = 0; index < events.length; index++){
    const event = events[index];
    if (!event || typeof event !== "object"){
      report(null, index, "invalid_record", "verified_integrity_error");
      continue;
    }
    const {eventId, spinNumber, outcome} = event;
    if (!Number.isInteger(outcome) || !isValidOutcome(outcome)) report(event, index, "invalid_outcome", "verified_integrity_error", {value: outcome});
    if (!Number.isSafeInteger(spinNumber) || spinNumber < 1){
      report(event, index, "invalid_sequence_number", "verified_integrity_error", {value: spinNumber});
      continue;
    }
    if (typeof eventId !== "string" || eventId.length === 0){
      report(event, index, "missing_event_id", "verified_integrity_error");
    } else if (seenEventIds.has(eventId)){
      const previous = seenEventIds.get(eventId);
      const exactReplay = previous.spinNumber === spinNumber && previous.outcome === outcome && previous.tableId === event.tableId;
      report(event, index, exactReplay ? "replayed_event" : "event_id_conflict", "verified_integrity_error", {firstIndex: previous.index});
    } else {
      seenEventIds.set(eventId, {index, spinNumber, outcome, tableId: event.tableId});
    }

    if (tableId !== null && event.tableId !== tableId){
      report(event, index, "table_mismatch", "verified_integrity_error", {expectedTableId: tableId, receivedTableId: event.tableId});
    }

    if (seenSpins.has(spinNumber)){
      const previousEvent = seenSpins.get(spinNumber);
      const exactReplay = previousEvent.outcome === outcome && previousEvent.eventId === eventId;
      report(event, index, exactReplay ? "replayed_event" : "conflicting_spin", "verified_integrity_error", {firstEventId: previousEvent.eventId});
    } else {
      seenSpins.set(spinNumber, {eventId, outcome, index, event});
    }

    if (spinNumber < previousSpin){
      report(event, index, "out_of_order", "verified_integrity_error", {previousSpinNumber: previousSpin});
    }
    previousSpin = spinNumber;
  }

  let expectedSpin = expectedFirstSpin;
  for (const spinNumber of [...seenSpins.keys()].sort((left, right) => left - right)){
    if (spinNumber > expectedSpin){
      const current = seenSpins.get(spinNumber);
      report(current.event, current.index, "missing_sequence", "verified_integrity_error", {firstMissing: expectedSpin, lastMissing: spinNumber - 1});
    }
    expectedSpin = Math.max(expectedSpin, spinNumber + 1);
  }

  return {accepted: issues.length === 0, issues};
}

export function inspectCorrectionHistory(events, corrections){
  const issues = [];
  const eventsById = new Map(events.map((event) => [event.eventId, event]));
  const currentOutcomes = new Map(events.map((event) => [event.eventId, event.outcome]));
  const revisions = new Map();
  const correctionIds = new Set();

  for (let index = 0; index < corrections.length; index++){
    const correction = corrections[index];
    const report = (code, details = {}) => issues.push({
      correctionId: correction?.correctionId ?? null,
      eventId: correction?.eventId ?? null,
      index,
      code,
      level: "verified_integrity_error",
      details,
    });
    if (!correction || typeof correction !== "object"){
      report("invalid_correction_record");
      continue;
    }
    const original = eventsById.get(correction.eventId);
    if (!original){
      report("correction_event_missing");
      continue;
    }
    if (typeof correction.correctionId !== "string" || !correction.correctionId){
      report("missing_correction_id");
      continue;
    }
    if (correctionIds.has(correction.correctionId)){
      report("duplicate_correction_id");
      continue;
    }
    correctionIds.add(correction.correctionId);
    if (correction.tableId !== original.tableId || correction.sessionId !== original.sessionId){
      report("correction_source_mismatch");
      continue;
    }
    if (!isValidOutcome(correction.correctedOutcome)){
      report("invalid_corrected_outcome", {value: correction.correctedOutcome});
      continue;
    }
    const expectedRevision = (revisions.get(correction.eventId) || 0) + 1;
    if (correction.revision !== expectedRevision || correction.previousOutcome !== currentOutcomes.get(correction.eventId)){
      report("correction_chain_conflict", {expectedRevision, expectedPreviousOutcome: currentOutcomes.get(correction.eventId)});
      continue;
    }
    revisions.set(correction.eventId, correction.revision);
    currentOutcomes.set(correction.eventId, correction.correctedOutcome);
  }

  return {accepted: issues.length === 0, issues, effectiveOutcomes: currentOutcomes};
}

export function evaluateDistributionShift(tracker, {baselineMinimum = 500, recentWindow = 100, threshold = DISTRIBUTION_SHIFT_THRESHOLD} = {}){
  if (tracker.count < baselineMinimum + recentWindow) return null;
  const recent = tracker.history.slice(-recentWindow);
  if (recent.length < recentWindow) return null;

  const recentCounts = new Array(CATEGORY_COUNT).fill(0);
  for (const outcome of recent){
    const street = streetOf(outcome);
    recentCounts[street === null ? 12 : street]++;
  }

  const lifetimeStreetTotal = tracker.appearances.reduce((sum, count) => sum + count, 0);
  const baselineCounts = tracker.appearances.map((count, street) => count - recentCounts[street]);
  baselineCounts.push(tracker.count - lifetimeStreetTotal - recentCounts[12]);
  if (baselineCounts.some((count) => count < 0)) throw new Error("Integrity monitor received inconsistent tracker totals.");

  const baselineSize = tracker.count - recentWindow;
  const prior = 1;
  const denominator = baselineSize + prior * CATEGORY_COUNT;
  const expected = baselineCounts.map((count) => recentWindow * (count + prior) / denominator);
  const chiSquare = recentCounts.reduce((score, observed, category) => {
    const difference = observed - expected[category];
    return score + difference * difference / expected[category];
  }, 0);
  const rankedContributions = recentCounts.map((observed, category) => ({
    category: category === 12 ? "zero" : `street-${category + 1}`,
    observed,
    expected: expected[category],
    contribution: (observed - expected[category]) ** 2 / expected[category],
  })).sort((left, right) => right.contribution - left.contribution).slice(0, 3);

  return {
    classification: chiSquare >= threshold ? "statistical_anomaly_candidate" : "no_distribution_shift_detected",
    verifiedError: false,
    chiSquare,
    threshold,
    thresholdMeaning: "Candidate-screening heuristic only; not a calibrated p-value.",
    baselineObservations: baselineSize,
    recentObservations: recentWindow,
    leadingContributions: rankedContributions,
    explanation: "A distribution shift is a statistical candidate only; it does not prove that any recorded result is incorrect.",
  };
}

export function scoreIntegrityDetections(expected, detected, latencyById = {}){
  const expectedSet = new Set(expected);
  const detectedSet = new Set(detected);
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  for (const id of detectedSet){
    if (expectedSet.has(id)) truePositives++;
    else falsePositives++;
  }
  for (const id of expectedSet){
    if (!detectedSet.has(id)) falseNegatives++;
  }
  const trueNegatives = Math.max(0, latencyById.controlCount || 0) - falsePositives;
  return {
    truePositives,
    falsePositives,
    trueNegatives,
    falseNegatives,
    precision: truePositives + falsePositives ? truePositives / (truePositives + falsePositives) : 0,
    recall: truePositives + falseNegatives ? truePositives / (truePositives + falseNegatives) : 0,
    falsePositiveRate: trueNegatives + falsePositives ? falsePositives / (trueNegatives + falsePositives) : 0,
    detectionLatency: {...latencyById.latencies},
  };
}