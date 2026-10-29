import {isValidOutcome} from "../core/roulette.js";
import {assertSafeMoneyCents} from "../core/mathematics.js";
import {settleWager, canPlaceWager} from "../bankroll/accounting.js";
import {decideNextAction} from "../strategies/decision-engine.js";
import {StreetPredictionEngine} from "./prediction-engine.js";
import {STREET_MODEL_IDS} from "./forecast-models.js";

const RESEARCH_ACTION_POLICIES = new Set(["adaptive", "maintain", "switch", "spread", "suspend"]);

function applyResearchActionPolicy(decision, policy, hasPosition){
  if (policy === "adaptive") return decision;
  const requestedAction = policy === "maintain" && !hasPosition ? "switch"
    : policy === "maintain" ? "continue"
      : policy === "suspend" ? "stop"
        : policy;
  const candidate = decision.candidates.find((entry) => entry.action === requestedAction);
  const selected = candidate?.feasible && candidate.sustainable
    ? candidate
    : decision.candidates.find((entry) => entry.action === "stop");
  return Object.freeze({
    ...decision,
    action: selected.action,
    selected,
    decisionPolicy: policy,
    reasons: [...decision.reasons, `The ${policy} complete-path research policy selected ${selected.action}.`],
  });
}

/**
 * Central BRI orchestration layer.
 *
 * Responsibilities are composed behind explicit interfaces:
 * - observation and learning: StreetPredictionEngine (observe, score, learn)
 * - action comparison and exposure: decideNextAction (evaluate, decide)
 * - settlement: bankroll accounting (verify, recalculate)
 * - memory and companion: registered listeners (record, remember)
 *
 * Lifecycle before each spin: Observe → Analyse → Predict → Evaluate →
 * Decide → Record. After each spin: Verify → Score → Learn → Remember →
 * Recalculate. Forecasts and decisions are always emitted before the outcome
 * is known, and no listener return value can influence the mathematics.
 */
export class BriCoordinator{
  constructor({
    unitCents,
    bankrollCents,
    progressionMode = "flat",
    limits = {},
    sustainabilityHorizon = 3,
    candidateCount = 3,
    minimumModelEvaluations = 25,
    wageringMode = "evidence-gated",
    researchActionPolicy = "adaptive",
    decisionHistoryLimit = 1000,
    recordDecisions = true,
    engineOptions = {},
    engine = null,
  } = {}){
    assertSafeMoneyCents(unitCents, "Stake unit");
    if (unitCents <= 0) throw new RangeError("Stake unit must be a positive amount.");
    assertSafeMoneyCents(bankrollCents, "Bankroll");
    if (bankrollCents < 0) throw new RangeError("Bankroll must not be negative.");
    this.unitCents = unitCents;
    this.progressionMode = progressionMode;
    this.limits = {...limits};
    this.sustainabilityHorizon = sustainabilityHorizon;
    this.candidateCount = candidateCount;
    this.minimumModelEvaluations = minimumModelEvaluations;
    if (!["evidence-gated", "strategy-research"].includes(wageringMode)) throw new RangeError("Unsupported BRI wagering mode.");
    if (!RESEARCH_ACTION_POLICIES.has(researchActionPolicy)) throw new RangeError("Unsupported BRI complete-path research policy.");
    if (!Number.isInteger(decisionHistoryLimit) || decisionHistoryLimit < 0) throw new RangeError("Decision history limit must be a non-negative integer.");
    this.wageringMode = wageringMode;
    this.researchActionPolicy = researchActionPolicy;
    this.decisionHistoryLimit = decisionHistoryLimit;
    this.recordDecisions = recordDecisions;
    this.engine = engine || new StreetPredictionEngine(engineOptions);
    this.forecastForNextSpin = null;
    this.state = {
      bankrollCents,
      startingBankrollCents: bankrollCents,
      accumulatedLossCents: 0,
      currentProgressionLossCents: 0,
      recoveryAttributionKnown: true,
      progressionStep: 1,
      currentStreets: [],
      spins: 0,
    };
    this.pending = null;
    this.decisions = [];
    this.decisionCounts = {continue: 0, switch: 0, spread: 0, stop: 0, observe: 0};
    this.listeners = {forecast: [], decision: [], outcome: [], evaluation: []};
  }

