export function createResearchSnapshot(engine, {
  datasetId,
  dataOrigin = "synthetic",
  sourceType = dataOrigin === "synthetic" ? "simulation" : "observed",
  outcome,
  evaluation = null,
  integrity = null,
  strategy = null,
  updatedAt = new Date().toISOString(),
} = {}){
  if (!engine?.tracker || typeof datasetId !== "string" || !datasetId){
    throw new TypeError("A prediction engine and dataset identity are required.");
  }
  const observationCount = engine.observationCount;
  const recentOutcomes = [...engine.tracker.history];
  const recentNumberCounts = new Array(37).fill(0);
  for (const number of recentOutcomes) recentNumberCounts[number]++;

  const forecast = evaluation?.forecast || null;
  const selectedModel = forecast?.candidateModels?.find((model) => model.modelVersion === forecast.modelVersion);
  const selectedProbabilities = selectedModel ? [...selectedModel.probabilities] : null;
  const performance = engine.modelPerformance.map((model) => ({...model}));
  const bestAlternative = performance
    .filter((model) => model.modelVersion !== "uniform-v1" && Number.isFinite(model.pairedBrierDeltaToUniform))
    .sort((left, right) => left.pairedBrierDeltaToUniform - right.pairedBrierDeltaToUniform)[0] || null;
  const strategyAction = strategy?.decision?.action || strategy?.decisionAction || strategy?.action || null;
  const strategyReasons = strategy?.decision?.reasons || strategy?.reasons || [];

  return Object.freeze({
    datasetId,
    dataOrigin,
    sourceType,
    observationCount,
    outcome,
    updatedAt,
    maturity: Math.min(observationCount, 100),
    expectedFairStreetAppearances: observationCount * 3 / 37,
    streets: engine.tracker.statistics().map((street) => ({...street})),
    recentNumberCounts,
    recentNumberWindow: recentOutcomes.length,
    latestForecast: forecast ? {
      spinNumber: forecast.spinNumber,
      modelVersion: forecast.modelVersion,
      selectedProbabilities,
      hit: evaluation.hit,
    } : null,
    evaluation: {
      total: engine.performance.total,
      successful: engine.performance.successful,
      accuracy: engine.performance.accuracy,
    },
    modelPerformance: performance,
    evidence: bestAlternative ? {
      bestComparedModel: bestAlternative.modelVersion,
      pairedMeanBrierDeltaToUniform: bestAlternative.pairedMeanBrierDeltaToUniform,
      upperBound: bestAlternative.pairedBrierDeltaUpperBound,
    } : null,
    integrity: integrity ? {...integrity} : null,
    strategy: strategy ? {
      action: strategyAction,
      actionLabel: strategyAction,
      totalStakeCents: strategy.wager?.totalStakeCents ?? strategy.decision?.selected?.financials?.totalStakeCents ?? strategy.selected?.financials?.totalStakeCents ?? 0,
      reasons: [...strategyReasons],
    } : null,
  });
}