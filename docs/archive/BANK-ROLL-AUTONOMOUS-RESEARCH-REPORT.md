# Bank-Roll Autonomous Research Report

**Run date:** 2026-10-28
**Scope:** BRI Autonomous financial correctness, deterministic research integration, performance, forecasting and decision evaluation.
**Result:** All requested 10,000-, 100,000- and 1,000,000-spin tiers completed against three seeded scenarios. No result demonstrates a real-world roulette advantage.

## A. Implementation summary

`compareAutonomousStrategies()` in `src/simulation/research-lab.js` now runs the production `AutonomousSessionEngine`, `BriCoordinator`, `StreetPredictionEngine`, decision engine and conventional session engine against one generated outcome array. Cold-street, BRI Evidence-Gated, BRI Strategy Research, flat-stake and observation-only variants therefore receive identical outcomes in identical order. The report retains the seed, full configuration and a sequence digest.

BRI Evidence-Gated suspends wagering whenever the evidence requirement is weak, including when losses remain outstanding; those losses remain recorded. Strategy Research may place constrained experimental wagers despite weak evidence, but its result explicitly discloses that this is not evidence of an advantage. Both paths retain independent bankroll, stop-loss, stake, exposure and progression checks.

STOP suspends betting, not observation. BRI continues forecasting and scoring subsequent outcomes. Result fields distinguish `wageringStatus`, `sessionTerminationReason` and `experimentEndReason`. The asynchronous autonomous comparison yields periodically; `src/workers/research-worker.js` accepts `run-autonomous` and cancellation messages.

Batch runs retain bounded aggregate evidence rather than per-spin decision snapshots. The seed, scenario, configuration, digest, aggregate decision/model metrics and production code make decisions replayable; the harness does not silently present aggregates as a retained audit log.

## B. Financial verification

### Independent reference calculations

All amounts below are integer cents, calculated independently of the production decision code.

| Case | Expected result | Verified result |
|---|---|---|
| 100-cent stake spread across four streets | 25 cents/street; total 100; hit gross 300; hit net +200; zero loses 100 | Matches decision candidate and settlement |
| Same Martingale spread, after the first losing spread | Total exposure for 1/3/5/10 consecutive losses: 100/2,500/12,100/408,900; next 4-street wager: 800 | Matches projections |
| 100-cent spread across three streets | Allocation 34/33/33; total remains 100; winning gross returns 408/396/396 by street; corresponding net +308/+296/+296; zero net -100 | Matches candidate and accounting settlement |
| Partial recovery | Existing 1,000-cent loss; 400-cent 4-street wager returns 1,200; only 800 cents of net profit is credited; 200 cents remain unrecovered | Matches coordinator |
| SWITCH | New position begins at progression step 1; old sequence losses remain in full and are included in settlement/recovery | Matches coordinator lifecycle test |
| STOP | No wager is placed; observations continue; bankroll and outstanding losses are unchanged | Matches coordinator and research tests |

SPREAD previously rounded each street down independently, which could silently reduce total stake when the amount was not divisible by the number of streets. It now allocates remainder cents explicitly and uses that same per-street allocation for table limits, expected return, settlement, recovery, projected exposure and chip labels. The roulette-board layout and geometry were not changed.

Other tested protections include safe-integer money bounds, insufficient bankroll, max stake, max exposure, stop-loss floors, take-profit/session termination, progression depth, zero outcomes, multiple covered streets and recovery after wins. Drawdown now measures settled bankrolls rather than the temporary debit before an outcome.

The ten-loss exposure field is a hypothetical progression schedule, not permission to place those future wagers. The selected candidate's `sustainableLosses` and independent approval guards constrain what may actually be placed. Forecasting/candidate projections do not override those limits.

## C. Benchmark methodology

### Reproduction configuration

The committed runner is `scripts/autonomous-benchmark.js`; it uses no new dependencies. Defaults are 10,000, 100,000 and 1,000,000 spins. Each experiment compares:

1. Original cold-street strategy.
2. BRI Autonomous, Evidence-Gated.
3. BRI Autonomous, Strategy Research.
4. Flat-stake baseline.

The common configuration is bankroll £10,000, £1 unit, £5,000 stop-loss and take-profit, European street wagers, three selected streets, Martingale progression, maximum depth 10, and £1,000 maximum stake and exposure. Strategy settings are identical apart from the declared wagering intention and the flat-baseline progression.

Scenarios are explicitly synthetic except the independent-uniform European wheel:

