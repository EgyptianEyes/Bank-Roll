import {isValidOutcome, streetOf} from "../core/roulette.js";

export const OBSERVATION_WINDOWS = Object.freeze([10, 25, 50, 75, 100]);

export class StreetTracker{
  constructor(){
    this.history = [];
    this.totalObservations = 0;
    this.appearances = new Array(12).fill(0);
    this.currentAbsence = new Array(12).fill(0);
    this.longestAbsence = new Array(12).fill(0);
    this.intervalTotals = new Array(12).fill(0);
    this.intervalCounts = new Array(12).fill(0);
    this.lastSeenAt = new Array(12).fill(null);
    this.consecutive = new Array(12).fill(0);
    this.previousStreet = null;
  }

  get count(){
    return this.totalObservations;
  }

  record(outcome){
    if (!isValidOutcome(outcome)) throw new RangeError("Roulette outcome must be an integer from 0 to 36.");
    const index = this.totalObservations + 1;
    const street = streetOf(outcome);
    for (let candidate = 0; candidate < 12; candidate++){
      if (candidate === street){
        if (this.lastSeenAt[candidate] !== null){
          this.intervalTotals[candidate] += index - this.lastSeenAt[candidate];
          this.intervalCounts[candidate]++;
        }
        this.appearances[candidate]++;
        this.currentAbsence[candidate] = 0;
        this.lastSeenAt[candidate] = index;
        this.consecutive[candidate] = this.previousStreet === candidate ? this.consecutive[candidate] + 1 : 1;
      } else {
        this.currentAbsence[candidate]++;
        this.longestAbsence[candidate] = Math.max(this.longestAbsence[candidate], this.currentAbsence[candidate]);
        this.consecutive[candidate] = 0;
      }
    }
    this.previousStreet = street;
    this.totalObservations = index;
    this.history.push(outcome);
    if (this.history.length > 100) this.history.shift();
  }

  windowCounts(windowSize = 100){
    const outcomes = this.history.slice(-windowSize);
    const counts = new Array(12).fill(0);
    for (const outcome of outcomes){
      const street = streetOf(outcome);
      if (street !== null) counts[street]++;
    }
    return {counts, observationCount: outcomes.length};
  }

  statistics(){
    const {counts: recentCounts, observationCount: recentObservations} = this.windowCounts(100);
    return this.appearances.map((appearances, street) => {
      return {
        street,
        appearances,
        frequency: this.count ? appearances / this.count : 0,
        currentAbsence: this.currentAbsence[street],
        longestAbsence: this.longestAbsence[street],
        averageInterval: this.intervalCounts[street] ? this.intervalTotals[street] / this.intervalCounts[street] : null,
        recentAppearances: recentCounts[street],
        recentObservationCount: recentObservations,
        consecutiveAppearances: this.consecutive[street],
      };
    });
  }

  snapshot(){
    return {
      version: 1,
      totalObservations: this.totalObservations,
      recentOutcomes: [...this.history],
      appearances: [...this.appearances],
      currentAbsence: [...this.currentAbsence],
      longestAbsence: [...this.longestAbsence],
      intervalTotals: [...this.intervalTotals],
      intervalCounts: [...this.intervalCounts],
      lastSeenAge: this.lastSeenAt.map((lastSeenAt) => lastSeenAt === null ? null : this.totalObservations - lastSeenAt),
      consecutive: [...this.consecutive],
      previousStreet: this.previousStreet,
    };
  }

  restore(snapshot){
    if (!snapshot || snapshot.version !== 1 || !Number.isSafeInteger(snapshot.totalObservations) || snapshot.totalObservations < 0){
      throw new TypeError("Unsupported street tracker snapshot.");
    }
    const fields = ["appearances", "currentAbsence", "longestAbsence", "intervalTotals", "intervalCounts", "lastSeenAge", "consecutive"];
    for (const field of fields){
      if (!Array.isArray(snapshot[field]) || snapshot[field].length !== 12) throw new TypeError(`Invalid ${field} in street tracker snapshot.`);
    }
    if (!Array.isArray(snapshot.recentOutcomes) || snapshot.recentOutcomes.length > 100 || snapshot.recentOutcomes.some((outcome) => !isValidOutcome(outcome))){
      throw new TypeError("Invalid rolling outcomes in street tracker snapshot.");
    }
    if (snapshot.recentOutcomes.length !== Math.min(snapshot.totalObservations, 100)) throw new TypeError("Rolling outcome count does not match the tracker total.");
    for (const field of ["appearances", "currentAbsence", "longestAbsence", "intervalTotals", "intervalCounts", "consecutive"]){
      if (snapshot[field].some((value) => !Number.isSafeInteger(value) || value < 0)) throw new TypeError(`Invalid values in ${field}.`);
    }
    if (snapshot.lastSeenAge.some((age) => age !== null && (!Number.isSafeInteger(age) || age < 0 || age >= snapshot.totalObservations))){
      throw new TypeError("Invalid last-seen age in tracker snapshot.");
    }
    for (let street = 0; street < 12; street++){
      if (snapshot.intervalCounts[street] !== Math.max(0, snapshot.appearances[street] - 1)) throw new TypeError("Street interval count does not match its appearances.");
      if (snapshot.longestAbsence[street] < snapshot.currentAbsence[street]) throw new TypeError("Longest absence is below the current absence.");
      if (snapshot.consecutive[street] > snapshot.appearances[street]) throw new TypeError("Consecutive count exceeds street appearances.");
      if ((snapshot.appearances[street] === 0) !== (snapshot.lastSeenAge[street] === null)) throw new TypeError("Last-seen state does not match street appearances.");
    }
    if (snapshot.appearances.reduce((sum, value) => sum + value, 0) > snapshot.totalObservations){
      throw new TypeError("Street appearances exceed the observation total.");
    }
    if (snapshot.previousStreet !== null && (!Number.isInteger(snapshot.previousStreet) || snapshot.previousStreet < 0 || snapshot.previousStreet > 11)){
      throw new TypeError("Invalid previous street in tracker snapshot.");
    }
    if (snapshot.totalObservations > 0 && snapshot.previousStreet !== streetOf(snapshot.recentOutcomes.at(-1))){
      throw new TypeError("Previous street does not match the latest outcome.");
    }
    this.history = [...snapshot.recentOutcomes];
    this.totalObservations = snapshot.totalObservations;
    for (const field of fields.filter((name) => name !== "lastSeenAge")) this[field] = [...snapshot[field]];
    this.lastSeenAt = snapshot.lastSeenAge.map((age) => age === null ? null : snapshot.totalObservations - age);
    this.previousStreet = snapshot.previousStreet;
    return this;
  }
}