# Development

## Tests

Run the deterministic regression and engine tests with:

```sh
npm test
php tests/php/run.php
```

Tests cover the preserved legacy behavior, European mapping, payouts, progression, pence accounting, risk rejection, street tracking, forecast timing/scoring, rolling windows, seeded reproducibility, live/research parity, UI control dispatch, roulette-board geometry/highlighting, integrity-sequence detection, anomaly candidate classification, correction chains, False Entry Challenge metrics, safe-integer monetary bounds, progression depth limits, CONTINUE/SWITCH/SPREAD/STOP decision snapshots, loss-horizon exposure projections, coordinator lifecycle ordering, autonomous observation/betting/settlement/approval/resume behavior, chronological model reconstruction, identical-sequence strategy comparison and companion mode gating.

The living-research tests also cover 37-outcome street and number summaries, provenance labels, event-before-milestone ordering, bounded timeline retention, significant state-change deduplication, and listener failure isolation. The UI refreshes from each resolved observation but batches DOM work to animation frames. Table-identity tests cover legacy-profile migration, persistence across reloads, explicit switching, server-profile synchronization, and active-table dialog markup.

The randomness audit tests verify all 37 unit-interval mapping buckets and Mulberry32 continuation from its reported state. The audit documents the generator and its limits; it does not implement serial-dependence statistics or alter the evidence-gated decision policy.

Run the reproducible autonomous research benchmark with:

```sh
npm run benchmark:autonomous -- --sizes=10000,100000,1000000 --output=/tmp/bri-benchmark.json
```

The runner compares the production autonomous engine, original cold-street strategy and flat baseline over shared seeded European, explicitly synthetic biased and changing-distribution sequences. It records forecast scoring, action distributions, immediate same-spin counterfactuals, bankroll results, sequence hashes and sampled process memory. These simulations do not establish a real-wheel advantage. The research worker accepts `run-autonomous` messages and yields at bounded intervals so cancellation can be processed.

Run the independent-seed street-intelligence study with:

```sh
npm run benchmark:street-intelligence -- --replicates=20 --sizes=10000,100000
```

It compares cold-street, evidence-gated BRI, strategy-research BRI, flat stake and production observation-only forecasting across a fair wheel and synthetic designated-street probabilities of 8.5%, 9%, 10%, 11% and 25%. Replicates are divided into development and holdout seeds before execution. The final holdout replicate at the largest size also compares complete maintain/switch/spread/suspend financial paths against the same outcomes. Machine-readable aggregates and replay metadata are saved under `research-results/` by default; `--output=/path/to/results.json` selects another location. These files contain synthetic research output only, are not loaded by the application, and are denied direct web access by the directory `.htaccess`.

The `compareAutonomousStrategies()` API also accepts a provided `outcomes` array for loaded-sequence comparisons. It validates that the array has exactly `spins` European outcomes (integers 0–36), copies it before running strategies, and returns the loaded sequence alongside `sequenceSource` and its digest so the experiment remains reproducible. Keep the required seed as the experiment's reproducibility label even when supplying outcomes.

`tests/fixtures/legacy-baseline.html` is a reference fixture used by the legacy tests. It is not deployed as the application entry point.

PHP syntax checks can be run with:

```sh
find server tests/php -name '*.php' -print0 | xargs -0 -n1 php -l
```

The PHP unit script covers request validation, data provenance, UUID/outcome categories and Brier scoring without a database.

## cPanel source package

Run `bash scripts/package-cpanel.sh` from any directory. It packages the current working tree's browser runtime (including uncommitted file contents) into `bank-roll-cpanel.zip`, with one `public_html/` root, safe file/directory permissions, local-page tests, module dependency validation and ZIP integrity checking. PHP backend files, migrations, tests, reports and synthetic datasets are deliberately excluded because database-backed production requirements are not verified for the initial browser-only release. The GitHub Actions `Package cPanel website` workflow can be started manually with `workflow_dispatch`; it produces the same ZIP as a downloadable artifact and has read-only repository permission. Neither packaging method commits, pushes or deploys.

## Database integration tests

`tests/integration/server-db.test.js` verifies the migrations and the full API — registration gating, active-table ownership/selection, session idempotency, forecast/decision-before-outcome ordering, durable decision readback and replay handling, conflict/replay handling, successive correction chains, rebuild idempotency and interrupted-rebuild retry, model checkpoint reconstruction/upload and consent-gated shared aggregates — against a real MySQL/MariaDB server through the PHP built-in web server. It drops and recreates every table in the configured test database, so point it at a disposable database only:

```sh
BANKROLL_TEST_DB_HOST=127.0.0.1 \
BANKROLL_TEST_DB_NAME=bankroll_integration \
BANKROLL_TEST_DB_USER=bankroll_test \
BANKROLL_TEST_DB_PASSWORD=... \
BANKROLL_TEST_PHP=php8.3 \
node --test tests/integration/server-db.test.js
```

The test skips itself when the environment variables are absent or the PHP CLI lacks `pdo_mysql`. A skipped run is not database verification; see `docs/server-api.md` for the deployment-side verification procedure on hosts where this suite cannot run.

The integrity benchmark uses clean controls and separately lists valid errors that cannot be inferred without independent evidence. Statistical shift candidates are not counted as verified errors. The Configuration panel can submit explicitly confirmed corrections. Corrections invalidate summary state and enqueue a rebuild request; do not clear validity flags manually. `POST /server/api/v1/rebuild.php` processes that queue, after which the client must upload a reconstructed model checkpoint before learning resumes for the affected table/origin.

## Static hosting

The `index.html` page references assets using relative paths. Upload the entry page together with `assets/`, `src/`, and `server/`. Native module scripts must be served with an HTTP(S) origin; `file://` loading is not a supported local test method. PHP and MySQL are required only for persistent BRI memory; the frontend itself is static. Node.js is needed only for development tests, not to host the production app.

Configure PHP with `BANKROLL_CONFIG_FILE` pointing outside the web root, or set the individual `BANKROLL_DB_HOST`, `BANKROLL_DB_NAME`, `BANKROLL_DB_USER`, `BANKROLL_DB_PASSWORD`, and `BANKROLL_REGISTRATION_KEY` variables. Import SQL migrations from `server/private/migrations/` in numeric order. The `/server/private/` path is denied by `.htaccess`; retain this protection on Apache/cPanel and do not expose the private directory through an alias.

## Change discipline

Keep roulette math and session transitions in `src/core/`, `src/strategies/`, `src/bankroll/`, and `src/simulation/`. Keep DOM operations in `src/ui/`. Add deterministic tests for mathematical behavior and preserve the board's arrangement and visual contract. The original source fixture is the comparison baseline; do not silently change its established calculations during refactors.