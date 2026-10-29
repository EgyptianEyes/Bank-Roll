# Bank-Roll Development Report

**Audit date:** 2026-10-29
**Scope:** Current working tree and the Phase 1 living-research UI foundation.
**Deployment entry point:** `index.html`

## A. Executive Summary

Bank-Roll is now a modular browser application with an optional PHP/MySQL persistence layer. The approved roulette board and base styling were extracted from the supplied single-file application; the number layout, chip layer and highlight behavior have regression coverage. Live and research simulation share the same session settlement functions. The current intelligence layer has a uniform baseline, rolling-frequency and exponentially weighted street models, prequential multicategory Brier scoring, table-scoped snapshots, sequence integrity checks, a statistical shift candidate, an explicit correction path, and a synthetic False Entry Challenge.

The preceding development phase added safe-integer monetary bounds, correction rebuild/recovery, the central BRI coordinator, four-action decision engine, seeded research laboratory, shared aggregates and companion module. This continuation adds a selectable BRI Autonomous live wagering path while retaining cold-street mode as the default, with coordinator forecasts/decisions controlling live street bets, STOP-as-observe behavior, independent wager approval, stop-loss/take-profit enforcement, and coordinator/prediction snapshots for resume. Autonomous decisions can be stored in an owner-scoped MySQL/MariaDB table and are replayed from the offline outbox between forecasts and outcomes. The updated migration and decision endpoint were subsequently exercised successfully against the disposable MariaDB integration database.

The audit found no evidence that the checked-in source contains live credentials. The workspace began with 55 project files; after this development phase it contains 66 project files (`README.md` tracked and modified, 65 untracked, excluding `.git/` and the previously generated archive). No ignored project files were reported.

The autonomous research follow-up now runs the production BRI engines against deterministic shared sequences, verifies distributed-stake accounting, and completes fair, controlled-bias and changing-distribution comparisons through one million spins. Its methodology, full result tables, decision counterfactuals and current environment limitations are documented in [BANK-ROLL-AUTONOMOUS-RESEARCH-REPORT.md](./BANK-ROLL-AUTONOMOUS-RESEARCH-REPORT.md). The 66-file inventory and performance/test figures below describe the preceding checkpoint; the follow-up adds the benchmark runner and research report.

The subsequent street-intelligence follow-up tightens SWITCH selection and Evidence-Gated statistical checks, separates position-local progression losses from global unrecovered losses, adds loaded-sequence support, and evaluates independent-seed and complete-path strategy comparisons. The earlier summary refers to `BANK-ROLL-STREET-INTELLIGENCE-REPORT.md`, but that file is not present in the current working tree; this report does not reconstruct or replace those research results.

The latest follow-up adds explicit shared-table cohorts (migration 005): the shared endpoint now requires an owned cohort UUID and scopes both observations and contributor counts to that cohort and table type. New integration assertions cover cross-player matching cohorts and exclusion of unrelated cohorts. This environment cannot execute the MySQL test because `pdo_mysql` and test DB settings are absent; the integration test skips here. Phase 1 living-research validation is recorded in section O.

Phase 1 of the living-website plan adds a transient observation event stream, a current-dataset research snapshot, a safe live panel for twelve streets and recent number frequencies, and a capped significant-event timeline. It does not create public research routes, a persistent journal, or an editorial publishing system. The implementation and remaining scope are detailed in [BANK-ROLL-LIVING-WEBSITE-REPORT.md](./BANK-ROLL-LIVING-WEBSITE-REPORT.md).

The current Randomness Integrity work completes the requested Phase 1 audit only. `BANK-ROLL-RANDOMNESS-INTEGRITY-REPORT.md` records Mulberry32/FNV-1a, seed/state resume, 37-outcome mapping, its tiny finite-grid remainder, and the absence of history-dependent outcome logic. Two focused regression tests were added; no PRNG or live betting behavior changed.

The current observation-integrity phase adds multiple persistent table profiles, explicit confirmed switching, local table-scoped model checkpoints, and an account-level active table pointer (migration 006 plus owner-checked `PUT tables.php`). Simulation sessions remain distinct from table IDs. The UI is still simulation-only; profile identity does not authenticate a physical wheel or human observer. Details and deferred safeguards are in [BANK-ROLL-OBSERVATION-INTEGRITY-REPORT.md](./BANK-ROLL-OBSERVATION-INTEGRITY-REPORT.md).

## B. Working Tree Inventory

### Root and assets

- `README.md` - tracked and modified; static/cPanel setup and current scope.
- `index.html` - deployment page, existing app markup and native-module references.
- `index-foundation.html` - separate full-size reference copy; not served as the entry point.
- `package.json` - Node test and autonomous benchmark commands; Node is development-only.
- `assets/css/bank-roll.css` - extracted original stylesheet plus restrained BRI monitor/connection styling.

### Documentation

