# BRI Server API

The optional same-origin API is implemented in PHP and targets MySQL/MariaDB. Every endpoint except player registration requires a bearer token. Responses are JSON and are not cacheable.

## cPanel setup

1. Create a database and a restricted database user in cPanel.
2. Import every `server/private/migrations/` SQL file in numeric order in phpMyAdmin, through `006_active_table_identity.sql`.
3. Copy `server/private/config.example.php` outside `public_html`, fill in secrets, and point `BANKROLL_CONFIG_FILE` at its absolute path through the PHP environment. Alternatively provide the individual `BANKROLL_DB_*` and `BANKROLL_REGISTRATION_KEY` variables.
4. Provision players through the registration endpoint using the registration key. Keep the returned player token; it is displayed once.
5. In Bank-Roll Configuration, enter the token and enable server memory. Shared contribution remains off unless separately selected and permitted by the player's account preference.

Do not store actual secrets in `server/private/config.example.php`, source control, or a publicly served directory. Keep the `.htaccess` denial in `server/private/`. Use HTTPS for all requests.

`BANKROLL_ALLOW_OBSERVED_SUBMISSIONS` is `false` in the example configuration. When false or unset, `sessions.php` rejects observed-origin sessions and `observations.php` rejects writes to observed-origin sessions. Do not enable it for production until a server-side human observation workflow, atomic cadence limits, provenance rules, quarantine behavior, and MySQL integration tests are implemented and verified. Synthetic simulation storage remains separate.

## Endpoints

- `POST /server/api/v1/register.php`: registration-secret-gated player provisioning. Returns a token once.
- `GET /server/api/v1/consent.php`, `PUT /server/api/v1/consent.php`: read/update the player's shared-research consent.
- `GET /server/api/v1/tables.php`: list only the authenticated player's table profiles, origin-separated totals, and account-level `active_table_id`.
- `POST /server/api/v1/tables.php`: create an owner-scoped table profile independently of an observation session and set it active. This records identity only; it does not assert that observations are human or physically verified.
- `PUT /server/api/v1/tables.php`: select an existing table profile as active. The server verifies that the profile belongs to the authenticated player; cross-player IDs return 404.
- `POST /server/api/v1/sessions.php`: create or idempotently reopen an owner-scoped table/session and set that table as the account's active profile. A session is not a table identity.
- `GET /server/api/v1/model-state.php?table_id=...&data_origin=synthetic`: load a compact versioned learner checkpoint for that table and provenance.
- `POST /server/api/v1/forecasts.php`: store an immutable forecast for the session's next spin before its outcome.
- `POST /server/api/v1/decisions.php`: store an idempotent CONTINUE/SWITCH/SPREAD/STOP/OBSERVE snapshot for the next unobserved spin, before its outcome.
- `GET /server/api/v1/decisions.php?session_id=...&after_spin=0&limit=250`: read private paginated strategy-decision history for an owned session.
- `POST /server/api/v1/observations.php`: append up to 500 chronological results; idempotent matching replays are ignored, conflicting history is rejected. Predictions are scored in the same transaction, and optional compact model state is committed with the result.
- `GET /server/api/v1/history.php?session_id=...&after_spin=0&limit=250`: read private paginated event/prediction history.
- `GET /server/api/v1/metrics.php?table_id=...`: read owner-scoped origin counts and model scores.
- `GET /server/api/v1/corrections.php?event_id=...`, `POST /server/api/v1/corrections.php`: inspect or append a correction revision using an expected-current-outcome check. Each revision's prediction impact is baselined on the immediately preceding effective revision, not always the original evaluation.
- `POST /server/api/v1/rebuild.php`: process pending rebuild requests for a table/origin. Recomputes every derived observation statistic from the effective (corrected) event history inside one transaction. Idempotent; interrupted runs leave requests in `processing` and remain claimable on retry. `GET` reports rebuild status and pages the effective chronological history for client model reconstruction.
- `POST /server/api/v1/model-state.php`: upload a model checkpoint reconstructed from the effective history after a rebuild. Accepted only when it matches the rebuilt observation ledger exactly, which re-enables forecasting. `GET` loads the checkpoint as before.
- `GET /server/api/v1/shared-aggregates.php?cohort_id=...`: consent-based collective intelligence for one explicit shared cohort. Returns anonymous cross-player street totals built only from sessions with explicit share consent by players who enabled research sharing, observed origin only, corrections applied, and the cohort's matching roulette table type. The requester must own a profile in that cohort and enable research sharing (reciprocity); profiles without a cohort are never pooled, and no per-player or per-table detail is exposed.
- `POST /server/api/v1/integrity-challenges.php`, `GET /server/api/v1/integrity-challenges.php`: store/retrieve aggregate False Entry Challenge results. These are client-reported synthetic benchmark results and remain unverified.

