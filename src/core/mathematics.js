export const EUROPEAN_OUTCOMES = 37;
export const STREET_OUTCOMES = 3;
export const EUROPEAN_STREET_PROBABILITY = STREET_OUTCOMES / EUROPEAN_OUTCOMES;

export function estimateStreetProbability(appearances, observationCount){
  if (!Number.isInteger(appearances) || appearances < 0 || !Number.isInteger(observationCount) || observationCount < 0){
    throw new RangeError("Appearance and observation counts must be non-negative integers.");
  }
  return (appearances + STREET_OUTCOMES) / (observationCount + EUROPEAN_OUTCOMES);
}

export const MAX_MONEY_CENTS = Number.MAX_SAFE_INTEGER;

export function assertSafeMoneyCents(amount, label = "Monetary amount"){
  if (!Number.isSafeInteger(amount)) throw new RangeError(`${label} must be a safe integer amount of minor units.`);
  return amount;
}

export function addMoneyCents(left, right){
  assertSafeMoneyCents(left, "Left addend");
  assertSafeMoneyCents(right, "Right addend");
  return assertSafeMoneyCents(left + right, "Monetary sum");
}

export function multiplyMoneyCents(amountCents, factor){
  assertSafeMoneyCents(amountCents, "Monetary amount");
  if (!Number.isSafeInteger(factor)) throw new RangeError("Monetary multiplier must be a safe integer.");
  return assertSafeMoneyCents(amountCents * factor, "Monetary product");
}

export function toMinorUnits(amount){
  if (!Number.isFinite(amount)) throw new TypeError("Monetary amount must be finite.");
  return assertSafeMoneyCents(Math.round(amount * 100), "Rounded monetary amount");
}

export function fromMinorUnits(amount){
  if (!Number.isSafeInteger(amount)) throw new TypeError("Minor-unit amount must be a safe integer.");
  return amount / 100;
}