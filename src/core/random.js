export function xfnv1a(value){
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < value.length; index++){
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed, onStateChange = () => {}){
  let state = seed >>> 0;
  return function nextRandom(){
    state |= 0;
    state = (state + 0x6D2B79F5) | 0;
    onStateChange(state >>> 0);
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}