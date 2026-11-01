# Outstanding requirements register

Status after the 2026-11-01 local next-stage implementation. This register distinguishes shipped local capabilities from server, research and scale work not validated here. The detailed initial-source audit is [BANK-ROLL-NEXT-STAGE-AUDIT.md](BANK-ROLL-NEXT-STAGE-AUDIT.md); test and benchmark boundaries are in [BANK-ROLL-NEXT-STAGE-REPORT.md](BANK-ROLL-NEXT-STAGE-REPORT.md).

| Priority | Requirement | Status / evidence needed before closure |
|---|---|---|
| P0 | Real production MySQL/MariaDB verification | Open. Integration suite was skipped without disposable DB and `pdo_mysql`. Verify migrations 001–006, concurrent writes, corrections/rebuild and consent in a provisioned disposable DB. |
| P0 | Server-enforced observed-origin anti-automation and provenance | Open. Server writes remain default-off. Add rate and burst limits, idempotency, contributor influence/quarantine, review/appeal, observer identity controls and operation monitoring; test under real host configuration. Client safeguards do not qualify. |
| P0 | Real physical-table data and independent predictability test | Open. Browser entries remain unverified; no physical-wheel edge or sequential predictability demonstrated. Obtain ethically collected, consented, continuity-labelled prospective data with a registered analysis protocol. |
| P1 | External, independent model and progression validation | Open. Fixed seeded train/validation-labelled simulations are only internal sensitivity experiments; no external blind set or physical-wheel validation. Flat is the default risk-control baseline; no progression is evidence-supported or automatically selected. |
| P1 | Model calibration and decision uncertainty | Open. Candidate scores are prospective Brier losses; estimated action EV is not a calibrated probability bound. Validate calibration, calibration drift, action-level payout uncertainty and switching estimates on independent data. The local switch-support margin is only a heuristic, not a confidence guarantee. |
| P1 | Player data deletion and restoration | Release blocker for general/stable release; acceptable only for a clearly labelled preview with explicit data-loss warnings. A store deletion method exists but there is no player-facing table/history deletion control; export exists but import/restore does not. |
| P1 | Player storage scale and device recovery | Open. IndexedDB restoration, correction, export and session replay are whole-table. Add migration/version recovery, cursor paging/checkpoints and tested quotas at 100k–1m observations; provide user-controlled backup/import and conflict recovery. |
| P1 | Observer quarantine review | Open. Rapid/machine-like patterns are excluded from local learning and flagged. There is no authenticated review/release workflow; permanent exclusion can create false positives. |
| P1 | Account recovery and consent withdrawal | Open. Token shown once; server auth recovery and deletion/export across all server data need verified workflows. |
| P1 | Cross-device sequence reconciliation | Open. Physical table identity is local; no synchronized observation ownership, merge/conflict UI or independently verified handover. |
| P2 | Wheel-sector analytics | Open. Betting-layout streets and physical wheel sectors remain distinct; no verified wheel-position/neighbor data or sector model. |
| P2 | Dependent-randomness challenge battery | Open. Add preregistered repeat/streak suppression, periodicity, balancing and Markov generators with independent-seed tests and familywise error accounting. |
| P2 | Persistent experiment catalogue, hypotheses and approval workflow | Open. Public Research currently runs a bounded isolated Worker comparison; results are downloadable/reproducible only through repository scripts. No publication or autonomous FAQ editing is enabled. |
| P2 | Monte Carlo planning | Open. No bankroll/risk scenario quantile planner has been validated for dependence or parameter uncertainty. |
| P2 | Accessibility and real-device validation | Partially open. Automated Chromium tests verify mobile viewport targets and accessible names; test real phones/tablets, screen readers, keyboard-only flows, zoom, touch latency and landscape use before release. |
| P2 | Server aggregate contributor privacy | Open. Consent and anonymized aggregate endpoints exist, but no minimum-contributor threshold, differential privacy or validated protection against singleton/small-cohort inference. |
| P2 | Production operations | Open. No live deployment, backup/restore test, alerting, retention policy or cache/header validation on the actual cPanel host. This task did not deploy. |

Never close a row based on implementation presence alone. Attach repeatable test output, deployment evidence and the stated data provenance.
