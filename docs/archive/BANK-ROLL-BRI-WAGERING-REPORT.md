# Simulator wagering: execution trace, defects and reproducible proof

## Direct answer

**Before this investigation, BRI genuinely controlled wagering in BRI Autonomous mode, but not in the default legacy Cold-street mode.** Autonomous already passed the coordinator's actual selected streets and integer-pence stakes to debit and settlement. Legacy wagers came from `createWager`, while a separate BRI calculation was displayed as a "decision" even though its result was not executed. That misleading display was a real defect, not proof that the autonomous engine was disconnected.

20p was not a forced amount. The default HTML base unit is GBP 0.20 and the default progression is flat. Non-20p configured/progressed wagers already worked before these fixes. This investigation found and corrected a real BRI maximum-street connection defect, misleading/stale decision displays, and unsafe silent fallback paths. No arbitrary stake increase, evidence-threshold relaxation or forecasting-model change was made.

## Ten required findings

| Question | Verified answer |
|---|---|
| 1. Where does 20p originate? | [index.html](index.html) has `unit` value `0.20`. All three existing presets also explicitly set the base unit to `0.20` in [app.js](src/ui/app.js). Presets can reset a previously edited unit; choosing a preset does not automatically select BRI Autonomous. |
| 2. Base unit, hardcoded wager or display? | It is an editable default base denomination, not a hardcoded actual wager. `readConfig` reads the field; `toMinorUnits` converts it to 20 integer pence. Previously `parseFloat(value) || 0.2` silently substituted 20p for zero/empty input; that fallback was removed and invalid units now stop with an explicit error. Chip labels display actual per-street stake, not total exposure or a placeholder. |
| 3. Does BRI determine streets? | Yes in Autonomous: real historical model probabilities rank candidate streets; `decideNextAction` compares CONTINUE, SWITCH, SPREAD and STOP. Legacy cold-street instead ranks current absence gaps and applies the cold threshold; it is not forecast-selected. Legacy Red/Black always chooses red and Dozens the first dozen. These static legacy policies are now explicitly disclosed, not passed off as adaptive BRI. |
| 4. Does BRI determine amounts? | Yes, within the user-selected unit/progression and financial constraints. `buildWagerCandidate` calculates per-street/total integer stakes; SWITCH restarts at step 1, CONTINUE uses the active stage and SPREAD reallocates exposure with integer division/remainder. The selected financials become the actual wager. BRI does not invent a new base unit or automatically choose an evidence-supported progression. |
| 5. Is progression connected? | Yes. [progression.js](src/strategies/progression.js) implements flat=1, linear=n, Martingale=2^(n-1), Fibonacci=1,1,2,3,5,... . Legacy and Autonomous both call it. A loss advances the active progression, a win resets it; BRI can instead switch/reallocate/suspend. Maximum depth and sustainability constraints can prevent a larger wager. Unknown modes formerly silently became flat; they now fail explicitly. |
| 6. Do strategies change decisions? | Yes: legacy streets/red/dozens produce different real wagers; Autonomous uses a separate execution engine. The comparison logs demonstrate different cold thresholds, units, progression, maximum streets and explicit synthetic research action policies. Research policies are repository/API experiment controls, not new public UI choices. |
| 7. Does bankroll affect risk/exposure? | Yes: wagers must fit current bankroll, stop-loss floor, maximum stake/exposure where supplied, permitted depth and the three-loss sustainability horizon. A GBP 1 research bankroll wagers three times then observes with 40p left on the common sequence; a 10p exposure cap prevents a 20p opening wager. Actual UI supplies bankroll/stop-loss/take-profit/max steps; `maxStake`/`maxExposure` are supported engine/research settings, not currently exposed as separate simulator controls. |
| 8. Can it choose NO BET? | Yes. Before ten observations there is no forecast. Afterward, evidence-gated Autonomous requires selected-model paired forward Brier bounds/recent scores to beat uniform and estimated net return to be positive, as well as affordable risk. STOP at the decision level means observation without a wager, not necessarily ending the session. Financial/session termination is separate. |
| 9. Does display match settlement? | Actual chips already used `streetStakeCents` or `perStreetStakeCents`; debit uses `totalStakeCents`, settlement returns 12 times the winning street's own stake. The legacy BRI status did not match its executed wager and has been replaced by actual controller/exposure reporting. NO BET now clears chips and updates actual result/bankroll/P&L instead of leaving stale values. Browser instrumentation verifies all 120 actual decisions and corresponding displayed stakes/debits/settlements. |
| 10. Does outcome feedback affect next decisions? | Yes. Outcomes score saved candidate forecasts before updating tracker, rolling/lifetime/decayed/transition histories. Subsequent forecasts use forward Brier performance to choose a model. Settlement updates bankroll, unrecovered losses, current position and progression. Uniform evidence legitimately remains observation; a deliberately repeated synthetic street qualifies the real selected model at spin 36 without injected model scores or altered thresholds. |

