import {assertSafeMoneyCents, multiplyMoneyCents} from "../core/mathematics.js";
import {MAX_PROGRESSION_STEP, stakeForStep} from "./progression.js";
import {STREET_GROSS_MULTIPLIER} from "../bankroll/accounting.js";

export const DECISION_ACTIONS = Object.freeze(["continue", "switch", "spread", "stop"]);
export const LOSS_HORIZONS = Object.freeze([1, 3, 5, 10]);

function uniqueStreets(streets){
  if (!Array.isArray(streets)) throw new TypeError("Streets must be an array.");
  const seen = new Set();
  for (const street of streets){
    if (!Number.isInteger(street) || street < 0 || street > 11) throw new RangeError("Streets must be integers from 0 to 11.");
    if (seen.has(street)) throw new RangeError("Streets must not repeat.");
    seen.add(street);
  }
  return [...streets];
}

function hitProbabilityFor(streets, probabilities){
  let probability = 0;
  for (const street of streets) probability += probabilities[street];
  return probability;
}

function comparePositionEvidence(current, alternative, probabilities, sampleSize){
  if (!current?.financials || !alternative?.financials || !Number.isInteger(sampleSize) || sampleSize < 1){
    return {
      justified: false,
      probabilityImprovement: null,
      standardError: null,
      confidenceMargin: null,
      reason: "There is not enough forecast-window information to establish that switching is better.",
    };
  }

  const weights = new Array(13).fill(0);
  for (let index = 0; index < current.streets.length; index++){
    weights[current.streets[index]] -= current.financials.streetStakeCents[index] / current.financials.totalStakeCents;
  }
  for (let index = 0; index < alternative.streets.length; index++){
    weights[alternative.streets[index]] += alternative.financials.streetStakeCents[index] / alternative.financials.totalStakeCents;
  }
  const improvement = weights.reduce((sum, weight, category) => sum + weight * probabilities[category], 0);
  const variance = Math.max(0,
    weights.reduce((sum, weight, category) => sum + weight * weight * probabilities[category], 0) - improvement ** 2,
  );
  const standardError = Math.sqrt(variance / sampleSize);
  const confidenceMargin = 1.96 * standardError;
  const justified = improvement > confidenceMargin;
  return {
    justified,
    probabilityImprovement: improvement,
    standardError,
    confidenceMargin,
    reason: justified
      ? "The alternative position has a statistically meaningful forecast advantage over the current position."
      : `The alternative's estimated probability improvement (${improvement.toFixed(4)}) does not exceed its 95% uncertainty margin (${confidenceMargin.toFixed(4)}).`,
  };
}

function allocateStake(totalStakeCents, streetCount){
  const baseStakeCents = Math.floor(totalStakeCents / streetCount);
  const remainderCents = totalStakeCents % streetCount;
  return Array.from({length: streetCount}, (_, index) => baseStakeCents + (index < remainderCents ? 1 : 0));
}

/**
 * Exact projected exposure of `lossCount` further consecutive losing wagers,
 * starting at `fromStep` with `streetCount` streets. Returns null when the
 * progression cannot legally reach that depth.
 */
export function projectedExposureCents({fromStep, lossCount, streetCount, unitCents, progressionMode, maxSteps = MAX_PROGRESSION_STEP, initialStakeCents = null}){
  const depthLimit = Math.min(maxSteps, MAX_PROGRESSION_STEP);
  let total = 0;
  if (!Number.isInteger(lossCount) || lossCount < 0) throw new RangeError("Loss count must be a non-negative integer.");
  if (initialStakeCents !== null){
    assertSafeMoneyCents(initialStakeCents, "Initial projected stake");
    if (initialStakeCents < 0) throw new RangeError("Initial projected stake must not be negative.");
    total = initialStakeCents;
  }
  const futureWagers = initialStakeCents === null ? lossCount : Math.max(0, lossCount - 1);
  for (let offset = 0; offset < futureWagers; offset++){
    const step = fromStep + offset;
    if (step > depthLimit) return null;
    const stakeCents = multiplyMoneyCents(multiplyMoneyCents(unitCents, stakeForStep(step, progressionMode)), streetCount);
    total = assertSafeMoneyCents(total + stakeCents, "Projected exposure");
  }
  return total;
}

