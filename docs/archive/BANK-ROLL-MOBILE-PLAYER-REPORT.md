# Mobile Player experience refinement

## Implementation

The approved homepage, typography, theme palette, shared navigation and theme implementation are unchanged.

- Active sessions lead with the physical table, available bankroll, session result, a concise **BRI RECOMMENDS** card and actual wager state, immediately followed by number entry.
- BRI displays **OBSERVE / NO BET**, **BET · exploratory**, or **STOP** for an ended session or breached financial limit. Exploratory proposals show covered numbers, per-street stakes, total and player-selected progression. They are not represented as actual bets.
- The unavailable BRI-wager button is omitted when no wager is recommended. Manual wagers remain subject to existing limits. Explicit **No Bet confirmed**, undecided/no-confirmed-wager and confirmed BRI/manual wager states stay distinct; the existing store uses `player-no-bet` for an explicit choice.
- Full recommendation explanations, forecast details, evidence, financial rules and accounting totals move into collapsed details. Detailed result/wager/correction history and integrity audit are expandable below an eight-result strip. Recent-result buttons open the full history.
- Player and Test Mode share a presentation-only CSS board: zero above twelve rows of three numbers in portrait, and zero left of twelve columns/three rows in sufficiently wide landscape and desktop. Number order and roulette colours remain accurate. Every tested interactive key is at least **44 x 44 CSS px**, with upright text, keyboard support and visible selection/focus.
- Layout changes use CSS, not orientation APIs, page reloads or regenerated handlers. Player selection still requires the explicit **Record result N** action; rotation never submits it. Reload restores persisted table/session/wagers but intentionally does not persist an unrecorded selection.
- Landscape at 900px and wider places BRI beside number entry. At smaller widths it uses a compact recommendation/status strip above the full-width board so twelve numbered columns can retain 44px targets.
- Record confirmation reports the number and settlement; recent results update, and undo explicitly reports a reopened actual wager. Corrected and undone rows remain distinct in history.
- Corrected a tightly related presentation issue: an unsettled stake no longer colours a zero session result as a loss. Profit and accounting values themselves are unchanged.
- Simulator cells are display-only `div` elements. Their board geometry, mapping and interaction remain unchanged; the portrait minimum number font increases to 0.95rem for readability rather than introducing unnecessary touch interaction.
- Added Player safe-area side padding and retained non-obstructing bottom action spacing. No sticky status/keypad overlay was introduced.

No forecasting algorithm, evidence threshold, strategy rule, progression calculation, settlement, table identity, persistent storage format, research record or theme/version/cache architecture was changed. Test Mode retains its existing immediate manual entry in a strictly separate temporary session.

## Exact files changed for this refinement

1. [player.html](player.html)
2. [test-mode.html](test-mode.html)
3. [assets/css/player.css](assets/css/player.css)
4. [assets/css/bank-roll.css](assets/css/bank-roll.css)
5. [assets/css/number-entry.css](assets/css/number-entry.css) (new)
6. [src/ui/player-app.js](src/ui/player-app.js)
7. [src/ui/sandbox-app.js](src/ui/sandbox-app.js)
8. [browser-tests/mobile-player.spec.js](browser-tests/mobile-player.spec.js) (new)
9. [browser-tests/player.spec.js](browser-tests/player.spec.js)
10. [tests/integration/page.test.js](tests/integration/page.test.js)
11. [tests/integration/test-mode-runtime.test.js](tests/integration/test-mode-runtime.test.js)
12. [docs/player-mode.md](docs/player-mode.md)
13. [docs.html](docs.html)
14. [README.md](README.md)
15. This report (new).

Existing uncommitted redesign/theme work is preserved. The review archive includes a task-only unified diff against the preceding website-review source snapshot, plus the full current diff against Git HEAD so these scopes are not confused.

## Actual before/after measurements

Same Chromium viewport, new physical table named "Mobile review example", no observations or wager, same themes and site header. Measured `rouletteBoard.top - playerWorkspace.top`, after asynchronous setup was fully rendered. Values match in Light and Dark.

| Viewport | Before distance from active workspace | After | Reduction | Absolute keypad top before / after |
| --- | ---: | ---: | ---: | ---: |
| 390 x 844 portrait | 562.03 px | 336.52 px | **225.52 px (40.1%)** | 634.03 / 408.52 px |
| 844 x 390 landscape | 224 px | 213.52 px | **10.48 px (4.7%)** | 296 / 285.52 px |
| 932 x 430 landscape | 224 px | 90 px | **134 px (59.8%)** | 296 / 162 px |

The active workspace begins at 72px beneath the unchanged site header. Raw measurement JSON and genuine before/after screenshots are in [visual-review/mobile-player/](visual-review/mobile-player/).

The improvement is substantial in portrait and side-by-side landscape, but deliberately modest at 844px: twelve comfortably tappable columns need the full width, so BRI cannot also occupy a separate sidebar there. This is not claimed to remove all scrolling.

