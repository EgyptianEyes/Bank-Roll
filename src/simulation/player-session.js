import {assertSafeMoneyCents} from "../core/mathematics.js";
import {settleWager} from "../bankroll/accounting.js";
import {streetOf, isValidOutcome} from "../core/roulette.js";
import {assessForecastEvidence} from "../intelligence/bri-coordinator.js";
import {StreetPredictionEngine} from "../intelligence/prediction-engine.js";
import {decideNextAction} from "../strategies/decision-engine.js";
import {approvePlayerWager, assessPlayerCadence, playerStopReason, replayPlayerFinancials, validatePlayerSettings} from "./player-rules.js";

const DEFAULT_SETTINGS = Object.freeze({
  startingBankrollCents: 10000,
  unitCents: 20,
  progressionMode: "flat",
  candidateCount: 3,
  sustainabilityHorizon: 3,
  minimumModelEvaluations: 25,
  maxStakeCents: 0,
  maxExposureCents: 0,
  tableMaxStakeCents: 0,
  stopLossCents: 0,
  takeProfitCents: 0,
  maxSteps: 6,
});

function selectedProbabilities(forecast){
  const selected = forecast.candidateModels.find((model) => model.modelVersion === forecast.modelVersion);
  return [...(selected || forecast.candidateModels[0]).probabilities];
}

function rankStreets(probabilities, limit){
  return probabilities.slice(0, 12)
    .map((probability, street) => ({street, probability}))
    .sort((left, right) => right.probability - left.probability || left.street - right.street)
    .slice(0, limit)
    .map((entry) => entry.street);
}

function decisionSettings(settings){
  return {
    maxStakeCents: settings.maxStakeCents,
    maxExposureCents: settings.maxExposureCents,
    tableMaxStakeCents: settings.tableMaxStakeCents,
    stopLossCents: settings.stopLossCents,
    maxSteps: settings.maxSteps,
  };
}

export class PlayerSession{
  constructor({store, table, session, engineOptions = {}, now = () => new Date().toISOString()} = {}){
    if (!store || !table || !session) throw new TypeError("PlayerSession requires a table, session, and local store.");
    this.store = store;
    this.table = table;
    this.session = session;
    this.now = now;
    this.settings = {...DEFAULT_SETTINGS, ...table.settings, ...session.settings};
    validatePlayerSettings(this.settings);
    this.session.settings = this.settings;
    this.engineOptions = {minimumObservations: 10, minimumModelEvaluations: this.settings.minimumModelEvaluations, ...engineOptions};
    this.engine = new StreetPredictionEngine({...this.engineOptions, recordTimestamps: true});
    this.observations = [];
    this.ready = false;
  }

  static async create({store, table, session, engineOptions, now}){
    const player = new PlayerSession({store, table, session, engineOptions, now});
    await player.restore();
    return player;
  }

  async restore(){
    if (this.store.getTable) this.table = await this.store.getTable(this.table.id);
    this.observations = await this.store.listObservations(this.table.id);
    await this.rebuildEngine();
    if (this.session.gapBeforeNext) this.engine.breakContinuity();
    if (this.session.pendingForecast && !this.engine.pendingForecast){
      this.engine.recordHistoricalForecast(this.session.pendingForecast);
    }
    this.ready = true;
    return this;
  }

