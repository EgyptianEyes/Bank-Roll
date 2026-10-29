export const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export const WHEEL_ORDER = Object.freeze([
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
  5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
]);

export function spinNumber(random){
  return Math.floor(random() * 37);
}

export function getWheelPosition(number){
  return WHEEL_ORDER.indexOf(number) * (360 / 37);
}

export function isRed(number){
  return number >= 1 && number <= 36 && REDS.has(number);
}

export function isBlack(number){
  return number >= 1 && number <= 36 && !REDS.has(number);
}

export function streetOf(number){
  if (!Number.isInteger(number) || number < 1 || number > 36) return null;
  return Math.floor((number - 1) / 3);
}

export function dozenOf(number){
  if (!Number.isInteger(number) || number < 1 || number > 36) return null;
  return Math.floor((number - 1) / 12);
}

export function isValidOutcome(number){
  return Number.isInteger(number) && number >= 0 && number <= 36;
}