import {writeFile} from "node:fs/promises";
import {compareAutonomousStrategies} from "../src/simulation/research-lab.js";

const requestedSizes = process.argv.find((argument) => argument.startsWith("--sizes="))?.slice(8);
const outputPath = process.argv.find((argument) => argument.startsWith("--output="))?.slice(9);
const sizes = requestedSizes
  ? requestedSizes.split(",").map(Number)
  : [10_000, 100_000, 1_000_000];
if (sizes.some((size) => !Number.isSafeInteger(size) || size < 1)) throw new RangeError("Benchmark sizes must be positive safe integers.");

const baseConfig = {
  bankroll: 10_000,
  unit: 1,
  stopLoss: 5_000,
  takeProfit: 5_000,
  betType: "streets",
  coldThreshold: 0,
  maxStreets: 3,
  progression: "martingale",
  maxSteps: 10,
  maxStake: 1_000,
  maxExposure: 1_000,
};
const variants = [
  {name: "original-cold-street", strategy: "cold-street"},
  {name: "bri-evidence-gated", strategy: "bri-autonomous", wageringMode: "evidence-gated"},
  {name: "bri-strategy-research", strategy: "bri-autonomous", wageringMode: "strategy-research"},
  {name: "flat-stake-baseline", strategy: "flat-baseline"},
];
const scenarios = [
  {name: "uniform-european", config: {type: "uniform"}},
  {name: "synthetic-controlled-bias", config: {type: "biased", favoredStreet: 5, favoredStreetProbability: 0.25}},
  {name: "synthetic-changing-distribution", config: {type: "changing", changeAtFraction: 0.5, favoredStreet: 5, favoredStreetProbability: 0.25}},
];
const measurements = [];
let peakHeapUsedBytes = process.memoryUsage().heapUsed;
let peakRssBytes = process.memoryUsage().rss;
const sampleMemory = () => {
  const memory = process.memoryUsage();
  peakHeapUsedBytes = Math.max(peakHeapUsedBytes, memory.heapUsed);
  peakRssBytes = Math.max(peakRssBytes, memory.rss);
};
const memorySampler = setInterval(sampleMemory, 10);

try {
  for (const spins of sizes){
    for (const entry of scenarios){
      sampleMemory();
      const memoryBefore = process.memoryUsage();
      peakHeapUsedBytes = memoryBefore.heapUsed;
      peakRssBytes = memoryBefore.rss;
      const seed = `bri-autonomous-v1:${entry.name}:${spins}`;
      const scenario = entry.config.type === "changing"
        ? {
          ...entry.config,
          changeAt: Math.floor(spins * entry.config.changeAtFraction),
        }
        : entry.config;
      const report = await compareAutonomousStrategies({
        seed,
        spins,
        scenario,
        baseConfig,
        variants,
        yieldEvery: 4096,
        onProgress: (progress) => {
          if (progress.completedSpins % 100_000 === 0 || progress.completedSpins === spins){
            process.stderr.write(`${entry.name} ${spins}: ${progress.strategy} ${progress.completedSpins}/${spins}\n`);
          }
          sampleMemory();
        },
      });
      sampleMemory();
      measurements.push({
        ...report,
        scenarioLabel: entry.name,
        memory: {
          measurement: "sampled process memory during the comparison; includes input sequence and runtime",
          sampleIntervalMs: 10,
          peakHeapUsedBytes,
          peakRssBytes,
          heapUsedAfterComparisonBytes: process.memoryUsage().heapUsed,
          rssAfterComparisonBytes: process.memoryUsage().rss,
        },
      });
    }
  }
} finally {
  clearInterval(memorySampler);
}

const result = {
  benchmarkVersion: 1,
  nodeVersion: process.version,
  platform: process.platform,
  architecture: process.arch,
  configuration: baseConfig,
  sizes,
  scenarios: scenarios.map(({name, config}) => ({name, ...config})),
  strategies: variants,
  measurements,
};
const serialized = JSON.stringify(result, null, 2);
if (outputPath) await writeFile(outputPath, `${serialized}\n`, "utf8");
process.stdout.write(`${serialized}\n`);
