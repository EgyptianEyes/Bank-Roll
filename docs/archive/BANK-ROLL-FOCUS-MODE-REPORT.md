# Live Player Focus Mode

## Delivered

Focus Mode is an optional presentation of the existing Player application, not another session or forecasting engine. **Focus Mode / Exit Focus Mode** uses one keyboard-accessible toggle, with `aria-pressed`. Exiting restores the ordinary site header/navigation/footer.

While enabled, the interface:

- Minimises website branding/navigation and footer distractions.
- Keeps a small sticky **table / bankroll / signed session P/L / BRI action** summary adjacent to an always-available Exit control. The summary mirrors existing rendered accounting and recommendation values; it does not calculate settlement or forecasts.
- Retains the actual actionable recommendation, exploratory proposal details when one exists, explicit No Bet and actual manual/BRI wager controls and states.
- Prioritises the unchanged orientation-aware number board, selected-number feedback and explicit **Record result N** confirmation.
- Collapses existing table/session, evidence, full strategy, historical statistics and integrity details when entering Focus Mode. They can still be reopened without exiting; recent results, detailed corrections, Undo, switching tables, session controls and export remain accessible.
- Uses the same portrait and landscape board geometry, roulette colours and minimum 44px number targets.
- Becomes a compact stacked interface in smaller landscape widths and BRI-beside-board at 900px and wider.

The separate localStorage key **`bank-roll-player-focus`** persists only a display preference. Storage failures are logged and visibly reported; current-page switching still works. Clearing or updating that preference in another tab updates the presentation. Theme-storage warnings remain visible rather than being hidden with the header.

No Fullscreen or Screen Orientation APIs are used. No automatic observation, wager acceptance, session creation/reset, table change or programmatic scrolling occurs when toggling. Buttons and business handlers are not rebuilt. Existing errors, financial stop reasons, pending wagers and submission feedback remain visible.

## Exact files changed for this task

1. [player.html](player.html): display toolbar and Focus stylesheet.
2. [src/ui/player-app.js](src/ui/player-app.js): imports the presentation module; business logic unchanged.
3. [src/ui/player-focus.js](src/ui/player-focus.js): new isolated presentation/preference module.
4. [assets/css/player-focus.css](assets/css/player-focus.css): new scoped Focus styling.
5. [browser-tests/player-focus.spec.js](browser-tests/player-focus.spec.js): new real browser workflow, viewport, preference and access tests.
6. [tests/unit/player-focus.test.js](tests/unit/player-focus.test.js): new deterministic display/persistence tests.
7. [docs/player-mode.md](docs/player-mode.md): usage and limitations.
8. [README.md](README.md): report/feature link.
9. This report.

All prior uncommitted website/mobile/theme changes are preserved. The new review ZIP contains a **task-only diff against the preceding mobile-player review source snapshot**, and a separate complete tracked diff against Git HEAD. These are different scopes.

## Genuine browser measurements

Measured in Chromium at scroll position zero with an existing loaded example table, no outcomes, no confirmed wager and collapsed details. Light and Dark produce the same geometry.

### 390 x 844 portrait

| Metric | Current normal Player | Focus Mode |
| --- | ---: | ---: |
| First number-entry button top | 459.52 px | **282.52 px** |
| Board width x height | 366 x 620 px | **366 x 620 px** |
| Board initially visible | 62.01% | **90.56%** |
| Recommendation-to-board edge gap | 155.69 px | **123.69 px** |
| Minimum downward scroll to show all numbers and Record result | 296.52 px | **119.52 px** |
| Sticky essential-status height | none | **56 px** |

Focus moves the first button **177px earlier (38.5%)** relative to current normal Player and reduces the required scroll extent by **177px (59.7%)**. It does **not** fit the entire portrait board and confirmation on the initial screen.

The new Focus control moves the normal Player keypad down by 51px. For transparency, the preceding approved mobile report measured the original normal keypad top at 408.52px. Focus is still **126px earlier (30.8%)** than that earlier implementation, without altering board height or touch targets.

### 932 x 430 landscape

| Metric | Current normal Player | Focus Mode |
| --- | ---: | ---: |
| First number-entry button top | 214 px | **137 px** |
| Board width x height | 659.73 x 140 px | **671.73 x 140 px** |
| Board initially visible | 100% | **100%** |
| Recommendation-to-board edge gap | 25 px | **13 px** |
| Minimum downward scroll to show all numbers and Record result | 0 px | **0 px** |
| Sticky essential-status height | none | **53 px** |

The full landscape board and confirmation control genuinely fit this measured viewport. History and optional expanded panels can still require scrolling.

Measurement JSON includes all tested viewports under [visual-review/focus-mode/](visual-review/focus-mode/). Visibility percentage is the intersection of the board rectangle with the initial viewport divided by board height; the board fits horizontally. Scroll extent is the additional downward distance from initial scroll zero required to bring the board bottom and Record result bottom into view. It is not a count of all gestures or optional panels. Gap is the shortest distance between the actual recommendation-content and board rectangles; raw signed vertical separation is also recorded and is negative in side-by-side landscape, not a negative physical gap.

## Tests and verification

