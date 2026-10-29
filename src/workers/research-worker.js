import {compareAutonomousStrategies, compareStrategies} from "../simulation/research-lab.js";

/**
 * Research laboratory Web Worker. Runs large identical-sequence strategy
 * comparisons off the interface thread. Messages:
 *   {type: "run", id, seed, sessions, maxSpins, variants} → legacy progress/result
 *   {type: "run-autonomous", id, seed, spins, scenario, baseConfig, variants} → progress/result
 *   {type: "cancel", id} → stops the autonomous run at its next 1,024-spin checkpoint
 * Commentary and UI never run here; correctness is never traded for speed.
 */
const cancelledRuns = new Set();

self.onmessage = async (event) => {
  const message = event.data || {};
  if (message.type === "cancel"){
    cancelledRuns.add(message.id);
    return;
  }
  if (message.type !== "run" && message.type !== "run-autonomous") return;
  const {id, seed, sessions, maxSpins, variants} = message;
  try {
    const shouldCancel = () => cancelledRuns.has(id);
    const onProgress = (progress) => self.postMessage({type: "progress", id, ...progress});
    const report = message.type === "run-autonomous"
      ? await compareAutonomousStrategies({
        seed,
        spins: message.spins,
        scenario: message.scenario,
        baseConfig: message.baseConfig,
        variants,
        shouldCancel,
        onProgress,
        yieldEvery: message.yieldEvery ?? 1024,
      })
      : compareStrategies({seed, sessions, maxSpins, variants, shouldCancel, onProgress});
    self.postMessage({type: "result", id, report});
  } catch (error) {
    self.postMessage({type: "error", id, error: error.message});
  } finally {
    cancelledRuns.delete(id);
  }
};