The BRI Autonomous client writes the forecast, then its decision snapshot, before the spin. Forecast/decision/outcome operations are persisted to a bounded browser outbox in that order. When network service returns, queued writes flush before the next forecast. The token is kept in `sessionStorage`; non-secret preferences and the bounded event outbox use browser storage.

Statistical integrity reports are explicitly marked as candidates, never verified errors. Corrections append a revision; they do not update the original `spin_events` row or the original prediction evaluation. Affected derived state is invalidated and new observations/forecasts are blocked until the rebuild endpoint runs and a reconstructed model checkpoint is uploaded. The recovery sequence is: `POST rebuild.php` (recompute statistics), page `GET rebuild.php` for the effective history, rebuild the model chronologically in the client (`src/intelligence/rebuild.js`), then `POST model-state.php`; forecasting resumes only after the checkpoint matches the rebuilt ledger. The Configuration correction form requires a selected event, a new value and explicit confirmation.

Correction readback returns the original value, current effective value, full revision chain and any prior-versus-corrected prediction score impacts. Successive corrections are each measured against the immediately preceding effective revision. Current prediction metrics exclude evaluations with correction impacts. Migration `002_integrity_corrections.sql` adds the audit/rebuild tables and invalidation flags.

False Entry Challenge reports include the clean-control count, false-positive count/rate, and per-case detection latency. Reports are client-reported synthetic benchmarks and stored with `verified = 0`; they are not evidence of real-table error rates unless independently reproduced.

## Data boundaries

Synthetic and observed outcomes are separately counted. A roulette table belongs to one player; unrelated players and tables are not automatically merged. Consent is recorded at player and session level; `shared-aggregates.php` is the only cross-player surface and returns aggregate street totals exclusively from consented observed sessions whose profiles share the requested UUID and table type. A cohort UUID is not proof of shared physical-table identity. The current browser simulation writes synthetic outcomes, so it will not contribute to these aggregates. Model selection and scores remain scoped to the table and origin. The model state is a compact checkpoint, while the append-only event ledger remains the audit source.

`tests/integration/server-db.test.js` verifies the schema and endpoints against a disposable MySQL/MariaDB database (see `docs/development.md`).

## Deployment-side verification

On shared hosting where the integration suite cannot run, verify the deployment with this procedure before trusting persistent storage. Do not claim database verification without completing it.

1. Import all migrations in numeric order through `006` and confirm phpMyAdmin reports no errors.
2. `POST register.php` with the registration key; confirm a `brp_` token is returned once and that repeating the call without the key returns 403.
3. `POST sessions.php` twice with identical payloads; the second response must return `"created": false` (idempotency), and changing `data_origin` must return 409.
4. Append ten observations one at a time via `observations.php`; confirm `tables.php` shows the exact spin count and `metrics.php` matches.
5. Record a forecast via `forecasts.php` and then its outcome; confirm `history.php` shows the prediction scored against that spin.
6. Record a decision snapshot via `decisions.php` before the corresponding outcome; confirm replaying the identical request is idempotent and `GET decisions.php` returns the snapshot. A different decision for the same spin must return 409.
7. Submit a correction via `corrections.php`; confirm further observations return 409 until `POST rebuild.php` succeeds, then confirm `GET rebuild.php` lists the corrected value as the effective outcome and the client checkpoint upload re-enables `model-state.php`.
8. Re-send an identical observation batch; confirm `"replayed"` rather than duplicated rows, and confirm a conflicting batch is rejected with 409.
9. Create two consented observed profiles with different cohort UUIDs and the same table type; each aggregate must exclude the other's observations. Confirm profiles in one cohort cannot have different table types and that an owner with no profile in a requested cohort receives 404.
10. Create a session and confirm `GET tables.php` returns its table as `active_table_id`; `PUT tables.php` may select another owned profile, while a different player's table ID returns 404.
11. Confirm an observed-origin session and observation write return 403 with the default server configuration. The disposable integration suite may opt in explicitly for its test database; this does not authorize production observed submissions.