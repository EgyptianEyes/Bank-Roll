# Architecture

Bank-Roll uses a browser-native ES-module frontend and an optional same-origin PHP API. The Apache/cPanel directory entry point is the mission-led home page (`home.html`); `player.html` is the local-first Player Mode and `index.html` preserves the simulator and its board. The browser experiences work without a backend. Deploy only the verified browser-only package rather than including unverified server features.

## Implemented boundaries

- `assets/js/theme.js` runs synchronously before styles on all public pages, restoring the local `bank-roll-theme` preference or following the operating system. `assets/css/theme.css` centralises both palettes and semantic presentation tokens. Theme storage is separate from all table/research records; the canvas chart module redraws its existing data on a theme-change event.
- `src/core/roulette.js`: European roulette outcomes, wheel order, colour, street and dozen mapping. `spinNumber()` maps a PRNG draw with `floor(draw * 37)` and does not use physical `WHEEL_ORDER` for outcome selection.
- `src/core/random.js`: deterministic FNV-1a seed hashing and Mulberry32 random generation.
- `src/core/mathematics.js`: European probabilities and integer minor-unit conversion.
- `src/observation/street-tracker.js`: all twelve street counts, rolling windows, absences, intervals and consecutive appearances.
- `src/observation/statistics.js`: session-level summary statistics.
- `src/intelligence/forecast-models.js`: uniform, lifetime, rolling-100, rolling-25, exponential and one-step transition models, multicategory Brier scores, and prequential selection.
- `src/intelligence/prediction-engine.js`: pre-outcome forecasts and post-outcome scoring; no UI or wager dependencies. Compact versioned snapshots restore rolling evidence without replaying the full history.
- `src/intelligence/research-snapshot.js`: derives a bounded current-dataset view from the authoritative tracker and prediction engine, including all twelve street profiles and recent number frequencies.
- `src/intelligence/research-events.js`: publishes one transient observation event per resolved simulator spin and retains only a capped set of significant milestone/state-change entries. Listener failures are isolated from simulation.
- `src/intelligence/bri-coordinator.js`: central orchestration of the BRI lifecycle (Observe → Analyse → Predict → Evaluate → Decide → Record, then Verify → Score → Learn → Remember → Recalculate). Forecasts and decision snapshots are emitted to listeners before outcomes; listener failures can never affect the mathematics.
- `src/simulation/autonomous-session-engine.js`: coordinator-backed live wagering mode. It maps STOP/no-forecast to an observation spin, keeps session limits active, applies an independent accounting approval to every proposed wager, and snapshots the coordinator plus prediction state for resume.
- `src/intelligence/rebuild.js`: chronological model reconstruction from the effective (corrected) outcome history and the full client/server recovery sequence after a correction.
- `src/intelligence/integrity/integrity-monitor.js`: sequence/source contradictions, correction-chain review, statistical shift candidates, and detection metrics.
- `src/intelligence/integrity/false-entry-challenge.js`: isolated synthetic corruption challenge with independent clean controls and unobservable-error cases.
- `src/strategies/`: progression (with hard safe-integer depth bounds), cold-street selection and wager construction.
- `src/strategies/decision-engine.js`: CONTINUE/SWITCH/SPREAD/STOP comparison under identical bankroll and risk constraints, with exact per-action stakes, returns, unrecovered losses, 1/3/5/10-loss exposure projections, sustainability horizons and plain-English reconstructable decision snapshots.
- `src/bankroll/accounting.js`: wager settlement, gross/net returns, and stake/exposure approval, with safe-integer monetary assertions throughout.
- `src/simulation/session-engine.js`: authoritative session state transitions shared by both simulation paths.
- `src/simulation/research-engine.js`: deterministic, non-animated session execution.
- `src/simulation/research-lab.js`: seeded identical-sequence strategy comparison with progress reporting, cancellation and throughput benchmarks.
- `src/workers/research-worker.js`: Web Worker wrapper around the research lab so large experiments never block the live interface.
- `src/companion/companion.js`: the companion personality (Quiet/Companion/Full modes, mood state machine, bounded memory, optional muted-by-default speech). It consumes events only and exposes no decision output.
- `src/ui/roulette-board.js`: existing number board, chip overlay and winning highlights.
- `src/ui/charts.js`: existing canvas chart rendering.
- `src/ui/controls.js`: injectable Run/Stop/Reset callbacks.
- `src/ui/app.js`: DOM bindings, wheel animation, session presentation and widget behavior.
- `src/ui/player-app.js`: human entry, explicit table/session controls, actual-wager confirmation, reproducible rules and local audit presentation.
- `src/simulation/player-session.js`: composes the existing predictor, shared evidence assessment, decision engine and accounting around asynchronous local transactions; it never auto-confirms a wager.
- `src/simulation/player-rules.js`: shared local monetary settings, actual-wager approval, replay and cadence assessment.
- `src/storage/player-mode-store.js`: IndexedDB table/session identity, optimistic session revisions, append-only observations/revisions, pre-outcome forecast events and all-session export.
- `src/ui/research-app.js`: actually constructs the research Worker, displays isolated synthetic comparisons and supports cancellation.
- `src/ui/research-panel.js`: safe text-only renderer for the live research panel; per-spin presentation updates are coalesced to animation frames.
- `src/storage/research-client.js`: authenticated API client and a bounded localStorage outbox for forecast, decision and outcome writes; player tokens are kept in sessionStorage by the UI.
- `src/storage/table-profile-store.js`: versioned local registry for multiple table identities, migration from the earlier single-profile key, explicit activation, and synchronization with owner-scoped server profiles.
- `server/api/v1/`: player registration, consent, table/session creation, forecasts, append-only outcomes and pre-outcome strategy decisions, correction audit, correction rebuild, model checkpoint upload/restore, consent-gated shared aggregates, integrity reports, benchmark history, private history and metrics.
- `server/private/`: external configuration loader, protected migrations and validation/scoring functions.

