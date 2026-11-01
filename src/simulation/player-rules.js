import {assertSafeMoneyCents, addMoneyCents} from "../core/mathematics.js";
import {canPlaceWager, settleWager} from "../bankroll/accounting.js";
import {stakeForStep} from "../strategies/progression.js";

export function validatePlayerSettings(settings){
  for (const key of ["startingBankrollCents", "unitCents", "maxStakeCents", "maxExposureCents", "tableMaxStakeCents", "stopLossCents", "takeProfitCents"]){
    const value = settings[key] ?? 0;
    assertSafeMoneyCents(value, key);
    if (value < 0 || (["startingBankrollCents", "unitCents"].includes(key) && value < 1)){
      throw new RangeError(`${key} must be ${key === "unitCents" || key === "startingBankrollCents" ? "positive" : "non-negative"}.`);
    }
  }
  if (!["flat", "linear", "fibo", "martingale"].includes(settings.progressionMode)) throw new RangeError("Choose a supported progression.");
  if (!Number.isInteger(settings.maxSteps) || settings.maxSteps < 1 || settings.maxSteps > 50) throw new RangeError("Progression depth must be between 1 and 50.");
  assertSafeMoneyCents(settings.unitCents * stakeForStep(settings.maxSteps, settings.progressionMode) * 144, "Configured progression and possible returns");
  return settings;
}

export function playerStopReason(session){
  const {settings} = session;
  const net = session.bankrollCents - session.startingBankrollCents;
  if (session.status !== "active") return "session ended";
  if (session.bankrollCents <= 0) return "bankroll exhausted";
  if (settings.stopLossCents > 0 && net <= -settings.stopLossCents) return "stop-loss reached";
  if (settings.takeProfitCents > 0 && net >= settings.takeProfitCents) return "take-profit reached";
  return null;
}

export function approvePlayerWager(session, wager){
  const reason = playerStopReason(session);
  if (reason) throw new Error(`Wager blocked: ${reason}. Observation may continue in an active session.`);
  settleWager(wager, 0);
  const approval = canPlaceWager(session.bankrollCents, wager, session.settings);
  if (!approval.allowed) throw new Error(`Wager blocked by ${approval.reason}.`);
  if (session.settings.tableMaxStakeCents > 0 && wager.streetStakeCents.some((stake) => stake > session.settings.tableMaxStakeCents)){
    throw new Error("Wager blocked by the per-street table limit.");
  }
  const floor = session.settings.stopLossCents > 0 ? Math.max(0, session.startingBankrollCents - session.settings.stopLossCents) : 0;
  if (session.bankrollCents - wager.totalStakeCents < floor) throw new Error("Wager blocked by the stop-loss floor.");
  addMoneyCents(session.totalStakedCents, wager.totalStakeCents);
  for (const stake of wager.streetStakeCents){
    addMoneyCents(session.bankrollCents - wager.totalStakeCents, assertSafeMoneyCents(stake * 12, "Possible return"));
    addMoneyCents(session.totalGrossReturnsCents, assertSafeMoneyCents(stake * 12, "Possible return"));
  }
}

export function replayPlayerFinancials(session, observations){
  const state = {
    bankrollCents: session.startingBankrollCents, totalStakedCents: 0, totalGrossReturnsCents: 0,
    wins: 0, losses: 0, accumulatedLossCents: 0, currentProgressionLossCents: 0,
    progressionStep: 1, currentStreets: [], recoveryAttributionKnown: true,
  };
  for (const observation of observations){
    if (observation.sessionId !== session.id || observation.voided || !observation.actualWager) continue;
    const wager = observation.actualWager;
    const settlement = settleWager(wager, observation.effectiveOutcome);
    if (wager.action === "switch") state.currentProgressionLossCents = 0;
    state.currentStreets = [...wager.chosen];
    state.bankrollCents = addMoneyCents(state.bankrollCents, settlement.netChangeCents);
    state.totalStakedCents = addMoneyCents(state.totalStakedCents, wager.totalStakeCents);
    state.totalGrossReturnsCents = addMoneyCents(state.totalGrossReturnsCents, settlement.grossReturnCents);
    state.wins += Number(settlement.hit);
    state.losses += Number(!settlement.hit);
    state.accumulatedLossCents = Math.max(0, addMoneyCents(state.accumulatedLossCents, -settlement.netChangeCents));
    state.currentProgressionLossCents = Math.max(0, addMoneyCents(state.currentProgressionLossCents, -settlement.netChangeCents));
    state.progressionStep = session.settings.progressionMode === "flat" || settlement.hit ? 1 : (wager.progressionStep ?? state.progressionStep) + 1;
  }
  return state;
}

export function assessPlayerCadence(session, timestamp){
  const elapsed = session.lastRecordedAt ? Date.parse(timestamp) - Date.parse(session.lastRecordedAt) : null;
  if (!Number.isFinite(Date.parse(timestamp))) throw new RangeError("Observation timestamp is invalid.");
  if (elapsed !== null && elapsed < 1500) throw new Error("Result not saved: wait at least 1.5 seconds between entries. Use Test Mode for rapid synthetic input.");
  const intervals = elapsed === null || session.gapBeforeNext ? [] : [...(session.entryIntervals || []), elapsed].slice(-8);
  const flags = [];
  if (elapsed !== null && elapsed < 8000 && !session.gapBeforeNext) flags.push("implausibly-fast-entry");
  if (intervals.length === 8 && Math.max(...intervals) < 15000 && Math.max(...intervals) - Math.min(...intervals) < 100){
    flags.push("machine-like-cadence");
  }
  return {flags, intervals, quarantined: flags.length > 0};
}