## Complete execution path

1. **Input/configuration:** [index.html](index.html) -> `readConfig` in [app.js](src/ui/app.js). Default mode is `cold-street`; selecting `bri-autonomous` requires Streets. Money is converted at engine boundaries using [mathematics.js](src/core/mathematics.js).
2. **Legacy:** [LiveSessionEngine](src/simulation/live-engine.js) -> `prepareSessionSpin` in [session-engine.js](src/simulation/session-engine.js) -> [strategy-engine.js](src/strategies/strategy-engine.js) -> [street-selection.js](src/strategies/street-selection.js) / progression. Forecasts still run independently for synthetic research; they do not control legacy wagers.
3. **Autonomous:** [AutonomousSessionEngine](src/simulation/autonomous-session-engine.js) previews a forecast without an outcome draw, then [BriCoordinator](src/intelligence/bri-coordinator.js) calls [decision-engine.js](src/strategies/decision-engine.js), using real [prediction-engine.js](src/intelligence/prediction-engine.js) and [forecast-models.js](src/intelligence/forecast-models.js) evidence.
4. **Before outcome:** the forecast is saved/emitted before resolving a spin; the coordinator clones selected financials into the actual wager, independently approves it and debits integer pence. The UI awaits optional forecast/decision storage before generating the outcome. Local coordinator decisions are retained in a bounded in-memory history; this is not durable per-spin local audit export.
5. **Settlement:** `resolveSpin` draws the configured synthetic result only after preparation. `afterSpin` scores the recorded forecast and calls [accounting.js](src/bankroll/accounting.js). Street gross return is `winningStreetStakeCents * 12`, inclusive of stake; bankroll is pre-spin bankroll minus total exposure plus gross return. Red/Black and Dozens use gross multipliers 2 and 3.
6. **Display:** the runner passes the same actual wager to [RouletteBoard.updateBets](src/ui/roulette-board.js); displayed amounts are formatted from its actual pence. BRI status now consumes the actual prepared decision/wager rather than recomputing a nonexecuted advisory decision in legacy mode.
7. **Isolation:** simulator uses its simulated table registry/research checkpoint, `source=simulation`, `data_origin=synthetic`; Player uses a separate IndexedDB store and actual-wager workflow. No cross-promotion, Player import or shared genuine-observation write was introduced.

Expected-return/probability estimates necessarily use real-valued statistics; actual units, allocation, exposure, debits, payouts and bankroll are integer pence. Formatting pounds for display does not change the monetary ledger.

## Corrected defects

1. **Maximum streets not applied to spreads:** `config.maxStreets` previously only limited the forecast candidate list. The decision engine's default spread width remained four and included the prior position. Baseline traces show four actual streets with max=2 and three with max=1. Autonomous now explicitly passes that configuration as the coordinator's maximum street count/spread width. Restoring a position larger than that cap fails explicitly before replacing current state; it cannot silently CONTINUE an oversized old position. Existing direct coordinator users retain their prior default, so Player is not silently altered.
2. **Legacy status presented an unused BRI decision:** removed that display-only computation and its separate weaker evidence check. Status now reports `LEGACY ...` and actual exposure; Autonomous reports the actual BRI action/wager or NO BET. No legacy wager is now falsely labelled BRI-controlled.
3. **Observation-only display stale:** the no-wager branch previously skipped bankroll/P&L/number display updates. It now displays the actual result and current bankroll, clears old chips and wagered-win/lose state, and exposes NO BET. Pre-spin financial stops also clear wagering displays and report the actual stop reason.
4. **Silent configuration substitutions:** zero/empty unit previously became 20p, and invalid progression modes became flat. Both now produce explicit errors; valid defaults are unchanged.
5. **Independent approval disagreement hidden:** the coordinator previously silently changed a selected wager to null when independent approval disagreed. It now throws a visible runner error rather than showing a successful selected-wager decision.
6. **Forced research policy could override evidence gating:** nonadaptive complete-path research policies selected feasible candidates after the ordinary evidence decision. Supplying such a policy with evidence-gated mode could bypass that gate. They are now allowed only with explicit synthetic `strategy-research`; default/public adaptive evidence-gated behaviour is unchanged.