- `uniform-european`: 37 outcomes with equal probability.
- `synthetic-controlled-bias`: street index 5 (numbers 16–18) receives probability 0.25; the remaining category probabilities are proportionally rescaled from the European baseline.
- `synthetic-changing-distribution`: uniform for the first half, followed by the same controlled bias for the second half.

The exact seed is `bri-autonomous-v1:<scenario-label>:<spin-count>`. The outcome sequence digest is FNV-1a 32-bit over the generated outcome categories. It is a reproducibility check, not a cryptographic integrity claim. The generator runs once per experiment and all compared strategies share its resulting array.

All runs observed the complete configured horizon, including outcomes after a strategy stopped wagering or its financial session terminated. For each strategy, observation-only spins equal configured spins minus wagers placed. BRI's first 10 observations are the forecast warm-up; the remaining `spins - 10` forecasts were issued before, and scored after, their corresponding outcomes.

Timing is Node `performance.now()` per strategy; comparison timing excludes sequence generation. Throughput is observed spins / strategy duration. Memory is process heap and RSS sampled every 10 ms during the comparison, includes the sequence and runtime, and may miss shorter peaks. It is not a per-strategy isolated-memory measurement.

Environment: Node v24.21.0, Linux x64; PHP 8.4.15. Profiling used Node's CPU profiler on a separate 10,000-spin BRI Strategy Research run.

### Seeds, sequence digests and sampled peak memory

| Scenario | Spins | Seed suffix | Digest | Comparison elapsed | Peak heap / RSS |
|---|---:|---|---|---:|---:|
| Uniform | 10,000 | `uniform-european:10000` | `60d83903` | 0.68 s | 8.8 / 70.6 MB |
| Uniform | 100,000 | `uniform-european:100000` | `b12566dc` | 3.73 s | 17.2 / 87.9 MB |
| Uniform | 1,000,000 | `uniform-european:1000000` | `def898e7` | 33.31 s | 32.1 / 114.3 MB |
| Controlled bias | 10,000 | `synthetic-controlled-bias:10000` | `7473c825` | 0.22 s | 9.2 / 75.0 MB |
| Controlled bias | 100,000 | `synthetic-controlled-bias:100000` | `5267e075` | 1.50 s | 17.0 / 93.1 MB |
| Controlled bias | 1,000,000 | `synthetic-controlled-bias:1000000` | `9332abee` | 14.50 s | 56.6 / 152.6 MB |
| Changing | 10,000 | `synthetic-changing-distribution:10000` | `f452a1b1` | 0.35 s | 12.0 / 78.8 MB |
| Changing | 100,000 | `synthetic-changing-distribution:100000` | `1a2c1ec0` | 2.70 s | 19.0 / 89.6 MB |
| Changing | 1,000,000 | `synthetic-changing-distribution:1000000` | `64fe4ce9` | 31.96 s | 65.2 / 160.6 MB |

## D. Benchmark results

Money columns are pounds. `Bets (W/L)` is wager count followed by winning/losing wagers. All experiments observed the full row's spin count. `Gross` is total returned, `Final` is ending bankroll, `DD` is maximum settled-bankroll drawdown, `Max wager` is the largest single wager, and `Open loss` is peak unrecovered BRI sequence loss. `10-loss` is the hypothetical ten-loss schedule described above. `—` means not applicable or no projection was produced.

### Conventional strategies

