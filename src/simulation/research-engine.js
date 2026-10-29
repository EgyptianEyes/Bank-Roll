import {spinNumber} from "../core/roulette.js";
import {createSessionState, prepareSessionSpin, settleSessionSpin, completeSession} from "./session-engine.js";

export function simulateSession(config, random){
  const state = createSessionState(config);
  while (state.spins < config.maxSpins && !state.stopReason){
    const prepared = prepareSessionSpin(config, state);
    if (prepared.action === "stop") break;
    settleSessionSpin(state, prepared.wager, spinNumber(random));
  }
  return completeSession(config, state);
}