- `docs/architecture.md` - module boundaries and current limitations.
- `docs/development.md` - test and deployment workflow.
- `docs/mathematics.md` - roulette and model probability conventions.
- `docs/server-api.md` - cPanel configuration and API behavior.
- `BANK-ROLL-AUTONOMOUS-RESEARCH-REPORT.md` - follow-up benchmark methodology, results and limitations.
- `BANK-ROLL-LIVING-WEBSITE-REPORT.md` - Phase 1 implementation status and outstanding website evolution work.
- `BANK-ROLL-RANDOMNESS-INTEGRITY-REPORT.md` - verified generator/mapping audit and staged independence research roadmap.
- `BANK-ROLL-OBSERVATION-INTEGRITY-REPORT.md` - persistent table identity scope, security boundaries and human-observation roadmap.
- `BANK-ROLL-OBSERVATION-INTEGRITY-REPORT.md` - persistent table identity scope, security boundaries and human-observation roadmap.

### Benchmark tooling

- `scripts/autonomous-benchmark.js` - seeded 10k/100k/1m production-engine comparisons and sampled process memory.
- `scripts/street-intelligence-benchmark.js` - independent-seed strategy matrix and complete-path follow-up.

### Server

- `server/api/v1/consent.php`
- `server/api/v1/corrections.php`
- `server/api/v1/forecasts.php`
- `server/api/v1/history.php`
- `server/api/v1/integrity-challenges.php`
- `server/api/v1/metrics.php`
- `server/api/v1/model-state.php` - checkpoint read plus rebuilt-checkpoint upload.
- `server/api/v1/observations.php`
- `server/api/v1/rebuild.php` - idempotent correction rebuild processor and effective-history pager.
- `server/api/v1/register.php`
- `server/api/v1/sessions.php`
- `server/api/v1/shared-aggregates.php` - consent-gated cross-player aggregates.
- `server/api/v1/decisions.php` - owner-scoped, idempotent pre-outcome decision persistence/readback.
- `server/api/v1/tables.php`
- `server/private/.htaccess` - denies direct web access to private server files.
- `server/private/bootstrap.php` - configuration, PDO setup, authentication and JSON response handling.
- `server/private/config.example.php` - safe placeholder configuration only.
- `server/private/migrations/001_bri_initial.sql` - players, profiles, sessions, events, predictions, summaries and initial integrity storage.
- `server/private/migrations/002_integrity_corrections.sql` - correction chains, evaluation impacts, rebuild queue and derived-state invalidation flags.
- `server/private/migrations/003_integrity_challenge_seed.sql` - reproducibility seed for benchmark runs.
- `server/private/migrations/004_strategy_decisions.sql` - durable, owner-scoped pre-outcome strategy snapshots.
- `server/private/migrations/005_shared_table_cohorts.sql` - explicit cohort UUIDs for deliberate observed-data sharing.
- `server/private/migrations/006_active_table_identity.sql` - account-level active table identity.
- `server/private/migrations/006_active_table_identity.sql` - account-level active table identity.
- `server/private/research-functions.php` - input validation, provenance, Brier scoring, model-state and challenge-report validation.

### Application source

- `src/core/mathematics.js`, `src/core/random.js`, `src/core/roulette.js`
- `src/observation/statistics.js`, `src/observation/street-tracker.js`
- `src/intelligence/forecast-models.js`, `src/intelligence/prediction-engine.js`, `src/intelligence/bri-coordinator.js`, `src/intelligence/rebuild.js`, `src/intelligence/research-events.js`, `src/intelligence/research-snapshot.js`
- `src/intelligence/integrity/integrity-monitor.js`, `src/intelligence/integrity/false-entry-challenge.js`
- `src/strategies/progression.js`, `src/strategies/street-selection.js`, `src/strategies/strategy-engine.js`, `src/strategies/decision-engine.js`
- `src/bankroll/accounting.js`
- `src/simulation/live-engine.js`, `src/simulation/research-engine.js`, `src/simulation/session-engine.js`, `src/simulation/research-lab.js`
- `src/simulation/autonomous-session-engine.js` - coordinator-backed live wagering while retaining observation spins.
- `src/workers/research-worker.js`
- `src/companion/companion.js`
- `src/storage/research-client.js`
- `src/storage/table-profile-store.js` - versioned multi-profile local identity registry.
- `src/storage/table-profile-store.js` - versioned multi-profile local identity registry.
- `src/ui/app.js`, `src/ui/charts.js`, `src/ui/controls.js`, `src/ui/roulette-board.js`, `src/ui/research-panel.js`

### Tests and references

- `tests/fixtures/legacy-baseline.html` - preserved original behavior/markup fixture.
- `tests/integration/page.test.js` - entrypoint, module import and DOM ID checks.
- `tests/integration/server-db.test.js` - real MySQL/MariaDB migration and end-to-end API verification (skips without a configured disposable database).
- `tests/php/router.php` - local PHP server router; blocks private, test and docs paths.
- `tests/php/run.php` - PHP validation, provenance, score and benchmark contract checks.
- `tests/regression/legacy-baseline.test.js` - original-engine baseline and seeded parity.
- `tests/statistical/integrity.test.js` - sequence integrity, blind challenge, correction chain and anomaly candidate tests.
- `tests/unit/engine.test.js` - math, session, persistence client, UI controls and board tests.
- `tests/unit/autonomous-session.test.js` - autonomous wager lifecycle, financial safeguards and snapshot/RNG resume behavior.
- `tests/unit/intelligence.test.js` - monetary bounds, decision engine, coordinator lifecycle, rebuild, deterministic autonomous research/counterfactuals and companion tests.
- `tests/unit/research-events.test.js` - live dataset snapshots, street/number counts, event ordering, bounded timeline and listener isolation.
- `tests/unit/table-profile-store.test.js` - legacy migration, profile persistence, switching and remote synchronization.

