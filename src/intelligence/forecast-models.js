import {streetOf} from "../core/roulette.js";

export const STREET_MODEL_IDS = Object.freeze({
  uniform: "uniform-v1",
  rolling: "rolling-frequency-v1",
  exponential: "exponential-frequency-v1",
});

const PRIOR_COUNTS = Object.freeze([...new Array(12).fill(3), 1]);
const PRIOR_TOTAL = 37;

function categoryOf(outcome){
  const street = streetOf(outcome);
  return street === null ? 12 : street;
}

function normalise(counts, denominator){
  return counts.map((count, category) => (count + PRIOR_COUNTS[category]) / (denominator + PRIOR_TOTAL));
}

export function scoreBrier(probabilities, actualCategory){
  if (!Array.isArray(probabilities) || probabilities.length !== 13){
    throw new TypeError("A roulette forecast must contain twelve streets and zero probabilities.");
  }
  if (!Number.isInteger(actualCategory) || actualCategory < 0 || actualCategory > 12){
    throw new RangeError("Actual outcome category must be a street index or zero category.");
  }
  return probabilities.reduce((score, probability, category) => {
    const observed = category === actualCategory ? 1 : 0;
    return score + (probability - observed) ** 2;
  }, 0);
}

export function buildForecastModels(history, exponentialWeights, windowSize){
  const uniform = PRIOR_COUNTS.map((count) => count / PRIOR_TOTAL);
  const rollingHistory = history.slice(-windowSize);
  const rollingCounts = new Array(13).fill(0);
  for (const outcome of rollingHistory) rollingCounts[categoryOf(outcome)]++;

  const weightedCounts = exponentialWeights || new Array(13).fill(0);
  const effectiveCount = weightedCounts.reduce((sum, count) => sum + count, 0);
  return [
    {modelVersion: STREET_MODEL_IDS.uniform, probabilities: uniform},
    {
      modelVersion: STREET_MODEL_IDS.rolling,
      probabilities: normalise(rollingCounts, rollingHistory.length),
    },
    {
      modelVersion: STREET_MODEL_IDS.exponential,
      probabilities: normalise(weightedCounts, effectiveCount),
    },
  ];
}

export function chooseBestScoredModel(models, performance, minimumEvaluations = 25){
  const scored = models
    .map((model, order) => ({
      model,
      order,
      score: performance[model.modelVersion],
    }))
    .filter((entry) => entry.score?.total >= minimumEvaluations)
    .sort((left, right) => left.score.meanBrier - right.score.meanBrier || left.order - right.order);
  return scored[0]?.model || models[0];
}