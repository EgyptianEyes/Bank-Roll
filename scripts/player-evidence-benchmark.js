import {writeFile} from "node:fs/promises";
import {compareAutonomousStrategies, generateScenarioOutcomeSequence} from "../src/simulation/research-lab.js";
import {mulberry32, xfnv1a} from "../src/core/random.js";
import {settleWager} from "../src/bankroll/accounting.js";

const output = process.argv.find((argument) => argument.startsWith("--output="))?.slice(9) || "research-results/next-stage-evidence.json";
const seedPrefix = process.argv.find((argument) => argument.startsWith("--seed-prefix="))?.slice(14) || "next-stage-fixed-v1";
const spins = 2000;
const replicates = 20;
const scenarios = [
  {type: "uniform"},
  {type: "biased", favoredStreet: 5, favoredStreetProbability: 0.25},
  {type: "changing", favoredStreet: 5, favoredStreetProbability: 0.25, changeAtFraction: 0.5},
];
const configuration = {bankroll: 10000, unit: 0.2, stopLoss: 5000, takeProfit: 5000, betType: "streets", coldThreshold: 0, maxStreets: 3, progression: "flat", maxSteps: 10, maxStake: 100, maxExposure: 100};
const variants = [
  {name: "bri-flat", strategy: "bri-autonomous", wageringMode: "evidence-gated"},
  {name: "cold-flat", strategy: "cold-street"},
  {name: "cold-linear", strategy: "cold-street", config: {progression: "linear"}},
  {name: "cold-fibonacci", strategy: "cold-street", config: {progression: "fibo"}},
  {name: "cold-martingale", strategy: "cold-street", config: {progression: "martingale"}},
  {name: "observation-only", strategy: "observation-only"},
];

function randomBaseline(outcomes, seed){
  const random = mulberry32(xfnv1a(`independent-random-streets:${seed}`));
  let bankroll = 1000000;
  let staked = 0;
  for (const outcome of outcomes){
    if (bankroll - 60 < 500000 || bankroll >= 1500000) continue;
    const streets = Array.from({length: 12}, (_, index) => index);
    for (let index = streets.length - 1; index > 0; index--){
      const other = Math.floor(random() * (index + 1));
      [streets[index], streets[other]] = [streets[other], streets[index]];
    }
    const wager = {kind: "streets", chosen: streets.slice(0, 3), perStreetStakeCents: 20, totalStakeCents: 60};
    bankroll += settleWager(wager, outcome).netChangeCents;
    staked += 60;
  }
  return {name: "random-flat", metrics: {netProfitLossCents: bankroll - 1000000, totalStakedCents: staked, observedSpins: outcomes.length}};
}

function estimate(values){
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  const halfWidth = (values.length === 20 ? 2.093 : 2.262) * Math.sqrt(variance / values.length);
  return {n: values.length, mean, confidence95: [mean - halfWidth, mean + halfWidth]};
}

const runs = [];
for (const scenario of scenarios){
  for (let replicate = 0; replicate < replicates; replicate++){
    const seed = `${seedPrefix}:${scenario.type}:${replicate}`;
    const outcomes = generateScenarioOutcomeSequence({seed, spins, scenario});
    const report = await compareAutonomousStrategies({seed, spins, outcomes, scenario, baseConfig: configuration, variants});
    report.results.push(randomBaseline(outcomes, seed));
    runs.push({scenario: scenario.type, seed, partition: replicate < 10 ? "development-label" : "validation-label", sequenceHash: report.outcomeSequenceHash, results: report.results});
  }
  console.log(`Completed ${scenario.type}: ${replicates} independent seeds x ${spins} outcomes.`);
}
const summaries = [];
for (const scenario of scenarios){
  for (const name of [...variants.map((variant) => variant.name), "random-flat"]){
    const rows = runs.filter((run) => run.scenario === scenario.type).map((run) => run.results.find((result) => result.name === name).metrics);
    summaries.push({
      scenario: scenario.type, strategy: name,
      profitCents: estimate(rows.map((row) => row.netProfitLossCents)),
      stakedCents: estimate(rows.map((row) => row.totalStakedCents)),
      validationProfitCents: estimate(rows.slice(10).map((row) => row.netProfitLossCents)),
    });
  }
}
await writeFile(output, JSON.stringify({
  schemaVersion: 1, policyVersion: "next-stage-evidence-v2", provenance: "synthetic-research-only", seedPrefix, spins, replicates, configuration,
  protocol: "Configurations fixed before execution; forecasts scored prequentially on later outcomes. Independent seed partitions are reporting labels, not a learned model-selection or blind external holdout. 95% t intervals are unadjusted across reported strategies/scenarios. No physical-wheel edge is established.",
  summaries, runs,
}, null, 2) + "\n");
console.log(`Saved ${output}`);
