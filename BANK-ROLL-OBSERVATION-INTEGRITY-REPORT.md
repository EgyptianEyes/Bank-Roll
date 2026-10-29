# Bank-Roll Observation Integrity Report

**Date:** 2026-10-29
**Development stage:** Phase 1, Persistent Table Identity
**Scope:** Existing local working tree. No external systems or websites were accessed.
**Production status:** No changes deployed to `bank-roll.uk`.

## Summary

This phase establishes persistent table identity for the existing simulation workflow. A table profile now persists independently of simulation sessions and browser reloads. The user sees the active table and must explicitly confirm before switching to another saved or newly created simulated profile. Switching retains the previous profile and its model history; presentation reset no longer resets the table learner.

When authenticated server storage is enabled, migration `006_active_table_identity.sql` stores the player's selected table ID. The owner-scoped tables API returns that active ID and accepts an authenticated `PUT` only for a table owned by the account. Session creation also records its table as active. Table IDs and session IDs remain distinct.

This is not yet a human-observation platform. The live application still records synthetic simulation outcomes. This phase does not implement manual live entry, historical data entry/import, server-side cadence limits, continuity-gap events, observer/dealer handovers, suspicious-submission quarantine, or administrator review. The active-table ID does not verify physical-wheel identity, human observation, or data authenticity.

For release safety, observed-origin sessions and submissions are additionally blocked by default in PHP through `BANKROLL_ALLOW_OBSERVED_SUBMISSIONS=false`. The disposable integration server can explicitly opt in; production must leave this disabled until the deferred human-observation safeguards and MySQL integration are verified. This gate is not a rate limiter or anti-automation system.

## Implemented Changes

| Area | Implementation | Verification |
| --- | --- | --- |
| Local table registry | `src/storage/table-profile-store.js` stores a versioned registry of multiple profiles and an active table ID; it migrates the former single-profile key without discarding its ID/name. | Unit tests cover migration, reload persistence, explicit activation, remote synchronization, and malformed-storage preservation. |
| Active-table UI | `index.html` displays the active profile and provides a native confirmation dialog to select a saved simulated profile or create another. General Configuration no longer silently changes table identity through a name/cohort edit. | Page tests verify the visible indicator and explicit confirmation dialog. |
| Table-scoped learner memory | Compact prediction-engine checkpoints are saved under the table ID to browser storage periodically and on `pagehide`; returning to a profile restores its own learner snapshot. | Existing predictor snapshot tests plus table registry tests; browser crash durability and storage quota behavior were not benchmarked. |
| Reset semantics | Clearing the simulation's displayed results does not reset table-level prediction history. A confirmed table switch creates/restores the selected table's learner and clears only the paused runner continuation state. | Existing prediction/reset regression suite and page tests. |
| Account active table | Migration 006 adds `players.active_table_id`. `GET tables.php` returns the active ID and owned profile metadata; `PUT tables.php` verifies ownership before selecting. Session creation updates the account pointer in its transaction. | Gated database integration assertions added; not executed in this container because PDO MySQL and test DB settings are unavailable. |
| Cross-device model state | On authenticated connection, the app synchronizes table profiles and restores the server checkpoint for the account's selected profile. | API/client coverage added; end-to-end DB behavior remains unverified in this environment. |
| Session separation | Every simulation run continues to use a distinct `session_id` under the selected `table_id`. A new run does not create a new table identity. | Database integration test asserts a second session leaves `active_table_id` unchanged. |

## Identity and Continuity Semantics

- **Table profile:** Persistent identity for one selected research dataset. It is not independently verified as a particular physical machine or wheel.
- **Observation session:** A bounded recording/run period associated with a table. Starting another simulation session retains the same table ID.
- **Observer/dealer/player:** These identities and handover events are not collected in Phase 1.
- **Sequence continuity:** Table continuity is not proof that every consecutive physical spin was observed. This phase has no pause/resume, missing-spin marker, `continuity_from_previous` field, or observer-handover log. Human sequence analysis must not treat separate future observation periods as adjacent until explicit continuity metadata exists.
- **Synthetic simulation:** The current live app's table profile type is `simulated`; results remain synthetic and excluded from observed-only shared aggregates.

