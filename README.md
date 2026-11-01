# Bank-Roll

A local-first European roulette player companion, with BRI intelligence, a separate simulator and synthetic research laboratory. No physical-wheel advantage has been established.

## Run and deploy

Start at the mission-led [home page](home.html), then choose [Player Mode](player.html), [the preserved simulator](index.html), Test Mode, Research or Learn. Apache/cPanel opens the home page at the site root. Use `bash scripts/package-cpanel.sh` to prepare the browser-only package; serve over HTTPS. No Node.js production service, paid API or CDN is required. Native ES modules require HTTP(S), not `file://`. No deployment is performed by packaging.

The header's **Theme** control offers Light, Dark and System. First visits follow the operating system; explicit preferences persist locally across pages and browser restarts. Theme changes do not reload the page or change table/session records. See [the visualisation and theme report](docs/archive/BANK-ROLL-THEME-REPORT.md).

Player Mode now prioritises live recommendation, wager status and upright orientation-aware number entry. See [the mobile Player refinement report](docs/archive/BANK-ROLL-MOBILE-PLAYER-REPORT.md) for measurements, regression results and remaining device-testing limitations.

An optional **Focus Mode** keeps the same session and wager workflow while minimising website distractions. Its separate local display preference and measured browser behaviour are documented in [the Focus Mode report](docs/archive/BANK-ROLL-FOCUS-MODE-REPORT.md).

The [final UI verification report](docs/archive/BANK-ROLL-FINAL-UI-REPORT.md) records the UI checkpoint's complete-suite results, exact packaged-browser checks, layout measurements and remaining preview limitations. Later BRI wagering validation is recorded separately below; earlier delivery reports are historical snapshots.

The optional backend described below is excluded from that package and is not production-verified. It requires PHP 8.1+, PDO MySQL and MySQL/MariaDB. Do not enable observed submissions without separate backend verification and server-enforced safeguards.

### Legacy simulator API (not Player Mode)

The following optional PHP setup belongs to the existing simulator's server-backed BRI features. Player Mode is local IndexedDB only, does not use this API and will not sync to it.

Create a database and restricted database user in cPanel, then import the SQL files in `server/private/migrations/` in numeric order with phpMyAdmin. Copy `server/private/config.example.php` to a location outside `public_html` and fill in the database credentials plus a long random registration key. Configure `BANKROLL_CONFIG_FILE` to that absolute path using the hosting provider's PHP-FPM environment settings. Alternatively, supply the individual `BANKROLL_DB_*` and `BANKROLL_REGISTRATION_KEY` variables through the PHP environment. Never place real secrets in a public directory or commit them.

Provision each player through `POST /server/api/v1/register.php` using the registration-key header. The returned bearer token is shown only once; paste it into Configuration. The token stays in the current browser tab's `sessionStorage`. Shared-research consent is off by default; the Configuration checkbox updates player consent and records consent for each new session. `server/private/.htaccess` denies web access to server internals and migrations.

For browser-only local development, serve the repository root with a static HTTP server. PHP helpers can be tested with PHP CLI, and JavaScript tests use Node.js:

```sh
npm test
php tests/php/run.php
npm run test:browser
```

See [Player Mode and its rules](docs/player-mode.md), [architecture](docs/architecture.md), [mathematics](docs/mathematics.md), [development](docs/development.md), and [server API](docs/server-api.md).

Public guides: [FAQ](/faq) and [technical documentation](/docs). These pages are static authored content; visitor input and research data cannot rewrite them.

Current findings, validation and outstanding work are in the [next-stage audit](docs/archive/BANK-ROLL-NEXT-STAGE-AUDIT.md), [delivery report](docs/archive/BANK-ROLL-NEXT-STAGE-REPORT.md) and [requirements register](BANK-ROLL-OUTSTANDING-REQUIREMENTS.md). Earlier release reports are historical snapshots.

## cPanel ZIP Packaging

Create a browser-only `bank-roll-cpanel.zip` from the current working tree, including uncommitted changes, with `bash scripts/package-cpanel.sh`. The archive contains exactly one top-level `public_html/` directory and is intended to be extracted into the cPanel account home directory. It includes the home page, Player Mode, simulator, Test Mode, Worker research, public guides, CSS and ES modules; it excludes PHP/MySQL APIs, migrations and development files. Observed server submissions remain disabled. Every page displays the version from `src/core/version.js` plus a content-derived build ID. Root/transitive module and Worker URLs use that build key; `build-info.json` records SHA-256 hashes, and HTML/assets must revalidate. The script runs page/module checks and verifies the archive before replacing the ZIP. Build identity is deterministic for identical public content; ZIP timestamps may differ. The manual GitHub Actions packaging workflow only uploads an artifact; it does not deploy.

## Current scope

The [simulator wagering investigation](docs/archive/BANK-ROLL-BRI-WAGERING-REPORT.md) traces the actual legacy and BRI Autonomous execution paths, explains the 20p base unit and configured progression, documents corrected street-limit/display/fallback defects, and provides reproducible pre-result decision and settlement evidence. The cPanel packaging workflow includes these changes when rebuilt; its versioned assets and manifest are verified from the generated archive.

The existing simulator interface and roulette board are retained. Simulated runs offer the original cold-street strategy as the default and a separate BRI Autonomous mode. Autonomous decisions drive the actual street wagers; STOP suspends wagers while the session continues observing. Every proposed wager is independently checked by bankroll accounting, and configured session stop-loss/take-profit limits still apply. The mode uses the central BRI coordinator and the CONTINUE/SWITCH/SPREAD/STOP decision engine with exact exposure projections. When server storage is enabled, forecasts and full decision snapshots are recorded before outcomes and replayed in order from the bounded offline outbox. The prediction model is exploratory and its measured accuracy is reported against the uniform European baseline; it does not establish a betting advantage, and the companion can never influence the mathematics.

