import {estimateStreetProbability} from "../core/mathematics.js";
import {isValidOutcome, streetOf} from "../core/roulette.js";
import {StreetTracker} from "../observation/street-tracker.js";
import {buildForecastModels, chooseBestScoredModel, scoreBrier, STREET_MODEL_IDS} from "./forecast-models.js";

export class StreetPredictionEngine{
  constructor({minimumObservations = 10, windowSize = 100, minimumModelEvaluations = 25, exponentialHalfLife = 25, historyLimit = 1000, recordTimestamps = true} = {}){
    if (!Number.isInteger(historyLimit) || historyLimit < 0) throw new RangeError("Prediction history limit must be a non-negative integer.");
    this.minimumObservations = minimumObservations;
    this.windowSize = windowSize;
    this.minimumModelEvaluations = minimumModelEvaluations;
    this.historyLimit = historyLimit;
    this.recordTimestamps = recordTimestamps;
    this.exponentialDecay = Math.exp(Math.log(0.5) / exponentialHalfLife);
    this.tracker = new StreetTracker();
    this.forecasts = [];
    this.evaluations = [];
    this.pendingForecast = null;
    this.exponentialWeights = new Array(13).fill(0);
    this.modelScores = new Map();
    this.evaluationCount = 0;
    this.successfulEvaluations = 0;
  }

  get observationCount(){
    return this.tracker.count;
  }

  observe(outcome){
    if (!isValidOutcome(outcome)) throw new RangeError("Roulette outcome must be an integer from 0 to 36.");
    let evaluation = null;
    if (this.pendingForecast){
      const actualCategory = streetOf(outcome) ?? 12;
      const modelResults = this.pendingForecast.candidateModels.map((candidate) => {
        const score = scoreBrier(candidate.probabilities, actualCategory);
        const current = this.modelScores.get(candidate.modelVersion) || {
          total: 0,
          brierTotal: 0,
          comparisonTotal: 0,
          pairedDifferenceTotal: 0,
        };
        current.total++;
        current.brierTotal += score;
        this.modelScores.set(candidate.modelVersion, current);
        return Object.freeze({modelVersion: candidate.modelVersion, brierScore: score});
      });
      const uniformScore = modelResults.find((result) => result.modelVersion === STREET_MODEL_IDS.uniform)?.brierScore;
      if (uniformScore !== undefined){
        for (const result of modelResults){
          if (result.modelVersion === STREET_MODEL_IDS.uniform) continue;
          const current = this.modelScores.get(result.modelVersion);
          const difference = result.brierScore - uniformScore;
          current.comparisonTotal++;
          current.pairedDifferenceTotal += difference;
        }
      }
      evaluation = Object.freeze({
        forecast: this.pendingForecast,
        actual: outcome,
        hit: streetOf(outcome) === this.pendingForecast.street,
        modelResults: Object.freeze(modelResults),
      });
      if (this.historyLimit > 0) this.evaluations.push(evaluation);
      this.evaluationCount++;
      if (evaluation.hit) this.successfulEvaluations++;
      if (this.evaluations.length > this.historyLimit) this.evaluations.shift();
      this.pendingForecast = null;
    }
    this.tracker.record(outcome);
    for (let category = 0; category < this.exponentialWeights.length; category++){
      this.exponentialWeights[category] *= this.exponentialDecay;
    }
    this.exponentialWeights[streetOf(outcome) ?? 12]++;
    return evaluation;
  }

  forecastNext(){
    if (this.pendingForecast) throw new Error("Score the pending forecast before creating another.");
    if (this.tracker.count < this.minimumObservations) return null;
    const {counts, observationCount} = this.tracker.windowCounts(this.windowSize);
    const models = buildForecastModels(this.tracker.history, this.exponentialWeights, this.windowSize);
    const performance = Object.fromEntries(this.modelPerformance.map((item) => [item.modelVersion, item]));
    const selectedModel = chooseBestScoredModel(models, performance, this.minimumModelEvaluations);
    const candidateModels = Object.freeze(models.map((model) => Object.freeze({
      modelVersion: model.modelVersion,
      probabilities: Object.freeze([...model.probabilities]),
    })));
    const selectedProbabilities = selectedModel.probabilities;
    let preferredStreet = 0;
    for (let street = 1; street < 12; street++){
      if (selectedProbabilities[street] > selectedProbabilities[preferredStreet]) preferredStreet = street;
    }
    const record = Object.freeze({
      spinNumber: this.tracker.count + 1,
      observationCount: this.tracker.count,
      windowSize: observationCount,
      street: preferredStreet,
      streetCount: counts[preferredStreet],
      probability: selectedProbabilities[preferredStreet],
      estimatedProbability: estimateStreetProbability(counts[preferredStreet], observationCount),
      modelVersion: selectedModel.modelVersion,
      candidateModels,
      forecastedAt: this.recordTimestamps ? new Date().toISOString() : null,
    });
    if (this.historyLimit > 0) this.forecasts.push(record);
    if (this.forecasts.length > this.historyLimit) this.forecasts.shift();
    this.pendingForecast = record;
    return record;
  }