The inventory count above is retained as a checkpoint snapshot, not a current post-follow-up file count. `.git/` and generated archives are excluded from the project inventory.

## C. Implementation Status

Status reflects code present and verified now, not earlier specifications or comments.

| Requirement area | Status | Evidence and limitation |
| --- | --- | --- |
| Lightweight HTML/CSS/ES-module architecture | **Implemented and tested** | `index.html`, `assets/css/bank-roll.css`, `src/ui/app.js`; integration test resolves imports and all DOM lookups. |
| Original board and betting display | **Implemented and tested** | `src/ui/roulette-board.js`, `tests/unit/engine.test.js`; asserts 3x12 order, chips and highlights. No automated screenshot comparison was run. |
| European mapping and payout math | **Implemented and tested** | `src/core/roulette.js`, `src/bankroll/accounting.js`; legacy parity tests cover street, spread, red/black and dozen returns. |
| Integer minor-unit accounting | **Implemented and tested** | Bankroll settlement uses pence; `assertSafeMoneyCents`/`multiplyMoneyCents` reject unsafe integers, progression depth is hard-bounded at 50 steps, and sessions stop with "progression limit" instead of overflowing. |
| Flat/linear/Martingale/Fibonacci progression | **Implemented and tested** | `src/strategies/progression.js`; custom and recovery-target progression are absent. |
| Session stop-loss/take-profit and basic risk checks | **Partially implemented** | Shared engine enforces bankroll, per-wager max stake/exposure, stop-loss/take-profit and progression depth when provided. The UI exposes only stop-loss/take-profit; long-range exposure scenarios and maximum consecutive-loss limits are absent. |
| Incremental street tracking | **Implemented and tested** | `src/observation/street-tracker.js`; lifetime summaries and a bounded 100-outcome window have snapshot/restore tests. The UI does not expose all 10/25/50/75 windows. |
| Forecast after ten observations | **Implemented and tested** | `src/intelligence/prediction-engine.js`; tests establish forecast 11 after ten results and score only after outcome. |
| Competing model scoring | **Implemented but not fully tested** | Uniform, rolling and exponential models use prior-only multicategory Brier scores; synthetic bias test promotes rolling after evidence. No independent validation set, confidence interval, calibration curve or adaptive parameter training exists. |
| Historical prediction persistence | **Implemented and previously verified** | Forecasts are sent before outcomes; PHP stores immutable prediction rows and evaluations. Existing MySQL transaction behavior was verified in the prior phase. |
| Autonomous strategy decisions | **Implemented and tested** | The UI can select BRI Autonomous separately from the legacy default. `AutonomousSessionEngine` drives actual wagers, treats STOP as observation, uses independent wager approval and session limits, and snapshots coordinator/prediction state. `decisions.php` stores and reads pre-outcome snapshots; the migration and endpoint passed the MariaDB integration suite. |
| Table/model snapshots | **Implemented but not fully tested** | Compact model checkpoints restore long-term counters and model scores. Real DB state restore cannot be exercised without PDO MySQL. |
| Statistical anomaly detection | **Partially implemented** | A 13-category Pearson screening statistic compares a rolling window to prior history. It is explicitly a candidate heuristic, not a calibrated p-value or proof of error. Number-level, sequence-dependence and validated change-point models are absent. |
| Structural data integrity | **Implemented and tested** | `integrity-monitor.js` detects invalid results, IDs, table mismatch, conflicts, gaps, replays and ordering. The PHP ingest endpoint validates range, provenance, sequence and IDs. |
| False Entry Challenge | **Implemented but not fully tested** | Nine blind synthetic error cases, clean controls, unobservable substitutions/swaps, confusion metrics and latency are implemented. The server stores client-reported results as unverified; it does not independently rerun the challenge. |
| Correction audit | **Implemented and tested** | Explicit Configuration UI and PHP API append correction revisions and prediction-score impact records; successive revisions baseline on the preceding effective revision. Original events/evaluations remain unchanged. `rebuild.php` recomputes derived state idempotently; interrupted rebuilds remain claimable; forecasting resumes only after a ledger-matched checkpoint upload. Verified against MariaDB. |
| Persistent PHP/MySQL backend | **Implemented and tested** | Four migrations and owner-scoped APIs, including migration 004 and strategy decision persistence, were exercised end-to-end against MariaDB 10.11. |
| Collective intelligence | **Implemented, database isolation test added but not run in this environment** | `shared-aggregates.php` requires a caller-owned cohort and matches cohort plus table type, with player/session consent, observed origin and corrections preserved. Migration 005 adds the profile cohort. The integration test covers unrelated-cohort exclusion and same-cohort sharing, but skips here because PDO MySQL/test DB configuration is unavailable. No shared model training exists; current simulator data is synthetic and excluded. |
| Live research events and panel | **Implemented and unit-tested; browser visual verification pending** | A common post-outcome handler for legacy and autonomous simulation derives all 12 street profiles, a last-100 number histogram, scored-model evidence and provenance, then emits one transient event per spin. RAF coalesces rendering; significant-only browser timeline retains at most 50 entries. It is local to the current dataset and is not persistent memory or a public research archive. |
| Randomness Integrity audit | **Phase 1 complete; independence testing not implemented** | Verified FNV-1a seed reduction, Mulberry32 state, `floor(draw * 37)` mapping, no outcome-history logic, and deterministic resume. The mapping grid has seven extra 32-bit words for outcomes 0-6, a theoretical excess of $1/2^{32}$ each under a uniform word source. New tests lock down mapping buckets and state continuation. This does not establish PRNG independence or predictability. |
| Persistent table identity | **Phase 1 implemented; database path not run here** | Versioned browser registry preserves multiple profile IDs and explicitly switches; table-scoped compact learner memory survives reload. Migration 006 stores account `active_table_id`; `PUT tables.php` owner-checks before update, and session creation selects its table. MySQL assertions added but skipped in this environment. Current profiles are simulation-only and do not verify physical identity or human input. |
| Human observation integrity | **Not implemented** | No manual live entry, pause/gap metadata, observer/dealer handovers, atomic live cadence limits, quarantine, admin review or historical/import workflow. See observation-integrity report. |
| Dynamic research pages and BRI Publishing Intelligence | **Not implemented** | No dynamic route/page-definition store, journal generator, proposal queue, administrator authentication, approval workflow, publication audit or sitemap exists. The current panel renders fixed trusted markup only. |
| Public research/methodology page | **Implemented and content-tested** | `research.html` explains the European baseline, BRI forecast/scoring method, provenance and limitations; the homepage links to it. It is static documentation, not a dynamic archive. |
| Manual observation/import/CSV workflows | **Not implemented** | Correction review is available for recorded server events; manual entry and imports are not. |
| Strategy switching/abandonment/opportunity comparison | **Implemented and tested** | `decision-engine.js` compares CONTINUE/SWITCH/SPREAD/STOP under identical constraints with exact exposure projections. In BRI Autonomous mode the live adapter applies those decisions to real simulated street wagers; STOP continues observation and accumulated losses are retained. The legacy cold-street path remains the default. |
| 100-spins-ahead scenario planning | **Not implemented** | Loss-horizon exposure projections (1/3/5/10) exist; no rolling Monte Carlo bankroll planner exists. |
| Research laboratory/Web Worker | **Autonomous comparison implemented; browser Worker not fully tested** | `research-lab.js` compares production BRI and conventional strategies on shared generated or provided sequences, reports forecast/action/financial metrics and supports cancellation; `research-worker.js` exposes the autonomous run message. Cancellation is tested at the research-engine level, but browser Worker execution and experiment-persistence UI are not. |
| Companion | **Implemented and tested** | `companion.js` provides Quiet/Companion/Full modes, a mood state machine, bounded memory, repetition avoidance and muted-by-default optional speech; it consumes events only and exposes no decision output. UI mode/voice controls persist in preferences. |
| Authentication/recovery and rate limiting | **Partially implemented** | Token hashing, bearer checks, owner-scoped queries and registration secret exist. No recovery/revocation UI, rate limiting, or comprehensive abuse/security tests. |