The integrity monitor flags contradictions and statistical shift candidates without treating surprising outcomes as verified errors. Player cadence checks reject double-entry and quarantine suspicious rapid streams locally; originals, corrections and forecasts are retained. The optional server has consent/cohort separation, append-only correction and rebuild machinery, but its MySQL integration test is skipped without a configured disposable database. `BANKROLL_ALLOW_OBSERVED_SUBMISSIONS=false` remains the default safety gate, not proof of human observation. See the [requirements register](BANK-ROLL-OUTSTANDING-REQUIREMENTS.md) for unimplemented server moderation, authentication recovery, large-history paging, model promotion, independent physical-table validation, imports, hypothesis management and Monte Carlo planning.

The live research panel now follows every resolved simulator outcome with current-dataset street profiles, a last-100 number-frequency view, forward-scored model summaries, and an in-memory timeline of significant events. It labels the simulator's data as synthetic, distinguishes sample maturity from predictive confidence, and does not claim that calibration or a hypothesis archive exists.

## Try BRI Safely

Test Mode records each number activation immediately, including consecutive identical results. A 650ms pressed highlight preserves roulette colours; a coloured **Recorded: N** status, observation count and newest-first eight-result strip confirm successful entries. Reduced-motion users receive the same static highlight. Player Mode still requires Select → Confirm.

Open [Test Mode](test-mode.html) to enter any result from 0 to 36 or generate up to 100 seeded random spins per batch (5,000 per temporary session). It runs the real BRI coordinator, prediction engine, decision policies, financial safeguards and optional companion locally in page memory. Its provenance is `test`/synthetic; it makes no server requests, does not use a table ID, and cannot enter live or shared research. A fixed 24-hour deadline is not extended by activity, and **End Test & Discard Results** clears the session immediately. Closing or navigating away discards it. Live human observations remain disabled by default on the PHP server until server-side validation, rate limiting and database tests are verified. Test Mode is separate from the reproducible structured Research Laboratory and the persistent simulated table profiles.

Bank-Roll distinguishes four workflows: Player Mode records unverified human observations locally in browser IndexedDB; server submission remains default-off. Test Mode is synthetic, memory-only and disposable. The Research Laboratory runs structured seeded experiments, and the simulator keeps its own profiles. None silently promotes or transfers data into another workflow. Player Mode has explicit gap markers, append-only corrections, export, session separation and actual-wager confirmation; only wagers explicitly confirmed by the player affect its bankroll. BRI defaults to observation until real prospective results support a model beyond the uniform baseline. See [BANK-ROLL-TEST-MODE-REPORT.md](docs/archive/BANK-ROLL-TEST-MODE-REPORT.md) for Test Mode boundaries and expiry.

## Persistent Table Identity

Player Mode keeps physical tables and sessions separate in IndexedDB, requires explicit table switching, records uncertain continuity and observer handovers, supports append-only corrections/undo and exports all table sessions. Client-side cadence warnings/quarantine are not anti-bot protection or verified identity. Historical import and shared live aggregation remain disabled. Export important records: browser storage can be evicted and is not a backup.

## Beyond Frequency: Can History Predict the Future?

Bank-Roll investigates two distinct questions. First, do outcomes occur at frequencies different from the theoretical European-wheel baseline? Second, does the ordered history contain information that improves a forecast made before the next outcome? A sequence can be well balanced overall and still have dependencies; an independent sequence can also contain striking-looking streaks and temporary imbalances. Neither a frequency deviation nor a retrospective pattern alone establishes predictability.

The simulator and synthetic research use a deterministic Mulberry32 pseudorandom generator initialized from a 32-bit FNV-1a hash of the configured seed. It maps a draw to a number with `floor(draw * 37)`; zero is a valid outcome. The generator maintains one 32-bit state and does not inspect prior roulette outcomes, suppress repeats, or balance frequencies. Seeded research is reproducible and is not cryptographically secure randomness. Reproducibility is useful for controlled experiments, but it does not establish how a real wheel, online RNG, or another software generator behaves. The UUID facility used for research record identifiers is separate from outcome generation.

An ideal independent wheel gives each number probability `1/37`, each street `3/37`, and zero `1/37`. Frequency tests address marginal distribution. Independence tests would instead ask whether past outcomes change conditional future probabilities, for example through lagged transitions or repeat rates. A historical transition table can look unusual by chance, especially after searching many lags and categories; a proposed relationship must be specified, forecast chronologically, scored against uniform and existing models, and validated on independent data before it can support a conclusion.

Current synthetic scenario generators include reproducible uniform, independent-biased and changing-distribution outcomes; no repeat-suppressed, streak-suppressed, frequency-balancing, Markov-dependent or periodic generator or blind predictability challenge is available. The separate prediction engine also includes a one-step street-transition candidate, which is not yet validated. The research lab has million-spin synthetic frequency experiments, but no integrated million-spin sequence-dependence benchmark has been run. No current evidence establishes sequential predictability or a betting edge. A single-street wager breaks even at `1/12` (about 8.3333%), above the fair-wheel probability `3/37` (about 8.1081%); a detected dependency would still need reliable forward conditional probabilities and risk-approved financial evaluation.

BRI now compares six pre-outcome distributions: uniform, lifetime frequency, rolling 100, rolling 25, exponential frequency and smoothed one-step street transitions. Missing observations break rolling/transition continuity; lifetime counts remain. Recent score deterioration suspends wagering, as do weak evidence, negative estimated return and financial limits. The transition model is exploratory, not validated sequence predictability. Controlled dependence batteries, independent physical data and production model-promotion criteria remain future work.