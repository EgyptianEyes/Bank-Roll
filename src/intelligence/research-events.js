const MILESTONES = new Map([
  [10, "First forecast threshold reached"],
  [50, "Fifty observations recorded"],
  [100, "Initial observation maturity reached"],
  [500, "Five hundred observations recorded"],
  [1000, "One thousand observations recorded"],
  [10000, "Ten thousand observations recorded"],
  [100000, "One hundred thousand observations recorded"],
  [1000000, "One million observations recorded"],
]);

export class ResearchEventStream{
  constructor({timelineLimit = 50, clock = () => new Date().toISOString()} = {}){
    if (!Number.isSafeInteger(timelineLimit) || timelineLimit < 1) throw new RangeError("Timeline limit must be a positive safe integer.");
    this.timelineLimit = timelineLimit;
    this.clock = clock;
    this.listeners = new Set();
    this.timeline = [];
    this.datasetId = null;
    this.lastIntegrityClassification = null;
    this.lastModelVersion = null;
    this.lastDecisionAction = null;
  }

  subscribe(listener){
    if (typeof listener !== "function") throw new TypeError("A research event listener is required.");
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publishObservation(snapshot){
    if (!snapshot || typeof snapshot.datasetId !== "string" || !snapshot.datasetId ||
      !Number.isSafeInteger(snapshot.observationCount) || snapshot.observationCount < 1 ||
      !Number.isInteger(snapshot.outcome) || snapshot.outcome < 0 || snapshot.outcome > 36 ||
      !["synthetic", "observed"].includes(snapshot.dataOrigin)){
      throw new TypeError("A valid, provenance-labelled observation snapshot is required.");
    }
    this.#beginDataset(snapshot.datasetId);

    const observation = Object.freeze({
      type: "observation",
      id: `${snapshot.datasetId}:${snapshot.observationCount}`,
      at: snapshot.updatedAt || this.clock(),
      snapshot,
    });
    this.#notify(observation);

    const milestone = MILESTONES.get(snapshot.observationCount);
    if (milestone) this.#record("milestone", snapshot, milestone);

    const integrityClassification = snapshot.integrity?.classification || "unassessed";
    if (integrityClassification !== this.lastIntegrityClassification){
      if (integrityClassification === "statistical_anomaly_candidate"){
        this.#record("integrity-candidate", snapshot, "A statistical shift candidate was flagged; this is not proof of an incorrect result.");
      }
      this.lastIntegrityClassification = integrityClassification;
    }

    const modelVersion = snapshot.latestForecast?.modelVersion || null;
    if (modelVersion && this.lastModelVersion && modelVersion !== this.lastModelVersion){
      this.#record("model-change", snapshot, `The selected forecast model changed from ${this.lastModelVersion} to ${modelVersion}.`);
    }
    if (modelVersion) this.lastModelVersion = modelVersion;

    const decisionAction = snapshot.strategy?.action || null;
    if (decisionAction === "stop" && this.lastDecisionAction !== "stop"){
      this.#record("strategy-suspension", snapshot, "Wagering was suspended; observation continues.");
    }
    this.lastDecisionAction = decisionAction;

    if (snapshot.evaluation?.total === 1){
      this.#record("first-evaluation", snapshot, "The first stored forecast has been evaluated against its outcome.");
    }
    return observation;
  }

  publishSnapshot(snapshot){
    if (!snapshot || typeof snapshot.datasetId !== "string" || !snapshot.datasetId ||
      !Number.isSafeInteger(snapshot.observationCount) || snapshot.observationCount < 1 ||
      !["synthetic", "observed"].includes(snapshot.dataOrigin)){
      throw new TypeError("A valid, provenance-labelled research snapshot is required.");
    }
    this.#beginDataset(snapshot.datasetId);
    this.#notify(Object.freeze({type: "snapshot", snapshot}));
  }

  reset(){
    this.timeline.length = 0;
    this.datasetId = null;
    this.lastIntegrityClassification = null;
    this.lastModelVersion = null;
    this.lastDecisionAction = null;
    this.#notify(Object.freeze({type: "reset"}));
  }

  #record(type, snapshot, message){
    const entry = Object.freeze({
      type,
      id: `${snapshot.datasetId}:${snapshot.observationCount}:${type}`,
      at: snapshot.updatedAt || this.clock(),
      datasetId: snapshot.datasetId,
      observationCount: snapshot.observationCount,
      dataOrigin: snapshot.dataOrigin,
      message,
    });
    this.timeline.push(entry);
    if (this.timeline.length > this.timelineLimit) this.timeline.shift();
    this.#notify(Object.freeze({type: "timeline", entry}));
  }

  #beginDataset(datasetId){
    if (datasetId === this.datasetId) return;
    this.timeline.length = 0;
    this.datasetId = datasetId;
    this.lastIntegrityClassification = null;
    this.lastModelVersion = null;
    this.lastDecisionAction = null;
    this.#notify(Object.freeze({type: "reset"}));
  }

  #notify(event){
    for (const listener of this.listeners){
      try {
        listener(event);
      } catch {
        // Research presentation must not interrupt observation or settlement.
      }
    }
  }
}