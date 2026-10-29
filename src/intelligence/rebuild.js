import {isValidOutcome} from "../core/roulette.js";
import {StreetPredictionEngine} from "./prediction-engine.js";

/**
 * Chronological model reconstruction after historical corrections.
 *
 * The server rebuilds SQL-derived statistics from the effective outcome
 * history; this module rebuilds the in-browser model state from the same
 * history. Original forecasts and their historical model versions are never
 * rewritten: reconstruction replays their stored candidate distributions
 * before each effective outcome, rebuilding model scores without creating
 * replacement predictions.
 */
export function rebuildPredictionEngine(effectiveOutcomes, options = {}){
  if (!Array.isArray(effectiveOutcomes)) throw new TypeError("Effective outcomes must be an array.");
  const engine = new StreetPredictionEngine(options);
  for (const entry of effectiveOutcomes){
    const outcome = typeof entry === "number" ? entry : entry.effective_outcome;
    if (!isValidOutcome(outcome)) throw new RangeError("Effective outcomes must be integers from 0 to 36.");
    const storedForecast = typeof entry === "object" ? entry.forecast : null;
    if (storedForecast) engine.recordHistoricalForecast(storedForecast);
    engine.observe(outcome);
  }
  return engine;
}

/**
 * Runs the full client/server recovery sequence for a corrected table:
 * 1. server-side statistical rebuild (idempotent, retry-safe),
 * 2. paged download of the effective chronological history,
 * 3. chronological model reconstruction,
 * 4. checkpoint upload, which the server accepts only when it matches the
 *    rebuilt ledger, after which forecasting may resume.
 */
export async function recoverCorrectedTable(client, {tableId, dataOrigin = "observed", engineOptions = {}, pageLimit = 500} = {}){
  const rebuild = await client.runRebuild({tableId, dataOrigin});
  const outcomes = [];
  let offset = 0;
  for (;;){
    const page = await client.getRebuildStatus({tableId, dataOrigin, offset, limit: pageLimit});
    for (const event of page.events) outcomes.push(event);
    if (!page.has_more) break;
    offset = page.next_offset;
  }
  const engine = rebuildPredictionEngine(outcomes, engineOptions);
  const upload = await client.uploadModelState({tableId, dataOrigin, modelState: engine.snapshot()});
  if (!upload.state_valid) throw new Error("The rebuilt model checkpoint was not accepted.");
  return {rebuild, engine, observationCount: outcomes.length};
}