No new forecasting models, staking policies, homepage/layout work or package rebuild was performed.

## Reproducible demonstrations

Run:

```sh
node scripts/verify-simulator-wagering.mjs /tmp/bank-roll-wager-proof
npm test
npm run test:browser
npm run test:php
```

The [proof script](scripts/verify-simulator-wagering.mjs) runs **120 resolved spins per configuration**. Common uniform runs use fixed seed **`bank-roll-wager-pipeline-v1`** and fresh isolated prediction state. All 16 post-fix variants complete 120 spins. Two additional controlled variants deliberately return number 1 repeatedly; they test actual model learning, not physical-wheel predictability.

Each JSONL alternates `decision-before-result` and `result-after-decision`. The script synchronously writes the decision to disk before invoking the outcome generator and asserts no random draws occurred during preparation. It records spin, available observations, mode/strategy, selected streets, per-street stakes, total exposure, pre/debited bankroll, progression stage, actual BRI explanation/candidate snapshot, forecast, result, settlement and updated bankroll. JSON companions provide joined readable rows. All debits/settlements are independently checked against the shared accounting function.

The evidence archive contains **14 genuinely captured pre-fix runs** and **16 post-fix runs**, not a retroactively labelled baseline. Controlled learning runs were added after the baseline capture and are explicitly not before/after measurements.

### Before/after: same 120-spin common seed

All final bankroll values below are integer pence; base bankroll is 100000p unless indicated.

| Configuration | Before bets / NO BET | After bets / NO BET | Max actual streets before -> after | Final bankroll before -> after |
|---|---:|---:|---:|---:|
| Legacy threshold 22, flat 20p | 98 / 22 | 98 / 22 | 2 -> 2 | 99040 -> 99040 |
| Legacy threshold 0, linear 20p | 120 / 0 | 120 / 0 | 2 -> 2 | 98560 -> 98560 |
| Legacy threshold 0, flat 50p | 120 / 0 | 120 / 0 | 2 -> 2 | 98200 -> 98200 |
| Legacy red, flat 20p | 120 / 0 | 120 / 0 | n/a | 99640 -> 99640 |
| Legacy first dozen, flat 20p | 120 / 0 | 120 / 0 | n/a | 100240 -> 100240 |
| BRI evidence-gated, 20p | 0 / 120 | 0 / 120 | 0 -> 0 | 100000 -> 100000 |
| BRI synthetic research, flat 20p, max 2 | 110 / 10 | 110 / 10 | **4 -> 2** | 100880 -> 101880 |
| BRI synthetic research, linear 20p, max 2 | 110 / 10 | 110 / 10 | **4 -> 2** | 105840 -> 109560 |
| BRI synthetic research, Martingale 20p, depth 8 | 110 / 10 | 110 / 10 | **4 -> 2** | 110880 -> 114960 |
| BRI synthetic research, flat 50p, max 2 | 110 / 10 | 110 / 10 | **4 -> 2** | 102206 -> 104700 |
| BRI synthetic research, flat 20p, max 1 | 110 / 10 | 110 / 10 | **3 -> 1** | 100960 -> 101640 |
| BRI research, GBP 1 bankroll | 3 / 117 | 3 / 117 | 1 -> 1 | 40 -> 40 |
| BRI research, 10p maximum exposure | 0 / 120 | 0 / 120 | 0 -> 0 | 100000 -> 100000 |
| BRI research maintain-policy, linear 20p | 110 / 10 | 110 / 10 | 1 -> 1 | 113820 -> 113820 |