## D. BRI Intelligence Assessment

BRI currently has genuine, transparent incremental learning in the narrow forecasting slice. It tracks street counts and gaps, evaluates uniform, rolling-frequency and exponential candidates, scores each before-outcome distribution with a 13-category Brier score, and selects the lowest historical mean after a minimum evaluation count. The uniform model remains the initial fallback. Compact checkpoints persist lifetime counts, rolling history, exponential weights and cumulative scores.

The model family is fixed; it does not discover arbitrary hypotheses or train parameters on an independent holdout. Model ranking still uses prequential scores, but Evidence-Gated wagering now uses paired Brier differences with a repeated-look alpha-spending boundary against uniform. The street-intelligence follow-up reports independent-seed results and false-positive intervals; this bounded experiment does not establish real-world predictability or remove the need for independently validated model lifecycles.

Perception is strongest for local structural contradictions and server sequence identity. Statistical anomalies are candidates and do not reject outcomes. Memory supports private append-only outcomes, forecasts, autonomous decision snapshots, corrections and checkpoints in the PHP/MySQL path; the decision migration/API was exercised in the preceding MariaDB integration phase, but this follow-up could not repeat database verification because the current PHP CLI lacks `pdo_mysql`. Reasoning combines competing fixed forecasts, a distribution-shift score, an honest evidence assessment against the uniform baseline, and four-action decision comparison with exact exposure projections. In BRI Autonomous mode, the coordinator decision controls the wager, STOP observes without betting, and every wager passes the independent accounting guard; legacy cold-street wagering remains separately selectable. Autonomous research performance and evidence limitations are detailed in the follow-up report. Adaptive hypothesis discovery and held-out model promotion are not implemented.

