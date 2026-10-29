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

Evidence-Gated compares each competing model's per-spin Brier score with the same forecast's uniform-model score. For comparison count `n`, each of the two alternatives receives `αₙ = 0.05 / (2n(n + 1))`; the upper bound is `mean paired difference + 4 × sqrt(log(1 / αₙ) / (2n))`. Wagering requires this bound to be below zero after the configured minimum evaluations. This controls repeated evidence checks under an independent uniform wheel more conservatively than comparing sample means, but synthetic-wheel results do not establish physical-wheel predictability.

For an active position, switching additionally requires a forecast probability improvement greater than an approximate 95% standard-error margin based on the forecast window. A fresh position may still be selected when continuing violates financial sustainability. No rule treats a long absence as evidence that a street is due.