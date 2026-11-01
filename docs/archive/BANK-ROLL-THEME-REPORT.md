# Bank-Roll visualisation and theme report

## Delivered

- Replaced the homepage's misleading number grid with **Observe -> Predict -> Evaluate**: ordered outcomes, accumulated analysis, a forecast recorded before the next result, then prospective scoring against a uniform-wheel baseline.
- Preserved the editorial headline, layout, typography and green accent. The static HTML/CSS graphic works without animation or external images.
- Its illustrative 0, 1 and 2 are correctly green, red and black and explicitly labelled "Example only". The street baseline is exactly **3 / 37**; there are no invented predictions or measured-performance claims.
- Added an accessible native **System / Light / Dark** control to all seven public pages. First visits follow the OS; manual preferences persist in `bank-roll-theme` localStorage across navigation, reloads and browser restarts. System follows live OS changes, and open tabs synchronise preferences.
- The same-origin, blocking theme script runs before styles and body content to apply the preference before rendering. Storage failures produce a visible status and console warning while switching remains usable on the current page.
- Centralised dark and warm-neutral light palettes, semantic surfaces, text, borders, actions, errors and chart colours. Forms, menus, dialogs, notifications, tables, loading/progress states and footers inherit them.
- Kept roulette red, black, green and white number labels fixed across themes; removed misleading number-cell fading. Canvas line, histogram and miniature charts redraw their existing values immediately on theme changes.
- Theme storage and the illustrative graphic do not write table/research records. No BRI algorithm, probability, scoring, bankroll, forecast-persistence or gameplay calculation was changed for this theme task.

## Files

### Visualisation and theme work

- [home.html](home.html): research-process graphic and theme integration.
- [assets/js/theme.js](assets/js/theme.js): early application, persistence, OS/tab events and error reporting.
- [assets/css/theme.css](assets/css/theme.css): central palettes and semantic component/roulette styling.
- [assets/css/site-shell.css](assets/css/site-shell.css): shared shell and research-process presentation.
- [assets/css/bank-roll.css](assets/css/bank-roll.css), [assets/css/player.css](assets/css/player.css): semantic colour migration.
- [index.html](index.html), [player.html](player.html), [test-mode.html](test-mode.html), [research.html](research.html), [faq.html](faq.html), [docs.html](docs.html): header controls, early bootstrap and theme stylesheet.
- [src/ui/charts.js](src/ui/charts.js): palette-driven rendering and redraw without changing calculations.
- [browser-tests/theme.spec.js](browser-tests/theme.spec.js), [tests/unit/theme.test.js](tests/unit/theme.test.js): browser and deterministic regression coverage.
- [README.md](README.md), [docs/architecture.md](docs/architecture.md), this report: usage, boundaries and verified delivery.
- [visual-review/themes/](visual-review/themes/): actual Chromium screenshots of both themes, desktop/mobile pages, roulette boards and dialogs.

### Earlier redesign still outstanding against HEAD

The working tree also retains the preceding mission-led homepage, shared navigation/footer, home-page directory routing, responsive simulator board and Player Mode presentation improvements. Related changes remain in [.htaccess](.htaccess), [src/ui/roulette-board.js](src/ui/roulette-board.js), [scripts/browser-server.mjs](scripts/browser-server.mjs), [scripts/package-cpanel.sh](scripts/package-cpanel.sh), [scripts/verify-cpanel-archive.mjs](scripts/verify-cpanel-archive.mjs), [docs/player-mode.md](docs/player-mode.md), the existing page/runtime/engine tests and [browser-tests/site-redesign.spec.js](browser-tests/site-redesign.spec.js). The proposed summary below includes these outstanding changes, but not BRI/Player logic already present in HEAD.

## Actual validation

| Check | Result |
| --- | --- |
| `npm test` | 143 tests: **142 passed, 1 skipped, 0 failed** |
| `npm run test:php` | **PASS**; non-fatal Xdebug connection warning |
| `npm run test:browser` against the working tree | **31 passed** |
| Complete browser suite against extracted cPanel package | **31 passed**, including final coverage of all three chart types |
| Packaging page/module/runtime checks | **16 passed** |
| Archive verification | Passed: one `public_html` root, 74 entries, versioned assets/imports, manifest, policy, private-file exclusions and ZIP integrity |
| `git diff --check` | Passed |

Browser coverage includes all seven public pages in both themes at 320, 390 and 1440 CSS-pixel widths; existing portrait/landscape regressions also passed. It verifies no horizontal page overflow or page errors, usable mobile menus, keyboard theme control/focus, reduced motion, live OS changes, manual preference persistence, browser restart, tab synchronisation and pre-render theme application.

All 37 roulette outcomes in Simulator, Player and Test Mode retain their correct colours. Tested semantic text/action and roulette-label pairs meet **4.5:1** contrast. Player wager debit, selected result, settlement and history survive theme changes; existing correction, undo, export, table separation, persistence and isolated Worker research browser tests passed. Chart image comparisons verify theme redraws and exact reversal using test-only sample series, without inserting observations.

Screenshots were inspected for light/dark homepage and mobile process, Player Mode and wager dialogs, simulator and configuration, Test Mode, Research, FAQ and documentation. These are Chromium renders, not mock-ups.

## Package

The refreshed [bank-roll-cpanel.zip](bank-roll-cpanel.zip) is a **browser-only package, not a deployment**. It includes the early theme script and stylesheet with build-key URLs.

- Version: `1.1.0-next`
- Build: `a25582abd4222d2bd020`
- SHA-256: `1b79fb941156c6b164ca07e554bdf9b7e3bb8590b5cdd5af7276979db65f32d0`

## Outstanding limitations

- Physical devices, Safari/WebKit, Firefox and screen-reader sessions were not tested. Desktop/mobile verification uses Chromium viewport emulation; contrast checks are representative semantic pairs, not a complete accessibility certification.
- The optional MySQL integration test remains skipped without a configured disposable database/PDO MySQL. The backend is excluded from the browser package and has not been production-certified.
- Player records remain browser/device-local and are not synchronised or backed up. Existing export-without-restore and lack of user-facing table deletion remain documented limitations; this presentation task does not resolve them.
- Passing software tests does not establish physical-wheel prediction advantage, a preferred stake progression or research validity. No new live research data or performance claims were introduced.
- If localStorage is blocked, theme switching works but cannot persist; this is explicitly reported to the visitor.
- Historical next-stage reports describe their earlier checkpoints. The validation and package identifiers above supersede earlier visual-delivery figures, not their underlying research caveats.

No dependencies were downloaded, no external searches were performed, and no files were staged, committed, pushed, tagged, released or deployed.

## Suggested single-paragraph commit summary

Add a research-led Bank-Roll homepage and shared responsive navigation/footer, replace the decorative number grid with an explicitly illustrative Observe -> Predict -> Evaluate process, and introduce persistent System/Light/Dark themes with accessible header controls, central semantic palettes and immediate chart redraws; refine the simulator's portrait/landscape board and Player Mode presentation while preserving roulette mappings, BRI calculations and gameplay, update home routing and cPanel packaging, and add regression coverage, screenshots and documentation. Assisted-by: Copilot.