| Scenario | Spins | Strategy | Bets (W/L) | Staked / gross | Final / net | DD / max wager | Duration |
|---|---:|---|---:|---:|---:|---:|---:|
| Uniform | 10,000 | Cold-street | 62 (15/47) | 3,126 / 3,276 | 10,150 / +150 | 1,533 / 768 | 0.01 s |
| Uniform | 10,000 | Flat | 63 (15/48) | 189 / 180 | 9,991 / -9 | 30 / 3 | <0.01 s |
| Uniform | 100,000 | Cold-street | 36 (10/26) | 2,103 / 1,200 | 9,097 / -903 | 1,533 / 768 | 0.01 s |
| Uniform | 100,000 | Flat | 185 (49/136) | 555 / 588 | 10,033 / +33 | 51 / 3 | <0.01 s |
| Uniform | 1,000,000 | Cold-street | 15 (1/14) | 1,722 / 384 | 8,662 / -1,338 | 1,533 / 768 | 0.02 s |
| Uniform | 1,000,000 | Flat | 16 (1/15) | 48 / 12 | 9,964 / -36 | 36 / 3 | 0.03 s |
| Controlled bias | 10,000 | Cold-street | 26 (6/20) | 1,797 / 564 | 8,767 / -1,233 | 1,533 / 768 | <0.01 s |
| Controlled bias | 10,000 | Flat | 27 (6/21) | 81 / 72 | 9,991 / -9 | 30 / 3 | <0.01 s |
| Controlled bias | 100,000 | Cold-street | 28 (3/25) | 3,084 / 3,120 | 10,036 / +36 | 1,533 / 768 | <0.01 s |
| Controlled bias | 100,000 | Flat | 29 (3/26) | 87 / 36 | 9,949 / -51 | 54 / 3 | <0.01 s |
| Controlled bias | 1,000,000 | Cold-street | 54 (13/41) | 2,934 / 2,880 | 9,946 / -54 | 1,533 / 768 | <0.01 s |
| Controlled bias | 1,000,000 | Flat | 88 (21/67) | 264 / 252 | 9,988 / -12 | 42 / 3 | <0.01 s |
| Changing | 10,000 | Cold-street | 23 (5/18) | 1,698 / 360 | 8,662 / -1,338 | 1,533 / 768 | <0.01 s |
| Changing | 10,000 | Flat | 44 (11/33) | 132 / 132 | 10,000 / 0 | 30 / 3 | <0.01 s |
| Changing | 100,000 | Cold-street | 111 (30/81) | 5,202 / 10,584 | 15,382 / +5,382 | 765 / 768 | 0.01 s |
| Changing | 100,000 | Flat | 205 (54/151) | 615 / 648 | 10,033 / +33 | 39 / 3 | <0.01 s |
| Changing | 1,000,000 | Cold-street | 44 (11/33) | 2,310 / 1,620 | 9,310 / -690 | 1,533 / 768 | <0.01 s |
| Changing | 1,000,000 | Flat | 45 (11/34) | 135 / 132 | 9,997 / -3 | 33 / 3 | <0.01 s |

### BRI Autonomous

The observation-only count is `spins - bets`. All BRI runs issued and evaluated every available forecast; all had 10 warm-up spins. Stop-loss events were zero in these runs; sessions that reached the configured take-profit are identified by their session termination reason. A session can also suspend wagering and continue observing without session termination.

| Scenario | Spins | Mode | Bets (W/L) | Staked / gross | Final / net | DD | Max wager / open loss / 10-loss | Duration / spins/s |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| Uniform | 10,000 | Evidence-Gated | 27 (2/25) | 896 / 20.04 | 9,124.04 / -875.96 | 875.96 | 192 / 875.96 / 3,069 | 0.43 s / 23,152 |
| Uniform | 10,000 | Strategy Research | 70 (12/58) | 540 / 438 | 9,898 / -102 | 252 | 128 / 252 / 4,092 | 0.22 s / 44,775 |
| Uniform | 100,000 | Evidence-Gated | 0 (0/0) | 0 / 0 | 10,000 / 0 | 0 | 0 / 0 / — | 1.68 s / 59,359 |
| Uniform | 100,000 | Strategy Research | 99,990 (8,249/91,741) | 99,990 / 98,988 | 8,998 / -1,002 | 1,613 | 1 / 1,613 / 1,023 | 2.03 s / 49,380 |
| Uniform | 1,000,000 | Evidence-Gated | 4 (1/3) | 39 / 96 | 10,057 / +57 | 7 | 32 / 7 / 1,023 | 15.84 s / 63,124 |
| Uniform | 1,000,000 | Strategy Research | 128,159 (10,264/117,895) | 128,162 / 123,168 | 5,006 / -4,994 | 4,994 | 2 / 4,994 / 2,046 | 17.39 s / 57,520 |
| Controlled bias | 10,000 | Evidence-Gated | 305 (95/210) | 4,678 / 10,260 | 15,582 / +5,582 | 693 | 192 / 693 / 3,069 | 0.12 s / 84,136 |
| Controlled bias | 10,000 | Strategy Research | 330 (99/231) | 4,703 / 10,308 | 15,605 / +5,605 | 693 | 192 / 693 / 3,069 | 0.09 s / 105,517 |
| Controlled bias | 100,000 | Evidence-Gated | 224 (50/174) | 3,777 / 9,824.04 | 16,047.04 / +6,047.04 | 513 | 192 / 513 / 3,069 | 0.81 s / 123,268 |
| Controlled bias | 100,000 | Strategy Research | 249 (51/198) | 3,802 / 9,836.04 | 16,034.04 / +6,034.04 | 513 | 192 / 513 / 3,069 | 0.68 s / 146,159 |
| Controlled bias | 1,000,000 | Evidence-Gated | 188 (41/147) | 2,487 / 7,488 | 15,001 / +5,001 | 450 | 128 / 450 / 1,023 | 7.41 s / 134,959 |
| Controlled bias | 1,000,000 | Strategy Research | 220 (44/176) | 2,545 / 7,704 | 15,159 / +5,159 | 450 | 128 / 450 / 1,023 | 7.08 s / 141,182 |
| Changing | 10,000 | Evidence-Gated | 403 (155/248) | 5,723 / 10,761.96 | 15,038.96 / +5,038.96 | 526 | 192 / 526 / 4,092 | 0.16 s / 63,846 |
| Changing | 10,000 | Strategy Research | 6,536 (644/5,892) | 12,434 / 17,481.96 | 15,047.96 / +5,047.96 | 629 | 192 / 629 / 4,092 | 0.19 s / 53,243 |
| Changing | 100,000 | Evidence-Gated | 467 (181/286) | 6,488 / 11,604 | 15,116 / +5,116 | 567 | 192 / 567 / 4,092 | 1.20 s / 83,105 |
| Changing | 100,000 | Strategy Research | 58,500 (4,800/53,700) | 67,314 / 73,332 | 16,018 / +6,018 | 3,034 | 192 / 3,034 / 4,092 | 1.49 s / 67,137 |
| Changing | 1,000,000 | Evidence-Gated | 322 (84/238) | 4,944 / 9,992.04 | 15,048.04 / +5,048.04 | 814.96 | 192 / 814.96 / 4,092 | 13.80 s / 72,467 |
| Changing | 1,000,000 | Strategy Research | 190,765 (15,481/175,284) | 190,766 / 185,772 | 5,006 / -4,994 | 5,040 | 2 / 5,040 / 1,023 | 18.15 s / 55,090 |

