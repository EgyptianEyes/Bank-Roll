# Bank-Roll Randomness Integrity Report

**Audit date:** 2026-10-29
**Phase completed:** Phase 1, Randomness Audit
**Scope:** Existing local working tree only. No external websites or roulette systems were accessed.
**Production status:** No changes deployed to `bank-roll.uk`.

## Executive Summary

The live simulator and reproducible research laboratory use the seeded Mulberry32 pseudorandom generator in `src/core/random.js`. The seed text is reduced to a 32-bit value by FNV-1a; the generator then evolves a 32-bit state. `src/core/roulette.js` maps each returned fraction to an outcome with `Math.floor(draw * 37)`. This path is deterministic, stateful, reproducible, and not cryptographically secure.

The generator contains no outcome-history input, transition logic, repeat suppression, frequency balancing, or anti-streak behavior. The physical European wheel order is used for display positioning, not for sampling outcomes. Record IDs made with `crypto.randomUUID()` are not used to generate spins.

The mapping test found a finite-grid remainder: $2^{32} = 37 \times 116{,}080{,}197 + 7$. If each possible 32-bit word were equally likely, outcomes 0 through 6 would each have one additional representable draw value compared with outcomes 7 through 36. The absolute probability difference per affected outcome is $1/2^{32}$, approximately $2.3283 \times 10^{-10}$. This is a tiny mapping bias, not evidence of sequential predictability or exploitable behavior. No generator behavior was changed; compatibility and seeded reproducibility were preserved.

This phase did not implement independence, lag, transition, streak, periodicity, or conditional-prediction tests. No result in this report claims that any physical or commercial roulette system is defective or predictable.

## Randomness Concepts

- **Ideal independent randomness:** Each result follows the specified distribution, and past results do not alter the conditional distribution of the next result.
- **Pseudorandomness:** A deterministic algorithm produces a sequence from internal state. Determinism by itself does not establish practical predictability from observed outputs.
- **Cryptographically secure pseudorandomness:** A generator designed to resist practical prediction under a defined adversary model. Mulberry32 is not claimed to have this property.
- **Uniformity:** Marginal outcome frequencies approach their theoretical probabilities over repeated trials.
- **Independence:** The conditional distribution of future outcomes is not improved by past outcomes.
- **Predictability:** A model using only information available before an outcome demonstrates better forward forecasts on suitable independent validation data.

Uniformity and independence are different hypotheses. Frequency balance cannot establish independence, and a sequence can contain ordinary streaks while remaining independent.

## Existing Generator Audit

### Seed and state

`xfnv1a(value)` starts from the 32-bit FNV offset basis, processes each JavaScript UTF-16 code unit, multiplies by the FNV prime with 32-bit arithmetic, and returns a value in the range 0 through $2^{32}-1$. This hash is a compact seed reducer, not a cryptographic hash. Distinct seed strings can collide because the resulting seed contains only 32 bits.

`mulberry32(seed, onStateChange)` retains a 32-bit integer state. Each call adds the constant `0x6D2B79F5`, applies integer mixing operations, and returns an unsigned 32-bit value divided by $2^{32}$. The callback receives the updated state on every call. Capturing that state after one draw and passing it to a new generator reproduces the next draw, which supports the existing pause/resume behavior.

### Outcome generation and mapping

The live simulation initializes its random state with `xfnv1a(configuredSeed)`. `generateOutcomeSequence()` and the seeded scenario generator use the same hash and Mulberry32 path. A roulette result is `floor(random() * 37)`, yielding integers 0 through 36. For an ideal uniform source of 32-bit words, the mapping remainder described above gives the first seven bins one extra word. The test suite checks every bucket midpoint and the lower/upper endpoints of the unit interval.

The European physical-wheel ordering (`WHEEL_ORDER`) is not part of this sampling step. It controls where a sampled number is drawn on the visual wheel. The mapping assumes independent uniformly distributed generator outputs; this code inspection does not prove that the generator's outputs meet that assumption over all sequence lengths or lags.

### History and security properties

The PRNG has internal state but does not inspect the previous roulette outcomes. There is no history-dependent balancing or anti-streak code in the audited generation path. This observation is limited to the inspected local implementation. It does not characterize other applications, physical wheels, online RNGs, or external operator systems.

The simulator is a deterministic research and demonstration environment. Its user-configurable seed is not secret, and the generator is not suitable for security-sensitive randomness. Research record UUID creation uses the browser's `crypto.randomUUID()` where available, but this identifier path is separate from spin generation and is not an independent control-sequence facility.

## Existing Research Capabilities

