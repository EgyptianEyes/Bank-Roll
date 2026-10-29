import {mulberry32, xfnv1a} from "../core/random.js";
import {spinNumber} from "../core/roulette.js";
import {completeSession, createSessionState, prepareSessionSpin, settleSessionSpin} from "./session-engine.js";
import {AutonomousSessionEngine} from "./autonomous-session-engine.js";
import {settleWager} from "../bankroll/accounting.js";
import {StreetPredictionEngine} from "../intelligence/prediction-engine.js";
import {STREET_MODEL_IDS} from "../intelligence/forecast-models.js";

/** Deterministic outcome sequence for reproducible research runs. */
export function generateOutcomeSequence(seed, spins){
  if (typeof seed !== "string" || seed === "") throw new TypeError("A non-empty seed string is required.");
  if (!Number.isInteger(spins) || spins < 1) throw new RangeError("Spins must be a positive integer.");
  const random = mulberry32(xfnv1a(seed));
  const outcomes = new Array(spins);
  for (let index = 0; index < spins; index++) outcomes[index] = spinNumber(random);
  return outcomes;
}

function scenarioProbabilities(scenario){
  if (scenario.type === "uniform") return null;
  const street = scenario.favoredStreet ?? 5;
  const favoredProbability = scenario.favoredStreetProbability ?? 0.18;
  if (!Number.isInteger(street) || street < 0 || street > 11) throw new RangeError("Favored street must be between 0 and 11.");
  if (!Number.isFinite(favoredProbability) || favoredProbability <= 0 || favoredProbability >= 1) throw new RangeError("Favored street probability must be between zero and one.");
  const weights = [...new Array(12).fill(3 / 37), 1 / 37];
  const remainder = weights.reduce((sum, value, index) => index === street ? sum : sum + value, 0);
  return weights.map((weight, index) => index === street ? favoredProbability : weight * (1 - favoredProbability) / remainder);
}

export function scenarioCategoryProbabilities(scenario){
  if (!scenario || !["uniform", "biased", "changing"].includes(scenario.type)){
    throw new RangeError("Scenario type must be uniform, biased, or changing.");
  }
  if (scenario.type === "uniform") return [...new Array(12).fill(3 / 37), 1 / 37];
  return scenarioProbabilities(scenario);
}

function sampleScenarioOutcome(random, probabilities){
  if (!probabilities) return spinNumber(random);
  let draw = random();
  for (let category = 0; category < probabilities.length; category++){
    draw -= probabilities[category];
    if (draw < 0){
      return category === 12 ? 0 : category * 3 + Math.floor(random() * 3) + 1;
    }
  }
  return 36;
}