## Tests performed

- `npm test`: **143 tests, 142 passed, 1 skipped, 0 failed**. The skip remains optional MySQL integration without configured disposable database/PDO MySQL.
- `npm run test:php`: **PASS**; non-fatal Xdebug connection warning.
- Complete source browser suite: **35 passed** before the final pending-stake colour correction.
- Complete browser suite against the **extracted final cPanel ZIP**: **35 passed**, including final pending-stake colour and shared-board changes.
- Packaging page/module/runtime checks: **16 passed**.
- Archive verification: **PASS**, one `public_html` root, 75 entries, resource/version/manifest checks and ZIP integrity.
- `git diff --check`: **PASS**.

New Chromium tests cover **320 x 700, 375 x 812, 390 x 844, 430 x 932, 667 x 375, 844 x 390, 932 x 430, 768 x 1024 and 1440 x 1000**, in Light and Dark, on both Player and Test Mode entry boards.

They assert all 37 numbers, ascending DOM order and conventional visual street relationships, exact roulette colours, upright labels, minimum 44px width/height, containment and no horizontal page overflow. Interaction coverage includes table/session creation, BRI observation recommendation, explicit No Bet, keyboard selection and changing a selection, separate result recording, duplicate synchronous confirmation attempts producing only one observation, manual wager confirmation, debit/settlement, undo/reopened wager, table switching, refresh/restore and repeated rotations preserving selection, pending wager, table, recommendation and bankroll.

Existing browser coverage also verifies correction and financial replay, session limits, export, table separation, persisted browser restart, all public pages, live theme changes/persistence, research Worker isolation/cancellation and the Simulator's orientation-aware board. No JavaScript exceptions occurred in successful browser runs.

## Actual screenshots reviewed

Before/after Player portrait and landscape in both themes; compact BRI/number-entry area; pending manual-wager dialog; confirmed wager and selection; recorded observation, recent results and reopened wager; Simulator portrait/landscape board; Test Mode portrait/landscape board.

Screenshots generated by the browser tests are from isolated synthetic review/test contexts, not genuine live-table observations. Final interaction captures were refreshed from the extracted final package. Source before/after captures use the unchanged shared header and source version footer.

Player full-page captures work normally. Test Mode retains the historical nested body scrolling behaviour; complete **board locator crops** are included separately because a normal full-page capture may omit below-viewport body content. These crops show the actual complete keypad, not a mock-up.

## Deliverables

- [bank-roll-cpanel.zip](bank-roll-cpanel.zip): refreshed browser-only package, **not deployed**.
  - Version: `1.1.0-next`
  - Build: `13c2cb90b675b83dc939`
  - SHA-256: `dbf04b890440699c65542573e7c5ed35cac74188b52c18d0924834f0fbeda771`
- [bank-roll-mobile-player-review.zip](bank-roll-mobile-player-review.zip): full current public source, relevant tests/documentation, task-only and HEAD diffs, Git status/stat, raw before/after measurements, screenshots, test output and outstanding limitations.

## Remaining limitations

- **Chromium emulation only**: no physical handset, browser-chrome/safe-area hardware, Safari/WebKit, Firefox or screen-reader testing is claimed.
- Twelve portrait rows at 44px plus zero and gaps require at least 620px for the board alone. On short phones the lower numbers/result confirmation/recent history require normal vertical scrolling; no controls are clipped or hidden behind sticky overlays.
- 667px and 844px landscape cannot fit a 620px-wide keypad plus a useful BRI sidebar. The stacked layout still requires some vertical scrolling; side-by-side starts at 900px.
- Screenshots substantiate OBSERVE/no-bet and manual wager workflows, not a genuine qualified BRI betting signal. No manufactured research edge or fake performance data was inserted to generate a BET screenshot.
- Player deletion/import/restore, storage-scale recovery, cross-device synchronisation, independent physical-wheel/strategy validation and production backend safeguards remain open as documented in the existing requirements register.
- Test Mode deliberately retains immediate entry, rather than adopting Player's confirmation/persistence workflow. Only board presentation is shared.

No dependency downloads or external searches were performed. No staging, commit, push, tag, release, deployment or live-site changes occurred.

## Suggested single-paragraph commit summary

Refine Bank-Roll's live Player interface around compact table/accounting status, concise BRI recommendations, explicit wager decisions and responsive upright roulette number entry; share presentation-only portrait/landscape keypad styles with isolated Test Mode, retain 44px interactive targets and separate Player observation confirmation, collapse detailed evidence/accounting/history, add recent-result access and clearer undo/selection status, correct pending-stake profit colouring, and improve display-only simulator number readability without changing forecasting, financial rules, storage or the approved themes/navigation; include the outstanding research-led homepage/shared shell and routing/package refinements already in the working tree, with updated documentation, regression tests and review screenshots. Assisted-by: Copilot.
