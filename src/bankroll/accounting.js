import {isBlack, isRed, streetOf, dozenOf} from "../core/roulette.js";
import {assertSafeMoneyCents, multiplyMoneyCents} from "../core/mathematics.js";

export const STREET_GROSS_MULTIPLIER = 12;
export const EVEN_MONEY_GROSS_MULTIPLIER = 2;
export const DOZEN_GROSS_MULTIPLIER = 3;

function assertStake(amountCents, label){
  assertSafeMoneyCents(amountCents, label);
  if (amountCents <= 0) throw new RangeError(`${label} must be a positive amount.`);
  return amountCents;
}

export function settleWager(wager, outcome){
  let hit = false;
  let grossReturnCents = 0;
  assertStake(wager.totalStakeCents, "Total stake");

  if (wager.kind === "streets"){
    if (!Array.isArray(wager.chosen) || wager.chosen.length < 1 || wager.chosen.length > 12) throw new RangeError("A street wager must choose between one and twelve streets.");
    if (new Set(wager.chosen).size !== wager.chosen.length) throw new RangeError("A street wager cannot repeat a street.");
    if (wager.chosen.some((street) => !Number.isInteger(street) || street < 0 || street > 11)) throw new RangeError("A street wager contains an invalid street.");
    const streetStakes = wager.streetStakeCents ?? new Array(wager.chosen.length).fill(wager.perStreetStakeCents);
    if (!Array.isArray(streetStakes) || streetStakes.length !== wager.chosen.length) throw new RangeError("A street wager must provide one stake per selected street.");
    const distributedStakeCents = streetStakes.reduce((total, stake) =>
      assertSafeMoneyCents(total + assertStake(stake, "Per-street stake"), "Distributed street stakes"), 0);
    if (distributedStakeCents !== wager.totalStakeCents) throw new RangeError("Distributed street stakes must equal the total stake.");
    const street = streetOf(outcome);
    const winningStreetIndex = street === null ? -1 : wager.chosen.indexOf(street);
    hit = winningStreetIndex >= 0;
    if (hit) grossReturnCents = multiplyMoneyCents(streetStakes[winningStreetIndex], STREET_GROSS_MULTIPLIER);
  } else if (wager.kind === "redblack"){
    hit = wager.color === "red" ? isRed(outcome) : isBlack(outcome);
    if (hit) grossReturnCents = multiplyMoneyCents(wager.totalStakeCents, EVEN_MONEY_GROSS_MULTIPLIER);
  } else if (wager.kind === "dozens"){
    hit = dozenOf(outcome) === wager.dozen;
    if (hit) grossReturnCents = multiplyMoneyCents(wager.totalStakeCents, DOZEN_GROSS_MULTIPLIER);
  } else {
    throw new RangeError(`Unsupported wager kind: ${wager.kind}`);
  }

  return {
    hit,
    grossReturnCents,
    netChangeCents: assertSafeMoneyCents(grossReturnCents - wager.totalStakeCents, "Net settlement"),
  };
}

export function canPlaceWager(bankrollCents, wager, limits = {}){
  assertSafeMoneyCents(bankrollCents, "Bankroll");
  assertStake(wager.totalStakeCents, "Total stake");
  if (wager.totalStakeCents > bankrollCents) return {allowed: false, reason: "insufficient funds"};
  if (limits.maxStakeCents > 0 && wager.totalStakeCents > limits.maxStakeCents){
    return {allowed: false, reason: "maximum stake"};
  }
  if (limits.maxExposureCents > 0 && wager.totalStakeCents > limits.maxExposureCents){
    return {allowed: false, reason: "maximum exposure"};
  }
  return {allowed: true, reason: null};
}