/**
 * How many further consecutive losses the progression could absorb while
 * every wager stays inside the bankroll, stop-loss floor and stake limits.
 */
export function sustainableLossCount({fromStep, streetCount, unitCents, progressionMode, bankrollCents, riskCapitalCents, maxStakeCents = 0, maxExposureCents = 0, maxSteps = MAX_PROGRESSION_STEP, searchLimit = 100, initialStakeCents = null}){
  const depthLimit = Math.min(maxSteps, MAX_PROGRESSION_STEP);
  let spent = 0;
  let losses = 0;
  while (losses < searchLimit){
    const step = fromStep + losses;
    if (step > depthLimit) break;
    const stakeCents = losses === 0 && initialStakeCents !== null
      ? initialStakeCents
      : multiplyMoneyCents(multiplyMoneyCents(unitCents, stakeForStep(step, progressionMode)), streetCount);
    if (maxStakeCents > 0 && stakeCents > maxStakeCents) break;
    if (maxExposureCents > 0 && stakeCents > maxExposureCents) break;
    const nextSpent = assertSafeMoneyCents(spent + stakeCents, "Cumulative loss projection");
    if (nextSpent > riskCapitalCents || nextSpent > bankrollCents) break;
    spent = nextSpent;
    losses++;
  }
  return losses;
}

