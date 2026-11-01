# Bank-Roll Test Mode Report

**Status:** Implemented as a browser-memory-only experiment page.  
**Date:** 2026-10-29  
**Production:** Not deployed by this feature work.  
**Data retention:** Fixed 24-hour lifetime; activity never extends expiry.

## Implementation

`test-mode.html` is a separate public page linked from the homepage and runs `src/ui/sandbox-app.js`. It supports manually entering every European result (0–36), generating one seeded random spin, and generating bounded batches of 10, 50, or 100. Total observations are capped at 5,000 per test session. Results include recent history, correction/undo, twelve street counts, current forecast, Brier summaries, coordinator action, simulated bankroll/P&L, and significant test events.

`src/simulation/sandbox-session.js` uses the real `BriCoordinator`, `StreetPredictionEngine`, `ResearchEventStream`, financial safeguards and `mulberry32`/`xfnv1a` research generator. Each outcome is processed through `beforeSpin()` before it is accepted, then `afterSpin(outcome)` scores and learns from it. Generated batches process one prepared forecast/decision before each outcome. Test wagering uses a local simulated bankroll with fixed limits; no decision bypasses the existing coordinator safeguards.

The optional Quiet/Companion/Full Character selector uses the existing `BriCompanion` in memory only. It receives Test Mode forecasts, decisions and evaluations, cannot influence the coordinator, and speech remains muted.

## Isolation and Expiry

- Provenance is explicit: `sourceType = "test"`, `dataOrigin = "synthetic"`, and each session uses a unique `test:<uuid>` dataset ID.
- The Test Mode dependency graph has no `ResearchClient`, localStorage, sessionStorage, IndexedDB, or `fetch` access. It cannot reach the table-profile registry, active live table, shared aggregates, PHP observation endpoints, or permanent research archives.
- Session outcomes, forecasts, decisions, events and bankroll exist only in the page's in-memory `TestModeSession` instance. Reloading or navigating away loses the page state; `pagehide` explicitly discards the session.
- `expiresAt` is fixed at creation plus 24 hours. Every session operation checks the deadline; the UI countdown checks once per second and rechecks on page restore/visibility return; activity does not renew the deadline. At expiry the session is discarded and subsequent operations fail closed.
- **End Test & Discard Results** clears the in-memory data immediately. Reset clears current test records, model state and companion memory but retains the original expiry deadline.
- Generated sequences are seeded/deterministic and visibly labelled synthetic. Manual results are also test-only; they are not claims of physical observation.

This is an isolated anonymous browser sandbox, not durable storage or a security boundary against a visitor inspecting their own browser memory. Because no Test Mode records are sent to the server, no server cleanup job or backup retention path is needed for them.

## Security and Resource Limits

The page imports browser UI, existing BRI calculation/coordinator, companion and Test Mode session modules. It does not import `ResearchClient`, local table-profile storage, or live app/table state. Batch generation is capped at 100 outcomes per action and the session at 5,000 total outcomes. Manual submissions remain synchronous and bounded by that cap. User text is not rendered as HTML; generated timeline/history labels use DOM text nodes. The existing root CSP restricts scripts and network connections to same origin.

The PHP live observed-origin gate remains default-off under `BANKROLL_ALLOW_OBSERVED_SUBMISSIONS=false`. Test Mode does not request an exception and does not alter this setting.

## Status Matrix

| Requirement | Status | Notes |
| --- | --- | --- |
| Prominent separate Test Mode entry | Implemented | Homepage and research page links lead to `test-mode.html`; status and synthetic provenance are visible. |
| Anonymous manual 0–36 input | Implemented | Rapid entry is allowed within the local 5,000-outcome bound. |
| Random single spin and bounded batch | Implemented | Uses existing seeded research RNG; batch maximum 100. |
| Genuine BRI forecasting/scoring/decisions | Implemented | Runs existing coordinator/prediction engine; no imitation engine. |
| Simulated bankroll safeguards | Implemented | Local coordinator with flat progression and conservative fixed session limits. |
| Correction/undo and reset | Implemented | Replays only the test session outcomes into a new isolated coordinator. |
| Optional BRI companion modes | Implemented | Existing Quiet/Companion/Full modes; memory is session-scoped, speech muted, and reset/discard clears it. |
| Fixed 24-hour expiry | Implemented | Deadline fixed at construction, checked by session methods and one-second UI timer. |
| Immediate discard | Implemented | Clears arrays, coordinator and event stream. |
| Server persistence/cleanup | Not used | Session data is never written to browser persistence or server storage. |
| Sequence-dependence / Randomness Integrity analysis | Not implemented | Current Test Mode displays existing frequency/model evidence only. |
| Research imports / structured experiments | Not implemented here | Remain in the separate Research Laboratory roadmap. |
| Live human observation | Separate, currently server-gated | Not implemented by this page; observed-origin PHP submissions default to 403. |

## Verification

Focused Test Mode session tests cover manual acceptance of all 37 numbers, forecast-before-outcome chronology, genuine BRI decisions/scoring, generated-sequence reproducibility, correction/undo replay, invalid input and resource limits, fixed expiry, no TTL extension, immediate discard, reset expiry preservation and independent sessions. Page tests assert the entry point, disclosures, real engine dependency, DOM bindings, module graph and absence of persistence/API clients. Current full suite: 105 passed, 0 failed, 1 skipped (106 total); the skipped MySQL integration test requires PDO MySQL and `BANKROLL_TEST_DB_*`. PHP helper and syntax checks pass. This implementation is uncommitted and is not included in the pushed v1.0.0 package.

No browser automation package is installed in this environment, so visual screenshots, keyboard/assistive-technology testing and interactive browser profiling are not claimed. The manual keypad uses native buttons and fixed-size responsive CSS; browser testing remains recommended before a public deploy.
