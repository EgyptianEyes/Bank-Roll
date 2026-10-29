import {mulberry32, xfnv1a} from "../../core/random.js";
import {inspectCorrectionHistory, inspectObservationSequence, scoreIntegrityDetections} from "./integrity-monitor.js";

function makeEvents(length, seed, tableId){
  const random = mulberry32(xfnv1a(seed));
  return Array.from({length}, (_, index) => ({
    eventId: `event-${index + 1}`,
    sessionId: `session-${tableId}`,
    spinNumber: index + 1,
    outcome: Math.floor(random() * 37),
    tableId,
  }));
}

function runCase(name, makeCorruption, code, randomSalt, sourceIndex = 10){
  const tableId = `table-${randomSalt}`;
  const clean = makeEvents(40, `false-entry-${randomSalt}`, tableId);
  const corrupted = makeCorruption(clean.map((event) => ({...event})));
  const blindDataset = corrupted.map(({challengeError, ...event}) => event);
  const detection = inspectObservationSequence(blindDataset, {tableId});
  const matchingIssue = detection.issues.find((issue) => issue.code === code);
  const detected = matchingIssue !== undefined;
  const targetId = corrupted.find((event) => event?.challengeError)?.challengeError || name;
  const latency = matchingIssue ? Math.max(1, matchingIssue.index - sourceIndex + 1) : null;
  return {name, expected: name, targetId, detected, latency, issues: detection.issues};
}

export function runFalseEntryChallenge({seed = globalThis.crypto.randomUUID()} = {}){
  const verifiableCases = [
    runCase("invalid-outcome", (events) => { events[10].outcome = 37; events[10].challengeError = "invalid-outcome"; return events; }, "invalid_outcome", `${seed}-a`),
    runCase("nonnumeric-outcome", (events) => { events[10].outcome = "23"; events[10].challengeError = "nonnumeric-outcome"; return events; }, "invalid_outcome", `${seed}-h`),
    runCase("duplicate-event-id", (events) => { events[10].eventId = events[9].eventId; events[10].challengeError = "duplicate-event-id"; return events; }, "event_id_conflict", `${seed}-b`),
    runCase("conflicting-spin", (events) => { const conflict = {...events[9], eventId: "conflicting-event", outcome: (events[9].outcome + 1) % 37, challengeError: "conflicting-spin"}; events.splice(10, 0, conflict); return events; }, "conflicting_spin", `${seed}-c`),
    runCase("missing-sequence", (events) => { events.splice(10, 1); return events; }, "missing_sequence", `${seed}-d`),
    runCase("out-of-order", (events) => { [events[9], events[10]] = [events[10], events[9]]; return events; }, "out_of_order", `${seed}-e`, 9),
    runCase("wrong-table", (events) => { events[10].tableId = "other-table"; events[10].challengeError = "wrong-table"; return events; }, "table_mismatch", `${seed}-f`),
    runCase("replayed-record", (events) => { const replay = {...events[9], challengeError: "replayed-record"}; events.splice(10, 0, replay); return events; }, "replayed_event", `${seed}-g`),
  ];
  const repeatedLegitimate = makeEvents(40, `${seed}-repeated-legitimate`, "table-repeat");
  repeatedLegitimate[10].outcome = repeatedLegitimate[9].outcome;
  const repeatedCheck = inspectObservationSequence(repeatedLegitimate, {tableId: "table-repeat"});

  const indistinguishableSubstitution = makeEvents(40, `${seed}-valid-substitution`, "table-substitution");
  indistinguishableSubstitution[10].outcome = (indistinguishableSubstitution[10].outcome + 1) % 37;
  const substitutionCheck = inspectObservationSequence(indistinguishableSubstitution, {tableId: "table-substitution"});
  const swappedOutcomes = makeEvents(40, `${seed}-swapped-outcomes`, "table-swapped");
  [swappedOutcomes[10].outcome, swappedOutcomes[11].outcome] = [swappedOutcomes[11].outcome, swappedOutcomes[10].outcome];
  const swappedCheck = inspectObservationSequence(swappedOutcomes, {tableId: "table-swapped"});
  const correctionEvents = makeEvents(2, `${seed}-correction-chain`, "table-correction");
  const incorrectCorrection = inspectCorrectionHistory(correctionEvents, [{
    correctionId: "correction-1",
    eventId: correctionEvents[0].eventId,
    sessionId: correctionEvents[0].sessionId,
    tableId: "table-correction",
    revision: 1,
    previousOutcome: (correctionEvents[0].outcome + 1) % 37,
    correctedOutcome: 23,
  }]);
  verifiableCases.push({
    name: "incorrect-correction",
    expected: "incorrect-correction",
    targetId: "incorrect-correction",
    detected: incorrectCorrection.issues.some((issue) => issue.code === "correction_chain_conflict"),
    latency: 1,
    issues: incorrectCorrection.issues,
  });
  const allExpected = verifiableCases.map((item) => item.expected);
  const controlEvents = makeEvents(40, `${seed}-false-entry-controls`, "control-table");
  const controlIssues = inspectObservationSequence(controlEvents, {tableId: "control-table"}).issues;
  const controlFalsePositives = [...new Set(controlIssues.map((issue) => issue.eventId).filter(Boolean))].map((eventId) => `control-${eventId}`);
  const detected = [
    ...verifiableCases.filter((item) => item.detected).map((item) => item.expected),
    ...controlFalsePositives,
  ];
  const controlFalsePositiveCount = controlFalsePositives.length;
  const confusion = scoreIntegrityDetections(allExpected, detected, {
    controlCount: controlEvents.length,
    latencies: Object.fromEntries(verifiableCases.map((item) => [item.name, item.latency])),
  });

  return {
    benchmark: "False Entry Challenge",
    seed,
    verifiableCases,
    metrics: confusion,
    legitimateRepeatedOutcomesAccepted: repeatedCheck.accepted,
    validSubstitutionClassifiedAsVerifiedError: substitutionCheck.issues.length > 0,
    swappedValidOutcomesClassifiedAsVerifiedError: swappedCheck.issues.length > 0,
    incorrectCorrectionDetected: incorrectCorrection.issues.some((issue) => issue.code === "correction_chain_conflict"),
    controlRecordsChecked: controlEvents.length,
    controlFalsePositiveCount,
    undetectableCases: [
      {name: "valid number substitution without independent source data", flagged: substitutionCheck.issues.length > 0},
      {name: "swapped valid outcomes without contradictory sequence metadata", flagged: swappedCheck.issues.length > 0},
    ],
  };
}