The Challenge result is measurable and reproducible by seed, but its report is generated client-side and is deliberately stored as unverified. A client can fabricate a benchmark report; it must not be represented as independent certification.

## E. Mathematical Correctness

The implementation uses 37 European outcomes, zero outside the 12 streets, street mapping `floor((n - 1) / 3)`, and gross returns of 12x street stake, 2x even-money stake, and 3x dozen stake. A spread wager deducts the exact sum of its per-street stakes and returns 12 times only the winning street's assigned stake. Integer remainder pennies are explicitly allocated rather than discarded. Unit/stake calculations use integer pence internally. Legacy seeded parity tests cover all three existing bet types and progression behavior; independent spread/exposure reference calculations are in the autonomous research report.

The current one-street baseline is $3/37$. The smoothed street estimate uses `(appearances + 3) / (observations + 37)`, with zero included in the observation denominator. The candidate models score the outcome category, including zero, with a multicategory Brier score.

Risks/limitations:

- ~~`toMinorUnits()` checks finiteness but not `Number.isSafeInteger()` after rounding~~ — fixed: all monetary helpers assert safe integers and `multiplyMoneyCents` guards every product.
- ~~Martingale/Fibonacci values can exceed safe integer precision~~ — fixed: progression steps are hard-bounded at 50 and stake products are asserted safe; sessions stop with "progression limit" rather than throwing or overflowing.
- Street/category logic exists independently in JavaScript and PHP, and the UI formats the one-street baseline separately from the core probability constant. Legacy parity tests mitigate, but do not eliminate, cross-language drift risk. The MySQL integration suite now exercises both sides against each other for the persistence path.
- `canPlaceWager()` checks the proposed wager against current bankroll and configured per-wager limits. Forward sequence projections (1/3/5/10 further losses, sustainability horizons, stop-loss floors) are provided by `decision-engine.js` and applied in the `BriCoordinator` pathway; the legacy session engine retains its per-wager safeguards and uses settled-bankroll drawdown accounting.
- A stop-loss is checked before the next wager in the legacy session engine; an individual losing wager can still overshoot it there. The decision engine treats a wager that could breach the stop-loss floor as infeasible.
- The live UI exposes stop-loss/take-profit limits; recovery targets, custom progressions and full table limits remain outside the UI.

No defect was found in the tested standard payout mappings.

The previously identified successive-correction defect in `corrections.php` is fixed: each revision's `prior_hit` and `prior_brier_score` are now taken from the most recent prior correction impact when one exists, so revision-to-revision comparisons are measured against the immediately preceding effective revision. This is verified end-to-end against MariaDB. Real-database testing also exposed one further genuine defect: `observations.php` passed an undeclared named parameter to the winning-street update, which is fatal under native MySQL prepares but invisible to SQLite-only checks; it is fixed and covered by the integration suite.

## F. Existing Design Preservation

The deployment markup and original stylesheet were extracted from the supplied foundation. The roulette board was moved to `src/ui/roulette-board.js`; its exact 3-row number order, 12 chip holders, chip label behavior and winner/street highlights are tested. The CSS palette, board rules and widget styles remain from the established application, though repeated legacy selector blocks remain in the extracted stylesheet.

Intentional additions are a compact prediction/integrity readout with a BRI decision line in the existing Live Performance area, and BRI connection, challenge, correction and companion mode/voice fields in Configuration. No separate dashboard or board redesign was introduced. Automated visual-regression screenshots were not captured; the DOM/CSS contracts and page routes were tested, and the board geometry/chip/highlight tests pass unchanged. The `index-foundation.html` reference copy is not the deployed entry point.

## G. Performance

Historical component-only measurements from the preceding development checkpoint (Node 24.21.0, seeded random source and post-run garbage collection; these are not full autonomous comparison results):

| Workload | Processed | Elapsed | Throughput | Retained heap delta |
| --- | ---: | ---: | ---: | ---: |
| Headless research session, flat one-street betting | 1,000,000 spins | 1,081 ms | 925,060 spins/s | 111,488 bytes |
| Incremental `StreetTracker` recording | 1,000,000 spins | 106.4 ms | 9,398,557 spins/s | 17,728 bytes; 100 outcomes retained |
| Prequential forecast and scoring loop | 100,000 spins; 99,990 forecasts | 1,063 ms | 94,085 spins/s | 1,906,360 bytes; latest 1,000 forecasts/evaluations retained |
| Identical-sequence lab comparison (2 variants, 2,000 sessions) | 65,356 settled spins | 285 ms | 229,319 spins/s | not measured |
| Four-action decision evaluation (`decideNextAction`) | 100,000 decision snapshots | 950 ms | 105,230 decisions/s | not measured |