Take-profit thresholds are checked after settlement; a final permitted wager can overshoot the threshold. In particular, single-run gains near £5,000 are not evidence of sustained profitability. All conventional and BRI outcomes are single seeded runs, not averages.

## E. Predictive evaluation

Each BRI intention produced the same forecast sequence for a given input, because wagering policy does not alter observation or prediction. Hit rate is the selected model's top-street hit rate. Brier is the 13-category proper score including zero; lower is better. ECE is the ten-bin expected calibration error for top-street confidence. Selection values are counts in Uniform / Rolling / Exponential order.

| Scenario | Spins | Forecasts | Hit rate | ECE | Uniform Brier | Rolling Brier | Exponential Brier | Model selections U/R/E |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| Uniform | 10,000 | 9,990 | 0.08188 | 0.00098 | 0.92047 | 0.92499 | 0.92330 | 9,963 / 0 / 27 |
| Uniform | 100,000 | 99,990 | 0.08079 | 0.00029 | 0.92039 | 0.92531 | 0.92361 | 99,990 / 0 / 0 |
| Uniform | 1,000,000 | 999,990 | 0.08093 | 0.00015 | 0.92039 | 0.92529 | 0.92355 | 999,986 / 0 / 4 |
| Controlled bias | 10,000 | 9,990 | 0.24484 | 0.04403 | 0.91993 | 0.89740 | 0.90099 | 25 / 9,963 / 2 |
| Controlled bias | 100,000 | 99,990 | 0.24721 | 0.04482 | 0.91984 | 0.89684 | 0.90050 | 25 / 99,960 / 5 |
| Controlled bias | 1,000,000 | 999,990 | 0.24934 | 0.04534 | 0.91985 | 0.89597 | 0.89981 | 25 / 999,964 / 1 |
| Changing | 10,000 | 9,990 | 0.14795 | 0.02629 | 0.91995 | 0.90955 | 0.91100 | 6,068 / 2,999 / 923 |
| Changing | 100,000 | 99,990 | 0.14953 | 0.02592 | 0.92009 | 0.91066 | 0.91173 | 57,886 / 29,870 / 12,234 |
| Changing | 1,000,000 | 999,990 | 0.15053 | 0.02555 | 0.92011 | 0.91066 | 0.91169 | 579,473 / 266,771 / 153,746 |

