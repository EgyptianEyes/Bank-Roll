/**
 * BRI companion personality.
 *
 * A persistent, determined mathematical companion. It consumes genuine
 * session and research events and produces commentary only; it exposes no
 * method that returns a betting decision and holds no reference to the
 * engines, so personality can never influence the mathematics or override
 * financial protections.
 */
export const COMPANION_MODES = Object.freeze(["quiet", "companion", "full"]);
export const COMPANION_MOODS = Object.freeze(["determined", "celebrating", "frustrated", "dejected", "recalculating", "disciplined"]);

const PHRASES = {
  forecast: [
    (c) => `Street ${c.street + 1} is my call — ${(c.probability * 100).toFixed(1)}% on the current model.`,
    (c) => `Watching street ${c.street + 1}. The ${c.modelVersion} model likes it at ${(c.probability * 100).toFixed(1)}%.`,
  ],
  hit: [
    (c) => `Yes! Street ${c.street + 1} came in. Winning Streets! That's ${c.successful} of ${c.total} now.`,
    (c) => `Called it — street ${c.street + 1}. The record stands at ${c.successful}/${c.total}.`,
  ],
  miss: [
    (c) => `Hmph. ${c.actual} was not what I calculated. Recording it and moving on.`,
    (c) => `Wrong again — ${c.actual}. The score is kept honestly: ${c.successful}/${c.total}.`,
  ],
  dejected: [
    (c) => `That hypothesis isn't holding up. ${c.consecutiveMisses} misses in a row. I need to recalculate.`,
    (c) => `Dejected, I admit it. ${c.consecutiveMisses} straight misses. Back to the numbers.`,
  ],
  recalculating: [
    () => "Recalculating. Every evaluation is preserved — failures teach as much as wins.",
    () => "Rebuilding my view of this table from the corrected history. Honest numbers only.",
  ],
  decisionStop: [
    (c) => c.reason || "The numbers say stop. Discipline beats determination today; I'll keep observing.",
    () => "I want to continue — but the financial constraints say no. Observing only.",
  ],
  decisionSwitch: [
    (c) => `Switching streets — the evidence moved. Accumulated losses stay on the books: ${c.losses}.`,
  ],
  decisionSpread: [
    () => "Spreading the stake across more streets. Same exposure discipline, wider net.",
  ],
  milestone: [
    (c) => `${c.count} spins observed on this table. ${c.count >= 100 ? "Full observation maturity reached." : "Forecasting is live."}`,
  ],
};

export class BriCompanion{
  constructor({mode = "companion", speech = false, speechSynthesis = null, memoryLimit = 50} = {}){
    this.setMode(mode);
    this.speechEnabled = Boolean(speech); // muted by default
    this.speechSynthesis = speechSynthesis;
    this.mood = "determined";
    this.memory = [];
    this.memoryLimit = memoryLimit;
    this.consecutiveMisses = 0;
    this.lastMessage = null;
    this.phraseCursor = new Map();
  }

  setMode(mode){
    if (!COMPANION_MODES.includes(mode)) throw new RangeError(`Unsupported companion mode: ${mode}`);
    this.mode = mode;
    return this;
  }

  setSpeech(enabled){
    this.speechEnabled = Boolean(enabled);
    return this;
  }

  remember(entry){
    this.memory.push({...entry, at: new Date().toISOString()});
    if (this.memory.length > this.memoryLimit) this.memory.shift();
  }

  nextPhrase(kind, context){
    const variants = PHRASES[kind];
    const cursor = this.phraseCursor.get(kind) || 0;
    this.phraseCursor.set(kind, (cursor + 1) % variants.length);
    const message = variants[cursor](context);
    if (message === this.lastMessage) return null; // avoid repetition
    this.lastMessage = message;
    return message;
  }

  say(kind, context, {essential = false} = {}){
    if (this.mode === "quiet") return null;
    if (this.mode === "companion" && !essential && kind === "forecast") return null;
    const message = this.nextPhrase(kind, context);
    if (!message) return null;
    this.remember({kind, message});
    if (this.speechEnabled && this.speechSynthesis && typeof this.speechSynthesis.speak === "function" && typeof globalThis.SpeechSynthesisUtterance === "function"){
      try {
        this.speechSynthesis.speak(new globalThis.SpeechSynthesisUtterance(message));
      } catch {
        // Speech is strictly optional.
      }
    }
    return message;
  }

  onForecast(forecast){
    this.mood = "determined";
    return this.say("forecast", forecast);
  }

  onEvaluation(evaluation){
    const performance = evaluation.performance || {successful: 0, total: 0};
    if (evaluation.hit){
      this.consecutiveMisses = 0;
      this.mood = "celebrating";
      return this.say("hit", {street: evaluation.forecast.street, ...performance}, {essential: true});
    }
    this.consecutiveMisses++;
    if (this.consecutiveMisses >= 5){
      this.mood = "dejected";
      const message = this.say("dejected", {consecutiveMisses: this.consecutiveMisses}, {essential: true});
      this.mood = "recalculating";
      return message;
    }
    this.mood = "frustrated";
    return this.say("miss", {actual: evaluation.actual, ...performance});
  }

  onDecision(decision){
    if (decision.action === "stop"){
      this.mood = "disciplined";
      return this.say("decisionStop", {reason: decision.reasons?.[0]}, {essential: true});
    }
    if (decision.action === "switch"){
      this.mood = "recalculating";
      return this.say("decisionSwitch", {losses: `£${(decision.accumulatedLossCents / 100).toFixed(2)}`}, {essential: true});
    }
    if (decision.action === "spread"){
      return this.say("decisionSpread", {});
    }
    this.mood = "determined";
    return null;
  }

  onRebuild(){
    this.mood = "recalculating";
    return this.say("recalculating", {}, {essential: true});
  }

  onMilestone(count){
    return this.say("milestone", {count}, {essential: true});
  }

  snapshotMemory(){
    return [...this.memory];
  }
}