These are local microbenchmarks, not cPanel/browser guarantees. Live simulation is animation-bound and updates the DOM; research runs are headless and can now run off-thread through `src/workers/research-worker.js` with progress and cancellation. Database throughput was not benchmarked. The prediction path remains the main per-spin cost and still has bounded per-observation model/scoring work. These audit-only microbenchmarks are not committed as a performance test suite.

The complete autonomous profile and 10k/100k/1m results from the follow-up are in [BANK-ROLL-AUTONOMOUS-RESEARCH-REPORT.md](./BANK-ROLL-AUTONOMOUS-RESEARCH-REPORT.md), including the former snapshot-cloning bottleneck, current sampled memory and observed throughput.

## H. Persistence and cPanel Compatibility

The frontend is static HTML/CSS/ES modules and the optional backend is PHP 8.1+ with PDO MySQL and MySQL/MariaDB. Credentials are read from environment settings or a config file outside the public directory; the safe example contains placeholders. `.htaccess` denies `server/private`. The API uses prepared statements, bearer tokens stored hashed, player ownership checks, transactional inserts, unique event/session-spin keys, and an append-only correction table.

The local PHP router smoke test returned 200 for public app/module paths, 404 for private config/migrations, 403 for registration without its secret, and 503 for DB-dependent routes while unconfigured. A preceding checkpoint ran `tests/integration/server-db.test.js` against MariaDB 10.11 using PHP 8.3 + PDO MySQL and passed four migrations and API cases. Migration 005 and the new cohort-isolation cases were added afterward; they are not yet database-verified because this environment's PHP 8.4 CLI lacks `pdo_mysql` and no test DB settings are present. Shared aggregates remain anonymous, consented observed street totals and now require an explicit cohort and matching table type.

## I. Tests and Verification

Executed during this continuation:

- `npm test` - **56 passed, 0 failed, 1 skipped** (the MySQL integration test self-skips when `BANKROLL_TEST_DB_*` is not configured). Includes legacy behavior, page module/DOM references and mode selector, autonomous observation/wager/settlement/approval/resume tests, plus existing intelligence and integrity coverage.
- `tests/integration/server-db.test.js` against the disposable MariaDB database with PHP 8.3 + PDO MySQL - **passed**: four migrations, forecast/decision-before-outcome ordering, decision readback and idempotency, alongside the existing API integration cases.
- `php tests/php/run.php` - **passed** (input/provenance validation, roulette/Brier scoring, model checkpoints and challenge report contract, including nonzero false-positive and false-negative examples).
- `php -l server/api/v1/decisions.php` - **passed**.
- `node --check` on all new and changed modules - **passed**.
- Research-lab and decision-engine microbenchmarks - results recorded in section G.
- Secret/artifact scan - **no `.env`, private-key, cloud-key or literal bearer-token files/content found**; `config.example.php` contains placeholders only.

Not performed in the preceding UI/persistence phase: Playwright/browser screenshot comparison, mobile screenshot checks, in-browser Web Worker execution tests, external-source validation, and database throughput benchmarks. No claim is made for those checks. The later street-intelligence study adds 20-seed comparisons and binomial intervals for its defined detection measures; it is not a broad statistical power study. End-to-end browser verification of the updated UI was not performed; the DOM/module contracts are covered by the page integration test.

The preceding autonomous-research follow-up validation is recorded in section L below; unlike the earlier checkpoint's configured MariaDB run, that environment skipped the DB integration test because it had no database configuration and PHP lacked `pdo_mysql`.

## J. Outstanding Work, Ranked

1. **High:** Add manual observation and CSV import/export with provenance and confirmation; ingest remains simulation/API oriented.
2. **High:** Add a 100-spin Monte Carlo bankroll planner and a worker-backed experiment UI with durable experiment and hypothesis history.
3. **High:** Add lifecycle states and independent holdout validation for competing models; current ranking uses the prequential record.
4. **Medium:** Improve anomaly evidence with number-level statistics, validated change-point calibration, larger blind datasets and independent challenge verification.
5. **Later:** Token recovery/revocation, rate limiting and abuse tests, companion memory, deeper collective intelligence, visual/mobile regression and database throughput benchmarks.

## K. Recommended Roadmap

1. Verify autonomous decision persistence on MariaDB and run the updated full integration test.
2. Add manual/import data workflows and end-to-end integrity/correction review tests.
3. Implement holdout-validated model lifecycles and durable experiment/hypothesis memory.
4. Build the worker-backed experiment UI and 100-spin Monte Carlo planner.
5. Validate anomaly thresholds over independent distributions, then add token recovery/revocation and rate limiting.
6. Add visual/mobile regression and a disposable-DB CI run while retaining the existing roulette board.

## Working Tree State