  async prepareRecommendation(){
    this.assertReady();
    this.assertActive();
    if (this.session.pendingActualWager) throw new Error("Record the result of the confirmed wager before preparing another one.");
    let forecast = this.engine.pendingForecast;
    if (!forecast) forecast = this.engine.forecastNext();
    if (!forecast){
      await this.store.savePending(this.session.id, {forecast: null, recommendation: null}, this.session.revision || 0);
      this.session = await this.store.getSession(this.session.id);
      return {forecast: null, decision: null, message: "Observation only: at least 10 recorded results are needed before a forecast can be prepared."};
    }
    const probabilities = selectedProbabilities(forecast);
    const evidence = assessForecastEvidence(this.engine, this.settings.minimumModelEvaluations);
    const stopReason = playerStopReason(this.session);
    const decision = decideNextAction({
      bankrollCents: this.session.bankrollCents,
      startingBankrollCents: this.session.startingBankrollCents,
      accumulatedLossCents: this.session.accumulatedLossCents,
      currentProgressionLossCents: this.session.currentProgressionLossCents,
      recoveryAttributionKnown: this.session.recoveryAttributionKnown,
      progressionStep: this.session.progressionStep,
      progressionMode: this.settings.progressionMode,
      unitCents: this.settings.unitCents,
      probabilities,
      currentStreets: this.session.currentStreets,
      candidateStreets: rankStreets(probabilities, this.settings.candidateCount),
      limits: decisionSettings(this.settings),
      sustainabilityHorizon: this.settings.sustainabilityHorizon,
      evidenceWeak: evidence.evidenceWeak || Boolean(stopReason),
      wageringMode: "evidence-gated",
      observationCount: this.engine.observationCount,
      forecastWindowSize: forecast.windowSize ?? 0,
      modelSampleSize: forecast.modelSampleSize ?? 0,
      modelVersion: forecast.modelVersion,
    });
    if (stopReason) decision.reasons.unshift(`Session risk limit: ${stopReason}. No further wagers are permitted.`);
    const recommendation = {
      version: 1,
      mode: "physical-player-evidence-gated",
      evidence,
      strategyVersion: "player-evidence-policy-v2",
      strategyAssessment: {
        preferredStrategy: "observation-only",
        rationale: "No staking progression is independently validated as advantageous. Flat is the default risk-control baseline, not a proven edge.",
        forecastStatus: evidence.evidenceWeak ? "not-qualified" : "internal-prospective-screen-passed-not-independent-validation",
        configuredProgression: this.settings.progressionMode,
        progressionSource: "player-selected-exploratory-setting",
        candidateAction: decision.action,
      },
      progressionMode: this.settings.progressionMode,
      stopReason,
      decision: structuredClone(decision),
      forecastedAt: forecast.forecastedAt,
    };
    try {
      await this.store.savePending(this.session.id, {forecast, recommendation}, this.session.revision || 0);
    } catch (error) {
      this.engine.cancelPendingForecast();
      throw error;
    }
    this.session = await this.store.getSession(this.session.id);
    return {forecast, decision, evidence, recommendation};
  }

  async confirmRecommendation(){
    this.assertReady();
    const recommendation = this.session.pendingRecommendation;
    if (!recommendation) throw new Error("Prepare a fresh recommendation before confirming a wager.");
    const decision = recommendation.decision;
    if (decision.action === "stop") throw new Error("BRI recommends no bet. You may record no bet or enter a manual wager within your limits.");
    const candidate = decision.selected;
    const wager = {
      kind: "streets",
      chosen: [...candidate.streets],
      perStreetStakeCents: candidate.financials.perStreetStakeCents,
      streetStakeCents: [...candidate.financials.streetStakeCents],
      totalStakeCents: candidate.financials.totalStakeCents,
      action: candidate.action,
      progressionStep: candidate.step,
      progressionMode: this.settings.progressionMode,
      origin: "bri-recommendation",
    };
    return this.confirmWager(wager);
  }

  async confirmManualStreetWager(streets, perStreetStakeCents){
    this.assertReady();
    if (!Array.isArray(streets) || streets.length < 1 || streets.length > 12 || new Set(streets).size !== streets.length || streets.some((street) => !Number.isInteger(street) || street < 0 || street > 11)){
      throw new RangeError("Select one to twelve unique streets.");
    }
    assertSafeMoneyCents(perStreetStakeCents, "Per-street stake");
    if (perStreetStakeCents <= 0) throw new RangeError("Stake per street must be at least one penny.");
    const wager = {
      kind: "streets",
      chosen: [...streets],
      perStreetStakeCents,
      streetStakeCents: streets.map(() => perStreetStakeCents),
      totalStakeCents: assertSafeMoneyCents(perStreetStakeCents * streets.length, "Total stake"),
      action: "manual",
      progressionStep: this.session.progressionStep,
      progressionMode: this.settings.progressionMode,
      origin: "player-manual",
    };
    return this.confirmWager(wager);
  }