| Capability | Status | Evidence and limitation |
| --- | --- | --- |
| Deterministic seeded sequence | Implemented and tested | `generateOutcomeSequence()` uses FNV-1a plus Mulberry32; repeatability and legacy parity are tested. |
| Pause/resume generator state | Implemented and tested | Live/autonomous snapshots retain the generator state; regression test verifies the next resolved outcome after restore. |
| European 0–36 outcome mapping | Implemented and tested | All 37 mapping intervals have a new regression; zero remains outside the twelve streets. |
| Marginal street-frequency tracking | Implemented | Incremental tracker stores lifetime street counts and bounded rolling outcome history. |
| Uniform and synthetic independent-bias experiments | Implemented | `research-lab.js` provides uniform, biased and changing distributions with deterministic seeds. |
| Sequence-dependence statistics | Not implemented | No lagged transition tests, conditional models, repeat-rate tests, streak null comparisons, or periodicity controls are present. |
| Cryptographically random control sequence | Not implemented | `crypto.getRandomValues()` is not used for outcomes; no secure-source control dataset has been added. |
| Blind predictability challenge | Not implemented | Existing False Entry Challenge concerns entry integrity, not independence or predictability classification. |
| Independent validation of sequence relationships | Not implemented | Existing model evaluation is forward-scored for current frequency models; no dependence-model holdout protocol exists. |
| Payout-aware conditional edge | Not implemented | No sequential model produces independently validated conditional street probabilities for wager evaluation. |

## Mapping Calculation

The generator returns a value from a 32-bit output grid, divided by $2^{32}$. Since

$$
2^{32} = 37 \cdot 116{,}080{,}197 + 7,
$$

the 37 outcome intervals cannot have identical counts of 32-bit grid points. The first seven outcomes receive 116,080,198 grid points; the remaining 30 outcomes receive 116,080,197. Under a hypothetical uniform word source, the affected outcomes' absolute probability excess is $1/2^{32}$. Their relative excess over the smaller bins is about $8.61 \times 10^{-9}$.

The bound above describes the integer mapping under a uniform 32-bit word source. It is not a statistical guarantee about Mulberry32 sequence independence, and it does not demonstrate a measurable or actionable bias in practical simulation runs. Replacing the mapping with rejection sampling could remove this finite-grid remainder for a uniform word source, but it would alter seeded sequences and legacy results. No change is warranted in this audit phase; the residual is documented and directly tested at the bucket boundaries.

## Verification

- Added a test for all 37 mapping bucket midpoints and the unit-interval endpoints.
- Added a test that resumes Mulberry32 from its reported state and reproduces the uninterrupted next draw.
- Existing seeded session repeatability and legacy-vs-modular parity tests pass.
- Existing autonomous snapshot resume test verifies that the next random outcome is preserved after restore.
- Focused validation: `node --test tests/unit/engine.test.js tests/regression/legacy-baseline.test.js tests/unit/autonomous-session.test.js` passed, 32 tests.
- No changes were made to `src/core/random.js` or `src/core/roulette.js`.
- No independence experiment, generator-quality battery, external-data validation, cryptographic-control comparison, or million-spin sequence-dependence benchmark was run.

The full test suite is rerun after report/documentation edits; its final count is recorded in the development and living-website reports.

## Conclusions

The implemented generator is a deterministic simulation PRNG with a compact non-cryptographic seed reduction and 32-bit internal state. The sampling path has no visible dependence on prior outcomes and no balancing logic. The 37-bin mapping has the minute finite-grid remainder quantified above. These facts do not establish that a finite Mulberry32 output sequence is independent, nor that it is predictably exploitable from roulette outcomes.

Current BRI work primarily examines marginal frequencies and forward model scores. It does not yet test serial independence. Therefore BRI must not claim that it has investigated or ruled out lagged dependencies, repeat suppression, periodicity, or other sequential behavior.

## Next Phases

1. Add incremental, dataset-scoped sufficient statistics for number/street/category transitions, selected lags and streaks, with reference calculations and zero handling.
2. Add deterministic known-mechanism generators for repeat suppression, Markov dependence, frequency balancing, periodic behavior and changing dependence. Keep the mechanism hidden from the forecasting model.
3. Design a blind challenge and reserve independent seeds for final validation. Report false positives, false negatives, intervals, identification rate and detection latency.
4. Add chronological conditional forecasting and compare it with uniform and existing frequency models using proper scores and calibration.
5. Treat frequency departure, sequential predictability and positive expected value as separate hypotheses. Evaluate the latter with uncertainty, payout structure and existing bankroll approvals only after forward validation.
6. Connect significant validated research events to the living website through the existing safe content path; do not generate a public claim from an unvalidated candidate.

No new module was added for sequence analysis in Phase 1. No commit, push, deployment, external search, or third-party interaction was performed.