| Check | Actual result |
| --- | --- |
| `npm test` | **146 tests, 145 passed, 1 skipped, 0 failed** |
| `npm run test:php` | **PASS**, non-fatal Xdebug connection warning |
| Complete source browser suite before final signed-profit formatting/access-test additions | **38 passed** |
| Complete browser suite against extracted final cPanel ZIP | **39 passed** |
| Packaging runtime/page/module checks | **16 passed** |
| Public archive verifier | **PASS**, 77 entries, one `public_html` root, resource versioning/manifest/dependency/policy checks |
| `git diff --check` | **PASS** |

Focus geometry and workflow were exercised in both themes at **320 x 700, 375 x 812, 390 x 844, 430 x 932, 667 x 375, 844 x 390, 932 x 430, 768 x 1024 and 1440 x 1000**.

Checks cover:

- Table/session setup, resume/reload, enabling/exiting Focus and preserving the active table, bankroll, recommendation, selection and confirmed wager.
- Explicit No Bet, selecting separately from recording, duplicate synchronous result confirmations producing one observation.
- Manual confirmation, wager debit, settlement, Undo/reopened wager and historical correction while still focused.
- Switching to another physical table and returning within Focus, preserving the original history/accounting.
- Portrait/landscape rotations without data loss or automatic submission.
- All 37 existing keys present, upright labels, >=44px width/height, containment and no horizontal page overflow. Existing mobile tests verify exact roulette colours and conventional visual number relationships.
- Keyboard toggle activation with focus retained, last-number access through ordinary scrolling without sticky overlap.
- A **390 x 260 keyboard-like viewport simulation**: manual confirmation remains reachable, dialog closure works and essential status becomes non-sticky.
- Persistent display preference and visible blocked-storage errors.
- Unit tests verify that presentation/preference changes retain existing source values and signed profit rendering.

Existing normal Player, theme, Simulator, Test Mode, correction, export, browser restart and Worker regression tests also pass. Successful browser runs report no page exceptions.

## Visual review and accessibility

Actual normal/Focus desktop/tablet/portrait/landscape screenshots, Light/Dark, selected number, pending manual-wager dialog, confirmed wager and recorded observation were captured and inspected. Final captures come from the extracted final cPanel package and isolated review-browser tables, not genuine physical observations.

The compact status stays readable without a large fixed overlay. It participates in document flow and stays above, not on top of, reachable number targets. It becomes static below 300px viewport height. Existing reduced-motion rules, theme tokens, button labels, focus styling and safe-area padding remain in use. Focus does not lock orientation or require fullscreen.

No fabricated qualifying BET signal was introduced for screenshots. OBSERVE and manual wager states use the existing real application workflow; BET/STOP display mirrors existing recommendation rendering. Previous semantic theme-contrast tests remain green; this is not an exhaustive new accessibility certification.

## Archives

- [bank-roll-cpanel.zip](bank-roll-cpanel.zip): verified browser-only public package, **not deployed**.
  - Version: `1.1.0-next`
  - Build: `9d6004f634ad80daa1b1`
  - SHA-256: `27b288e0a723b703aa7536780bd35d3bc6f9cb3af6868aebfe37e0fb198a12ad`
  - Contains no development reports, test fixtures, tests, credentials or private configuration.
- [bank-roll-focus-mode-review.zip](bank-roll-focus-mode-review.zip): relevant current source/test/docs, task and HEAD diffs, Git evidence, measurements, real screenshots and test logs. Review material is not included in the public package.

## Remaining limitations

- Chromium browser emulation only: no physical phones, actual on-screen keyboards/browser chrome, Safari/WebKit, Firefox or screen-reader sessions are claimed. The 260px test simulates reduced viewport height, not hardware keyboard behaviour.
- Portrait still requires natural vertical scrolling; long table names, warnings, real BET details or expanded panels can increase space requirements beyond the baseline figures.
- Smaller landscape widths cannot safely combine a >=620px horizontal board with a useful BRI sidebar. They retain the compact stacked layout and can require scrolling.
- Focus uses ordinary browser storage. If localStorage is unavailable the selection cannot survive restart; the interface says so.
- Focus is optional. The same exit button always restores full navigation; changing theme is available after exiting, rather than duplicating the approved theme control.
- Existing local data deletion/import/restore, storage scaling, cross-device recovery, independent physical-wheel validation and optional backend production verification remain outstanding.
- The optional MySQL integration test remains skipped because no configured disposable database/PDO MySQL is available.

No BRI algorithms, evidence requirements, strategy/progression/settlement calculations, provenance, physical identity, IndexedDB schema, history, research isolation, Test Mode/Simulator logic, theme palette or version/cache architecture were changed. No dependencies were downloaded and no external searches were performed.

Nothing was staged, committed, pushed, tagged, released, deployed or changed on the live website.

## Proposed single-paragraph commit summary

Add optional persistent Live Player Focus Mode with a compact sticky table/bankroll/session P/L/BRI summary, clear exit control, reduced website distractions and collapsible existing management/evidence/history panels, preserving the same wager confirmation, number selection, recording, correction and settlement workflow; include the outstanding research-led homepage, theme/shared navigation and responsive mobile keypad refinements already in the working tree, plus documented real browser measurements, preference/accessibility tests and review screenshots, without changing forecasting, financial rules, storage schemas or the approved visual identity. Assisted-by: Copilot.
