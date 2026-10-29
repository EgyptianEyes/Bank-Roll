# Bank-Roll Living Website Report

**Phase:** 1, Living Intelligence Foundation
**Date:** 2026-10-29
**Deployment status:** Not deployed; production `bank-roll.uk` was not accessed.
**Scope:** Existing local working tree only.

## Summary

Phase 1 connects the existing live simulation engines to an evidence-labelled research view. It adds a transient observation event stream, a derived current-dataset snapshot, a responsive twelve-street profile, recent number-frequency counts, forward-scored model summaries, and a bounded timeline of significant events. The approved roulette board and betting surface remain unchanged.

This is not yet a multi-page research archive and does not autonomously publish content. No external language model or paid service was introduced.

## Implemented Modules

| Module | Responsibility | Verification |
| --- | --- | --- |
| `src/intelligence/research-events.js` | Emits one transient observation event per spin; records significant milestones and selected state changes in a 50-entry maximum timeline. Listener failures are isolated. | Unit tests cover ordering, retention, provenance validation and listener failure. |
| `src/intelligence/research-snapshot.js` | Reads authoritative tracker and predictor state to derive all 12 street profiles, last-100 number counts, forecast/model/evaluation summaries, provenance, integrity and available strategy information. | Tests compare all 37 European outcomes against expected street and number counts. |
| `src/ui/research-panel.js` | Renders fixed page markup with `textContent`; creates street rows and number cells once and coalesces spin updates to animation frames. | Page/module/DOM checks pass. No browser screenshot or accessibility-tool run was performed. |
| `src/ui/app.js` | Publishes the common post-outcome event for both legacy and autonomous live simulation paths and clears the browser-local dataset timeline on reset. | Existing app checks and complete JavaScript suite pass. |

## Live Content Behavior

The panel reports:

- Observation count and sample maturity, capped at 100 and explicitly distinguished from predictive confidence.
- Synthetic provenance for current simulator data, dataset-local lifetime street appearances, fair-wheel expected appearances, recent 100-result street counts and current gaps.
- Individual number frequencies within the most recent 100 observations; lifetime per-number counts are not currently maintained.
- The distribution from the last scored forecast, available model Brier summaries, paired mean Brier difference and its existing sequential upper-bound field. Calibration is explicitly unavailable.
- A summary of an autonomous action when present; legacy betting does not produce a BRI coordinator decision.
- Significant local events: selected observation milestones, the first scored forecast, selected-model changes, statistical-candidate transitions and STOP transitions. Ordinary spins are not added as journal rows.

Every resolved simulation outcome reaches the live event stream. The event itself is delivered to subscribers but not retained in an unbounded log; the current tracker continues to own lifetime street totals and a bounded 100-outcome rolling history. Panel refresh is coalesced with `requestAnimationFrame`. The event timeline is browser-memory-only, scoped to the current table-profile dataset, and cleared on reset or table-profile changes. Restored model checkpoints refresh the panel without fabricating a new spin or milestone; because current checkpoints do not retain the last observation timestamp, the panel reports that timestamp as unavailable rather than showing the page-load time.

Forecasts remain produced before their outcomes by the existing engines. The panel labels its forecast probabilities as the last scored forecast, avoiding an implication that these probabilities describe a future spin.

## Data Provenance and Security

The current UI creates synthetic simulation data. The research panel labels it as synthetic and does not pool it with observed tables or expose shared aggregates. The snapshot helper accepts explicit `synthetic` or `observed` provenance, but this phase does not add a manual or observed-wheel input workflow.

The event stream is local to the browser and performs no database writes. It exposes no authentication or publishing operation. All displayed text is inserted through DOM `textContent`; the renderer does not execute generated markup, CSS, scripts or PHP. No database schema changes were made for Phase 1. Existing PHP authentication, ownership, consent and cohort rules were not changed by this phase.

No administrator authentication, CSRF-protected editorial operations, publishing audit log, public/private page access rules, content quotas, or persistent deletion controls were added. Therefore there is no autonomous publishing permission in this implementation.

## Dynamic Pages and Publishing Status

The new live research panel is a fixed section inside the existing simulator page. It is not a dynamic page framework. The following capabilities remain unimplemented:

- Stable `/research`, street, experiment, hypothesis, journal, intelligence, methodology or about routes.
- A structured research-content schema, page definitions, slugs, canonical metadata, sitemap, or page revision history.
- Persistent experiment/hypothesis/journal memory and evidence-reference resolution.
- Deterministic narrative composition, journal proposals, automatic updates, or admin review/publish/rollback workflow.
- Public/private content authorization and a distinction between publication-approved and unpublished research records.
- A page-template registry capable of creating new pages without source edits.

No empty research pages were created. The panel displays an explicit empty state for the absent hypothesis archive rather than fabricating activity.

