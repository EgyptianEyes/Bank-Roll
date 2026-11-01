# Bank-Roll next-stage audit

Audit date: 2026-10-31. This is the **pre-implementation** assessment of the actual local working tree, not a release certification. Application files were not changed during this audit. No fetch, pull, remote repository access, staging, commit, tag, push or deployment was performed.

## 1. Current project state

- Branch: `main`. HEAD: `a64d90e53d05b3c380525958aa6464cf60532041`.
- Locally cached `origin/main` and `origin/HEAD` point to the same commit. This is the last locally known published baseline, **not verification of today's remote or production website**.
- HEAD introduced browser-only cPanel packaging. Earlier commits introduced Test Mode and the v1.0.0 reports.
- Native ES modules, static HTML/CSS, optional PHP/PDO MySQL backend, Node test runner. Production requires no Node service.
- The dirty tree already contains substantial Player Mode work. It must be completed, not replaced or discarded.
- An ignored `bank-roll-cpanel.zip` exists; its existence is not proof that it contains the current tree.

## 2. Exact initial working-tree changes

No staged changes. Tracked unstaged changes: 16 files, 168 insertions, 85 deletions.

| File | + / - | Actual change |
|---|---:|---|
| `README.md` | 3 / 3 | Documents local Player Mode, packaging/version source |
| `assets/css/bank-roll.css` | 4 / 1 | Navigation, entry link and version styles |
| `docs.html` | 5 / 4 | Player links/scope and version loader |
| `faq.html` | 7 / 6 | Player links/scope and version loader |
| `index.html` | 8 / 2 | Player entry banner; simulator remains index |
| `package.json` | 3 / 0 | Adds fake-indexeddb development dependency |
| `research.html` | 3 / 0 | Player navigation/version label |
| `scripts/package-cpanel.sh` | 7 / 2 | Packages Player assets; versions staging copy; runtime checks |
| `scripts/verify-cpanel-archive.mjs` | 17 / 3 | Checks Player assets and versioned dependency paths |
| `src/intelligence/bri-coordinator.js` | 30 / 26 | Extracts shared `assessForecastEvidence` |
| `src/intelligence/integrity/false-entry-challenge.js` | 2 / 1 | Shared non-credential UUID helper |
| `src/simulation/sandbox-session.js` | 3 / 2 | Same UUID helper |
| `src/storage/table-profile-store.js` | 4 / 1 | Same UUID helper |
| `src/ui/app.js` | 35 / 34 | Restores missing streetOf import and correct predictionUI bindings; UUID helper |
| `test-mode.html` | 3 / 0 | Player navigation/version label |
| `tests/integration/page.test.js` | 34 / 0 | Player markup/import and version checks |

Initial untracked files, all preserved:

```text
assets/css/player.css
package-lock.json
player.html
scripts/version-cpanel-assets.mjs
src/core/identifiers.js
src/core/version.js
src/simulation/player-session.js
src/storage/player-mode-store.js
src/ui/player-app.js
src/ui/version-label.js
tests/integration/app-startup.test.js
tests/integration/test-mode-runtime.test.js
tests/unit/player-mode-store.test.js
tests/unit/player-session.test.js
```

## 3. Implemented functionality

Evidence is from source inspection plus the initial tests described below; browser operation is not yet verified.

- European outcomes, physical wheel order, street/dozen/colour mappings; exact integer monetary helpers. Street settlement returns **12 times the winning street stake**, including the returned stake, and zero loses street bets (`src/bankroll/accounting.js`).
- Flat, linear, Fibonacci and Martingale progression; cold-street legacy selection; central BRI CONTINUE/SWITCH/SPREAD/STOP comparison with bounded exposure and sustainability projections.
- Uniform, rolling-frequency and exponential candidate forecasts. Every candidate is scored before learning its outcome. Model snapshots and bounded prediction history exist.
- Simulator, structured research engine and worker wrapper are separate from Test Mode. The wrapper is not wired into a browser research UI in the initial tree. Test Mode uses the real coordinator, memory-only synthetic data, bounded batches and fixed 24-hour expiry.
- Player Mode IndexedDB tables, sessions, observations, correction revisions and gap events. Actual confirmed wagers, not recommendations, debit bankroll. Session/history separation and JSON export exist.
- Startup fixes in the dirty tree repair genuinely broken imports/event bindings. They are covered by mock-DOM runtime tests and must be preserved.
- PHP authentication, ownership, consent, chronological/idempotent observation writes, correction/rebuild machinery and provenance-separated aggregates exist. Database-backed operation is **not demonstrated** by their presence.
- Authored FAQ/documentation cannot be overwritten by observation submissions. Packaging excludes backend/private/development data.

## 4. Partial functionality and defects