**Interpretation.** On each fair sequence, top-street hit rate remains near the European baseline `3/37 ≈ 0.08108`; the uniform model has the best aggregate Brier score and is selected almost exclusively. This is the intended evidence-gated outcome: at 100,000 spins it made no wagers and preserved the bankroll. The fair sequence does not support a predictive advantage.

On the controlled bias, the rolling model's Brier score improves over the uniform baseline and top-street hit rate approaches the generated 0.25 street probability. This confirms that the current fixed model family can track this explicit synthetic bias. It does not show detection of a physical wheel anomaly or a real-world edge. Calibration error around 0.045 also shows that better ranking/proper score does not imply well-calibrated top-street probabilities.

For the changing 1,000,000-spin case, the first fully post-change 100,000-spin forecast window recorded hit rate 0.2449 and selected-model Brier 0.90034 versus uniform 0.91984; the following window was 0.2512 and 0.89650 versus 0.91986. The first 100,000-spin window after the shift was mixed and improved more modestly (0.1034 hit rate, Brier 0.91571 versus 0.91981). This is evidence of response in the synthetic stream, but the selector continues to choose the uniform model frequently over the whole changing run. There is no explicit change-point reset, independent holdout, statistical significance test or multiple-seed estimate.

## F. Decision-quality analysis

The runner records the action distribution and an immediate, same-outcome counterfactual for each forecasted decision. It settles every feasible and sustainable alternative on the actual outcome, including STOP at zero. Evidence-Gated excludes wagers when the evidence gate is weak. `Worse / delta` below counts decisions where the chosen action's realized one-spin net was below the best allowed alternative after the outcome was known; delta is selected net minus that hindsight best net. This is intentionally ex-post, not a causal or multi-spin strategy comparison.

| Scenario | Spins | Mode | CONTINUE / SWITCH / SPREAD / STOP | Worse / compared | Delta |
|---|---:|---|---:|---:|---:|
| Uniform | 10,000 | Evidence-Gated | 21 / 5 / 1 / 9,963 | 26 / 9,990 | -1,044.80 |
| Uniform | 10,000 | Strategy Research | 32 / 35 / 3 / 9,920 | 60 / 9,990 | -593.68 |
| Uniform | 100,000 | Evidence-Gated | 0 / 0 / 0 / 99,990 | 0 / 99,990 | 0 |
| Uniform | 100,000 | Strategy Research | 8,249 / 91,741 / 0 / 0 | 91,741 / 99,990 | -3,077.40 |
| Uniform | 1,000,000 | Evidence-Gated | 2 / 1 / 1 / 999,986 | 3 / 999,990 | -7 |
| Uniform | 1,000,000 | Strategy Research | 10,265 / 117,893 / 1 / 871,831 | 117,895 / 999,990 | -3,980.98 |
| Controlled bias | 10,000 | Evidence-Gated | 290 / 14 / 1 / 25 | 210 / 9,990 | -3,781.48 |
| Controlled bias | 10,000 | Strategy Research | 294 / 35 / 1 / 0 | 231 / 9,990 | -3,808.40 |
| Controlled bias | 100,000 | Evidence-Gated | 208 / 15 / 1 / 25 | 174 / 99,990 | -3,334.28 |
| Controlled bias | 100,000 | Strategy Research | 209 / 39 / 1 / 0 | 198 / 99,990 | -3,374.12 |
| Controlled bias | 1,000,000 | Evidence-Gated | 177 / 11 / 0 / 25 | 147 / 999,990 | -2,619.08 |
| Controlled bias | 1,000,000 | Strategy Research | 184 / 36 / 0 / 0 | 176 / 999,990 | -2,687 |
| Changing | 10,000 | Evidence-Gated | 387 / 9 / 7 / 6,081 | 249 / 9,990 | -3,935.72 |
| Changing | 10,000 | Strategy Research | 907 / 5,622 / 7 / 13 | 5,893 / 9,990 | -22,669.36 |
| Changing | 100,000 | Evidence-Gated | 454 / 8 / 5 / 57,886 | 286 / 99,990 | -4,698.44 |
| Changing | 100,000 | Strategy Research | 5,165 / 53,328 / 7 / 0 | 53,700 / 99,990 | -1,823.61 |
| Changing | 1,000,000 | Evidence-Gated | 299 / 19 / 4 / 579,473 | 239 / 999,990 | -5,203.24 |
| Changing | 1,000,000 | Strategy Research | 15,482 / 175,283 / 0 / 809,225 | 175,284 / 999,990 | -5,926.35 |