  restoreState(snapshot){
    if (!snapshot || snapshot.version !== 1 || !snapshot.state || !Array.isArray(snapshot.decisions) || !snapshot.decisionCounts){
      throw new TypeError("Unsupported BRI coordinator snapshot.");
    }
    const state = snapshot.state;
    assertSafeMoneyCents(state.bankrollCents, "Bankroll");
    assertSafeMoneyCents(state.startingBankrollCents, "Starting bankroll");
    assertSafeMoneyCents(state.accumulatedLossCents, "Accumulated losses");
    const hasCurrentProgressionLoss = Number.isSafeInteger(state.currentProgressionLossCents);
    const currentProgressionLossCents = state.currentProgressionLossCents ?? 0;
    const recoveryAttributionKnown = state.recoveryAttributionKnown ?? hasCurrentProgressionLoss;
    assertSafeMoneyCents(currentProgressionLossCents, "Current progression losses");
    if (state.bankrollCents < 0 || state.startingBankrollCents < 0 || state.accumulatedLossCents < 0 ||
      currentProgressionLossCents < 0 || currentProgressionLossCents > state.accumulatedLossCents ||
      !Number.isSafeInteger(state.progressionStep) || state.progressionStep < 1 ||
      !Number.isSafeInteger(state.spins) || state.spins < 0 ||
      !Array.isArray(state.currentStreets) ||
      state.currentStreets.some((street) => !Number.isInteger(street) || street < 0 || street > 11)){
      throw new TypeError("Invalid BRI coordinator session state.");
    }
    const countKeys = ["continue", "switch", "spread", "stop", "observe"];
    if (countKeys.some((key) => !Number.isSafeInteger(snapshot.decisionCounts[key]) || snapshot.decisionCounts[key] < 0)){
      throw new TypeError("Invalid BRI decision counts.");
    }
    this.state = {...state, currentProgressionLossCents, recoveryAttributionKnown, currentStreets: [...state.currentStreets]};
    this.decisions = snapshot.decisions.slice(-1000);
    this.decisionCounts = Object.fromEntries(countKeys.map((key) => [key, snapshot.decisionCounts[key]]));
    this.pending = null;
    return this;
  }

  on(event, listener){
    if (!this.listeners[event]) throw new RangeError(`Unknown BRI event: ${event}`);
    if (typeof listener !== "function") throw new TypeError("A listener function is required.");
    this.listeners[event].push(listener);
    return this;
  }

  emit(event, payload){
    for (const listener of this.listeners[event]){
      try {
        listener(payload);
      } catch {
        // Listeners (memory, companion, UI) must never break the mathematics.
      }
    }
  }

  get observationCount(){
    return this.engine.observationCount;
  }

  prepareForecast(){
    if (this.pending) throw new Error("Resolve the pending spin before preparing another forecast.");
    if (!this.forecastForNextSpin){
      this.forecastForNextSpin = this.engine.pendingForecast || this.engine.forecastNext();
    }
    return this.forecastForNextSpin;
  }

