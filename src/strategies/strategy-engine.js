import {multiplyMoneyCents, toMinorUnits} from "../core/mathematics.js";
import {stakeForStep} from "./progression.js";
import {selectColdestStreets} from "./street-selection.js";

export function createWager(config, step, gaps){
  const stakeUnits = stakeForStep(step, config.progression);
  const unitCents = toMinorUnits(config.unit);
  if (unitCents <= 0) throw new RangeError("Stake unit must be a positive amount.");
  const perBetCents = multiplyMoneyCents(unitCents, stakeUnits);

  if (config.betType === "streets"){
    const streets = selectColdestStreets(gaps, config.coldThreshold, config.maxStreets);
    if (streets.length === 0) return null;
    return {
      kind: "streets",
      chosen: streets,
      stakeUnits,
      perStreetStakeCents: perBetCents,
      totalStakeCents: multiplyMoneyCents(perBetCents, streets.length),
    };
  }

  if (config.betType === "redblack"){
    return {kind: "redblack", color: "red", stakeUnits, totalStakeCents: perBetCents};
  }

  if (config.betType === "dozens"){
    return {kind: "dozens", dozen: 0, stakeUnits, totalStakeCents: perBetCents};
  }

  throw new RangeError(`Unsupported bet type: ${config.betType}`);
}