function buildWagerCandidate(action, streets, step, context){
  const {unitCents, progressionMode, bankrollCents, accumulatedLossCents, limits, probabilities} = context;
  const constraints = [];
  const streetCount = streets.length;
  if (streetCount === 0){
    return {action, feasible: false, sustainable: false, streets, constraints: ["no streets are available for this action"], financials: null};
  }

  let perStreetStakeCents;
  let totalStakeCents;
  let streetStakeCents;
  if (step > Math.min(limits.maxSteps, MAX_PROGRESSION_STEP)){
    return {action, feasible: false, sustainable: false, streets, step, constraints: ["the progression has reached its permitted depth"], financials: null};
  }
  const unitsStakeCents = multiplyMoneyCents(unitCents, stakeForStep(step, progressionMode));
  if (action === "spread"){
    totalStakeCents = multiplyMoneyCents(unitsStakeCents, Math.max(1, context.currentStreets.length));
    streetStakeCents = allocateStake(totalStakeCents, streetCount);
    perStreetStakeCents = streetStakeCents[0];
  } else {
    perStreetStakeCents = unitsStakeCents;
    totalStakeCents = multiplyMoneyCents(perStreetStakeCents, streetCount);
    streetStakeCents = new Array(streetCount).fill(perStreetStakeCents);
  }
  if (streetStakeCents.some((stake) => stake < 1)) constraints.push("the reallocated stake per street falls below one minor unit");
  if (totalStakeCents > bankrollCents) constraints.push("the proposed stake exceeds the current bankroll");
  if (limits.maxStakeCents > 0 && totalStakeCents > limits.maxStakeCents) constraints.push("the proposed stake exceeds the maximum permitted stake");
  if (limits.maxExposureCents > 0 && totalStakeCents > limits.maxExposureCents) constraints.push("the proposed stake exceeds the exposure limit");
  if (limits.tableMaxStakeCents > 0 && Math.max(...streetStakeCents) > limits.tableMaxStakeCents) constraints.push("the stake per street exceeds the table limit");
  if (context.riskCapitalCents < totalStakeCents) constraints.push("a loss would breach the stop-loss floor");

  const grossReturnByStreetCents = streetStakeCents.map((stake) => multiplyMoneyCents(stake, STREET_GROSS_MULTIPLIER));
  const grossReturnCents = Math.max(...grossReturnByStreetCents);
  const minimumNetProfitCents = Math.min(...grossReturnByStreetCents) - totalStakeCents;
  const maximumNetProfitCents = grossReturnCents - totalStakeCents;
  const netProfitCents = minimumNetProfitCents;
  const remainingUnrecoveredCents = Math.max(0, accumulatedLossCents - netProfitCents);
  const nextProgressionStep = step + 1;
  const requiredNextStakeCents = projectedExposureCents({fromStep: nextProgressionStep, lossCount: 1, streetCount, unitCents, progressionMode, maxSteps: limits.maxSteps});
  const exposureByHorizon = {};
  for (const horizon of LOSS_HORIZONS){
    exposureByHorizon[horizon] = projectedExposureCents({
      fromStep: step + 1,
      lossCount: horizon,
      streetCount,
      unitCents,
      progressionMode,
      maxSteps: limits.maxSteps,
      initialStakeCents: totalStakeCents,
    });
  }
  const sustainableLosses = sustainableLossCount({
    fromStep: step,
    streetCount,
    unitCents,
    progressionMode,
    bankrollCents,
    riskCapitalCents: context.riskCapitalCents,
    maxStakeCents: limits.maxStakeCents,
    maxExposureCents: limits.maxExposureCents,
    maxSteps: limits.maxSteps,
    initialStakeCents: totalStakeCents,
  });
  const hitProbability = hitProbabilityFor(streets, probabilities);
  const expectedGrossReturnCents = grossReturnByStreetCents.reduce((total, grossReturn, index) =>
    total + probabilities[streets[index]] * grossReturn, 0);
  const expectedNetCents = expectedGrossReturnCents - totalStakeCents;
  const outcomesByStreet = Array.from({length: 13}, (_, category) => {
    const street = category === 12 ? null : category;
    const selectedIndex = street === null ? -1 : streets.indexOf(street);
    const stakeCents = selectedIndex < 0 ? 0 : streetStakeCents[selectedIndex];
    const grossReturnCents = selectedIndex < 0 ? 0 : grossReturnByStreetCents[selectedIndex];
    const netChangeCents = grossReturnCents - totalStakeCents;
    return {
      street,
      stakeCents,
      probability: probabilities[category],
      grossReturnCents,
      netChangeCents,
      remainingUnrecoveredCents: Math.max(0, accumulatedLossCents - netChangeCents),
    };
  });
  const feasible = constraints.length === 0;
  const sustainable = feasible && sustainableLosses >= context.sustainabilityHorizon;
  if (feasible && !sustainable) constraints.push(`only ${sustainableLosses} further consecutive ${sustainableLosses === 1 ? "loss" : "losses"} could be staked within the financial constraints`);

  return {
    action,
    streets,
    step,
    feasible,
    sustainable,
    constraints,
    financials: {
      bankrollCents,
      accumulatedLossCents,
      currentProgressionLossCents: context.currentProgressionLossCents,
      recoveryAttributionKnown: context.recoveryAttributionKnown,
      abandonedLossCents: action === "switch"
        ? accumulatedLossCents
        : Math.max(0, accumulatedLossCents - context.currentProgressionLossCents),
      totalStakeCents,
      perStreetStakeCents,
      streetStakeCents,
      grossReturnCents,
      grossReturnByStreetCents,
      netProfitCents,
      minimumNetProfitCents,
      maximumNetProfitCents,
      remainingUnrecoveredCents,
      remainingUnrecoveredAfterWorstOutcomeCents: accumulatedLossCents + totalStakeCents,
      worstCaseNetChangeCents: -totalStakeCents,
      nextProgressionStep,
      requiredNextStakeCents,
      exposureByHorizon,
      sustainableLosses,
      maxPermittedStakeCents: limits.maxStakeCents,
      hitProbability,
      expectedGrossReturnCents,
      expectedNetCents,
      expectedNetRate: expectedNetCents / totalStakeCents,
      outcomesByStreet,
      recoversAccumulatedLosses: netProfitCents >= accumulatedLossCents,
    },
  };
}