  /**
   * Evidence is weak until a competing model's paired prequential Brier
   * difference has a sequentially adjusted upper bound below uniform.
   * A fair wheel always remains an eligible explanation.
   */
  evidenceAssessment(){
    const performance = this.engine.modelPerformance;
    const uniform = performance.find((model) => model.modelVersion === STREET_MODEL_IDS.uniform);
    const alternatives = performance.filter((model) =>
      model.modelVersion !== STREET_MODEL_IDS.uniform &&
      model.comparisonEvaluations >= this.minimumModelEvaluations &&
      Number.isFinite(model.pairedBrierDeltaUpperBound),
    );
    if (!uniform || uniform.total < this.minimumModelEvaluations || alternatives.length === 0){
      return {evidenceWeak: true, reason: "insufficient forward-tested evaluations against the uniform baseline"};
    }
    const best = alternatives.reduce((left, right) =>
      left.pairedBrierDeltaUpperBound <= right.pairedBrierDeltaUpperBound ? left : right);
    if (best.pairedBrierDeltaUpperBound >= 0){
      return {
        evidenceWeak: true,
        reason: "no competing model has a confidence bound demonstrating lower Brier loss than uniform",
        bestModel: best.modelVersion,
        pairedBrierDeltaUpperBound: best.pairedBrierDeltaUpperBound,
      };
    }
    return {
      evidenceWeak: false,
      reason: `${best.modelVersion} has a confidence bound below the uniform baseline`,
      bestModel: best.modelVersion,
      pairedBrierDeltaUpperBound: best.pairedBrierDeltaUpperBound,
    };
  }

  /** Before-spin lifecycle. Returns the forecast, decision and prepared wager. */
  beforeSpin(){
    if (this.pending) throw new Error("Resolve the pending spin before preparing another.");
    this.state.spins++;

    // Observe/Analyse/Predict
    const forecast = this.forecastForNextSpin || this.engine.pendingForecast || this.engine.forecastNext();
    this.forecastForNextSpin = null;
    if (!forecast){
      const observation = Object.freeze({action: "observe", forecast: null, decision: null, wager: null, spins: this.state.spins});
      this.decisionCounts.observe++;
      this.pending = observation;
      return observation;
    }
    this.emit("forecast", forecast);

    // Evaluate/Decide
    const selectedModel = forecast.candidateModels.find((model) => model.modelVersion === forecast.modelVersion) || forecast.candidateModels[0];
    const probabilities = [...selectedModel.probabilities];
    const candidateStreets = probabilities
      .slice(0, 12)
      .map((probability, street) => ({street, probability}))
      .sort((left, right) => right.probability - left.probability || left.street - right.street)
      .slice(0, this.candidateCount)
      .map((entry) => entry.street);
    const evidence = this.evidenceAssessment();
    const rankedDecision = decideNextAction({
      bankrollCents: this.state.bankrollCents,
      startingBankrollCents: this.state.startingBankrollCents,
      accumulatedLossCents: this.state.accumulatedLossCents,
      currentProgressionLossCents: this.state.currentProgressionLossCents,
      recoveryAttributionKnown: this.state.recoveryAttributionKnown,
      progressionStep: this.state.progressionStep,
      progressionMode: this.progressionMode,
      unitCents: this.unitCents,
      probabilities,
      currentStreets: this.state.currentStreets,
      candidateStreets,
      limits: this.limits,
      sustainabilityHorizon: this.sustainabilityHorizon,
      evidenceWeak: evidence.evidenceWeak,
      wageringMode: this.wageringMode,
      includeTimestamp: this.recordDecisions,
      observationCount: this.engine.observationCount,
      forecastWindowSize: forecast.windowSize ?? 0,
      modelVersion: forecast.modelVersion,
    });
    const decision = applyResearchActionPolicy(rankedDecision, this.researchActionPolicy, this.state.currentStreets.length > 0);

    // Record — the decision snapshot is persisted before the outcome exists.
    if (this.recordDecisions && this.decisionHistoryLimit > 0){
      this.decisions.push(decision);
      if (this.decisions.length > this.decisionHistoryLimit) this.decisions.shift();
    }
    this.decisionCounts[decision.action]++;
    this.emit("decision", decision);

    let wager = null;
    if (decision.action !== "stop"){
      const selected = decision.selected;
      wager = {
        kind: "streets",
        chosen: [...selected.streets],
        stakeUnits: null,
        perStreetStakeCents: selected.financials.perStreetStakeCents,
        streetStakeCents: [...selected.financials.streetStakeCents],
        totalStakeCents: selected.financials.totalStakeCents,
      };
      const approval = canPlaceWager(this.state.bankrollCents, wager, this.limits);
      if (!approval.allowed){
        // The decision engine and accounting must agree; refuse rather than
        // allow a decision to override the independent financial safeguard.
        wager = null;
      } else {
        this.state.bankrollCents -= wager.totalStakeCents;
        if (decision.action === "switch"){
          this.state.progressionStep = 1;
          this.state.currentProgressionLossCents = 0;
          this.state.recoveryAttributionKnown = true;
        }
        this.state.currentStreets = [...selected.streets];
      }
    }
    const prepared = Object.freeze({action: decision.action, forecast, decision, wager, spins: this.state.spins, evidence});
    this.pending = prepared;
    return prepared;
  }

