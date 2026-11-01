# Bank-Roll next-stage delivery report

Date: 2026-11-01. All work remains local and uncommitted. No files were staged; no commit, push, tag, release, deploy, live-site changes or remote Git access occurred.

## What changed

- Created the comprehensive [initial working-tree audit](BANK-ROLL-NEXT-STAGE-AUDIT.md), recording local HEAD `a64d90e`, the original user-provided 16-file dirty diff and 14 untracked files before implementation.
- Made Player Mode the Apache directory default while retaining simulator `index.html`, existing desktop design and roulette board. Added confirmed table switching, separate new-session limits, resume continuity prompt, observer handovers and gap markers.
- Added actual-wager-only integer-cent settlement; flat, linear, Fibonacci and Martingale session strategies; maximum-stake, per-street, exposure, stop-loss and take-profit bounds. Forecasts are recorded before outcomes. Recommendations cannot debit money.
- Added local append-only forecast/action/event history, ordered correction revisions, undo tombstones, whole-table/session financial replay, evidence epoch invalidation, export of all sessions and optimistic per-session cross-tab revisions.
- Added local cadence rejection and quarantine (client safeguards only). Quarantined outcomes are excluded from model learning but actual wagers still settle. No data leaves Player Mode.
- Extended the existing learner to six prospective distributions: uniform, lifetime, rolling-100, rolling-25, exponential-frequency and smoothed street transition. Gaps reset continuous context. The selected model's anytime paired-score bound, recent deterioration, positive estimated return and risk horizon gate wagering.
- Corrected switch screening to use support from the selected model, not the general forecast window. Transition support counts only prior outcomes from the current category; exponential-frequency support uses effective sample size. Forecast-based switching now requires 25 effective observations and an explicitly approximate screening margin, not a claimed 95% confidence guarantee.
- Made BRI's preferred strategy explicit as observation/no wager. Qualified wagers are labelled exploratory; the configured progression remains player-selected and is not described as an evidence-backed strategy or silently changed. Flat is the default risk-control baseline only.
- Confirmed table deletion exists only as a storage method and is not exposed in the Player UI; JSON export has no import/restore counterpart. Documented both as blockers for general/stable release, while allowing only a clearly labelled preview with prominent data-loss warnings.
- Replaced the previous coarse repeated-check score threshold with fixed-lambda Hoeffding/Ville bounds using each stored forecast's pre-outcome paired-score range; multiplicity is allocated across five alternatives and 21 fixed lambdas. The exact formula and scope limitations are documented in [mathematics](docs/mathematics.md).
- Wired the existing research worker into an explicitly synthetic Research page. Seven strategies/progressions can be compared on the same reproducible sequence, with cancellation and no Player Mode import.
- Added content-derived package build IDs, transitive ES-module/Worker cache keys, an SHA-256 file manifest, Apache HTML/CSS/JS revalidation, and `DirectoryIndex player.html`. cPanel remains browser-only.
- Added a reviewed requirements register: [BANK-ROLL-OUTSTANDING-REQUIREMENTS.md](BANK-ROLL-OUTSTANDING-REQUIREMENTS.md).

## Validation

- `npm test`: **139 tests, 138 passed, 0 failed, 1 skipped**. The one skip is optional MySQL integration; no configured disposable database/PDO MySQL was available.
- `php tests/php/run.php`: **PASS**. PHP prints a non-fatal Xdebug connection warning because no debugging client is listening.
- `npm run test:browser`: **12 passed**. Real Chromium persistent profile covered Player setup, actual wagers, European zero, multiple streets, correction, undo/reopened wager with lost/undone/reopened/won history labels, local export, physical table switching, separate bankroll session and browser-process restart. Worker comparison/cancellation passed.
- All six public HTML pages were checked in actual Chromium at mobile widths **320, 375, 390, 430 and 768**, portrait and rotated landscape viewport; no horizontal overflow or JavaScript page errors. Player number keys measured at least **44×44 CSS px**.
- Re-extracted the finished cPanel ZIP and reran all **12 browser tests** against its `public_html`; the packaged pages, Worker, and mobile layouts passed.
- Every one of the 37 European results was checked against a three-street actual wager. Additional tests cover storage failure/retry, stale tabs, cadence quarantine, gaps, historical-session correction, same-timestamp revisions, checkpoint rejection, all configured financial stops, selected-model evidence and the model-specific switch-support threshold.
- Added deterministic low-support transition-switch coverage, selected-model effective-sample checks (including weighted exponential support), persisted preferred-strategy assessment coverage, unit coverage for observed/unresolved/undone/won/lost rendering states, and a browser regression checking an undone wager is reopened before its subsequent settlement.
- A fresh fixed-policy research confirmation (`seedPrefix=next-stage-final-check-v2`) ran **20 independent seeds × 2,000 outcomes** for each fair, biased and changing scenario, seven fixed strategies and an independent random-street baseline. Full results and per-seed replay hashes are in [next-stage-confirmation.json](research-results/next-stage-confirmation.json); the earlier diagnostic run is [next-stage-evidence.json](research-results/next-stage-evidence.json).