function rankWagerCandidates(left, right){
  if (left.sustainable !== right.sustainable) return left.sustainable ? -1 : 1;
  const expectedDelta = right.financials.expectedNetRate - left.financials.expectedNetRate;
  if (Math.abs(expectedDelta) > 1e-9) return expectedDelta < 0 ? -1 : 1;
  return DECISION_ACTIONS.indexOf(left.action) - DECISION_ACTIONS.indexOf(right.action);
}

/**
 * Compares CONTINUE, SWITCH, SPREAD and STOP under identical bankroll and
 * risk constraints and returns a reconstructable decision snapshot.
 *
 * Selection policy, in order:
 * 1. Candidates that violate a financial constraint are never selected.
 * 2. Candidates able to sustain `sustainabilityHorizon` further losses beat
 *    those that cannot; if none can, wagering stops while observation
 *    continues. Determination never becomes blind commitment.
 * 3. Among sustainable candidates the best expected return per unit staked
 *    wins. Equivalent positions prefer stability over a fresh progression.
 * 4. Weak model evidence suspends evidence-gated wagering even when losses
 *    remain outstanding; those losses remain recorded during observation.
 * Accumulated sequence losses are carried into every candidate and are never
 * erased by switching streets.
 */
export function decideNextAction(rawContext){
  const context = normaliseContext(rawContext);
  const {currentStreets, candidateStreets, limits} = context;

  const continueCandidate = currentStreets.length > 0
    ? buildWagerCandidate("continue", currentStreets, context.progressionStep, context)
    : {action: "continue", feasible: false, sustainable: false, streets: [], constraints: ["there is no active street position to continue"], financials: null};

  const switchStreets = candidateStreets.filter((street) => !currentStreets.includes(street)).slice(0, Math.max(1, currentStreets.length || 1));
  const switchCandidate = buildWagerCandidate("switch", switchStreets, 1, context);
  const switchEvidence = comparePositionEvidence(
    continueCandidate,
    switchCandidate,
    context.probabilities,
    context.forecastWindowSize,
  );
  switchCandidate.selectionEligible = currentStreets.length === 0 ||
    !continueCandidate.feasible || !continueCandidate.sustainable || switchEvidence.justified;
  switchCandidate.selectionReason = switchCandidate.selectionEligible
    ? null
    : switchEvidence.reason;

  const spreadStreets = uniqueStreets([...new Set([...currentStreets, ...candidateStreets])].slice(0, context.spreadWidth));
  const spreadCandidate = spreadStreets.length > Math.max(1, currentStreets.length)
    ? buildWagerCandidate("spread", spreadStreets, context.progressionStep, context)
    : {action: "spread", feasible: false, sustainable: false, streets: spreadStreets, constraints: ["no additional streets are available to spread across"], financials: null};

  const stopCandidate = {
    action: "stop",
    streets: [],
    step: null,
    feasible: true,
    sustainable: true,
    constraints: [],
    financials: {
      bankrollCents: context.bankrollCents,
      accumulatedLossCents: context.accumulatedLossCents,
      totalStakeCents: 0,
      perStreetStakeCents: 0,
      grossReturnCents: 0,
      netProfitCents: 0,
      remainingUnrecoveredCents: context.accumulatedLossCents,
      nextProgressionStep: null,
      requiredNextStakeCents: null,
      exposureByHorizon: Object.fromEntries(LOSS_HORIZONS.map((horizon) => [horizon, 0])),
      sustainableLosses: Number.POSITIVE_INFINITY,
      maxPermittedStakeCents: limits.maxStakeCents,
      hitProbability: 0,
      expectedNetCents: 0,
      expectedNetRate: 0,
      recoversAccumulatedLosses: false,
    },
  };

  const candidates = [continueCandidate, switchCandidate, spreadCandidate, stopCandidate];
  const wagerable = candidates.filter((candidate) => candidate.action !== "stop" && candidate.feasible);
  const sustainableWagers = wagerable
    .filter((candidate) => candidate.sustainable && candidate.selectionEligible !== false)
    .sort(rankWagerCandidates);

  let selected;
  const reasons = [];
  if (context.wageringMode === "evidence-gated" && context.evidenceWeak){
    selected = stopCandidate;
    reasons.push("The forecasting evidence is no stronger than the uniform baseline, so BRI is observing rather than opening a new position.");
  } else if (sustainableWagers.length === 0){
    selected = stopCandidate;
    reasons.push(wagerable.length === 0
      ? "No wager satisfies the current bankroll and risk constraints, so wagering is suspended while observation continues."
      : `No feasible wager could sustain ${context.sustainabilityHorizon} further consecutive losses, so wagering is suspended rather than risking an unrecoverable progression.`);
  } else {
    selected = sustainableWagers[0];
    reasons.push(describeSelection(selected, context));
    if (selected.action !== "continue" && continueCandidate.financials !== null && !continueCandidate.sustainable){
      reasons.push("Continuing the existing progression was rejected: " + continueCandidate.constraints.join("; ") + ".");
    }
  }
  if (switchCandidate.selectionEligible === false) reasons.push(switchCandidate.selectionReason);
  if (context.wageringMode === "strategy-research" && context.evidenceWeak && selected.action !== "stop"){
    reasons.push("Strategy research mode permits this simulated wager for behavioural study; no predictive advantage has been established.");
  }
  if (context.accumulatedLossCents > 0){
    reasons.push(`Accumulated sequence losses of ${formatCents(context.accumulatedLossCents)} are retained in full and are not erased by this decision.`);
  }

  return Object.freeze({
    version: 1,
    tableId: context.tableId,
    observationCount: context.observationCount,
    modelVersion: context.modelVersion,
    action: selected.action,
    selected,
    candidates,
    switchEvidence,
    probabilities: Object.freeze([...context.probabilities]),
    bankrollCents: context.bankrollCents,
    accumulatedLossCents: context.accumulatedLossCents,
    riskCapitalCents: context.riskCapitalCents,
    limits: Object.freeze({...limits}),
    sustainabilityHorizon: context.sustainabilityHorizon,
    evidenceWeak: context.evidenceWeak,
    wageringMode: context.wageringMode,
    reasons,
    decidedAt: context.includeTimestamp === false ? null : new Date().toISOString(),
  });
}

