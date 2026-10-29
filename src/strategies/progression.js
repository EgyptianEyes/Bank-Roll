// Beyond this depth Martingale and Fibonacci stake units exceed exact
// double-precision integers, so progression values are hard-bounded.
export const MAX_PROGRESSION_STEP = 50;

function assertStep(step){
  if (!Number.isInteger(step) || step < 1) throw new RangeError("Progression step must be a positive integer.");
  if (step > MAX_PROGRESSION_STEP) throw new RangeError(`Progression step must not exceed ${MAX_PROGRESSION_STEP}.`);
}

export function fibonacciAt(step){
  assertStep(step);
  if (step <= 2) return 1;
  let previous = 1;
  let current = 1;
  for (let index = 3; index <= step; index++){
    [previous, current] = [current, previous + current];
  }
  return current;
}

export function stakeForStep(step, mode){
  assertStep(step);
  let units;
  switch(mode){
    case "flat": units = 1; break;
    case "linear": units = step; break;
    case "martingale": units = 2 ** (step - 1); break;
    case "fibo": units = fibonacciAt(step); break;
    default: units = 1; break;
  }
  if (!Number.isSafeInteger(units)) throw new RangeError("Progression stake exceeds the safe integer range.");
  return units;
}

export function cumulativeStakeUnits(fromStep, lossCount, mode){
  if (!Number.isInteger(lossCount) || lossCount < 0) throw new RangeError("Loss count must be a non-negative integer.");
  let total = 0;
  for (let offset = 0; offset < lossCount; offset++){
    total += stakeForStep(fromStep + offset, mode);
    if (!Number.isSafeInteger(total)) throw new RangeError("Cumulative progression stake exceeds the safe integer range.");
  }
  return total;
}