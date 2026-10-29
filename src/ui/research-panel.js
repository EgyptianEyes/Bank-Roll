const STREET_COUNT = 12;
const NUMBER_COUNT = 37;

export class ResearchPanel{
  constructor(root, eventStream){
    if (!root || !eventStream) throw new TypeError("A research panel root and event stream are required.");
    this.root = root;
    this.running = false;
    this.snapshot = null;
    this.timelineEntries = [];
    this.framePending = false;
    this.fields = Object.fromEntries([...root.querySelectorAll("[data-research-field]")].map((element) => [element.dataset.researchField, element]));
    this.streetRows = this.#createStreetRows(root.querySelector("#researchStreetRows"));
    this.numberCells = this.#createNumberCells(root.querySelector("#researchNumberCounts"));
    this.unsubscribe = eventStream.subscribe((event) => this.#receive(event));
  }

  setRunning(running){
    this.running = Boolean(running);
    this.#renderStatus();
  }

  #receive(event){
    if (event.type === "reset"){
      this.snapshot = null;
      this.timelineEntries = [];
      this.#renderTimeline();
      this.#renderEmpty();
      this.#renderStatus();
      return;
    }
    if (event.type === "observation"){
      this.snapshot = event.snapshot;
      this.#scheduleRender();
      return;
    }
    if (event.type === "snapshot"){
      this.snapshot = event.snapshot;
      this.#scheduleRender();
      return;
    }
    if (event.type === "timeline"){
      this.timelineEntries.push(event.entry);
      if (this.timelineEntries.length > 50) this.timelineEntries.shift();
      this.#renderTimeline();
    }
  }