These are diagnostic synthetic results, not evidence that the corrections improve expected profit. Different coverage changes the realised path on this seed; no model advantage is inferred.

### Non-20p, NO BET and genuine feedback proof

- Legacy linear wagers span **20p to 400p per street**, and configured flat 50p remains exactly 50p. Both already worked before this investigation.
- Corrected adaptive BRI research linear spans **20p to 280p per street**; Martingale spans **20p to 640p** under its risk/depth rules.
- Corrected flat BRI research max=2 uses **10p or 20p per street** because SPREAD reallocates an opening street's 20p total across two streets. Flat fixes base units, not necessarily each street's allocated portion.
- Corrected flat BRI research max=1 remains **exactly 20p**: one street, flat multiplier 1, no allowed spread. This is legitimate constant staking, not a fabricated failure.
- Real evidence-gated controlled number-1 runs first bet at **spin 36**, after 35 actual observations and 25 forward evaluations. At a 50p unit, there are **85 bets and 35 NO BET**, all on 1-3, final bankroll **146750p**. The 20p counterpart ends **118700p**. This deliberately extreme synthetic sequence is not a real-table observation or demonstration of a physical-wheel edge.
- The browser proof runs the actual UI runner on the controlled outcomes with the real forecast engine and captures every prepared decision before resolution. All 85 chip labels are **50p**, every debit is **50p**, every hit gross return is **600p**, and displayed final bankroll is **GBP 1467.50**.

## Tests and integrity

- Full Node suite: **152 total, 151 passed, one optional MySQL integration skip, zero failures**.
- Full Chromium suite: **48 passed**, including four new actual-runner tests plus Player/Focus/persistence/settlement/Undo/rotation, Test isolation/feedback, simulator, research, theme/navigation and version regressions.
- PHP suite: **PASS**, nonfatal Xdebug connection warning.
- New [simulator-wagering unit tests](tests/unit/simulator-wagering.test.js) cover pre-outcome draw ordering, 120-spin records, exact settlement, 20p/50p and progression variation, BRI maximum streets, policies, bankroll/exposure NO BET, unsupported progression and evidence-gate enforcement.
- New [browser proof](browser-tests/simulator-wagering.spec.js) verifies actual engine-to-chip-to-bankroll equality, real model qualification, legacy progression display, observation-only displays and invalid unit rejection. Its controlled outcome generator and read-only auditing wrappers exist **only in the test**, not production code.
- Previous complete suite remains green; no dependencies downloaded or external searches performed.

The [evidence ZIP](bank-roll-bri-wagering-evidence.zip) contains source, baseline relevant source snapshots, logs, all pre/post traces and SHA-256 payload inventory. It is **not** a cPanel package. At the time this investigation was delivered, the prior cPanel and final-UI review archives had not been rebuilt and did not contain these corrections; the definitive cPanel archive is built and independently tested during final consolidation.

## Remaining boundaries

BRI defaults to observation unless genuine forward evidence and risk rules qualify. Progression does not turn negative expectation into an edge. Legacy defaults are retained and explicitly labelled rather than secretly replaced. Presets still select their historical unit/progression values; users must explicitly choose Autonomous. The simulator's existing public controls do not expose forced research policies or separate maximum exposure fields.

Tests use Chromium emulation and synthetic sequences. No physical roulette evidence, real-device verification, backend deployment, durable per-spin local simulator audit export or benchmark claim is added. Optional backend production verification and Player backup/recovery limitations remain open.

Nothing was staged, committed, pushed, tagged, released, deployed or changed on the live website during the investigation. Final consolidation subsequently rebuilt the cPanel archive for review only; it was not deployed.

## Suggested single-paragraph commit summary

Correct the simulator's BRI wagering integrity by enforcing configured street limits on autonomous spreads, reporting actual legacy versus BRI wagering authority and exposure, refreshing NO BET outcomes and bankroll displays, rejecting silent invalid-unit/progression substitutions and preventing forced research policies from bypassing evidence gating; preserve the 20p base default, existing forecast thresholds and integer-pence settlement, and add reproducible 120-spin pre/post decision ledgers plus engine-to-chip-to-bankroll browser regressions and documentation. Assisted-by: Copilot.