  async confirmNoBet(){
    this.assertReady();
    this.assertActive();
    this.session = await this.store.confirmWager(this.session.id, null, this.session.revision || 0);
    return this.session;
  }

  async confirmWager(wager){
    this.assertActive();
    if (this.session.pendingActualWager) throw new Error("A confirmed wager is already awaiting its result.");
    approvePlayerWager(this.session, wager);
    this.session = await this.store.confirmWager(this.session.id, wager, this.session.revision || 0);
    return this.session;
  }

  async recordOutcome(outcome, {claimedAt = null} = {}){
    this.assertReady();
    this.assertActive();
    if (!isValidOutcome(outcome)) throw new RangeError("Enter a European roulette result from 0 to 36.");
    if (this.session.pendingRecommendation && this.session.wagerStatus === "awaiting-player"){
      throw new Error("Confirm the BRI wager or explicitly record no bet before entering the result.");
    }
    const previousModelState = this.engine.snapshot();
    const previousForecast = this.engine.pendingForecast;
    const receivedAt = this.store.now ? this.store.now() : this.now();
    const cadence = assessPlayerCadence(this.session, receivedAt);
    if (cadence.quarantined) this.engine.breakContinuity();
    const forecastEvaluation = cadence.quarantined ? null : this.engine.observe(outcome);
    const wager = this.session.pendingActualWager;
    let settlement = null;
    let hit = false;
    if (wager){
      settlement = settleWager(wager, outcome);
      hit = settlement.hit;
    }
    const evaluation = {
      hit,
      forecastHit: forecastEvaluation?.hit ?? null,
      forecastEvaluation: forecastEvaluation ? structuredClone(forecastEvaluation) : null,
      settlement,
    };
    let record;
    try {
      record = await this.store.appendOutcome({
        tableId: this.table.id,
        sessionId: this.session.id,
        outcome,
        evaluation,
        modelState: this.engine.snapshot(),
        claimedAt,
        expectedRevision: this.session.revision || 0,
        receivedAt,
      });
    } catch (error) {
      this.engine.restore(previousModelState);
      if (previousForecast) this.engine.recordHistoricalForecast(previousForecast);
      throw error;
    }
    this.observations.push({...record, effectiveOutcome: outcome, corrections: []});
    this.session = await this.store.getSession(this.session.id);
    return {record, evaluation, session: this.session};
  }

  async markGap(options){
    this.assertReady();
    if (this.session.pendingActualWager) throw new Error("Resolve the confirmed wager before marking a missed-spin gap.");
    const previousModelState = this.engine.snapshot();
    this.engine.cancelPendingForecast();
    let event;
    try {
      event = await this.store.markGap(this.session.id, options, this.session.revision || 0);
    } catch (error) {
      this.engine.restore(previousModelState);
      if (this.session.pendingForecast) this.engine.recordHistoricalForecast(this.session.pendingForecast);
      throw error;
    }
    this.session = await this.store.getSession(this.session.id);
    if (options?.missingSpins !== 0) this.engine.breakContinuity();
    return event;
  }

