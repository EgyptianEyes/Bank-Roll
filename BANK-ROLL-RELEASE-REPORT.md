# Bank-Roll v1.0.0 Release Report

**Version:** 1.0.0
**Release commit:** `d3e5b5b6e203b9d1cdd9170b3e4de8be70646426`
**Branch:** `main`
**Repository status:** Pushed to `origin/main` on 2026-10-29 using a normal fast-forward push.
**Production status:** Not deployed. The production cPanel destination, deployment permissions, backup location and database are not available in this workspace and were not guessed.

## Included

- Preserved European roulette simulator and original board regression coverage.
- BRI legacy and autonomous simulation, forecast scoring, risk checks, correction/rebuild flow, and reproducible research tools.
- Live research panel and static public `research.html` page explaining the baseline, payout math, model methodology and limitations.
- Persistent simulated table profiles, explicit confirmed switching, account active-table persistence schema/API, and table-scoped model checkpoints.
- Root Apache rules for directory listing and baseline security headers; private server files and synthetic research-result files remain denied.
- Human observed-origin session creation and outcome appends are server-disabled by default with `BANKROLL_ALLOW_OBSERVED_SUBMISSIONS=false`. Do not enable until cadence enforcement, human observation provenance and database integration are verified.

## Verification

- `npm test`: 91 passed, 0 failed, 1 skipped (92 tests total).
- `npm run test:php`: passed.
- PHP syntax checks across `server/` and `tests/php/`: passed.
- Local preview: homepage and research page return 200; app module returns 200; private config/migration and research-result paths return 404.
- Secret-pattern scan: no credential, bearer-token or private-key matches in intended source/documentation files. The shipped config is a placeholder example only.
- Original roulette board geometry/highlight regression: passed.
- cPanel package: [bank-roll-cpanel-v1.0.0.tar.gz](bank-roll-cpanel-v1.0.0.tar.gz), 100,892 bytes, SHA-256 `e7c188b0d79e26f930931dc15ea8b0fba5c3f3910cecc1937993e8585dc27afe`. It contains only `.htaccess`, homepage/research page, `assets/`, `src/`, and `server/`, with 0644 files and 0755 directories. Extracted JS/PHP syntax checks pass; no tests, docs, reports, research-result JSON, Git metadata or real config are included.

## Limitations

- The MySQL/MariaDB integration test is skipped because PHP lacks `pdo_mysql` and `BANKROLL_TEST_DB_*` is unset. Migrations 005/006, active-table API behavior and the observed-submit gate are therefore not database-verified in this environment.
- No browser automation/browser is installed; there is no screenshot, mobile visual, accessibility-tool or interactive browser regression result.
- Apache config validation is unavailable; `.htaccess` was exercised only through the protected local PHP router, which returned expected local paths but does not parse Apache directives.
- No cPanel target, document root, hosting configuration, database or production credentials are available. Production has not been changed.
- Human live observation, server-side cadence rate limits, quarantine, observer/dealer handover and research import remain disabled/unimplemented. Persistent table identity is not proof of physical-wheel identity or human input.

## Deployment and Rollback

Deployment is pending confirmation of the correct cPanel account/domain/document root, deployment permission, hosting PHP/Apache configuration, and backup procedure. Before deployment, back up the existing document root and any database. Upload/extract the package only after confirming the destination. Keep the observed-submission flag false. Do not apply database migrations until a compatible MySQL/MariaDB environment and migration procedure are verified; no production migrations have been applied by this release work.

After an authorized deployment, verify HTTPS, `/`, `/research.html`, ES-module loading, the original board, and 404 responses for `/server/private/`, `.sql`, `/research-results/`, tests and reports. If any check fails, restore the pre-release document-root backup. Since this work applied no production migrations, there is no production schema rollback required. If migrations are later applied, take and verify a database backup first; recover from that backup or an explicitly reviewed reverse migration, never by dropping tables blindly.
