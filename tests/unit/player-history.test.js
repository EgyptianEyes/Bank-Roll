import assert from "node:assert/strict";
import test from "node:test";
import {wagerOutcomeStatus} from "../../src/ui/player-history.js";

test("player wager history distinguishes observed, unresolved, undone, won and lost entries", () => {
  const wager = {totalStakeCents: 20};
  assert.equal(wagerOutcomeStatus({actualWager: null}), "observed");
  assert.equal(wagerOutcomeStatus({actualWager: wager, evaluation: {settlement: null}}), "unresolved");
  assert.equal(wagerOutcomeStatus({actualWager: wager, voided: true, evaluation: {settlement: null}}), "undone");
  assert.equal(wagerOutcomeStatus({actualWager: wager, evaluation: {settlement: {hit: true}}}), "won");
  assert.equal(wagerOutcomeStatus({actualWager: wager, evaluation: {settlement: {hit: false}}}), "lost");
});