  /** After-spin lifecycle. Scores the forecast, settles and recalculates. */
  afterSpin(outcome){
    if (!this.pending) throw new Error("Prepare the spin before recording its outcome.");
    if (!isValidOutcome(outcome)) throw new RangeError("Roulette outcome must be an integer from 0 to 36.");
    const pending = this.pending;
    this.pending = null;

    // Verify/Score/Learn — scoring happens strictly after the recorded forecast.
    const evaluation = this.engine.observe(outcome);
    this.emit("outcome", {outcome, spins: pending.spins});
    if (evaluation) this.emit("evaluation", evaluation);

    // Recalculate — exact monetary settlement.
    let settlement = null;
    if (pending.wager){
      settlement = settleWager(pending.wager, outcome);
      this.state.bankrollCents = assertSafeMoneyCents(this.state.bankrollCents + settlement.grossReturnCents, "Bankroll");
      if (settlement.hit){
        const netProfitCents = settlement.grossReturnCents - pending.wager.totalStakeCents;
        this.state.accumulatedLossCents = assertSafeMoneyCents(Math.max(0, this.state.accumulatedLossCents - netProfitCents), "Accumulated losses");
        this.state.currentProgressionLossCents = assertSafeMoneyCents(Math.max(0, this.state.currentProgressionLossCents - netProfitCents), "Current progression losses");
        this.state.progressionStep = 1;
      } else {
        this.state.accumulatedLossCents = assertSafeMoneyCents(this.state.accumulatedLossCents + pending.wager.totalStakeCents, "Accumulated losses");
        this.state.currentProgressionLossCents = assertSafeMoneyCents(this.state.currentProgressionLossCents + pending.wager.totalStakeCents, "Current progression losses");
        this.state.progressionStep++;
      }
    }
    return {
      outcome,
      evaluation,
      settlement,
      state: {
        bankrollCents: this.state.bankrollCents,
        startingBankrollCents: this.state.startingBankrollCents,
        accumulatedLossCents: this.state.accumulatedLossCents,
        currentProgressionLossCents: this.state.currentProgressionLossCents,
        recoveryAttributionKnown: this.state.recoveryAttributionKnown,
        progressionStep: this.state.progressionStep,
        currentStreets: [...this.state.currentStreets],
        spins: this.state.spins,
      },
    };
  }

  snapshotState(){
    return {
      version: 1,
      state: {
        bankrollCents: this.state.bankrollCents,
        startingBankrollCents: this.state.startingBankrollCents,
        accumulatedLossCents: this.state.accumulatedLossCents,
        currentProgressionLossCents: this.state.currentProgressionLossCents,
        recoveryAttributionKnown: this.state.recoveryAttributionKnown,
        progressionStep: this.state.progressionStep,
        currentStreets: [...this.state.currentStreets],
        spins: this.state.spins,
      },
      decisions: this.decisions.map((decision) => structuredClone(decision)),
      decisionCounts: {...this.decisionCounts},
    };
  }

  /** Reflection: honest performance summary from the prequential record. */
  reflection(){
    return {
      observationCount: this.engine.observationCount,
      prediction: this.engine.performance,
      models: this.engine.modelPerformance,
      evidence: this.evidenceAssessment(),
      decisions: {...this.decisionCounts},
      bankrollCents: this.state.bankrollCents,
      accumulatedLossCents: this.state.accumulatedLossCents,
      profitLossCents: this.state.bankrollCents - this.state.startingBankrollCents,
    };
  }
}