The immediate counterfactual intentionally exposes cases where BRI's selected action loses while another currently sustainable candidate or STOP would have done better on that already-known outcome. Its hindsight comparison must not be used to tune decisions and then claim independent predictive validation. It does show no universal one-step decision superiority.

SWITCH was frequent in Strategy Research (91,741 times in the 100,000-spin fair run and 175,283 times in the million-spin changing run), but the experiment does not establish that switching improves a full future financial path. SPREAD was rare (0–7 decisions in the completed runs), so the benchmark cannot establish that it reduces exposure or improves outcomes; only the settlement/projection arithmetic is verified. STOP protects the evidence-gated fair 100,000-spin run from speculative wagering and research-mode runs suspend when financial sustainability is exhausted, but no causal STOP-versus-continue simulation was performed.

## G. Performance findings

The previous development report's component microbenchmarks are not full autonomous-system throughput measurements. In the baseline profile for this task, structured cloning retained decision snapshots dominated the sampled work; that per-spin history clone was removed. Research mode now disables per-spin decision and prediction-history retention while preserving exact deterministic replay inputs and aggregate model/decision evidence.

The finalized CPU profile of a 10,000-spin BRI run sampled about 610 ms. Leading sampled work was garbage collection (~98 ms), `stakeForStep` (~37 ms), `decideNextAction` (~34 ms), coordinator `beforeSpin` (~33 ms), prediction scoring/building and candidate evaluation (~30 ms each). `structuredClone` was no longer a leading hotspot. The production engine completed the full million-spin comparisons: the slowest BRI variants processed approximately 55,000–63,000 spins/s on this Node host; sampled maximum memory across the matrix was about 65.2 MB heap and 160.6 MB RSS.

The system has no evidence of an unbounded retained decision log in batch mode. The shared input sequence is retained for the experiment, prediction state retains bounded rolling history, and output retains aggregate metrics. Web Worker cancellation/yield semantics are covered at the research-engine level; actual browser Worker execution and browser memory were not measured.

## H. Automated checks

- `npm test`: **62 passed, 0 failed, 1 skipped**. The skip is the MySQL/MariaDB integration test; this environment has no configured test database and PHP lacks `pdo_mysql`.
- `npm run test:php`: **passed**.
- `php -l` across `server/` and `tests/php/`: **all files passed**.
- `git diff --check`: **passed**.
- The database integration test was not repeated here; its skip is not a new verification of the database or decision-history migration. Earlier development-report claims are historical and remain subject to the environment limitation above.

The suite includes shared-sequence/seed reproducibility, warm-up and forecast-before-outcome ordering, evidence STOP without wager, continued observations, strategy-research disclosure, cancellation, action distributions, model comparisons, distributed-cent SPREAD settlement, SWITCH loss retention, partial recovery, exposure horizons and bankroll limits. The original board geometry regression remains passing.

## I. Limitations and remaining work

1. These are one deterministic seed per scenario/size, not repeated independent trials. No confidence intervals, statistical power analysis or multiple-wheel runs were computed.
2. Bias and change cases are synthetic only. Neither proves real roulette predictability.
3. The model family remains fixed (uniform, rolling-frequency, exponential-frequency). There is no discovery/holdout split, multiple-testing correction, explicit change-point detector or persistent hypothesis evaluation protocol.
4. Prequential predictions are scored strictly after each forecast, but past outcomes both train/update the online model and determine later model selection. Reported overall model performance is not an independent final holdout.
5. Same-spin hindsight counterfactuals identify bad realized choices but do not simulate alternative strategies' future progression, bankroll or learning trajectories.
6. Strategy Research can lose close to its configured stop-loss before suspending; a single settlement may cross a take-profit threshold by the amount of the last permitted wager. Neither mode claims a profitable opportunity from a single result.
7. MariaDB integration and in-browser Web Worker execution require verification in their respective environments before those paths can be called verified for this phase.

Before expanding persistent intelligence, the next research work should test multiple independent seeds, independently held-out model evaluation, model-selection false-positive rates, explicit distribution-shift detection and multi-spin counterfactual strategy simulations.

## J. Reproduction

From the repository root:

```sh
npm run benchmark:autonomous -- --sizes=10000,100000,1000000 --output=/tmp/bri-benchmark.json
npm test
npm run test:php
```

The benchmark runner prints the full JSON report and optionally writes the same report to the supplied output path. Seeds are deterministic from the documented naming rule. It installs no packages and does not change application state beyond the selected JSON output file.
