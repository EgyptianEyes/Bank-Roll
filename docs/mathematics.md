# Mathematical Conventions

## Roulette

The model uses standard single-zero European roulette: outcomes are integers 0–36, with 37 equally likely outcomes for the uniform baseline. Zero belongs to no street or dozen. Street index is `floor((number - 1) / 3)` for numbers 1–36.

A street wager covers three numbers and has an 11:1 net payout (12 times the winning street stake returned gross). For a spread over multiple streets, the full stake is deducted and only the winning street returns its 12-times gross amount. Red/black returns two times the stake gross; dozens return three times gross.

For street stakes `s_i` and forecast probabilities `p_i`, expected net return is `12 × Σ(p_i × s_i) - Σs_i`. A single street breaks even at `1/12`; the European baseline `3/37` has a negative expected return. A spread's return per unit staked is the stake-weighted average probability of its covered streets, so wider coverage does not itself improve expected value.

## Money

Wager construction and settlement use integer pence. UI display converts pence to pounds only at the presentation boundary. Gross return includes the winning stake; net change is gross return less the total wager stake.

Distributed street stakes sum exactly to the proposed total; remainder pence are assigned in street order. For every possible outcome, including zero and uncovered streets, gross return is the selected street's assigned stake times twelve or zero, and net change subtracts the entire distributed stake.

## Current street estimate

The rolling-frequency predictor uses a uniform European prior with one pseudo-count per roulette number. For a selected street with `k` appearances in `n` observed outcomes, its estimate is:

`(k + 3) / (n + 37)`

The estimate includes zero in `n`, and the one-street uniform baseline is `3 / 37` (about 8.1%). This is a smoothed empirical estimate, not evidence that the next spin is physically dependent on previous spins or that the strategy has an advantage.

The integrity monitor compares the latest 100 outcomes with the preceding table history using a 13-category Pearson statistic and a screening threshold. With sparse expected category counts, the threshold is a candidate-screening heuristic, not a calibrated p-value; a candidate never proves that an entry is wrong.

Forecasts become eligible after ten observed outcomes. The predictor uses up to the latest 100 outcomes while the tracker retains longer history. Each forecast is made for the next spin; its outcome is scored separately and cannot alter the immutable forecast record.

The six candidate distributions are uniform, lifetime frequency, rolling 100, rolling 25, exponential frequency (25-observation half-life) and smoothed one-step street transitions. All use the European prior where applicable. A gap clears continuous rolling/exponential context and the preceding transition category; no transition is fabricated across missing spins. Lifetime counts and previously observed transition pairs remain. Each forecast also records its selected model's support: uniform has no learned support, rolling/lifetime models report the observations used, a transition model reports transitions from the current category, and the exponentially weighted model reports effective sample size `(sum weights)^2 / sum(weight^2)`.

Evidence-Gated compares each non-uniform model's per-outcome Brier loss with the **same stored forecast's** uniform loss. Let `d_t = Brier(p_t, y_t) - Brier(u, y_t)` and `a_tc = p_tc - u_c`. Its outcome-dependent range, known before the outcome, is `r_t = 2(max_c a_tc - min_c a_tc)`. Store `V_n = sum r_t^2` alongside `sum d_t`.

For each of 21 fixed lambdas `2^-10, ..., 2^10`, the Hoeffding conditional-moment bound and Ville's inequality give an anytime upper bound on mean conditional paired loss:

`U_n(lambda) = mean(d) + [log(5 * 21 / 0.05)/lambda + lambda * V_n/8]/n`.

The engine takes the minimum across this **fixed, predeclared grid**, with the error budget allocated across five alternatives and 21 lambdas. It does not plug a retrospectively optimized lambda into a fixed-lambda inequality. This is less wasteful than the previous constant-width bound while retaining an anytime interpretation for a fixed evidence epoch. Legacy snapshots without the range accumulator use the conservative `V_n = 16n`. Corrections begin a new evidence epoch; this is not one global 5% guarantee over arbitrary resets, tables or contributors.

Wagering requires at least the configured minimum paired evaluations (25 by default), a negative bound for the **selected** model, improvement in its most recent up-to-100 paired scores, positive *estimated* wager return, and financial sustainability. A score improvement is not a calibrated next-spin probability interval or proof of positive true expected return. No physical-wheel predictability is established by these rules.

For an active position, a forecast-based switch requires at least 25 effective observations supporting the selected model. It then screens the estimated probability improvement against `2 × sqrt(estimated variance / model effective sample size)`. This is an approximate support heuristic, **not** a calibrated confidence interval, validated 95% guarantee, or proof of a real advantage. Sparse transition histories therefore cannot authorize a forecast-based switch even if the general rolling window is large. An unaffordable continuation may still be stopped or changed as a financial safeguard, independent of forecast evidence. No rule treats a long absence as evidence that a street is due.