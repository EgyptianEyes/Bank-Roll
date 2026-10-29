import {createHash} from "node:crypto";
import {mkdir, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {compareAutonomousStrategies, scenarioCategoryProbabilities} from "../src/simulation/research-lab.js";
import {STREET_MODEL_IDS} from "../src/intelligence/forecast-models.js";

function option(name){
  return process.argv.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function parsePositiveInteger(value, label){
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new RangeError(`${label} must be a positive safe integer.`);
  return parsed;
}

const sizes = (option("sizes") || "10000,100000").split(",").map((size) => parsePositiveInteger(size, "Benchmark size"));
const replicateCount = parsePositiveInteger(option("replicates") || "20", "Replicate count");
if (replicateCount < 20) throw new RangeError("At least 20 independent replicates are required.");
const changingReplaySpins = parsePositiveInteger(option("changing-spins") || "1000000", "Changing-distribution replay size");
const generatedAt = new Date().toISOString();
const defaultOutput = `research-results/street-intelligence-${generatedAt.replaceAll(":", "-")}.json`;
const outputPath = resolve(option("output") || defaultOutput);

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

const scenarios = [
  {label: "fair-european", type: "uniform", favoredStreet: 5, favoredStreetProbability: 3 / 37},
  ...[0.085, 0.09, 0.10, 0.11, 0.25].map((favoredStreetProbability) => ({
    label: `biased-${(favoredStreetProbability * 100).toFixed(1)}pct`,
    type: "biased",
    favoredStreet: 5,
    favoredStreetProbability,
  })),
];

const comparisonVariants = [
  {name: "original-cold-street", strategy: "cold-street"},
  {name: "bri-evidence-gated", strategy: "bri-autonomous", wageringMode: "evidence-gated"},
  {name: "bri-strategy-research", strategy: "bri-autonomous", wageringMode: "strategy-research"},
  {name: "flat-stake-baseline", strategy: "flat-baseline"},
  {name: "observation-only-forecasting", strategy: "observation-only"},
];

const pathVariants = [
  {name: "path-maintain", strategy: "bri-autonomous", wageringMode: "strategy-research", actionPolicy: "maintain"},
  {name: "path-switch", strategy: "bri-autonomous", wageringMode: "strategy-research", actionPolicy: "switch"},
  {name: "path-spread", strategy: "bri-autonomous", wageringMode: "strategy-research", actionPolicy: "spread"},
  {name: "path-suspend", strategy: "bri-autonomous", wageringMode: "strategy-research", actionPolicy: "suspend"},
];

function summarize(values){
  const sorted = [...values].filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return {count: 0, mean: null, median: null, min: null, max: null, confidence95: null};
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const variance = sorted.length > 1
    ? sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (sorted.length - 1)
    : 0;
  const tCritical = sorted.length >= 20 ? 2.093 : 1.96;
  const halfWidth = tCritical * Math.sqrt(variance / sorted.length);
  const median = sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  return {
    count: sorted.length,
    mean,
    median,
    min: sorted[0],
    max: sorted.at(-1),
    confidence95: sorted.length > 1 ? [mean - halfWidth, mean + halfWidth] : null,
  };
}

function wilsonInterval(successes, count){
  if (!count) return null;
  const z = 1.96;
  const proportion = successes / count;
  const denominator = 1 + z ** 2 / count;
  const center = (proportion + z ** 2 / (2 * count)) / denominator;
  const radius = z * Math.sqrt(proportion * (1 - proportion) / count + z ** 2 / (4 * count ** 2)) / denominator;
  return [Math.max(0, center - radius), Math.min(1, center + radius)];
}

function aggregateRunGroup(runs){
  const resultsByName = new Map();
  for (const run of runs){
    for (const result of run.results){
      const entries = resultsByName.get(result.name) || [];
      entries.push(result);
      resultsByName.set(result.name, entries);
    }
  }
  return [...resultsByName].map(([name, results]) => {
    const metrics = results.map((result) => result.metrics);
    const decisionRejectionReasons = {continue: {}, switch: {}, spread: {}};
    for (const metric of metrics){
      for (const [action, reasons] of Object.entries(metric.candidateRejectionReasons || {})){
        for (const [reason, count] of Object.entries(reasons)){
          decisionRejectionReasons[action][reason] = (decisionRejectionReasons[action][reason] || 0) + count;
        }
      }
    }
    const numericMetrics = [
      "wagersPlaced",
      "firstWagerSpin",
      "firstEvidenceQualifiedSpin",
      "firstConfirmedStreetDetectionSpin",
      "forecastHitRate",
      "favoredStreetForecastRate",
      "topStreetExpectedCalibrationError",
      "netProfitLossCents",
      "finalBankrollCents",
      "maximumDrawdownCents",
      "maximumExposureCents",
      "maximumUnrecoveredLossCents",
      "processingTimeMs",
      "spinsPerSecond",
    ];
    const summary = Object.fromEntries(numericMetrics.map((key) => [
      key,
      summarize(metrics.map((metric) => metric[key])),
    ]));
    summary.modelBrier = Object.fromEntries(Object.values(STREET_MODEL_IDS).map((modelVersion) => [
      modelVersion,
      summarize(metrics.map((metric) =>
        metric.modelPerformance?.find((model) => model.modelVersion === modelVersion)?.meanBrier,
      )),
    ]));
    summary.modelSelectionFrequency = Object.fromEntries(Object.values(STREET_MODEL_IDS).map((modelVersion) => [
      modelVersion,
      summarize(metrics.map((metric) => metric.modelSelectionFrequency?.[modelVersion]?.fraction)),
    ]));
    const actionDistribution = Object.fromEntries(["continue", "switch", "spread", "stop"].map((action) => [
      action,
      summarize(metrics.map((metric) => metric.decisionDistribution?.[action] ?? null)),
    ]));
    const identificationRuns = metrics.filter((metric) =>
      metric.favoredStreetForecasts && metric.mostForecastedStreet === metric.favoredStreetForecasts.street,
    ).length;
    const evidenceConfirmedRuns = metrics.filter((metric) =>
      Number.isFinite(metric.favoredStreetForecasts?.confirmed) && metric.favoredStreetForecasts.confirmed > 0,
    ).length;
    const falsePositiveRuns = metrics.filter((metric) => metric.falsePositiveDetection === true).length;
    return {
      name,
      replicateCount: results.length,
      biasedStreetIdentificationRate: metrics.some((metric) => metric.favoredStreetForecasts)
        ? identificationRuns / results.length
        : null,
      biasedStreetIdentificationRateConfidence95: metrics.some((metric) => metric.favoredStreetForecasts)
        ? wilsonInterval(identificationRuns, results.length)
        : null,
      evidenceConfirmedDetectionRate: metrics.some((metric) => Number.isFinite(metric.favoredStreetForecasts?.confirmed))
        ? evidenceConfirmedRuns / results.length
        : null,
      evidenceConfirmedDetectionRateConfidence95: metrics.some((metric) => Number.isFinite(metric.favoredStreetForecasts?.confirmed))
        ? wilsonInterval(evidenceConfirmedRuns, results.length)
        : null,
      fairWheelFalsePositiveRate: metrics.some((metric) => metric.falsePositiveDetection !== null)
        ? falsePositiveRuns / results.length
        : null,
      fairWheelFalsePositiveRateConfidence95: metrics.some((metric) => metric.falsePositiveDetection !== null)
        ? wilsonInterval(falsePositiveRuns, results.length)
        : null,
      actionDistribution,
      summary,
      decisionRejectionReasons: Object.values(decisionRejectionReasons).some((reasons) => Object.keys(reasons).length)
        ? decisionRejectionReasons
        : null,
    };
  });
}

const allRuns = [];
for (const scenario of scenarios){
  const scenarioConfig = scenario.type === "uniform"
    ? {type: "uniform"}
    : {
      type: "biased",
      favoredStreet: scenario.favoredStreet,
      favoredStreetProbability: scenario.favoredStreetProbability,
    };
  for (const spins of sizes){
    const runsForGroup = [];
    for (let replicate = 0; replicate < replicateCount; replicate++){
      const split = replicate < Math.floor(replicateCount / 2) ? "development" : "holdout";
      const seed = `bri-street-intelligence-v1:${scenario.label}:${spins}:replicate-${String(replicate + 1).padStart(2, "0")}`;
      const includePaths = spins === Math.max(...sizes) && replicate === replicateCount - 1;
      const report = await compareAutonomousStrategies({
        seed,
        spins,
        scenario: scenarioConfig,
        baseConfig,
        variants: includePaths ? [...comparisonVariants, ...pathVariants] : comparisonVariants,
        yieldEvery: 4096,
        onProgress: (progress) => {
          const finalVariantName = includePaths ? "path-suspend" : "observation-only-forecasting";
          if (progress.completedSpins === spins && progress.strategy === finalVariantName){
            process.stderr.write(`${scenario.label} ${spins} replicate ${replicate + 1}/${replicateCount} complete\n`);
          }
        },
      });
      const run = {
        experimentId: `street-intelligence-${createHash("sha256").update(seed).digest("hex").slice(0, 16)}`,
        generatedAt,
        split,
        replicate: replicate + 1,
        scenario: {
          ...scenario,
          categoryProbabilities: scenarioCategoryProbabilities(scenarioConfig),
          redistribution: "All non-designated street and zero-category probabilities are proportionally scaled from their European roulette weights; outcomes within a street remain equiprobable.",
        },
        seed,
        spins,
        outcomeSequenceDigest: report.outcomeSequenceHash,
        modelVersions: Object.values(STREET_MODEL_IDS),
        configuration: baseConfig,
        comparisonElapsedMs: report.elapsedMs,
        results: report.results,
        completePathComparison: includePaths,
      };
      runsForGroup.push(run);
      allRuns.push(run);
    }
  }
}

let changingDistributionReplay = null;
if (!process.argv.includes("--no-changing-replay")){
  const scenario = {
    type: "changing",
    changeAt: Math.floor(changingReplaySpins / 2),
    favoredStreet: 5,
    favoredStreetProbability: 0.25,
  };
  const seed = `bri-autonomous-v1:synthetic-changing-distribution:${changingReplaySpins}`;
  let lastProgressSpin = 0;
  const report = await compareAutonomousStrategies({
    seed,
    spins: changingReplaySpins,
    scenario,
    baseConfig,
    variants: comparisonVariants,
    yieldEvery: 4096,
    onProgress: (progress) => {
      if (progress.completedSpins - lastProgressSpin >= 100_000){
        lastProgressSpin = progress.completedSpins;
        process.stderr.write(`changing-distribution replay ${progress.strategy} ${progress.completedSpins}/${changingReplaySpins}\n`);
      }
    },
  });
  changingDistributionReplay = {
    experimentId: `changing-replay-${createHash("sha256").update(seed).digest("hex").slice(0, 16)}`,
    generatedAt,
    purpose: "Same-seed replay of the prior changing-distribution benchmark under the current instrumented implementation; not a reconstruction of deleted historical per-spin state.",
    scenario: {
      ...scenario,
      categoryProbabilities: scenarioCategoryProbabilities(scenario),
      redistribution: "The designated street is assigned 25%; all other European street and zero-category weights are proportionally rescaled.",
    },
    seed,
    spins: changingReplaySpins,
    outcomeSequenceDigest: report.outcomeSequenceHash,
    modelVersions: Object.values(STREET_MODEL_IDS),
    configuration: baseConfig,
    comparisonElapsedMs: report.elapsedMs,
    results: report.results,
  };
}

const aggregate = [];
for (const scenario of scenarios){
  for (const spins of sizes){
    const runs = allRuns.filter((run) => run.scenario.label === scenario.label && run.spins === spins);
    aggregate.push({
      scenario: scenario.label,
      spins,
      split: {
        developmentRuns: runs.filter((run) => run.split === "development").length,
        holdoutRuns: runs.filter((run) => run.split === "holdout").length,
        policy: "Replicates are split before execution; model configurations were fixed before this benchmark. Each run remains prequential online evaluation.",
      },
      strategies: aggregateRunGroup(runs),
    });
  }
}

const result = {
  formatVersion: 1,
  report: "Bank-Roll Street Intelligence Benchmark",
  generatedAt,
  environment: {
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
  },
  models: Object.values(STREET_MODEL_IDS),
  configuration: baseConfig,
  replicateCount,
  sizes,
  scenarios,
  completePathPolicies: pathVariants.map(({name, actionPolicy}) => ({name, actionPolicy})),
  changingDistributionReplay,
  runs: allRuns,
  aggregate,
};
const serialized = `${JSON.stringify(result, null, 2)}\n`;
await mkdir(dirname(outputPath), {recursive: true});
await writeFile(outputPath, serialized, "utf8");
const checksum = createHash("sha256").update(serialized).digest("hex");
process.stdout.write(`Saved ${allRuns.length} experiments to ${outputPath}\n`);
process.stdout.write(`SHA-256 ${checksum}\n`);
for (const group of aggregate){
  const gated = group.strategies.find((strategy) => strategy.name === "bri-evidence-gated");
  const research = group.strategies.find((strategy) => strategy.name === "bri-strategy-research");
  process.stdout.write(`${group.scenario} ${group.spins}: gated detections=${gated?.biasedStreetIdentificationRate ?? "n/a"}, research mean P/L pence=${research?.summary.netProfitLossCents.mean ?? "n/a"}\n`);
}
