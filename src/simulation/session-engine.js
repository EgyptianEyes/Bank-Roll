import {fromMinorUnits, toMinorUnits} from "../core/mathematics.js";
import {streetOf} from "../core/roulette.js";
import {canPlaceWager, settleWager} from "../bankroll/accounting.js";
import {createWager} from "../strategies/strategy-engine.js";
import {MAX_PROGRESSION_STEP} from "../strategies/progression.js";

export function createSessionState(config){
  const startingBankrollCents = toMinorUnits(config.bankroll);
  return {
    startingBankrollCents,
    bankrollCents: startingBankrollCents,
    progressionStep: 1,
    maxSteps: config.maxSteps,
    gaps: new Array(12).fill(0),
    spins: 0,
    totalStakedCents: 0,
    totalReturnedCents: 0,
    maxStakeCents: 0,
    peakBankrollCents: startingBankrollCents,
    maximumDrawdownCents: 0,
    stopReason: null,
  };
}

function limitReason(config, state){
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

export function prepareSessionSpin(config, state){
  state.spins++;
  const stoppingReason = limitReason(config, state);
  if (stoppingReason){
    state.stopReason = stoppingReason;
    return {action: "stop", reason: stoppingReason, wager: null};
  }
  if (state.progressionStep > MAX_PROGRESSION_STEP){
    state.stopReason = "progression limit";
    return {action: "stop", reason: "progression limit", wager: null};
  }

  if (config.betType === "streets"){
    for (let street = 0; street < 12; street++) state.gaps[street]++;
  }
  const wager = createWager(config, state.progressionStep, state.gaps);
  if (!wager) return {action: "observe", reason: null, wager: null};

  const limits = {
    maxStakeCents: config.maxStake > 0 ? toMinorUnits(config.maxStake) : 0,
    maxExposureCents: config.maxExposure > 0 ? toMinorUnits(config.maxExposure) : 0,
  };
  const approval = canPlaceWager(state.bankrollCents, wager, limits);
  if (!approval.allowed){
    state.stopReason = approval.reason;
    return {action: "stop", reason: approval.reason, wager};
  }

  state.bankrollCents -= wager.totalStakeCents;
  state.totalStakedCents += wager.totalStakeCents;
  state.maxStakeCents = Math.max(state.maxStakeCents, wager.totalStakeCents);
  return {action: "bet", reason: null, wager};
}

export function settleSessionSpin(state, wager, outcome){
  const street = streetOf(outcome);
  for (let candidate = 0; candidate < 12; candidate++){
    if (candidate === street) state.gaps[candidate] = 0;
  }

  if (!wager){
    return {hit: false, grossReturnCents: 0, netChangeCents: 0, bankroll: fromMinorUnits(state.bankrollCents)};
  }

  const settlement = settleWager(wager, outcome);
  state.bankrollCents += settlement.grossReturnCents;
  state.totalReturnedCents += settlement.grossReturnCents;
  state.progressionStep = settlement.hit ? 1 : state.progressionStep + 1;
  updateDrawdown(state);
  if (state.progressionStep > state.maxSteps){
    state.stopReason = "max steps";
  }
  return {...settlement, bankroll: fromMinorUnits(state.bankrollCents)};
}

export function completeSession(config, state){
  return {
    final: fromMinorUnits(state.bankrollCents),
    pl: fromMinorUnits(state.bankrollCents - state.startingBankrollCents),
    spins: state.spins,
    reason: state.stopReason || "max spins",
    totalStaked: fromMinorUnits(state.totalStakedCents),
    totalReturned: fromMinorUnits(state.totalReturnedCents),
    maxStake: fromMinorUnits(state.maxStakeCents),
    maximumDrawdown: fromMinorUnits(state.maximumDrawdownCents),
    state,
  };
}