For authenticated use, the account's active ID is persisted server-side. Local profile selection remains available when disconnected. If a browser-only checkpoint cannot be reconciled with an empty server table, the app stops rather than silently uploading an inconsistent model ledger. Historical replay/import to reconcile those records is not yet implemented.

## Security Boundary

The new server write uses the existing bearer-token authentication and checks that the requested table belongs to the authenticated player. A different player's table ID returns 404. The active pointer is one database update; concurrent explicit selections resolve last-write-wins. Session creation updates the active pointer within its existing transaction.

The local profile registry and model snapshots are browser storage, not tamper-proof evidence. A profile name, local checkpoint, table ID, or shared cohort UUID does not establish human observation or physical-table authenticity. No anti-bot guarantee is claimed.

This phase adds no cookie-based state-changing endpoint, admin capability, rate limiter, IP retention, behavioral profile, quarantine pathway, import parser, or additional personal data. Existing observation APIs still accept the current app's simulation source and should not be treated as authenticated human observations.

## Status Matrix

| Requirement | Status | Limitation |
| --- | --- | --- |
| Active table persists in the same browser | Implemented | Uses localStorage; storage can be cleared or unavailable. |
| Active table persists across sign-in/device | Implemented when server storage is enabled | Uses the account's `active_table_id`; requires migration 006 and a configured authenticated PHP/MySQL service. DB integration is not run here. |
| Explicit switch with retention confirmation | Implemented for simulated profiles | No physical/live profile workflow yet; local table entries are retained, with no deletion UI. |
| Separate table-specific learning | Implemented for existing street prediction engine | Model snapshot is scoped by profile ID; full raw history remains server-backed only where existing storage is enabled. |
| Session identity distinct from table identity | Implemented | Existing sessions have separate IDs and are associated with the selected table. |
| Pause/resume observation and mark missing spins | Not implemented | No human live-entry interface or sequence-boundary event model. |
| Observer/dealer/player handover records | Not implemented | No identity/event schema or UI. |
| Server-side observed-origin release gate | Implemented, default off | `sessions.php` and `observations.php` reject observed-origin operations unless privately configured. It does not impose cadence limits or verify human origin. |
| Server-side live cadence limits | Not implemented | There is no live human submission mode in this phase; API caller speed must not be interpreted as physical wheel speed. |
| Suspicious-submission quarantine | Not implemented | Synthetic/observed provenance remains the existing API classification; no risk state or review process was added. |
| Historical entry/CSV import | Not implemented | No import workflow or retrospective replay labeling. |
| Admin integrity review | Not implemented | No admin role or moderation interface. |
| Reliable proof of physical observation | Not implemented and not claimed | Table profile identity is an organizational reference only. |

## Verification

- Focused page/profile suite: 9 passed; separate registry behavior suite: 4 passed.
- Full suite: 91 passed, 0 failed, 1 skipped (92 total); PHP helpers and PHP syntax checks passed.
- Full JavaScript and PHP suites must be rerun after final edits; current full-suite count is recorded in `BANK-ROLL-DEVELOPMENT-REPORT.md`.
- MySQL integration assertions now include migration 006, session-to-table persistence, active-table listing, and cross-player active-table rejection. They cannot be verified here because this PHP environment lacks `pdo_mysql` and `BANKROLL_TEST_DB_*` configuration.
- No load test, concurrent DB test, security penetration test, browser screenshot, or cross-device deployment test was performed.

## Next Steps

1. Add explicit observation-period events and sequence continuity states. Default unknown gaps to uncertain; never infer uninterrupted physical spins from a new session.
2. Implement observer/dealer/player change events with minimal, permission-controlled metadata.
3. Build the manual 0–36 entry workflow as a separate live-human mode; keep forecast-before-outcome ordering and corrections append-only.
4. Add atomic server-side idempotency, rate-limit profiles and quarantine before accepting live-human outcomes as trusted research.
5. Add historical-entry and chunked import modes with explicit provenance and retrospective/holdout labels; do not apply live cadence limits to research workloads.
6. Run migration/API tests against disposable MySQL/MariaDB and test concurrent active-table updates before claiming persistence verification.

The original Phase 1 changes are included in source commit `d3e5b5b6e203b9d1cdd9170b3e4de8be70646426`, pushed to `origin/main`. Production deployment remains pending the verified cPanel destination, permissions, backup and database procedure. See `BANK-ROLL-RELEASE-REPORT.md`.