function describeSelection(candidate, context){
  const f = candidate.financials;
  const streetsLabel = candidate.streets.map((street) => `${street * 3 + 1}-${street * 3 + 3}`).join(", ");
  const base = {
    continue: `Continuing the current position on streets ${streetsLabel} at progression step ${candidate.step}`,
    switch: `Switching to a fresh position on streets ${streetsLabel}, restarting the progression at step 1`,
    spread: `Spreading the proposed stake across streets ${streetsLabel} at progression step ${candidate.step}`,
  }[candidate.action];
  return `${base}: staking ${formatCents(f.totalStakeCents)} (${f.streetStakeCents.map(formatCents).join(", ")} per street) for a potential gross return of ${formatCents(f.grossReturnCents)}; the plan can absorb ${f.sustainableLosses >= context.sustainabilityHorizon ? `at least ${context.sustainabilityHorizon}` : f.sustainableLosses} further consecutive losses within the agreed limits.`;
}

function formatCents(amountCents){
  return `£${(amountCents / 100).toFixed(2)}`;
}

function normaliseContext(context){
  if (!context || typeof context !== "object") throw new TypeError("A decision context is required.");
  const {
    bankrollCents,
    startingBankrollCents = bankrollCents,
    accumulatedLossCents = 0,
    currentProgressionLossCents = accumulatedLossCents,
    recoveryAttributionKnown = true,
    progressionStep = 1,
    progressionMode = "flat",
    unitCents,
    probabilities,
    currentStreets = [],
    candidateStreets = [],
    limits = {},
    sustainabilityHorizon = 3,
    evidenceWeak = false,
    spreadWidth = 4,
    tableId = null,
    observationCount = 0,
    modelVersion = null,
    forecastWindowSize = 0,
  } = context;
  if (!Number.isInteger(forecastWindowSize) || forecastWindowSize < 0){
    throw new RangeError("Forecast window size must be a non-negative integer.");
  }
  assertSafeMoneyCents(bankrollCents, "Bankroll");
  assertSafeMoneyCents(startingBankrollCents, "Starting bankroll");
  assertSafeMoneyCents(accumulatedLossCents, "Accumulated losses");
  assertSafeMoneyCents(currentProgressionLossCents, "Current progression losses");
  if (accumulatedLossCents < 0) throw new RangeError("Accumulated losses must not be negative.");
  if (currentProgressionLossCents < 0 || currentProgressionLossCents > accumulatedLossCents){
    throw new RangeError("Current progression losses must be between zero and total unrecovered losses.");
  }
  assertSafeMoneyCents(unitCents, "Stake unit");
  if (unitCents <= 0) throw new RangeError("Stake unit must be a positive amount.");
  if (!Number.isInteger(progressionStep) || progressionStep < 1) throw new RangeError("Progression step must be a positive integer.");
  if (!Array.isArray(probabilities) || probabilities.length !== 13 || probabilities.some((value) => !Number.isFinite(value) || value < 0 || value > 1) ||
    Math.abs(probabilities.reduce((sum, value) => sum + value, 0) - 1) > 1e-6){
    throw new TypeError("A thirteen-category probability vector is required.");
  }
  if (!Number.isInteger(spreadWidth) || spreadWidth < 1 || spreadWidth > 12) throw new RangeError("Spread width must be an integer from 1 to 12.");
  if (!Number.isInteger(sustainabilityHorizon) || sustainabilityHorizon < 1) throw new RangeError("Sustainability horizon must be a positive integer.");
  const normalisedLimits = {
    maxStakeCents: assertLimit(limits.maxStakeCents),
    maxExposureCents: assertLimit(limits.maxExposureCents),
    tableMaxStakeCents: assertLimit(limits.tableMaxStakeCents),
    stopLossCents: assertLimit(limits.stopLossCents),
    maxSteps: Number.isInteger(limits.maxSteps) && limits.maxSteps >= 1 ? Math.min(limits.maxSteps, MAX_PROGRESSION_STEP) : MAX_PROGRESSION_STEP,
  };
  const stopLossFloorCents = normalisedLimits.stopLossCents > 0 ? Math.max(0, startingBankrollCents - normalisedLimits.stopLossCents) : 0;
  const riskCapitalCents = Math.max(0, bankrollCents - stopLossFloorCents);
  return {
    tableId,
    observationCount,
    modelVersion,
    forecastWindowSize,
    bankrollCents,
    startingBankrollCents,
    accumulatedLossCents,
    currentProgressionLossCents,
    recoveryAttributionKnown: Boolean(recoveryAttributionKnown),
    progressionStep,
    progressionMode,
    unitCents,
    probabilities,
    currentStreets: uniqueStreets(currentStreets),
    candidateStreets: uniqueStreets(candidateStreets),
    limits: normalisedLimits,
    sustainabilityHorizon,
    evidenceWeak: Boolean(evidenceWeak),
    wageringMode: context.wageringMode === "strategy-research" ? "strategy-research" : "evidence-gated",
    spreadWidth,
    riskCapitalCents,
  };
}

function assertLimit(value){
  if (value === undefined || value === null) return 0;
  assertSafeMoneyCents(value, "Limit");
  if (value < 0) throw new RangeError("Limits must not be negative.");
  return value;
}
