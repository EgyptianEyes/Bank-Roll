import {spinNumber} from "../core/roulette.js";
import {completeSession, createSessionState, prepareSessionSpin, settleSessionSpin} from "./session-engine.js";

export class LiveSessionEngine{
  constructor(config, random, savedState = null){
    this.config = config;
    this.random = random;
    this.state = savedState ? {...savedState, gaps: [...savedState.gaps]} : createSessionState(config);
    this.pendingSpin = null;
  }

  prepareNextSpin(){
    if (this.pendingSpin) throw new Error("Resolve the prepared spin before preparing another.");
    const prepared = prepareSessionSpin(this.config, this.state);
    const spin = {...prepared, spinNumber: this.state.spins};
    if (spin.action !== "stop") this.pendingSpin = spin;
    return spin;
  }

  previewNextSpin(){
    if (this.pendingSpin) throw new Error("Resolve the prepared spin before previewing another.");
    const previewState = {...this.state, gaps: [...this.state.gaps]};
    const prepared = prepareSessionSpin(this.config, previewState);
    return {...prepared, spinNumber: previewState.spins};
  }

  resolveSpin(prepared){
    if (prepared.action === "stop") throw new Error("A stopped spin cannot be resolved.");
    if (prepared !== this.pendingSpin) throw new Error("Only the currently prepared spin can be resolved.");
    const outcome = spinNumber(this.random);
    const settlement = settleSessionSpin(this.state, prepared.wager, outcome);
    this.pendingSpin = null;
    return {outcome, settlement};
  }

  get spins(){
    return this.state.spins;
  }

  get bankroll(){
    return this.state.bankrollCents / 100;
  }

  get stopReason(){
    return this.state.stopReason;
  }

  get profitLossCents(){
    return this.state.bankrollCents - this.state.startingBankrollCents;
  }

  get result(){
    return completeSession(this.config, this.state);
  }

  snapshot(){
    return {...this.state, gaps: [...this.state.gaps]};
  }
}