  recordHistoricalForecast(record){
    if (this.pendingForecast) throw new Error("Score the pending historical forecast before restoring another.");
    if (!record || record.observationCount !== this.tracker.count || !Number.isSafeInteger(record.observationCount) || record.observationCount < this.minimumObservations){
      throw new RangeError("Historical forecast observation count does not match reconstructed history.");
    }
    if (!Array.isArray(record.candidateModels) || record.candidateModels.length < 1){
      throw new TypeError("Historical forecast must retain its candidate model distributions.");
    }
    const candidates = record.candidateModels.map((candidate) => {
      if (typeof candidate.modelVersion !== "string" || !Array.isArray(candidate.probabilities) || candidate.probabilities.length !== 13 ||
        candidate.probabilities.some((probability) => !Number.isFinite(probability) || probability < 0 || probability > 1) ||
        Math.abs(candidate.probabilities.reduce((sum, probability) => sum + probability, 0) - 1) > 1e-6){
        throw new TypeError("Historical forecast contains an invalid probability distribution.");
      }
      return Object.freeze({modelVersion: candidate.modelVersion, probabilities: Object.freeze([...candidate.probabilities])});
    });
    const selectedModel = candidates.find((candidate) => candidate.modelVersion === record.modelVersion);
    if (!selectedModel || !Number.isInteger(record.street) || record.street < 0 || record.street > 11 ||
      Math.abs(selectedModel.probabilities[record.street] - record.probability) > 1e-9){
      throw new TypeError("Historical forecast selection does not match its stored model distribution.");
    }
    const restored = Object.freeze({
      ...record,
      spinNumber: this.tracker.count + 1,
      candidateModels: Object.freeze(candidates),
      forecastedAt: record.forecastedAt || null,
    });
    this.forecasts.push(restored);
    if (this.forecasts.length > 1000) this.forecasts.shift();
    this.pendingForecast = restored;
    return restored;
  }

  cancelPendingForecast(){
    if (!this.pendingForecast) return false;
    if (this.forecasts.at(-1) === this.pendingForecast) this.forecasts.pop();
    this.pendingForecast = null;
    return true;
  }

  reset(){
    this.tracker = new StreetTracker();
    this.forecasts.length = 0;
    this.evaluations.length = 0;
    this.pendingForecast = null;
    this.exponentialWeights.fill(0);
    this.modelScores.clear();
    this.evaluationCount = 0;
    this.successfulEvaluations = 0;
  }

  get performance(){
    return {
      total: this.evaluationCount,
      successful: this.successfulEvaluations,
      accuracy: this.evaluationCount ? this.successfulEvaluations / this.evaluationCount : 0,
    };
  }

  get modelPerformance(){
    return [...this.modelScores.entries()].map(([modelVersion, score]) => ({
      modelVersion,
      total: score.total,
      meanBrier: score.brierTotal / score.total,
      comparisonEvaluations: score.comparisonTotal,
      pairedMeanBrierDeltaToUniform: score.comparisonTotal
        ? score.pairedDifferenceTotal / score.comparisonTotal
        : null,
      pairedBrierDeltaUpperBound: pairedBrierDeltaUpperBound(score),
      pairedDifferenceTotal: score.pairedDifferenceTotal,
    }));
  }

  snapshot(){
    return {
      version: 1,
      tracker: this.tracker.snapshot(),
      exponentialWeights: [...this.exponentialWeights],
      modelPerformance: this.modelPerformance,
      predictionPerformance: {
        total: this.evaluationCount,
        successful: this.successfulEvaluations,
      },
    };
  }

  restore(snapshot){
    if (!snapshot || snapshot.version !== 1) throw new TypeError("Unsupported prediction engine snapshot.");
    const tracker = new StreetTracker().restore(snapshot.tracker);
    if (!Array.isArray(snapshot.exponentialWeights) || snapshot.exponentialWeights.length !== 13 || snapshot.exponentialWeights.some((value) => !Number.isFinite(value) || value < 0)){
      throw new TypeError("Invalid exponential model state.");
    }
    const predictionPerformance = snapshot.predictionPerformance;
    if (!predictionPerformance || !Number.isSafeInteger(predictionPerformance.total) || !Number.isSafeInteger(predictionPerformance.successful) || predictionPerformance.successful < 0 || predictionPerformance.successful > predictionPerformance.total){
      throw new TypeError("Invalid prediction performance state.");
    }
    if (!Array.isArray(snapshot.modelPerformance)) throw new TypeError("Invalid model performance state.");
    const modelScores = new Map();
    for (const model of snapshot.modelPerformance){
      if (typeof model.modelVersion !== "string" || !Number.isSafeInteger(model.total) || model.total < 0 || !Number.isFinite(model.meanBrier) || model.meanBrier < 0){
        throw new TypeError("Invalid model score in prediction snapshot.");
      }
      const comparisonTotal = model.comparisonEvaluations ?? 0;
      const pairedDifferenceTotal = model.pairedDifferenceTotal ?? 0;
      if (!Number.isSafeInteger(comparisonTotal) || comparisonTotal < 0 ||
        !Number.isFinite(pairedDifferenceTotal)){
        throw new TypeError("Invalid paired model comparison state.");
      }
      modelScores.set(model.modelVersion, {
        total: model.total,
        brierTotal: model.total * model.meanBrier,
        comparisonTotal,
        pairedDifferenceTotal,
      });
    }
    this.tracker = tracker;
    this.exponentialWeights = [...snapshot.exponentialWeights];
    this.modelScores = modelScores;
    this.evaluationCount = predictionPerformance.total;
    this.successfulEvaluations = predictionPerformance.successful;
    this.evaluations.length = 0;
    this.forecasts.length = 0;
    this.pendingForecast = null;
    return this;
  }
}

function pairedBrierDeltaUpperBound(score){
  const count = score.comparisonTotal;
  if (!count) return null;
  const mean = score.pairedDifferenceTotal / count;
  const alpha = 0.05 / (2 * count * (count + 1));
  const logarithm = Math.log(1 / alpha);
  return mean + 4 * Math.sqrt(logarithm / (2 * count));
}