## Data flow

The default cold-street live mode continues using `LiveSessionEngine`. In BRI Autonomous mode, the UI instead asks `AutonomousSessionEngine` to get its forecast and action from `BriCoordinator`; the same coordinator observes the resolved outcome, preventing duplicate prediction updates. STOP and initial evidence-gathering do not end the session: they produce observation-only spins. Each actual wager passes `canPlaceWager` independently, and stop-loss, take-profit and bust limits terminate the session. The research engine retains its existing shared preparation and settlement functions without DOM work. Forecasts and autonomous decision snapshots are recorded before outcomes; evaluation and learning occur afterward. When BRI storage is enabled, the outbox preserves forecast → decision → outcome order.

After the engine consumes each outcome, the common live-app outcome handler derives a current-dataset snapshot, assesses integrity, and publishes it to `ResearchEventStream`. The renderer shows lifetime street counts and gaps, fair-wheel expected counts, the last-100 street and number windows, the last scored forecast, available model Brier summaries, and any autonomous decision. Animation-frame scheduling coalesces presentation work; ordinary spins are not retained as timeline entries. The browser-local timeline is capped at 50 meaningful milestone or state-change records and is cleared with the prediction dataset. Current simulator outcomes are synthetic; this panel does not merge unrelated physical tables or claim that a persistent hypothesis/journal system exists.

The PHP API uses bearer tokens whose hashes are stored in the database. Tables, sessions, events, and metrics are owner-scoped. Synthetic and observed data are labelled separately. Shared-research consent is an explicit player preference plus per-session consent; `shared-aggregates.php` pools only explicitly consented observed data into anonymous cross-player street totals and requires the requester to share research too. Credentials are loaded from environment variables or a PHP array outside the web root selected by `BANKROLL_CONFIG_FILE`.

Table identity is separate from sessions. The simulator's registry and Player Mode's IndexedDB database are different stores. Player Mode never calls the PHP API and never promotes a browser observation to trusted shared data. Its gap markers break model continuity, while old table observations survive new sessions. Unknown continuity on resume is explicitly recorded; pending actual wagers survive refresh and must be settled before switching or ending. Corrections replay every affected session's actual-wager ledger and invalidate the table's prospective evidence epoch without inventing replacement historical forecasts. See [Player Mode](player-mode.md).

The original supplied HTML is retained at `tests/fixtures/legacy-baseline.html` for behavioral regression tests. `index-foundation.html` is a separate reference copy and is not the deployment entry point.

## Deliberate current limits

The server correction/rebuild path remains separate and unverified against MySQL in this environment. Statistical anomalies never verify a bad entry. Still outstanding are calibrated next-wager evidence, adaptive model promotion, account recovery, imports, Monte Carlo planning and persistent hypothesis/publishing workflows. Browser restore/export currently load a whole table: this is not million-spin browser persistence. A server rollout needs verified migrations, cursor-paged `(table, sequence)` retrieval, incremental correction-aware aggregates, authenticated contributor quotas/quarantine and explicit consent before observed writes are enabled. The existing schema/indexes are a foundation, not evidence that global learning is operational.