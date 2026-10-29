import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import {simulateSession} from "../../src/simulation/research-engine.js";
import {mulberry32, xfnv1a} from "../../src/core/random.js";

const source = await readFile(new URL("../fixtures/legacy-baseline.html", import.meta.url), "utf8");
const scriptStart = source.indexOf("/* ========================= UTILITIES ========================= */");
const scriptEnd = source.indexOf("/* ========================= CHARTING ========================= */", scriptStart);
assert.notEqual(scriptStart, -1, "legacy engine section exists");
assert.notEqual(scriptEnd, -1, "legacy engine section has a clear boundary");
const engineSource = source.slice(scriptStart, scriptEnd);
const engine = vm.runInNewContext(`${engineSource}\n({xfnv1a,mulberry32,streetOf,dozenOf,isRed,isBlack,stakeForStep,simulateOneSession})`, {});

function sessionConfig(overrides = {}){
  return {
    bankroll: 100,
    unit: 1,
    maxSpins: 1,
    stopLoss: 0,
    takeProfit: 0,
    betType: "streets",
    coldThreshold: 0,
    maxStreets: 1,
    progression: "flat",
    maxSteps: 10,
    ...overrides,
  };
}

function sequenceRng(numbers){
  let index = 0;
  return () => ((numbers[index++] ?? 0) + 0.25) / 37;
}

test("legacy European roulette mapping keeps zero outside the twelve streets", () => {
  assert.equal(engine.streetOf(0), null);
  assert.equal(engine.streetOf(1), 0);
  assert.equal(engine.streetOf(3), 0);
  assert.equal(engine.streetOf(4), 1);
  assert.equal(engine.streetOf(36), 11);
  assert.equal(engine.dozenOf(0), null);
  assert.equal(engine.dozenOf(36), 2);
  assert.equal(engine.isRed(1), true);
  assert.equal(engine.isBlack(2), true);
});

test("legacy street payout returns the correct 11:1 net win", () => {
  const result = engine.simulateOneSession(sessionConfig(), sequenceRng([1]));
  assert.equal(result.final, 111);
  assert.equal(result.pl, 11);
});

test("legacy spread bet pays one winning street against all selected stakes", () => {
  const result = engine.simulateOneSession(sessionConfig({ maxStreets: 3 }), sequenceRng([4]));
  assert.equal(result.final, 109);
  assert.equal(result.pl, 9);
});

test("legacy progression values match configured flat, linear and Fibonacci steps", () => {
  assert.equal(engine.stakeForStep(4, "flat"), 1);
  assert.equal(engine.stakeForStep(4, "linear"), 4);
  assert.equal(engine.stakeForStep(5, "fibo"), 5);
  assert.equal(engine.stakeForStep(5, "martingale"), 16);
});

test("legacy stop-loss ends a session after the losing wager", () => {
  const result = engine.simulateOneSession(sessionConfig({
    betType: "redblack",
    stopLoss: 1,
    maxSpins: 5,
  }), sequenceRng([2]));
  assert.equal(result.reason, "stop-loss");
  assert.equal(result.final, 99);
});

test("legacy seeded sessions are reproducible", () => {
  const run = () => engine.simulateOneSession(sessionConfig({
    betType: "redblack",
    maxSpins: 20,
  }), engine.mulberry32(engine.xfnv1a("baseline-seed")));
  assert.deepEqual(run(), run());
});

test("modular research sessions preserve legacy results for matching seeded configurations", () => {
  const cases = [
    sessionConfig({maxSpins: 80, coldThreshold: 0, maxStreets: 1}),
    sessionConfig({maxSpins: 80, coldThreshold: 20, maxStreets: 2, progression: "linear", maxSteps: 5}),
    sessionConfig({maxSpins: 80, betType: "redblack", progression: "fibo", maxSteps: 6}),
    sessionConfig({maxSpins: 80, betType: "dozens", progression: "martingale", maxSteps: 4}),
  ];
  for (const [index, cfg] of cases.entries()){
    const seed = xfnv1a(`legacy-parity-${index}`);
    const legacy = engine.simulateOneSession(cfg, engine.mulberry32(seed));
    const modular = simulateSession(cfg, mulberry32(seed));
    for (const key of ["final", "pl", "spins", "reason"]){
      assert.equal(modular[key], legacy[key], `${key} mismatch in parity case ${index}`);
    }
  }
});