| Priority | Finding and source |
|---|---|
| P0 | Player `index.html` is not the starting page; simulator is still the site root. |
| P0 | Table dropdown changes the active physical table immediately without confirmation (`src/ui/player-app.js`, change handler). Creating another table can also bypass the pending-wager boundary. |
| P0 | Forecasting is optional/manual: outcomes can arrive without preparing a forecast. This creates selectively scored evidence rather than a complete prospective record. |
| P0 | `PlayerSession.recordOutcome` mutates loss state before persistence, while the store also updates it. Test doubles sharing references can double-count; real failures can lose the pending engine forecast because snapshots exclude it. |
| P0 | `correctOutcome` replays only the current session. Correcting a historical session does not repair that session's saved bankroll; store silently ignores mismatched session IDs. |
| P0 | Store methods accept stale session writes without optimistic revision checks. Two tabs can combine a stale evaluation/model with a different persisted wager. |
| P0 | Player settings lack take-profit; manual wagers are not independently blocked by session end in the controller and do not enforce every configured per-street limit. |
| P1 | No cadence enforcement, machine-like-pattern warning or observer-handover controls. `human-observed-unverified` is a label, not attestation. |
| P1 | Gaps are recorded but not applied to prediction windows/sequence statistics. Resume/new-session does not establish whether physical spins were missed. |
| P1 | Corrections preserve original forecasts but effective-history learning can treat later, correction-contaminated forecasts as clean prospective evidence. No explicit evidence epoch reset. |
| P1 | Export includes one session despite containing all table observations; table metadata can be stale. No full session-summary export, undo/tombstone workflow or visible audit log. |
| P1 | Strategy panel omits reproducible increase/decrease/reset/stop rules, complete current settings and candidate score comparisons. Its text is constrained to a small internal scrolling box. |
| P1 | Brier improvement is not payout-aware proof of profitable wagering. Evidence selection can refer to a different model from the one whose probabilities drive the wager. Long-run scores do not respond explicitly to recent deterioration. |
| P1 | Only three frequency perspectives exist. No lifetime candidate, short/long window competition or sequence-dependence model. Wheel sectors must not be described as betting streets. |
| P1 | Mobile Player keypad is 13 rows of 36-40px targets; navigation/accounting precede recommendations. Actual 320/375/390/430/768px interaction has not been tested. |
| P1 | All builds use `1.1.0-dev` as a cache key. Different source trees with the same version can serve stale transitive modules. Pages show no unique build identity; HTML cache revalidation is not set. |
| P2 | Player restore/list/export load the entire table history; local browser storage is not a demonstrated million-spin datastore. |

## 5. Missing functionality / operational boundaries

- Verified human-observation ingestion, server-enforced rate limits, contributor influence caps, moderation/quarantine workflow, recovery of lost bearer tokens and a verified production MySQL deployment.
- Physical wheel measurements or independently validated exploitable edge.
- Validated transition/pattern/change-point/sector prediction models, calibrated confidence, deployment-quality adaptive model lifecycle and externally validated holdouts.
- Reviewed generated-content proposal workflow. Existing static authored pages are safe, but not an autonomous publishing system.
- Multi-device synchronization and guaranteed browser storage durability/backup.

These must not be represented as operational merely because a schema, UI label or previous report mentions them.

## 6. Initial validation and gaps

- `npm test`: **120 tests, 119 passed, 0 failed, 1 skipped**, 7310.922485ms.
- The skipped test is the environment-gated MySQL integration suite. It drops/recreates the explicitly configured disposable database; no shared database was used.
- `php tests/php/run.php`: **PASS** (Xdebug reports an unavailable debugging client; helper tests still pass).
- `git diff --check`: passed on the initial dirty tree.
- Coverage includes engine/accounting, shared decisions, regression fixtures, source/module checks, mock-DOM simulator/Test startup, and fake IndexedDB Player tests.
- No real-browser Player interaction tests, browser restart persistence tests, concurrency tests, cadence tests or measured mobile targets were present. Passing unit tests do not close these gaps.

## 7. Security and data integrity

- Backend uses prepared statements, hashed bearer tokens, owner-scoped queries, explicit consent and protected private configuration. API output is non-cacheable.
- Observed writes default off via `BANKROLL_ALLOW_OBSERVED_SUBMISSIONS`; this is a release gate, **not bot protection**. Keep it off.
- Shared aggregates exclude synthetic data and require cohort/table-type and consent checks, but do not establish resistance to a malicious consented contributor.
- Local IndexedDB and all browser controls are modifiable by the device user. Never promote local records to trusted shared research.
- Original observations and correction history must survive changes. Corrections require deterministic ordering independent of timestamp ties, invalidated derived evidence and atomic financial replay.
- No production database integration or penetration-test certification is claimed. cPanel package must remain browser-only.

## 8. Documentation discrepancies and previous requirements

- `README.md` already describes local Player Mode while older architecture/reports call human observation wholly missing. The latter describe older snapshots, not this working tree.
- README's remaining-work list correctly says worker-backed research UI is missing while the architecture describes a worker wrapper as if it were wired into the interface. Full-repository inspection found no worker construction in the initial UI.
- The street-intelligence script assigns development/holdout seed labels before execution and keeps configurations fixed, but both partitions run online prequential comparisons; it is not an independent final model-selection/holdout deployment protocol.
- Historical reports contain counts such as 62/105 passing tests; current baseline is 119 passed, not those historical totals.
- README describes a legacy 20p/three-cold-street default. That is the simulator default, not an evidence-backed Player policy.
- Prior randomness/integrity reports correctly leave independence testing, blind challenges, handovers, cadence, shared ingestion and administrative review unfinished.
- Existing synthetic fair/biased/changing benchmark outputs are reproducible research artifacts, not verified live-table advantage. Million-spin synthetic throughput is not million-spin browser persistence validation.

## 9. Implementation priorities

1. Repair Player transactional correctness, historical corrections, prospective ordering, gap boundaries and risk limits. Preserve current schema data.
2. Make Player the root experience without removing the approved simulator/board; explicit table switching, handovers, resume continuity and actual-wager controls.
3. Extend the existing forecasting architecture with bounded, forward-scored analytical candidates; align evidence to the selected model and conservatively block unproven wagering.
4. Expose reproducible strategy rules, scores, session summaries and audit history; add append-only undo.
5. Verify complete workflows in a real browser, all requested mobile sizes/orientations, and fair/biased independent-seed research.
6. Content-address the deployable build, verify every transitive asset, update docs/register, package and checksum without publishing.

Implementation outcomes and remaining requirements will be documented separately; this audit remains a record of the initial state.