At the original audit: 55 project files, `README.md` modified and tracked, 54 other files untracked, no ignored files. This development phase added `src/intelligence/bri-coordinator.js`, `src/intelligence/rebuild.js`, `src/strategies/decision-engine.js`, `src/simulation/research-lab.js`, `src/workers/research-worker.js`, `src/companion/companion.js`, `server/api/v1/rebuild.php`, `server/api/v1/shared-aggregates.php`, `tests/unit/intelligence.test.js` and `tests/integration/server-db.test.js`, and modified the monetary/progression/session modules, `corrections.php`, `observations.php`, `model-state.php`, the research client, `index.html`, `src/ui/app.js`, the documentation and this report. No changes were committed.

## L. Autonomous Research Follow-up

The current focused phase adds `scripts/autonomous-benchmark.js`, connects the production autonomous engine to deterministic comparisons and the autonomous Worker message, fixes exact redistributed-cent accounting for SPREAD, separates evidence-gated wagering from research-intent wagering, and removes per-spin decision-history cloning from the headless coordinator path. No roulette-board geometry or arrangement was changed.

`npm test` now reports **62 passed, 0 failed, 1 skipped**; the skipped test is the MySQL/MariaDB integration test because the current environment lacks `pdo_mysql` and test-database configuration. `npm run test:php` passes, and PHP syntax checks pass for all files under `server/` and `tests/php/`. The full benchmark and its explicit predictive/financial limitations are documented in [BANK-ROLL-AUTONOMOUS-RESEARCH-REPORT.md](./BANK-ROLL-AUTONOMOUS-RESEARCH-REPORT.md).

## M. Street-Intelligence Follow-up

The current continuation corrects expected-return-per-stake ranking and adds a forecast-uncertainty threshold before switching away from a sustainable active position. Current-position losses are tracked separately from global unrecovered losses: switching resets only position-local recovery, while global loss remains intact. Legacy snapshots without that attribution retain their global loss total and do not invent a position-local history. Evidence-Gated now requires an anytime-adjusted paired Brier improvement over the uniform baseline; Strategy Research remains explicitly experimental.

The laboratory can compare production strategies against generated or provided, validated European outcome sequences. It records exact sequence source/hash and keeps forecasts flowing after financial termination. A duplicate post-termination forecast counter was fixed and regression-tested. Financial candidate reporting includes the per-outcome settlement and exposure projections needed to compare SPREAD, switching, and recovery. No UI/roulette-board changes were made.

The earlier phase summary references a separate street-intelligence report that is absent from this working tree. Existing machine-readable results under `research-results/` remain unchanged; no missing prose report was inferred from them.

## N. Shared-Cohort Isolation Follow-up

Migration `005_shared_table_cohorts.sql` adds nullable `shared_cohort_id` to table profiles. `sessions.php` validates the UUID, binds it to the table profile, rejects profile reuse with a changed cohort, and prevents a cohort from mixing roulette table types. `shared-aggregates.php` requires the caller to own a profile in the requested cohort, then filters aggregate totals and contributor counts by that cohort and table type. Player consent, per-session consent, observed-only provenance, correction-effective outcomes and reciprocity remain enforced. The Configuration field carries the cohort into future observed-data workflows; the current simulation still stores synthetic outcomes, which are deliberately excluded.

The MySQL integration test now checks that a second consenting player in the same cohort contributes, a separate cohort stays isolated, and a non-sharing player cannot retrieve aggregates. It applies all five migrations. It could not run in that phase because PHP lacked `pdo_mysql` and `BANKROLL_TEST_DB_*` was unset. `node --check` passed for touched JavaScript; `npm test` reported **74 passed, 0 failed, 1 skipped** (75 total); all server/test PHP files passed `php -l`; `npm run test:php` passed. This is a historical phase checkpoint; current release commit and deployment status are recorded in section R and `BANK-ROLL-RELEASE-REPORT.md`.

## O. Living Intelligence Foundation Phase 1

The common live outcome handler now derives a compact view from the existing prediction engine and emits one transient event per resolved simulator spin. The snapshot reports data origin, dataset-local count and maturity, lifetime appearances/current gaps for all twelve streets, expected fair counts, a bounded last-100 number histogram, the last scored forecast, available Brier summaries, the integrity candidate state, and an autonomous strategy action when present. It does not duplicate model calculations or change forecast timing.

`ResearchEventStream` notifies subscribers for each spin but stores only significant timeline records, capped at 50. Current milestones are 10, 50, 100, 500, 1,000, 10,000, 100,000 and 1,000,000 observations; it also records integrity-candidate transitions, selected-model changes, first evaluation and STOP transitions. The renderer uses fixed trusted markup and `textContent`, creates the 12 street rows and 37 number cells once, and coalesces view refreshes with `requestAnimationFrame`. Reset clears the local timeline and starts a new dataset identity. The interface labels simulation outcomes as synthetic. The current event stream and timeline are not persisted across browser reloads.

No database migration or public route was added in this phase. There is no active hypothesis registry, general-purpose narrative generation, automatic publishing, editorial queue, admin role, page revision system, independent observed-wheel input flow, per-number lifetime statistic, or calibration estimator. The last-scored model distribution is descriptive evidence and is not presented as a next-spin certainty or as wager value. This phase did not change or reformat the roulette board.