function hashOutcomeSequence(outcomes){
  let hash = 0x811c9dc5;
  for (const outcome of outcomes) hash = Math.imul(hash ^ outcome, 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Creates explicitly labelled, seeded scenarios; no real-wheel inference is implied. */
export function generateScenarioOutcomeSequence({seed, spins, scenario = {type: "uniform"}}){
  if (typeof seed !== "string" || seed === "") throw new TypeError("A non-empty seed string is required.");
  if (!Number.isInteger(spins) || spins < 1) throw new RangeError("Spins must be a positive integer.");
  if (!scenario || !["uniform", "biased", "changing"].includes(scenario.type)) throw new RangeError("Scenario type must be uniform, biased, or changing.");
  const random = mulberry32(xfnv1a(seed));
  const outcomes = new Array(spins);
  const biasedProbabilities = scenario.type === "uniform" ? null : scenarioProbabilities(scenario);
  const changeAt = scenario.type === "changing" ? (scenario.changeAt ?? Math.floor(spins / 2)) : 0;
  if (scenario.type === "changing" && (!Number.isInteger(changeAt) || changeAt < 0 || changeAt > spins)) throw new RangeError("Changing scenario changeAt must be within the sequence.");
  for (let index = 0; index < spins; index++){
    const probabilities = scenario.type === "changing" && index < changeAt ? null : biasedProbabilities;
    outcomes[index] = sampleScenarioOutcome(random, probabilities);
  }
  return outcomes;
}

function makeResearchMetrics(startingBankrollCents){
  return {
    wagersPlaced: 0,
    observationOnlySpins: 0,
    winningWagers: 0,
    losingWagers: 0,
    totalStakedCents: 0,
    totalGrossReturnsCents: 0,
    finalBankrollCents: startingBankrollCents,
    netProfitLossCents: 0,
    maximumDrawdownCents: 0,
    maximumExposureCents: 0,
    maximumUnrecoveredLossCents: 0,
    maximumProjectedTenLossExposureCents: null,
    firstWagerSpin: null,
    lastWagerSpin: null,
    firstEvidenceQualifiedSpin: null,
    firstCorrectStreetForecastSpin: null,
    firstConfirmedStreetDetectionSpin: null,
    favoredStreetForecasts: null,
    favoredStreetForecastRate: null,
    forecastStreetCounts: null,
    mostForecastedStreet: null,
    wageringSuspendedAtSpin: null,
    lastWageringSuspendedAtSpin: null,
    wageringStoppedAtSpin: null,
    firstWageringSuspensionDetails: null,
    lastWageringSuspensionDetails: null,
    wageringStopReason: null,
    wageringResumedAtSpin: null,
    observationsAfterWageringStopped: null,
    observationsContinuedAfterWageringStopped: null,
    candidateRejectionReasons: null,
    firstRejectedSpreadCandidate: null,
    financialTerminationDetails: null,
    falsePositiveDetection: null,
    forecastsIssued: null,
    forecastsEvaluated: null,
    forecastHitRate: null,
    selectedForecastCalibration: null,
    topStreetExpectedCalibrationError: null,
    forecastPerformanceByWindow: null,
    uniformBaselineMeanBrier: null,
    modelPerformance: null,
    modelSelectionFrequency: null,
    modelActionDistribution: null,
    decisionDistribution: null,
    decisionCounterfactuals: null,
    stopLossEvents: null,
    sessionTerminationReason: null,
    experimentEndReason: null,
    wageringStatus: null,
    warmupSpins: null,
    forwardTestForecasts: null,
    spinsPerSecond: null,
    notApplicable: [],
  };
}

function recordForecastCalibration(metrics, forecast, evaluation, bins){
  if (!forecast || !evaluation) return;
  const confidence = forecast.probability;
  const index = Math.min(bins.length - 1, Math.floor(confidence * bins.length));
  bins[index].count++;
  bins[index].confidenceTotal += confidence;
  bins[index].hits += evaluation.hit ? 1 : 0;
}

function recordForecastWindow(windows, forecast, evaluation, totalSpins){
  if (!forecast || !evaluation) return;
  const index = Math.min(windows.length - 1, Math.floor((forecast.spinNumber - 1) * windows.length / totalSpins));
  const window = windows[index];
  const selectedScore = evaluation.modelResults.find((result) => result.modelVersion === forecast.modelVersion);
  const uniformScore = evaluation.modelResults.find((result) => result.modelVersion === STREET_MODEL_IDS.uniform);
  window.forecasts++;
  window.hits += evaluation.hit ? 1 : 0;
  if (selectedScore) window.selectedBrierTotal += selectedScore.brierScore;
  if (uniformScore) window.uniformBrierTotal += uniformScore.brierScore;
}

function createDecisionCounterfactuals(){
  return {
    comparedDecisions: 0,
    selectedWorseThanBestCount: 0,
    selectedVsBestImmediateNetCents: 0,
    bestActionCounts: {continue: 0, switch: 0, spread: 0, stop: 0},
    actions: Object.fromEntries(["continue", "switch", "spread", "stop"].map((action) => [action, {
      availableDecisions: 0,
      wagers: 0,
      wins: 0,
      losses: 0,
      totalStakedCents: 0,
      totalGrossReturnsCents: 0,
      totalNetCents: 0,
    }])),
  };
}

function recordDecisionCounterfactuals(metrics, decision, outcome, actualNetCents){
  const available = [];
  for (const candidate of decision.candidates){
    if (candidate.action === "stop"){
      available.push({action: "stop", netCents: 0});
      continue;
    }
    if (decision.wageringMode === "evidence-gated" && decision.evidenceWeak) continue;
    if (!candidate.feasible || !candidate.sustainable || candidate.selectionEligible === false || !candidate.financials) continue;
    const wager = {
      kind: "streets",
      chosen: candidate.streets,
      totalStakeCents: candidate.financials.totalStakeCents,
      perStreetStakeCents: candidate.financials.perStreetStakeCents,
      streetStakeCents: candidate.financials.streetStakeCents,
    };
    const settlement = settleWager(wager, outcome);
    const action = metrics.decisionCounterfactuals.actions[candidate.action];
    action.availableDecisions++;
    action.wagers++;
    action.totalStakedCents += wager.totalStakeCents;
    action.totalGrossReturnsCents += settlement.grossReturnCents;
    action.totalNetCents += settlement.netChangeCents;
    if (settlement.hit) action.wins++;
    else action.losses++;
    available.push({action: candidate.action, netCents: settlement.netChangeCents});
  }
  if (!available.length) return;
  const best = available.reduce((winner, candidate) => candidate.netCents > winner.netCents ? candidate : winner);
  const counterfactual = metrics.decisionCounterfactuals;
  counterfactual.comparedDecisions++;
  counterfactual.bestActionCounts[best.action]++;
  counterfactual.selectedVsBestImmediateNetCents += actualNetCents - best.netCents;
  if (actualNetCents < best.netCents) counterfactual.selectedWorseThanBestCount++;
}

function formatCents(cents){
  return cents / 100;
}

function runConventionalVariant({name, config, outcomes, type}){
  const started = performance.now();
  const state = createSessionState(config);
  let bets = 0;
  let firstWagerSpin = null;
  let lastWagerSpin = null;
  let wins = 0;
  let losses = 0;
  let observed = 0;
  let sessionTerminated = false;
  let terminationReason = null;
  for (const outcome of outcomes){
    if (!sessionTerminated && state.spins < config.maxSpins){
      const prepared = prepareSessionSpin(config, state);
      if (prepared.action === "stop"){
        sessionTerminated = true;
        terminationReason = prepared.reason;
      } else {
        if (prepared.wager){
          bets++;
          firstWagerSpin ??= state.spins;
          lastWagerSpin = state.spins;
        }
        const settlement = settleSessionSpin(state, prepared.wager, outcome);
        if (prepared.wager){
          if (settlement.hit) wins++;
          else losses++;
        }
        if (state.stopReason){
          sessionTerminated = true;
          terminationReason = state.stopReason;
        }
      }
    } else {
      sessionTerminated = true;
    }
    observed++;
  }
  const metrics = makeResearchMetrics(state.startingBankrollCents);
  metrics.wagersPlaced = bets;
  metrics.observationOnlySpins = observed - bets;
  metrics.winningWagers = wins;
  metrics.losingWagers = losses;
  metrics.totalStakedCents = state.totalStakedCents;
  metrics.totalGrossReturnsCents = state.totalReturnedCents;
  metrics.finalBankrollCents = state.bankrollCents;
  metrics.netProfitLossCents = state.bankrollCents - state.startingBankrollCents;
  metrics.maximumDrawdownCents = state.maximumDrawdownCents;
  metrics.maximumExposureCents = state.maxStakeCents;
  metrics.firstWagerSpin = firstWagerSpin;
  metrics.lastWagerSpin = lastWagerSpin;
  metrics.maximumUnrecoveredLossCents = null;
  metrics.sessionTerminationReason = terminationReason || "not-terminated";
  metrics.experimentEndReason = "horizon-exhausted";
  metrics.wageringStatus = terminationReason ? "session-terminated" : "ended";
  metrics.wageringStoppedAtSpin = terminationReason ? state.spins : null;
  metrics.wageringStopReason = terminationReason;
  metrics.observationsAfterWageringStopped = terminationReason ? Math.max(0, observed - state.spins) : 0;
  metrics.observationsContinuedAfterWageringStopped = terminationReason && observed > state.spins;
  metrics.stopLossEvents = terminationReason === "stop-loss" ? 1 : 0;
  metrics.processingTimeMs = performance.now() - started;
  metrics.spinsPerSecond = metrics.processingTimeMs > 0 ? observed * 1000 / metrics.processingTimeMs : null;
  metrics.observedSpins = observed;
  metrics.notApplicable = [
    "forecastsIssued",
    "forecastsEvaluated",
    "forecastHitRate",
    "selectedForecastCalibration",
    "topStreetExpectedCalibrationError",
    "forecastPerformanceByWindow",
    "uniformBaselineMeanBrier",
    "modelPerformance",
    "modelSelectionFrequency",
    "modelActionDistribution",
    "decisionDistribution",
    "decisionCounterfactuals",
    "maximumProjectedTenLossExposureCents",
    "maximumUnrecoveredLossCents",
    "warmupSpins",
    "forwardTestForecasts",
  ];
  return {name, strategy: type, wageringMode: null, config, metrics};
}

async function runAutonomousVariant({name, config, outcomes, wageringMode, actionPolicy, scenario, shouldCancel, onProgress, yieldEvery}){
  const started = performance.now();
  const startingBankrollCents = Math.round(config.bankroll * 100);
  const predictionEngine = new StreetPredictionEngine({
    historyLimit: 0,
    recordTimestamps: false,
  });
  const session = new AutonomousSessionEngine({
    ...config,
    maxSpins: outcomes.length,
    wageringMode,
    researchActionPolicy: actionPolicy || "adaptive",
    decisionHistoryLimit: 0,
    recordDecisions: false,
  }, () => 0, predictionEngine);
  const metrics = makeResearchMetrics(startingBankrollCents);
  metrics.forecastsIssued = 0;
  metrics.forecastsEvaluated = 0;
  metrics.decisionDistribution = {continue: 0, switch: 0, spread: 0, stop: 0, observe: 0};
  metrics.modelSelectionFrequency = {};
  metrics.modelActionDistribution = {};
  metrics.candidateRejectionReasons = {continue: {}, switch: {}, spread: {}};
  metrics.decisionCounterfactuals = createDecisionCounterfactuals();
  metrics.favoredStreetForecasts = scenario?.type === "uniform" || !Number.isInteger(scenario?.favoredStreet)
    ? null
    : {street: scenario.favoredStreet, forecasts: 0, correct: 0, confirmed: 0};
  metrics.forecastStreetCounts = {};
  const performanceWindows = new Array(10).fill(null).map((_, index) => ({
    startSpinInclusive: Math.floor(index * outcomes.length / 10) + 1,
    endSpinInclusive: Math.floor((index + 1) * outcomes.length / 10),
    forecasts: 0,
    hits: 0,
    selectedBrierTotal: 0,
    uniformBrierTotal: 0,
  }));
  const calibrationBins = new Array(10).fill(null).map((_, index) => ({
    lowerBound: index / 10,
    upperBound: (index + 1) / 10,
    count: 0,
    confidenceTotal: 0,
    hits: 0,
  }));
  let observed = 0;
  let cancelled = false;
  let terminalReason = null;
  let terminalDetails = null;
  let lastDecisionAction = "observe";
  let wageringSuspended = false;
  for (let index = 0; index < outcomes.length; index++){
    if (index % 1024 === 0 && shouldCancel?.()){
      cancelled = true;
      break;
    }
    const outcome = outcomes[index];
    let prepared = null;
    let forecast = null;
    let evaluation = null;

    if (!terminalReason){
      const preview = session.previewNextSpin();
      if (preview.action === "stop"){
        terminalReason = preview.reason;
        session.state.stopReason = preview.reason;
        terminalDetails = {
          spinNumber: index + 1,
          reason: preview.reason,
          bankrollCents: session.coordinator.state.bankrollCents,
          accumulatedLossCents: session.coordinator.state.accumulatedLossCents,
          currentProgressionLossCents: session.coordinator.state.currentProgressionLossCents,
          progressionStep: session.coordinator.state.progressionStep,
          currentStreets: [...session.coordinator.state.currentStreets],
          modelVersion: null,
          evidence: null,
          decisionAction: null,
        };
      } else {
        prepared = session.prepareNextSpin();
        forecast = prepared.forecast;
        if (forecast){
          metrics.forecastsIssued++;
          metrics.modelSelectionFrequency[forecast.modelVersion] = (metrics.modelSelectionFrequency[forecast.modelVersion] || 0) + 1;
          metrics.forecastStreetCounts[forecast.street] = (metrics.forecastStreetCounts[forecast.street] || 0) + 1;
          if (prepared.evidence && !prepared.evidence.evidenceWeak && metrics.firstEvidenceQualifiedSpin === null){
            metrics.firstEvidenceQualifiedSpin = forecast.spinNumber;
          }
          if (metrics.favoredStreetForecasts){
            metrics.favoredStreetForecasts.forecasts++;
            if (forecast.street === metrics.favoredStreetForecasts.street){
              metrics.favoredStreetForecasts.correct++;
              if (metrics.firstCorrectStreetForecastSpin === null) metrics.firstCorrectStreetForecastSpin = forecast.spinNumber;
              if (prepared.evidence && !prepared.evidence.evidenceWeak){
                metrics.favoredStreetForecasts.confirmed++;
                if (metrics.firstConfirmedStreetDetectionSpin === null){
                  metrics.firstConfirmedStreetDetectionSpin = forecast.spinNumber;
                }
              }
            }
          }
        }
        metrics.decisionDistribution[prepared.decision?.action || "observe"]++;
        lastDecisionAction = prepared.decision?.action || "observe";
        if (forecast && prepared.decision){
          const byModel = metrics.modelActionDistribution[forecast.modelVersion] || (metrics.modelActionDistribution[forecast.modelVersion] = {continue: 0, switch: 0, spread: 0, stop: 0});
          byModel[prepared.decision.action]++;
        }
        if (prepared.decision){
          for (const candidate of prepared.decision.candidates){
            if (!Object.hasOwn(metrics.candidateRejectionReasons, candidate.action)) continue;
            let reason = null;
            if (!candidate.feasible) reason = candidate.constraints.join("; ") || "financially infeasible";
            else if (!candidate.sustainable) reason = candidate.constraints.join("; ") || "financially unsustainable";
            else if (candidate.selectionEligible === false) reason = candidate.selectionReason;
            else if (candidate.action !== prepared.decision.action) reason = `ranked below ${prepared.decision.action} by expected return per unit staked`;
            if (reason){
              const reasons = metrics.candidateRejectionReasons[candidate.action];
              reasons[reason] = (reasons[reason] || 0) + 1;
            }
            if (candidate.action === "spread" && !metrics.firstRejectedSpreadCandidate && reason){
              metrics.firstRejectedSpreadCandidate = {
                spinNumber: forecast?.spinNumber ?? index + 1,
                selectedAction: prepared.decision.action,
                reason,
                streets: [...candidate.streets],
                financials: candidate.financials ? structuredClone(candidate.financials) : null,
              };
            }
          }
        }
        if (prepared.decision?.action === "stop"){
          if (!wageringSuspended){
            metrics.wageringSuspendedAtSpin ??= forecast?.spinNumber ?? index + 1;
            metrics.wageringStopReason ??= prepared.decision.reasons.join(" ");
            const suspension = {
              spinNumber: forecast?.spinNumber ?? index + 1,
              bankrollCents: session.coordinator.state.bankrollCents,
              accumulatedLossCents: session.coordinator.state.accumulatedLossCents,
              currentProgressionLossCents: session.coordinator.state.currentProgressionLossCents,
              progressionStep: session.coordinator.state.progressionStep,
              currentStreets: [...session.coordinator.state.currentStreets],
              modelVersion: forecast?.modelVersion ?? null,
              forecastedStreet: forecast?.street ?? null,
              evidence: prepared.evidence ?? null,
              reasons: [...prepared.decision.reasons],
            };
            metrics.firstWageringSuspensionDetails ??= suspension;
            metrics.lastWageringSuspensionDetails = suspension;
            metrics.lastWageringSuspendedAtSpin = suspension.spinNumber;
          }
          wageringSuspended = true;
        } else if (prepared.wager && wageringSuspended){
          metrics.wageringResumedAtSpin ??= forecast?.spinNumber ?? index + 1;
          wageringSuspended = false;
        }
        if (prepared.wager){
          metrics.firstWagerSpin ??= prepared.spinNumber;
          metrics.lastWagerSpin = prepared.spinNumber;
          metrics.wagersPlaced++;
          metrics.totalStakedCents += prepared.wager.totalStakeCents;
          metrics.maximumExposureCents = Math.max(metrics.maximumExposureCents, prepared.wager.totalStakeCents);
          const projected = prepared.decision?.selected?.financials?.exposureByHorizon?.[10];
          if (Number.isSafeInteger(projected)){
            metrics.maximumProjectedTenLossExposureCents = Math.max(metrics.maximumProjectedTenLossExposureCents || 0, projected);
          }
        }
      }
    }

    if (prepared){
      const resolved = session.resolveOutcome(prepared, outcome);
      evaluation = resolved.evaluation;
      if (resolved.settlement){
        metrics.totalGrossReturnsCents += resolved.settlement.grossReturnCents;
        if (resolved.settlement.hit) metrics.winningWagers++;
        else metrics.losingWagers++;
      }
      if (prepared.decision){
        recordDecisionCounterfactuals(metrics, prepared.decision, outcome, resolved.settlement?.netChangeCents || 0);
      }
    } else if (terminalReason){
      forecast = predictionEngine.forecastNext();
      if (forecast){
        metrics.forecastsIssued++;
        metrics.modelSelectionFrequency[forecast.modelVersion] = (metrics.modelSelectionFrequency[forecast.modelVersion] || 0) + 1;
        metrics.forecastStreetCounts[forecast.street] = (metrics.forecastStreetCounts[forecast.street] || 0) + 1;
        if (metrics.favoredStreetForecasts){
          metrics.favoredStreetForecasts.forecasts++;
          if (forecast.street === metrics.favoredStreetForecasts.street){
            metrics.favoredStreetForecasts.correct++;
            metrics.firstCorrectStreetForecastSpin ??= forecast.spinNumber;
          }
        }
      }
      evaluation = predictionEngine.observe(outcome);
    } else {
      // The session reached its configured spin horizon; the experiment still observes this input.
      predictionEngine.observe(outcome);
    }

    if (evaluation){
      metrics.forecastsEvaluated++;
      const evaluatedForecast = forecast || evaluation.forecast;
      recordForecastCalibration(metrics, evaluatedForecast, evaluation, calibrationBins);
      recordForecastWindow(performanceWindows, evaluatedForecast, evaluation, outcomes.length);
    }
    observed++;
    if (session.stopReason && !terminalReason) terminalReason = session.stopReason;
    if (session.stopReason && !terminalDetails){
      terminalDetails = {
        spinNumber: prepared?.spinNumber ?? index + 1,
        reason: session.stopReason,
        bankrollCents: session.coordinator.state.bankrollCents,
        accumulatedLossCents: session.coordinator.state.accumulatedLossCents,
        currentProgressionLossCents: session.coordinator.state.currentProgressionLossCents,
        progressionStep: session.coordinator.state.progressionStep,
        currentStreets: [...session.coordinator.state.currentStreets],
        decisionAction: prepared?.decision?.action ?? null,
        modelVersion: prepared?.forecast?.modelVersion ?? null,
        forecastedStreet: prepared?.forecast?.street ?? null,
        evidence: prepared?.evidence ?? null,
      };
      metrics.wageringSuspendedAtSpin ??= prepared?.spinNumber ?? index + 1;
      metrics.wageringStopReason = session.stopReason;
    }
    metrics.maximumUnrecoveredLossCents = Math.max(metrics.maximumUnrecoveredLossCents, session.coordinator.state.accumulatedLossCents);

    if (yieldEvery > 0 && observed % yieldEvery === 0){
      onProgress?.({strategy: name, completedSpins: observed, totalSpins: outcomes.length});
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const prediction = predictionEngine.performance;
  const modelPerformance = predictionEngine.modelPerformance;
  const uniformScore = modelPerformance.find((model) => model.modelVersion === STREET_MODEL_IDS.uniform);
  metrics.observedSpins = observed;
  metrics.warmupSpins = Math.min(observed, predictionEngine.minimumObservations);
  metrics.forwardTestForecasts = metrics.forecastsEvaluated;
  metrics.observationOnlySpins = observed - metrics.wagersPlaced;
  metrics.finalBankrollCents = session.coordinator.state.bankrollCents;
  metrics.netProfitLossCents = metrics.finalBankrollCents - startingBankrollCents;
  metrics.maximumDrawdownCents = session.state.maximumDrawdownCents;
  metrics.maximumExposureCents = Math.max(metrics.maximumExposureCents, session.state.maxStakeCents);
  metrics.forecastHitRate = metrics.forecastsEvaluated ? prediction.accuracy : null;
  metrics.favoredStreetForecastRate = metrics.favoredStreetForecasts?.forecasts
    ? metrics.favoredStreetForecasts.correct / metrics.favoredStreetForecasts.forecasts
    : null;
  metrics.mostForecastedStreet = Object.entries(metrics.forecastStreetCounts)
    .map(([street, count]) => ({street: Number(street), count}))
    .sort((left, right) => right.count - left.count || left.street - right.street)[0]?.street ?? null;
  metrics.uniformBaselineMeanBrier = uniformScore?.meanBrier ?? null;
  metrics.modelPerformance = modelPerformance;
  metrics.modelSelectionFrequency = Object.fromEntries(Object.entries(metrics.modelSelectionFrequency).map(([id, count]) => [id, {
    count,
    fraction: metrics.forecastsIssued ? count / metrics.forecastsIssued : 0,
  }]));
  metrics.selectedForecastCalibration = calibrationBins
    .filter((bin) => bin.count > 0)
    .map((bin) => ({
      lowerBound: bin.lowerBound,
      upperBound: bin.upperBound,
      forecasts: bin.count,
      meanPredictedProbability: bin.confidenceTotal / bin.count,
      observedHitRate: bin.hits / bin.count,
    }));
  const calibratedForecastCount = calibrationBins.reduce((total, bin) => total + bin.count, 0);
  metrics.topStreetExpectedCalibrationError = calibratedForecastCount
    ? calibrationBins.filter((bin) => bin.count > 0).reduce((total, bin) =>
      total + Math.abs(bin.confidenceTotal / bin.count - bin.hits / bin.count) * bin.count, 0) / calibratedForecastCount
    : null;
  metrics.forecastPerformanceByWindow = performanceWindows.map((window) => ({
    startSpinInclusive: window.startSpinInclusive,
    endSpinInclusive: window.endSpinInclusive,
    forecasts: window.forecasts,
    hitRate: window.forecasts ? window.hits / window.forecasts : null,
    selectedModelMeanBrier: window.forecasts ? window.selectedBrierTotal / window.forecasts : null,
    uniformMeanBrier: window.forecasts ? window.uniformBrierTotal / window.forecasts : null,
  }));
  metrics.stopLossEvents = terminalReason === "stop-loss" ? 1 : 0;
  metrics.wageringStoppedAtSpin = terminalDetails?.spinNumber ??
    (lastDecisionAction === "stop" ? metrics.lastWageringSuspendedAtSpin : null);
  metrics.observationsAfterWageringStopped = metrics.wageringStoppedAtSpin === null
    ? 0
    : Math.max(0, observed - metrics.wageringStoppedAtSpin + 1);
  metrics.observationsContinuedAfterWageringStopped = metrics.wageringStoppedAtSpin !== null &&
    metrics.wageringStoppedAtSpin < observed;
  metrics.sessionTerminationReason = terminalReason || "not-terminated";
  metrics.financialTerminationDetails = terminalDetails;
  metrics.falsePositiveDetection = scenario?.type === "uniform"
    ? metrics.firstEvidenceQualifiedSpin !== null
    : null;
  metrics.experimentEndReason = cancelled ? "cancelled" : "horizon-exhausted";
  metrics.wageringStatus = terminalReason ? "session-terminated" : (lastDecisionAction === "stop" ? "suspended" : (lastDecisionAction === "observe" ? "gathering-evidence" : "active"));
  metrics.processingTimeMs = performance.now() - started;
  metrics.spinsPerSecond = metrics.processingTimeMs > 0 ? observed * 1000 / metrics.processingTimeMs : null;
  return {
    name,
    strategy: actionPolicy ? "bri-policy-path" : "bri-autonomous",
    wageringMode,
    actionPolicy: actionPolicy || "adaptive",
    policyDisclosure: wageringMode === "strategy-research"
      ? "Experimental street wagers are permitted for behavioural evaluation; no predictive advantage is claimed."
      : "Wagers require evidence to outperform the uniform baseline; otherwise the system observes without wagering.",
    config,
    metrics,
    cancelled,
  };
}

function runObservationOnlyVariant({name, config, outcomes, scenario}){
  const started = performance.now();
  const startingBankrollCents = Math.round(config.bankroll * 100);
  const engine = new StreetPredictionEngine({historyLimit: 0, recordTimestamps: false});
  const metrics = makeResearchMetrics(startingBankrollCents);
  metrics.forecastsIssued = 0;
  metrics.forecastsEvaluated = 0;
  metrics.modelSelectionFrequency = {};
  metrics.favoredStreetForecasts = scenario?.type === "uniform" || !Number.isInteger(scenario?.favoredStreet)
    ? null
    : {street: scenario.favoredStreet, forecasts: 0, correct: 0, confirmed: null};
  metrics.forecastStreetCounts = {};
  const windows = new Array(10).fill(null).map((_, index) => ({
    startSpinInclusive: Math.floor(index * outcomes.length / 10) + 1,
    endSpinInclusive: Math.floor((index + 1) * outcomes.length / 10),
    forecasts: 0,
    hits: 0,
    selectedBrierTotal: 0,
    uniformBrierTotal: 0,
  }));
  const bins = new Array(10).fill(null).map((_, index) => ({
    lowerBound: index / 10,
    upperBound: (index + 1) / 10,
    count: 0,
    confidenceTotal: 0,
    hits: 0,
  }));
  for (const outcome of outcomes){
    const forecast = engine.forecastNext();
    if (forecast){
      metrics.forecastsIssued++;
      metrics.modelSelectionFrequency[forecast.modelVersion] = (metrics.modelSelectionFrequency[forecast.modelVersion] || 0) + 1;
      metrics.forecastStreetCounts[forecast.street] = (metrics.forecastStreetCounts[forecast.street] || 0) + 1;
      if (metrics.favoredStreetForecasts){
        metrics.favoredStreetForecasts.forecasts++;
        if (forecast.street === metrics.favoredStreetForecasts.street){
          metrics.favoredStreetForecasts.correct++;
          metrics.firstCorrectStreetForecastSpin ??= forecast.spinNumber;
        }
      }
    }
    const evaluation = engine.observe(outcome);
    if (evaluation){
      metrics.forecastsEvaluated++;
      recordForecastCalibration(metrics, forecast, evaluation, bins);
      recordForecastWindow(windows, forecast, evaluation, outcomes.length);
    }
  }
  const modelPerformance = engine.modelPerformance;
  const uniformScore = modelPerformance.find((model) => model.modelVersion === STREET_MODEL_IDS.uniform);
  metrics.observedSpins = outcomes.length;
  metrics.observationOnlySpins = outcomes.length;
  metrics.warmupSpins = Math.min(outcomes.length, engine.minimumObservations);
  metrics.forwardTestForecasts = metrics.forecastsEvaluated;
  metrics.finalBankrollCents = startingBankrollCents;
  metrics.netProfitLossCents = 0;
  metrics.maximumDrawdownCents = 0;
  metrics.maximumExposureCents = 0;
  metrics.maximumUnrecoveredLossCents = 0;
  metrics.forecastHitRate = metrics.forecastsEvaluated ? engine.performance.accuracy : null;
  metrics.favoredStreetForecastRate = metrics.favoredStreetForecasts?.forecasts
    ? metrics.favoredStreetForecasts.correct / metrics.favoredStreetForecasts.forecasts
    : null;
  metrics.mostForecastedStreet = Object.entries(metrics.forecastStreetCounts)
    .map(([street, count]) => ({street: Number(street), count}))
    .sort((left, right) => right.count - left.count || left.street - right.street)[0]?.street ?? null;
  metrics.uniformBaselineMeanBrier = uniformScore?.meanBrier ?? null;
  metrics.modelPerformance = modelPerformance;
  metrics.modelSelectionFrequency = Object.fromEntries(Object.entries(metrics.modelSelectionFrequency).map(([id, count]) => [id, {
    count,
    fraction: metrics.forecastsIssued ? count / metrics.forecastsIssued : 0,
  }]));
  metrics.selectedForecastCalibration = bins.filter((bin) => bin.count > 0).map((bin) => ({
    lowerBound: bin.lowerBound,
    upperBound: bin.upperBound,
    forecasts: bin.count,
    meanPredictedProbability: bin.confidenceTotal / bin.count,
    observedHitRate: bin.hits / bin.count,
  }));
  metrics.topStreetExpectedCalibrationError = metrics.forecastsEvaluated
    ? bins.filter((bin) => bin.count > 0).reduce((total, bin) =>
      total + Math.abs(bin.confidenceTotal / bin.count - bin.hits / bin.count) * bin.count, 0) / metrics.forecastsEvaluated
    : null;
  metrics.forecastPerformanceByWindow = windows.map((window) => ({
    startSpinInclusive: window.startSpinInclusive,
    endSpinInclusive: window.endSpinInclusive,
    forecasts: window.forecasts,
    hitRate: window.forecasts ? window.hits / window.forecasts : null,
    selectedModelMeanBrier: window.forecasts ? window.selectedBrierTotal / window.forecasts : null,
    uniformMeanBrier: window.forecasts ? window.uniformBrierTotal / window.forecasts : null,
  }));
  metrics.sessionTerminationReason = "not-terminated";
  metrics.experimentEndReason = "horizon-exhausted";
  metrics.wageringStatus = "observation-only";
  metrics.processingTimeMs = performance.now() - started;
  metrics.spinsPerSecond = metrics.processingTimeMs > 0 ? outcomes.length * 1000 / metrics.processingTimeMs : null;
  metrics.notApplicable = [
    "maximumProjectedTenLossExposureCents",
    "modelActionDistribution",
    "decisionDistribution",
    "candidateRejectionReasons",
    "firstRejectedSpreadCandidate",
    "decisionCounterfactuals",
    "financialTerminationDetails",
    "wageringStoppedAtSpin",
    "firstWageringSuspensionDetails",
    "lastWageringSuspensionDetails",
    "wageringStopReason",
    "wageringResumedAtSpin",
  ];
  return {name, strategy: "observation-only", wageringMode: null, config, metrics};
}

/**
 * Runs production autonomous and conventional engines against the same
 * deterministic sequence. Results contain bounded aggregates, not an
 * unbounded per-spin audit log; seed + scenario reproduce the input exactly.
 */
export async function compareAutonomousStrategies({
  seed,
  spins,
  outcomes: providedOutcomes = null,
  scenario = {type: "uniform"},
  baseConfig,
  variants = [
    {name: "cold-street", strategy: "cold-street"},
    {name: "bri-evidence-gated", strategy: "bri-autonomous", wageringMode: "evidence-gated"},
    {name: "bri-strategy-research", strategy: "bri-autonomous", wageringMode: "strategy-research"},
    {name: "flat-stake", strategy: "flat-baseline"},
  ],
  shouldCancel = null,
  onProgress = null,
  yieldEvery = 0,
}){
  if (!baseConfig || typeof baseConfig !== "object") throw new TypeError("A base simulation configuration is required.");
  if (!Array.isArray(variants) || variants.length === 0) throw new TypeError("At least one comparison strategy is required.");
  if (!Number.isInteger(spins) || spins < 1) throw new RangeError("Spins must be a positive integer.");
  if (typeof seed !== "string" || !seed.trim()) throw new TypeError("A reproducibility seed or sequence label is required.");
  const outcomes = providedOutcomes === null
    ? generateScenarioOutcomeSequence({seed, spins, scenario})
    : [...providedOutcomes];
  if (outcomes.length !== spins || outcomes.some((outcome) => !Number.isInteger(outcome) || outcome < 0 || outcome > 36)){
    throw new RangeError("A provided outcome sequence must contain exactly the configured number of European roulette outcomes.");
  }
  const started = performance.now();
  const results = [];
  for (const variant of variants){
    if (shouldCancel?.()) break;
    const config = {...baseConfig, ...variant.config, maxSpins: spins};
    let result;
    if (variant.strategy === "bri-autonomous"){
      result = await runAutonomousVariant({
        name: variant.name,
        config,
        outcomes,
        wageringMode: variant.wageringMode || "evidence-gated",
        actionPolicy: variant.actionPolicy,
        scenario,
        shouldCancel,
        onProgress,
        yieldEvery,
      });
    } else if (variant.strategy === "cold-street" || variant.strategy === "flat-baseline"){
      if (variant.strategy === "flat-baseline") config.progression = "flat";
      result = runConventionalVariant({name: variant.name, config, outcomes, type: variant.strategy});
    } else if (variant.strategy === "observation-only"){
      result = runObservationOnlyVariant({name: variant.name, config, outcomes, scenario});
    } else {
      throw new RangeError(`Unsupported research strategy: ${variant.strategy}`);
    }
    results.push(result);
    onProgress?.({strategy: variant.name, completedSpins: spins, totalSpins: spins});
    if (result.cancelled) break;
  }
  return {
    version: 1,
    seed,
    scenario: structuredClone(scenario),
    configuration: structuredClone(baseConfig),
    spins,
    sequenceSource: providedOutcomes === null ? "generated" : "provided",
    providedOutcomeSequence: providedOutcomes === null ? null : outcomes,
    outcomeSequenceHash: hashOutcomeSequence(outcomes),
    completedStrategies: results.length,
    cancelled: results.some((result) => result.cancelled) || Boolean(shouldCancel?.()),
    elapsedMs: performance.now() - started,
    results,
  };
}

/** Runs one session against a fixed outcome sequence (identical-spin replay). */
export function simulateSessionWithOutcomes(config, outcomes){
  const state = createSessionState(config);
  let cursor = 0;
  while (state.spins < config.maxSpins && !state.stopReason && cursor < outcomes.length){
    const prepared = prepareSessionSpin(config, state);
    if (prepared.action === "stop") break;
    settleSessionSpin(state, prepared.wager, outcomes[cursor]);
    cursor++;
  }
  return completeSession(config, state);
}

/**
 * Compares strategy variants against identical spin sequences. Every variant
 * sees exactly the same outcomes in every session, so differences in results
 * are attributable to the strategy alone. The seed is recorded for
 * independent validation; discovery and validation should use different
 * seeds.
 */
export function compareStrategies({seed, sessions, maxSpins, variants, onProgress = null, shouldCancel = null}){
  if (!Array.isArray(variants) || variants.length < 1) throw new TypeError("At least one strategy variant is required.");
  if (!Number.isInteger(sessions) || sessions < 1) throw new RangeError("Sessions must be a positive integer.");
  if (!Number.isInteger(maxSpins) || maxSpins < 1) throw new RangeError("maxSpins must be a positive integer.");
  for (const variant of variants){
    if (typeof variant.name !== "string" || variant.name === "" || !variant.config) throw new TypeError("Each variant needs a name and a config.");
  }
  const startedAt = Date.now();
  const results = variants.map(() => []);
  let totalSpins = 0;
  let cancelled = false;
  for (let session = 0; session < sessions; session++){
    if (shouldCancel && shouldCancel()){
      cancelled = true;
      break;
    }
    const outcomes = generateOutcomeSequence(`${seed}:${session}`, maxSpins);
    for (let index = 0; index < variants.length; index++){
      const result = simulateSessionWithOutcomes({...variants[index].config, maxSpins}, outcomes);
      results[index].push(result);
      totalSpins += result.spins;
    }
    if (onProgress && (session + 1) % 25 === 0) onProgress({completedSessions: session + 1, totalSessions: sessions});
  }
  const elapsedMs = Date.now() - startedAt;
  return {
    seed,
    sessions,
    maxSpins,
    cancelled,
    completedSessions: results[0].length,
    benchmark: {
      totalSpins,
      elapsedMs,
      spinsPerSecond: elapsedMs > 0 ? Math.round(totalSpins / (elapsedMs / 1000)) : null,
    },
    variants: variants.map((variant, index) => ({
      name: variant.name,
      config: variant.config,
      summary: summariseResults(variant.config, results[index]),
    })),
  };
}

export function summariseResults(config, results){
  if (results.length === 0) return null;
  const finals = results.map((result) => result.final);
  const wins = results.filter((result) => result.pl > 0).length;
  const totalPl = results.reduce((sum, result) => sum + result.pl, 0);
  return {
    sessions: results.length,
    meanFinal: finals.reduce((sum, value) => sum + value, 0) / finals.length,
    totalProfitLoss: totalPl,
    winRate: wins / results.length,
    worst: Math.min(...finals),
    best: Math.max(...finals),
    meanSpins: results.reduce((sum, result) => sum + result.spins, 0) / results.length,
    maxDrawdown: Math.max(...results.map((result) => result.maximumDrawdown)),
    stopReasons: results.reduce((reasons, result) => {
      reasons[result.reason] = (reasons[result.reason] || 0) + 1;
      return reasons;
    }, {}),
  };
}