  #scheduleRender(){
    if (this.framePending) return;
    this.framePending = true;
    requestAnimationFrame(() => {
      this.framePending = false;
      this.#renderSnapshot();
    });
  }

  #renderSnapshot(){
    const snapshot = this.snapshot;
    if (!snapshot) return this.#renderEmpty();
    this.#text("observed", snapshot.observationCount.toLocaleString());
    this.#text("maturity", `${snapshot.maturity} / 100`);
    this.#text("provenance", snapshot.dataOrigin === "synthetic" ? "Synthetic simulation" : "Observed record");
    this.#text("lastUpdate", snapshot.updatedAt ? new Date(snapshot.updatedAt).toLocaleString() : "Observation time unavailable");
    this.#text("explanation", this.#maturityText(snapshot.observationCount));
    this.#text("forecastCaption", snapshot.latestForecast
      ? `Spin ${snapshot.latestForecast.spinNumber} · ${snapshot.latestForecast.modelVersion} · scored`
      : "Forecast comparison unavailable");

    const maturityFill = this.root.querySelector("#researchMaturityFill");
    maturityFill.style.width = `${snapshot.maturity}%`;
    this.root.querySelector("#researchMaturityTrack").setAttribute("aria-valuenow", String(snapshot.maturity));

    const probabilities = snapshot.latestForecast?.selectedProbabilities;
    for (const row of this.streetRows){
      const street = snapshot.streets[row.index];
      const expected = snapshot.expectedFairStreetAppearances;
      row.observed.textContent = `${street.appearances.toLocaleString()} / ${expected.toFixed(1)}`;
      row.recent.textContent = `${street.recentAppearances} / ${street.recentObservationCount}`;
      row.gap.textContent = street.currentAbsence.toLocaleString();
      row.forecast.textContent = probabilities ? `${(probabilities[row.index] * 100).toFixed(2)}%` : "Not yet scored";
    }

    const numberWindow = snapshot.recentNumberWindow;
    this.#text("numberCaption", numberWindow
      ? `Most recent ${numberWindow} of ${snapshot.observationCount.toLocaleString()} observations`
      : "No recent outcomes");
    for (let number = 0; number < NUMBER_COUNT; number++){
      const cell = this.numberCells[number];
      const count = snapshot.recentNumberCounts[number];
      cell.textContent = `${number} · ${count}`;
      cell.setAttribute("aria-label", `Number ${number}: ${count} appearances in the recent window`);
    }

    this.#renderModels(snapshot);
    this.#renderStrategy(snapshot.strategy);
    this.#renderStatus();
  }

  #renderModels(snapshot){
    const list = this.root.querySelector("#researchModelScores");
    const fragment = document.createDocumentFragment();
    for (const model of snapshot.modelPerformance){
      const item = document.createElement("li");
      item.textContent = `${model.modelVersion} · Brier ${model.meanBrier.toFixed(3)} · ${model.total.toLocaleString()} evaluations`;
      fragment.append(item);
    }
    list.replaceChildren(fragment);
    if (!snapshot.modelPerformance.length){
      const empty = document.createElement("li");
      empty.textContent = "Forecasts have not yet been scored.";
      list.append(empty);
    }
    if (!snapshot.evidence){
      this.#text("evidence", "No forward-scored model comparison yet. Calibration is not currently estimated.");
      return;
    }
    const {bestComparedModel, pairedMeanBrierDeltaToUniform, upperBound} = snapshot.evidence;
    this.#text("evidence", `${bestComparedModel}: paired mean Brier change vs uniform ${pairedMeanBrierDeltaToUniform.toFixed(4)}; sequential upper bound ${upperBound === null ? "not available" : upperBound.toFixed(4)}. This measures forecast score, not wager value. Calibration is not currently estimated.`);
  }

  #renderStrategy(strategy){
    if (!strategy){
      this.#text("strategy", "No autonomous strategy decision was recorded for this observation.");
      return;
    }
    const stake = strategy.totalStakeCents / 100;
    this.#text("strategy", `${strategy.actionLabel || strategy.action || "Observe"} · proposed stake £${stake.toFixed(2)}${strategy.reasons.length ? ` · ${strategy.reasons[0]}` : ""}`);
  }

  #renderTimeline(){
    const list = this.root.querySelector("#researchTimeline");
    const fragment = document.createDocumentFragment();
    if (!this.timelineEntries.length){
      const empty = document.createElement("li");
      empty.className = "research-timeline-empty";
      empty.textContent = "Milestones and meaningful state changes will appear here as they occur.";
      fragment.append(empty);
    } else {
      for (const entry of [...this.timelineEntries].reverse()){
        const item = document.createElement("li");
        const time = document.createElement("time");
        time.dateTime = entry.at;
        time.textContent = new Date(entry.at).toLocaleString();
        const message = document.createElement("span");
        message.textContent = `${entry.message} · ${entry.observationCount.toLocaleString()} observations · ${entry.dataOrigin}`;
        item.append(time, message);
        fragment.append(item);
      }
    }
    list.replaceChildren(fragment);
    this.#text("timelineCount", `${this.timelineEntries.length} event${this.timelineEntries.length === 1 ? "" : "s"}`);
  }

  #renderEmpty(){
    this.#text("observed", "0");
    this.#text("maturity", "0 / 100");
    this.#text("provenance", "No dataset");
    this.#text("lastUpdate", "Not yet updated");
    this.#text("explanation", "No observations are loaded. Observation maturity is not a measure of predictive confidence.");
    this.#text("forecastCaption", "Forecast comparison unavailable");
    this.#text("numberCaption", "No recent outcomes");
    this.#text("evidence", "No forward-scored model comparison yet. Calibration is not currently estimated.");
    this.#text("strategy", "No autonomous strategy decision was recorded for this observation.");
    this.root.querySelector("#researchMaturityFill").style.width = "0%";
    for (const row of this.streetRows){
      row.observed.textContent = "0 / 0.0";
      row.recent.textContent = "0 / 0";
      row.gap.textContent = "0";
      row.forecast.textContent = "Not yet scored";
    }
    for (let number = 0; number < NUMBER_COUNT; number++){
      this.numberCells[number].textContent = `${number} · 0`;
      this.numberCells[number].setAttribute("aria-label", `Number ${number}: no recent observations`);
    }
    const models = this.root.querySelector("#researchModelScores");
    const emptyModel = document.createElement("li");
    emptyModel.textContent = "Forecasts have not yet been scored.";
    models.replaceChildren(emptyModel);
  }

  #renderStatus(){
    const status = this.fields.status;
    if (this.running){
      status.textContent = "BRI IS OBSERVING";
      status.dataset.active = "true";
    } else if (this.snapshot){
      status.textContent = this.snapshot.updatedAt
        ? `Idle · last update ${new Date(this.snapshot.updatedAt).toLocaleTimeString()}`
        : "Idle · observation time unavailable";
      status.dataset.active = "false";
    } else {
      status.textContent = "Idle · no observations yet";
      status.dataset.active = "false";
    }
  }

  #createStreetRows(body){
    const rows = [];
    const fragment = document.createDocumentFragment();
    for (let street = 0; street < STREET_COUNT; street++){
      const row = document.createElement("tr");
      const start = street * 3 + 1;
      const end = start + 2;
      const label = document.createElement("th");
      label.scope = "row";
      label.textContent = `Street ${street + 1} · ${start}-${end}`;
      const cells = Array.from({length: 4}, () => document.createElement("td"));
      row.append(label, ...cells);
      fragment.append(row);
      rows.push({index: street, observed: cells[0], recent: cells[1], gap: cells[2], forecast: cells[3]});
    }
    body.replaceChildren(fragment);
    return rows;
  }

  #createNumberCells(container){
    const cells = [];
    const fragment = document.createDocumentFragment();
    for (let number = 0; number < NUMBER_COUNT; number++){
      const cell = document.createElement("span");
      cell.className = number === 0 ? "research-number research-number-zero" : "research-number";
      cell.textContent = `${number} · 0`;
      cell.setAttribute("aria-label", `Number ${number}: no recent observations`);
      cells.push(cell);
      fragment.append(cell);
    }
    container.replaceChildren(fragment);
    return cells;
  }

  #maturityText(count){
    if (count < 10) return "The first forecast is available after ten observations. Maturity describes sample size, not predictive confidence.";
    if (count < 100) return "Forward forecasts are being scored. Initial observation maturity is still building and is not predictive confidence.";
    return "The initial observation maturity threshold is reached; learning and forward scoring continue. Maturity is not proof of predictive power.";
  }

  #text(field, value){
    if (this.fields[field]) this.fields[field].textContent = value;
  }
}