Current verification: `npm test` reports **88 passed, 0 failed, 1 skipped** (89 total). The skip is the MySQL integration test because PHP lacks `pdo_mysql` and `BANKROLL_TEST_DB_*` is not configured. `npm run test:php` and PHP syntax checks across `server/` and `tests/php/` pass. New profile tests cover legacy profile migration, persistence, explicit switching, remote synchronization, UI confirmation, and malformed-storage preservation. Database active-table ownership assertions are added but are not executed here. The protected preview is available at port 8000. No browser screenshot, responsive visual audit, accessibility tooling, million-spin UI profiling, deployment or external-site inspection was performed.

## P. Randomness Integrity Phase 1

See [BANK-ROLL-RANDOMNESS-INTEGRITY-REPORT.md](./BANK-ROLL-RANDOMNESS-INTEGRITY-REPORT.md). The audit confirms the deterministic FNV-1a-to-Mulberry32 seed path, 32-bit state callback/resume behavior, `floor(draw * 37)` output mapping, and lack of prior-outcome input in the PRNG path. The finite mapping remainder is documented as an extremely small marginal discretization effect; it is not evidence of serial predictability. No generator changes or new independence model were introduced.

Added tests directly verify every mapping bucket midpoint, endpoint handling, and uninterrupted-vs-restored generator draws. The focused set passed 32 tests. Current complete-suite verification is **82 passed, 0 failed, 1 skipped**; the skip remains MySQL integration due to unavailable PDO MySQL/test DB settings. PHP helper and syntax checks pass. Transition statistics, controlled dependent generators, blind evaluation, conditional forecasting, and actionability remain planned phases.

## Q. Observation Integrity Phase 1

Migration `006_active_table_identity.sql` adds the player's active table pointer. `PUT tables.php` selects only an owned table; `GET tables.php` returns the active ID and profiles; session creation updates the pointer in the same transaction. The UI migrates the former single-table local key into a persistent multi-profile registry, presents a confirmed Switch Table dialog, and keeps compact learner snapshots separate by table ID. A simulation reset clears presentation/runner state without wiping table-level model history.

The table profile remains an identifier, not independent evidence that a specific physical wheel or human observer supplied outcomes. Separate sessions do not yet include explicit pause, unknown-gap, observer, or dealer events. Human-entry cadence enforcement, quarantine, moderation and research import are not included. The current mode writes synthetic data only. See [BANK-ROLL-OBSERVATION-INTEGRITY-REPORT.md](./BANK-ROLL-OBSERVATION-INTEGRITY-REPORT.md) for the complete implementation matrix and next phases.

At this phase checkpoint, `npm test` reported **88 passed, 0 failed, 1 skipped** (89 total); the skipped test is the MySQL integration test. `npm run test:php` passed and all PHP files under `server/` and `tests/php/` passed `php -l`. The gated MySQL test applies migration 006 and asserts active-table ownership, create/select behavior, and session/table continuity, but remains unverified because PDO MySQL and `BANKROLL_TEST_DB_*` settings are unavailable. Current release status is recorded in section R and `BANK-ROLL-RELEASE-REPORT.md`.

## R. First Public Release Preflight

The public surface now includes `research.html`, linked from the simulator, with factual European street probabilities, payout/break-even math, the existing forecast/scoring outline, synthetic provenance, and explicit limitations. The nonexistent `script.js` request was removed; the ES-module app remains the sole JavaScript entrypoint. Root Apache rules disable directory listings, apply a restrictive same-origin CSP/security headers, and deny repository metadata, SQL, reports, development directories and synthetic research-result files. `server/private/.htaccess` continues denying its contents.

Observed-origin session creation and outcome append now require `BANKROLL_ALLOW_OBSERVED_SUBMISSIONS=true` in private server configuration; the shipped example defaults to `false`. The disposable integration server is the only code path that opts in for observed-data API verification. Human submission/rate limiting is not implemented, so this release must keep the production setting false.

Final verification: **91 tests passed, 0 failed, 1 skipped** (92 total; the MySQL integration test skips because PDO MySQL/test DB settings are unavailable). PHP helper tests and PHP syntax checks pass. Local PHP preview checks return 200 for `/` and `/research.html`, and 404 for private config/migrations and `/research-results/`. Secret-pattern scanning found no credential/private-key/bearer-token matches in intended source/documentation files; synthetic research result artifacts are kept out of the cPanel payload. The approved board's geometry/highlight regression passes. No browser automation package/browser or Apache config checker is installed, so visual screenshot/mobile audit and `.htaccess` parser validation were not performed.

The cPanel payload is limited to `.htaccess`, `index.html`, `research.html`, `assets/`, `src/`, and `server/`; it contains no credentials, reports, tests, build tooling, or result JSON. The production host, cPanel deployment path, backup method and database provisioning were not available for verification. Production deployment is therefore not performed. Roll back by restoring the pre-release `public_html` backup; if database migrations are later applied, take a database backup first and do not roll back by dropping or editing tables. The migration 006 active-table column is additive; any schema rollback must be planned separately after traffic is stopped.