## Implementation Status

| Requirement | Status | Notes |
| --- | --- | --- |
| Original simulator and roulette board preserved | Implemented and regression-tested | Existing 3x12 board checks remain in the suite. No visual screenshot comparison was run. |
| Each live simulation outcome updates BRI | Implemented for legacy and autonomous live paths | Existing engine processes observations; new event stream updates the page. Research-worker batches and future manual imports are not connected to this UI stream. |
| Twelve dynamic street profiles | Implemented for the current browser dataset | Lifetime street totals and gaps; recent window and forecast summaries. Not merged across independent observed tables. |
| Individual number frequencies | Implemented as a last-100 window | Lifetime number counts and number-level inference are not implemented. |
| Research timeline | Implemented, volatile and bounded | 50 meaningful events maximum; not persisted and not a complete audit log. |
| Evidence-backed live explanation | Partial | Uses actual tracker/model/forecast values. No active hypothesis registry or calibration estimator exists. |
| Large-experiment UI responsiveness | Partially supported | Research computation already has a Worker path; this panel batches DOM changes. Million-spin browser/UI memory and throughput were not benchmarked in this phase. |
| Persistent research archive | Not implemented by this phase | Existing event/prediction persistence remains available for configured sessions, but the new timeline and content are not persisted as research records. |
| FAQ and technical documentation | Implemented as searchable static pages | `/faq` and `/docs` route to authored HTML; search only filters existing DOM text. No dynamic content definitions, sitemap or autonomous update pipeline. |
| Dynamic research pages and SEO metadata | Not implemented | No generated research-page router, page definitions, sitemap or per-finding canonical pages added. |
| BRI Publishing Intelligence | Not implemented | No content proposal or publishing authority exists. |
| Editorial administration | Not implemented | No admin role, CSRF flow, preview/review/approve/reject/unpublish/rollback endpoints or audit log. |
| Autonomous code modification/deployment | Prohibited and absent | Generated content is not code; no code-generation or deployment feature was added. |
| Statistical evidence calibration | Not changed in Phase 1 | Existing evidence gate remains under investigation; `research-results/` contains machine-readable studies. A separate street-intelligence Markdown report referenced by an older summary is absent from this working tree. |
| Public Randomness Integrity research section | Not implemented | README now explains frequency versus independence and links to the local audit. No dedicated public `/research/randomness-integrity` page or dynamic independence monitor exists. |
| Public methodology page | Implemented as static page | `research.html` is linked from the homepage and covers project scope, European wheel math, forecast method and limits; no dynamic research archive is published. |
| Persistent table identity | Implemented for simulated profiles | Local multi-profile registry and confirmed switch; account-level active table is persisted via migration 006 and owner-checked API. No human observation mode, observer/dealer metadata, or gap/continuity markers exists. |
| Human observation integrity | Not implemented | Current app records synthetic simulation outcomes only. No human-entry UI, rate limiting, anomaly quarantine, import mode, or admin review. Table/cohort identifiers do not authenticate physical identity. |
| Isolated Test Mode | Implemented locally; not part of pushed v1.0.0 | Uses the production BRI coordinator and predictor, temporary `test` provenance, fixed 24-hour expiry, bounded generation and immediate discard. No storage/API imports; the session disappears on page close. |

## Tests and Limitations

- `npm test`: 105 passed, 0 failed, 1 skipped (106 tests total). The skipped MySQL integration test requires PDO MySQL and `BANKROLL_TEST_DB_*` settings.
- `npm run test:php`: passed.
- `php -l` across `server/` and `tests/php/`: passed.
- Focused research-event and page tests: 9 passed.
- Table-profile registry tests: 4 passed; active-table dialog checks are included in the page integration tests.
- Database migrations and API integration were not exercised in this environment.
- No Playwright/browser screenshot, mobile visual comparison, assistive-technology test, security penetration test, or million-spin UI profile was performed. Test Mode changes remain uncommitted and are not in the published v1.0.0 package.

## Next Work

1. Phase 2: independently investigate distribution-change detection, forward predictive improvement, and payout-aware expected value as separate questions. Run fair and subtle-bias tests over independent seeds; report false-positive/negative intervals, latency and abstention. Do not lower the wagering threshold to increase activity.
2. Add observed-data ingestion with explicit dataset/table identity and keep synthetic and observed records isolated.
3. Persist experiment metadata/results and research events through an indexed, bounded PHP/MySQL design before building public archive pages.
4. Define structured hypotheses/findings and evidence references; retain append-only revisions and supersession links.
5. Add trusted server-rendered research routes and safe page templates, then a separate admin-authenticated editorial workflow with CSRF, quotas and audit history.
6. Add browser, responsive, accessibility, security, database and million-spin presentation benchmarks before claiming production readiness.