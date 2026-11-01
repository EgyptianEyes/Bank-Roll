# Player Mode

## Starting and resuming

Player Mode is the default directory page on Apache/cPanel via `DirectoryIndex player.html index.html`. Other static servers may require opening `player.html` explicitly. The simulator's existing `index.html` URL, desktop design and board remain available.

Create a physical table profile, set the starting bankroll, unit, maximum total stake, stop-loss, take-profit and optional progression. Open **Table: ... / session controls** to explicitly switch tables, start a fresh session, end a session, record an observer handover or export.

Selecting another dropdown option does not activate it. **Switch Table** requires confirmation. Actual unsettled wagers block switching, new sessions and ending. Profiles and all their session histories survive browser restarts in IndexedDB; they are not synced. A new session can use different bankroll limits without deleting earlier observations.

On resume, explicitly confirm whether every spin was observed; declining records an unknown gap. A pending actual wager survives without silently being discarded: settle its actual result before recording a gap. **Missed spin** accepts a known count or unknown count, never fabricates outcomes. An explicit zero means continuity was confirmed. Observer handovers always mark uncertain continuity and record an alias, not authenticated identity.

## Each spin

1. Read **CURRENT BRI STRATEGY** and the proposed streets/stakes.
2. Confirm the recommendation, enter an actual manual street wager, or record no bet. A recommendation never debits money.
3. Select the winning number on the 0-36 keypad, then **Record result**.
4. The confirmed actual wager settles; a result without one leaves money unchanged.
5. The interface prepares and persists the next forecast before its outcome is entered. Forecasting begins after ten eligible observations.

An outstanding choice is required before submitting the next result. Manual wagers are still permitted when BRI recommends observation, but cannot bypass financial/session limits. This records the human's decision; it is not an endorsement.

## Reproducing the rules

BRI's preferred strategy is **observation with no wager**. Flat is the default risk-control baseline because no progression has independently demonstrated an advantage; this is not a claim that flat has a predictive edge. When internal prospective checks pass, a specific wager may be displayed as an **exploratory candidate** requiring explicit player confirmation. The configured progression is player-selected and is never represented as evidence-supported or automatically changed by BRI. The configurable 20p unit is a denomination, not a standing recommendation.

- Uniform roulette has street probability `3/37`; street break-even probability is `1/12`. Absence does not make a street due.
- Six candidate models are generated before the next outcome and all are subsequently scored. Lower cumulative forward Brier loss selects the model after minimum evaluation counts; otherwise uniform remains the baseline.
- Wager eligibility requires the selected model's anytime paired bound below uniform, improvement in recent forward scores, positive estimated return and the shared financial constraints. These internal prospective checks are not independent validation or proof of profit. See [the evidence and switching methods](mathematics.md).
- Candidate streets are ranked by that selected distribution. The existing decision engine compares continuing, switching, spreading or stopping under identical constraints.
- Flat always stays at step 1. Linear proposes `step` units; Martingale proposes `2^(step-1)` units; Fibonacci proposes `1,1,2,3,5,8,...`. Non-flat losses advance the ledger step, **not permission to place another bet**.
- A hit or opening a fresh position resets the step. Switching never erases total unrecovered losses. A continuation may be rejected in favour of a sustainable fresh position.
- Every proposal must absorb the configured three-loss horizon (including the current proposed wager and subsequent losses), maximum total/per-street/exposure stakes, stop-loss floor, available bankroll and progression-depth constraints. Take-profit blocks further actual bets once reached.
- Forecast-based switches require at least 25 effective observations supporting the selected model and an approximate support-screening margin. That heuristic is not a calibrated confidence interval; financially unsustainable continuations may be stopped independently.
- Evidence loss or recent deterioration suspends proposed wagering. Observation may continue. The model is not allowed to override a manually ended session.

The interface exposes these rules, the current step, starting unit, exact next stake, candidate scores, actual total staked and gross returns. Brier improvement and positive *estimated* return do not prove a real positive expectation.

## Exact money and corrections

All accounting uses safe-integer minor units. A confirmed bet is debited once. For multiple streets, only the winning street receives `12 * its stake` gross; net outcome is that return minus **all** staked amounts. Zero loses all street stakes. Available bankroll excludes a pending stake; displayed session profit excludes an unsettled wager's temporary debit.

Corrections append ordered revisions; timestamp ties cannot reorder them. Original outcomes, forecasts, evaluations and actual wagers remain in the export. Replaying a historical session repairs that session's ledger, not the new session's starting bankroll. A correction invalidates the table's accumulated prospective evidence, since later forecasts were made using an earlier history. New forecasts are never backfilled into old outcomes.

**Undo last** appends a tombstone, excludes the entry from derived observations, and reopens any actual wager for its correct result. It does not pretend the player never placed the wager. Undo/correction is blocked while another actual wager is unsettled. A corrected historical ledger can reveal insufficient historical funds; the app does not invent a deposit to hide this.

Session revision checks reject stale cross-tab mutations, including when a correction rebuilds financial summaries across several sessions. Errors are displayed rather than converting a failed save into success; reload after a conflict. A failed outcome save retains its original pending forecast for retry.

## Integrity and privacy

- Entries less than 1.5 seconds apart are rejected. Entries under 8 seconds apart, or eight almost-identical sub-15-second intervals, are flagged and quarantined from model learning. Legitimate rapid entry can be a false positive; use Test Mode for batches, not live entry.
- Gaps and quarantine break the rolling/exponential context and prevent a fabricated adjacent transition. Lifetime counts remain for eligible observations.
- Four observer handovers in an hour flag frequent observer changes. This is a review signal, not proof of automation or dishonesty.
- Every local record is unverified. Browser code, clocks and IndexedDB are user-modifiable; these safeguards cannot prevent determined automation.
- Quarantine review/release, authenticated observers and server moderation are **not implemented**. Quarantined actual wagers still settle because money records describe what the player actually did.
- Export includes all sessions, original/effective outcomes, forecasts, decisions, integrity labels and audit events. Treat exports as private; avoid personal names in table/observer fields.
- There are no Player Mode network submissions, automatic imports or cross-mode transfers. Browser storage may be evicted; export important histories.
- The store has a table-deletion operation, but there is no player-facing delete control. Export creates a backup file, but there is no import/restore workflow.

## Scale and deployment boundary

The predictor has bounded rolling state, score windows and a 13x13 transition matrix; lifetime counts are incremental. Local restoration/correction/export currently read the whole table history. Million-spin browser storage/responsiveness and multi-device conflict reconciliation are not validated.

**Release readiness:** Missing in-app deletion and backup restoration should block a general public/stable local-first release: users need a clear way to remove locally retained table history and recover from device/browser loss. They do not block a clearly labelled, limited preview if users are warned that exports are manual, irreversible loss is possible, and no restore facility is provided.

The PHP schema is a separate foundation for indexed/paged observations and consented aggregates. Observed server writes stay default-off and the cPanel package excludes all backend files. Global learning, malicious-contributor resistance and MySQL operation are not certified by local/browser tests.
