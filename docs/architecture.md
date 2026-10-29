# Architecture

Bank-Roll uses a browser-native ES-module frontend and an optional same-origin PHP API. `index.html` contains the approved interface markup and relative references to `assets/css/bank-roll.css` and `src/ui/app.js`. Browser-only simulation remains available when the backend is not configured.

## Implemented boundaries

- `src/core/roulette.js`: European roulette outcomes, wheel order, colour, street and dozen mapping. `spinNumber()` maps a PRNG draw with `floor(draw * 37)` and does not use physical `WHEEL_ORDER` for outcome selection.
- `src/core/random.js`: deterministic FNV-1a seed hashing and Mulberry32 random generation.
- `src/core/mathematics.js`: European probabilities and integer minor-unit conversion.
- `src/observation/street-tracker.js`: all twelve street counts, rolling windows, absences, intervals and consecutive appearances.
- `src/observation/statistics.js`: session-level summary statistics.
- `src/intelligence/forecast-models.js`: uniform, rolling-frequency and exponentially weighted models, multicategory Brier scores, and evidence-based prequential selection.
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
- `src/ui/research-panel.js`: safe text-only renderer for the live research panel; per-spin presentation updates are coalesced to animation frames.
- `src/storage/research-client.js`: authenticated API client and a bounded localStorage outbox for forecast, decision and outcome writes; player tokens are kept in sessionStorage by the UI.
- `src/storage/table-profile-store.js`: versioned local registry for multiple table identities, migration from the earlier single-profile key, explicit activation, and synchronization with owner-scoped server profiles.
- `server/api/v1/`: player registration, consent, table/session creation, forecasts, append-only outcomes and pre-outcome strategy decisions, correction audit, correction rebuild, model checkpoint upload/restore, consent-gated shared aggregates, integrity reports, benchmark history, private history and metrics.
- `server/private/`: external configuration loader, protected migrations and validation/scoring functions.

## Data flow

The default cold-street live mode continues using `LiveSessionEngine`. In BRI Autonomous mode, the UI instead asks `AutonomousSessionEngine` to get its forecast and action from `BriCoordinator`; the same coordinator observes the resolved outcome, preventing duplicate prediction updates. STOP and initial evidence-gathering do not end the session: they produce observation-only spins. Each actual wager passes `canPlaceWager` independently, and stop-loss, take-profit and bust limits terminate the session. The research engine retains its existing shared preparation and settlement functions without DOM work. Forecasts and autonomous decision snapshots are recorded before outcomes; evaluation and learning occur afterward. When BRI storage is enabled, the outbox preserves forecast → decision → outcome order.

After the engine consumes each outcome, the common live-app outcome handler derives a current-dataset snapshot, assesses integrity, and publishes it to `ResearchEventStream`. The renderer shows lifetime street counts and gaps, fair-wheel expected counts, the last-100 street and number windows, the last scored forecast, available model Brier summaries, and any autonomous decision. Animation-frame scheduling coalesces presentation work; ordinary spins are not retained as timeline entries. The browser-local timeline is capped at 50 meaningful milestone or state-change records and is cleared with the prediction dataset. Current simulator outcomes are synthetic; this panel does not merge unrelated physical tables or claim that a persistent hypothesis/journal system exists.

The PHP API uses bearer tokens whose hashes are stored in the database. Tables, sessions, events, and metrics are owner-scoped. Synthetic and observed data are labelled separately. Shared-research consent is an explicit player preference plus per-session consent; `shared-aggregates.php` pools only explicitly consented observed data into anonymous cross-player street totals and requires the requester to share research too. Credentials are loaded from environment variables or a PHP array outside the web root selected by `BANKROLL_CONFIG_FILE`.

Table identity is separate from `research_sessions`: multiple sessions belong to one table profile. The local profile registry survives browser reloads; migration `006_active_table_identity.sql` stores one owner-scoped active table ID for account-level restoration, and `tables.php` supports an authenticated active-table update after verifying ownership. Session creation also marks its table active. The current live application is still simulation-only. Its compact local learner cache is keyed by table ID; authenticated server checkpoints are restored for the selected table. Table selection does not imply uninterrupted sequence continuity. This phase adds no human observation cadence, gap, observer, dealer, quarantine, or import workflow.

The original supplied HTML is retained at `tests/fixtures/legacy-baseline.html` for behavioral regression tests. `index-foundation.html` is a separate reference copy and is not the deployment entry point.

## Deliberate current limits

Corrections append immutable revisions and mark affected evaluation rows. Affected table/model state is invalidated and new learning is blocked until `rebuild.php` recomputes the derived statistics from the effective event history and the client uploads a freshly reconstructed model checkpoint; the rebuild is idempotent and interrupted runs remain claimable. Statistical anomalies remain candidates and never verify a bad entry. Still outstanding are calibrated distribution-vs-prediction-vs-wager evidence, adaptive model lifecycle and holdout promotion, account/token recovery, manual/imported data workflows, forward Monte Carlo scenario planning, a worker-backed experiment UI, and persistent experiment/hypothesis/journal publishing. Import all six migrations in numeric order when deploying. Migrations 005 and 006 require MySQL/MariaDB verification in the deployment environment before enabling observed submissions.