  async correctOutcome(observationId, correctedOutcome, reason = ""){
    this.assertReady();
    if (correctedOutcome !== null && !isValidOutcome(correctedOutcome)) throw new RangeError("A corrected result must be between 0 and 36.");
    if (this.session.pendingActualWager) throw new Error("Resolve the confirmed wager before correcting a result.");
    const observation = this.observations.find((entry) => entry.id === observationId);
    if (!observation) throw new RangeError("That result is not part of this table's local history.");
    const target = this.observations.find((entry) => entry.id === observationId);
    const previousOutcome = target.effectiveOutcome;
    const previousVoided = target.voided;
    const previousEngine = this.engine.snapshot();
    const previousForecast = this.engine.pendingForecast;
    target.effectiveOutcome = correctedOutcome;
    target.voided = correctedOutcome === null;
    await this.rebuildEngine();
    const sessions = this.store.listSessions ? await this.store.listSessions(this.table.id) : [this.session];
    const updatedSessions = sessions.map((session) => ({...session, ...replayPlayerFinancials(session, this.observations)}));
    const financialState = updatedSessions.find((session) => session.id === this.session.id);
    const forecastEvaluation = this.lastReplayedEvaluations.get(observationId) || null;
    const wager = target.actualWager;
    const settlement = wager && correctedOutcome !== null ? settleWager(wager, correctedOutcome) : null;
    const correctedEvaluation = {
      hit: settlement?.hit ?? false,
      forecastHit: forecastEvaluation?.hit ?? null,
      forecastEvaluation: forecastEvaluation ? structuredClone(forecastEvaluation) : null,
      settlement,
    };
    const updatedSession = {
      ...this.session,
      ...financialState,
      pendingForecast: null,
      pendingRecommendation: null,
      wagerStatus: "no-bet-recorded",
    };
    if (correctedOutcome === null && wager && target.sessionId === this.session.id){
      updatedSession.pendingActualWager = wager;
      updatedSession.bankrollCents = assertSafeMoneyCents(updatedSession.bankrollCents - wager.totalStakeCents);
      updatedSession.totalStakedCents = assertSafeMoneyCents(updatedSession.totalStakedCents + wager.totalStakeCents);
      updatedSession.wagerStatus = "player-confirmed";
    }
    this.engine.resetEvidence();
    const evidenceResetSequence = (this.observations.at(-1)?.sequence || 0) + 1;
    let correction;
    try {
      correction = await this.store.addCorrection(observationId, correctedOutcome, reason, {
        updatedSession,
        updatedSessions,
        expectedRevision: this.session.revision || 0,
        evidenceResetSequence,
        evaluation: correctedEvaluation,
        modelState: this.engine.snapshot(),
      });
    } catch (error) {
      target.effectiveOutcome = previousOutcome;
      target.voided = previousVoided;
      this.engine.restore(previousEngine);
      if (previousForecast) this.engine.recordHistoricalForecast(previousForecast);
      throw error;
    }
    this.observations = await this.store.listObservations(this.table.id);
    this.session = await this.store.getSession(this.session.id);
    this.table.evidenceResetSequence = evidenceResetSequence;
    return correction;
  }

  async undoLastOutcome(){
    const last = this.observations.filter((entry) => !entry.voided).at(-1);
    if (!last || last.sessionId !== this.session.id) throw new Error("There is no current-session result to undo.");
    return this.correctOutcome(last.id, null, "Player undid the last entry; original record retained.");
  }

  async rebuildEngine(){
    this.engine.reset();
    this.lastReplayedEvaluations = new Map();
    for (const observation of this.observations){
      if (observation.gapBefore || observation.voided || observation.trustStatus === "quarantined") this.engine.breakContinuity();
      if (observation.voided || observation.trustStatus === "quarantined") continue;
      if (observation.sequence >= (this.table.evidenceResetSequence || 0) && observation.forecast && observation.forecast.observationCount === this.engine.observationCount){
        this.engine.recordHistoricalForecast(observation.forecast);
      }
      const evaluation = this.engine.observe(observation.effectiveOutcome);
      if (evaluation) this.lastReplayedEvaluations.set(observation.id, evaluation);
    }
  }

  replaySessionFinancials(){
    return replayPlayerFinancials(this.session, this.observations);
  }

  async exportHistory(){
    this.assertReady();
    const events = await this.store.listEvents?.(this.table.id) || [];
    return {
      schemaVersion: 2,
      exportedAt: this.now(),
      provenance: "human-observed-unverified",
      table: this.store.getTable ? await this.store.getTable(this.table.id) : this.table,
      session: this.session,
      sessions: this.store.listSessions ? await this.store.listSessions(this.table.id) : [this.session],
      observations: this.observations,
      events,
    };
  }

  assertReady(){
    if (!this.ready) throw new Error("Player Mode is still loading this table's local history.");
  }

  assertActive(){
    if (this.session.status !== "active") throw new Error("This session has ended. Start a new session to continue.");
  }
}

export {DEFAULT_SETTINGS as PLAYER_DEFAULT_SETTINGS, streetOf};