### Research interpretation

The fair-wheel BRI policy placed **zero wagers in all 20 runs**: mean P/L £0 and total stake £0, because no model qualified. Its selected one-street forecast hit rate averaged **8.04%** against the chance baseline of 3/37 = **8.11%**; the paired uniform Brier mean was 0.9203. The cold flat progression averaged £−1.47 with a wide, unadjusted 95% interval of £−4.20 to £1.26 after £50.07 average exposure. Cold linear/Fibonacci/Martingale had occasional positive sample means, all with intervals spanning zero. This illustrates why small runs do not establish advantage.

The research comparison does not establish a preferred staking progression: flat, linear, Fibonacci and Martingale are compared on synthetic sequences, with no external/physical-wheel validation and no justified progression advantage. BRI does not automatically select a progression. It identifies observation/no wager as its preferred strategy; any wager candidate that passes internal screens is exploratory, explicitly requires player confirmation and uses the player's configured progression without changing risk limits.

Under the deliberately synthetic 25%-favoured-street distribution, BRI qualified in 20/20 runs, averaged £488.42 P/L, staked £245.38 and had an unadjusted replicate 95% t interval of £468.25 to £508.59. This scenario gives one betting street a 25% outcome probability rather than 3/37; it explicitly contains a large exploitable edge known to the experimenter. It demonstrates response to that stipulated signal only, **not** discovery of or evidence about a physical wheel.

The changing scenario qualifies in 8/20 runs and averages £27.28 P/L after £12.32 average stake, with a £6.78 to £47.78 interval. That injected scenario is biased for its first half and fair after a change; qualifications, tiny exposures and results are exploratory model behavior, not independent validation. The random flat control lost £35.04 on average in the fair case after £1,200 total betting exposure, interval £−53.39 to £−16.69. These intervals are small-sample, unadjusted across strategies/scenarios; they do **not** establish physical-wheel advantage or strategy superiority. Flat staking removes progression-driven escalation, not the house edge. Seed partitions in the stored JSON are reporting labels, not a trained model's blind holdout.

## Player/money safeguards and boundaries

- Only explicit wager confirmation debits the bankroll. A submitted result without a confirmed wager cannot change bankroll. Zero loses all street stakes; a winning street returns 12 times only its allocated stake. Unit, total, per-street and potential returns are bounded in safe integer minor units.
- Table switches require confirmation and are rejected with an unsettled wager. New session settings do not erase table observations. Resume without asserted continuity adds a gap.
- Corrections retain originals and scores and reset later prospectively scored evidence rather than treating forecasts made on incorrect history as clean.
- Cadence/handover checks run only in the browser. A determined user can bypass them; they are not server security or verified human provenance. Quarantined observations are excluded from model learning and clearly flagged, but there is no moderation/release UI.
- Player history stays in IndexedDB and is unsynced/unbacked-up. Persistence/corrections/exports read the whole table; million-spin Player Mode scale has not been validated.
- No in-app table deletion or import/restore workflow exists. This blocks general/stable release; limited preview requires prominent warning that data loss is irreversible and exports cannot currently be restored.
- No MySQL production verification, live deployment, real casino observation, verified wheel bias, global learning or guaranteed returns are claimed. Observed PHP submissions remain disabled.

## Package

The browser-only ZIP is rebuilt from the final local tree after tests. Its destination is [bank-roll-cpanel.zip](bank-roll-cpanel.zip) (ignored by Git). The script passed its HTML/runtime checks, stages `public_html/`, content-versions transitive assets and Workers, and verifies its file hashes, security boundaries and archive. The exact archive was extracted and passed the full Chromium browser suite. The package contains 69 entries, excludes PHP/backend, tests, reports, research outputs, Git metadata and `node_modules`, and was not deployed.

- SHA-256: `346a6177987fdbe6b28adbbd71a4c1342363ff8cdeba6be95fe3208c781480e2`
- Size: **155,428 bytes**
- Build identity: `1.1.0-next.6c0fefd3ad9a53f1caf0`

## Proposed commit message (do not commit in this task)

`Make Player Mode observation-first with model-supported switching and explicit risk disclosures`

Assisted-by: GitHub-Copilot:gpt-6-luna
