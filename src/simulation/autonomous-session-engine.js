import {toMinorUnits} from "../core/mathematics.js";
import {spinNumber} from "../core/roulette.js";
import {canPlaceWager} from "../bankroll/accounting.js";
import {BriCoordinator} from "../intelligence/bri-coordinator.js";
import {completeSession, createSessionState} from "./session-engine.js";

function stoppingReason(config, state){
  const profitLoss = state.bankrollCents - state.startingBankrollCents;
  if (config.stopLoss > 0 && profitLoss <= -toMinorUnits(config.stopLoss)) return "stop-loss";
  if (config.takeProfit > 0 && profitLoss >= toMinorUnits(config.takeProfit)) return "take-profit";
  if (state.bankrollCents <= 0) return "bust";
  return null;
}

function updateDrawdown(state){
  state.peakBankrollCents = Math.max(state.peakBankrollCents, state.bankrollCents);
  state.maximumDrawdownCents = Math.max(state.maximumDrawdownCents, state.peakBankrollCents - state.bankrollCents);
}

export class AutonomousSessionEngine{
  constructor(config, random, predictionEngine, savedState = null){
    if (!predictionEngine) throw new TypeError("A prediction engine is required for autonomous sessions.");
    this.config = config;
    this.random = random;
    this.predictionEngine = predictionEngine;
    if (savedState?.predictionEngineState) this.predictionEngine.restore(savedState.predictionEngineState);
    this.state = savedState ? {
      ...savedState,
      gaps: [...savedState.gaps],
      coordinatorState: undefined,
      predictionEngineState: undefined,
    } : createSessionState(config);
    this.coordinator = new BriCoordinator({
      unitCents: toMinorUnits(config.unit),
      bankrollCents: this.state.bankrollCents,
      progressionMode: config.progression,
      limits: {
        stopLossCents: config.stopLoss > 0 ? toMinorUnits(config.stopLoss) : 0,
        maxStakeCents: config.maxStake > 0 ? toMinorUnits(config.maxStake) : 0,
        maxExposureCents: config.maxExposure > 0 ? toMinorUnits(config.maxExposure) : 0,
        maxSteps: config.maxSteps,
      },
      candidateCount: config.maxStreets,
      wageringMode: config.wageringMode || "evidence-gated",
      researchActionPolicy: config.researchActionPolicy || "adaptive",
      decisionHistoryLimit: config.decisionHistoryLimit ?? 1000,
      recordDecisions: config.recordDecisions !== false,
      engine: predictionEngine,
    });
    if (savedState?.coordinatorState) this.coordinator.restoreState(savedState.coordinatorState);
    this.pendingSpin = null;
  }

  previewNextSpin(){
    if (this.pendingSpin) throw new Error("Resolve the prepared spin before previewing another.");
    const reason = stoppingReason(this.config, this.state);
    return {
      action: reason ? "stop" : "prepare",
      reason,
      forecast: reason ? null : this.coordinator.prepareForecast(),
      wager: null,
      spinNumber: this.state.spins + 1,
    };
  }

  prepareNextSpin(){
    if (this.pendingSpin) throw new Error("Resolve the prepared spin before preparing another.");
    const reason = stoppingReason(this.config, this.state);
    if (reason){
      this.state.spins++;
      this.state.stopReason = reason;
      return {action: "stop", reason, wager: null, spinNumber: this.state.spins};
    }

    const coordinated = this.coordinator.beforeSpin();
    this.state.spins = coordinated.spins;
    let wager = coordinated.wager;
    if (wager){
      const approval = canPlaceWager(this.coordinator.state.bankrollCents + wager.totalStakeCents, wager, {
        maxStakeCents: this.config.maxStake > 0 ? toMinorUnits(this.config.maxStake) : 0,
        maxExposureCents: this.config.maxExposure > 0 ? toMinorUnits(this.config.maxExposure) : 0,
      });
      if (!approval.allowed){
        this.coordinator.state.bankrollCents += wager.totalStakeCents;
        this.coordinator.pending = null;
        if (coordinated.forecast) this.predictionEngine.cancelPendingForecast();
        this.state.spins--;
        throw new Error(`BRI wager rejected by independent bankroll approval: ${approval.reason}.`);
      } else {
        this.state.totalStakedCents += wager.totalStakeCents;
        this.state.maxStakeCents = Math.max(this.state.maxStakeCents, wager.totalStakeCents);
      }
    }

    this.state.bankrollCents = this.coordinator.state.bankrollCents;
    const prepared = {
      ...coordinated,
      action: wager ? "bet" : "observe",
      decisionAction: coordinated.decision?.action || "observe",
      wager,
      spinNumber: coordinated.spins,
    };
    this.pendingSpin = prepared;
    return prepared;
  }

  resolveSpin(prepared){
    return this.resolveOutcome(prepared, spinNumber(this.random));
  }

  resolveOutcome(prepared, outcome){
    if (prepared !== this.pendingSpin) throw new Error("Only the currently prepared spin can be resolved.");
    const result = this.coordinator.afterSpin(outcome);
    this.pendingSpin = null;
    this.state.bankrollCents = this.coordinator.state.bankrollCents;
    if (result.settlement) this.state.totalReturnedCents += result.settlement.grossReturnCents;
    updateDrawdown(this.state);
    this.state.stopReason = stoppingReason(this.config, this.state);
    return {...result, settlement: result.settlement && {
      ...result.settlement,
      bankroll: this.bankroll,
    }};
  }

  get spins(){ return this.state.spins; }
  get bankroll(){ return this.state.bankrollCents / 100; }
  get stopReason(){ return this.state.stopReason; }
  get profitLossCents(){ return this.state.bankrollCents - this.state.startingBankrollCents; }
  get result(){ return completeSession(this.config, this.state); }

  snapshot(){
    return {
      ...this.state,
      gaps: [...this.state.gaps],
      coordinatorState: this.coordinator.snapshotState(),
      predictionEngineState: this.predictionEngine.snapshot(),
    };
  }
}
