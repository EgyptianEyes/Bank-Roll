import {isRed} from "../core/roulette.js";
import {TestModeSession} from "../simulation/sandbox-session.js";
import {fromMinorUnits} from "../core/mathematics.js";
import {BriCompanion} from "../companion/companion.js";

const $ = (id) => document.getElementById(id);
const ui = {
  expiry: $("testExpiry"),
  setup: $("testSetup"),
  wageringMode: $("testWageringMode"),
  companionMode: $("testCompanionMode"),
  btnStart: $("btnStartTest"),
  session: $("testSession"),
  sessionState: $("testSessionState"),
  discard: $("btnDiscardTest"),
  numberPad: $("testNumberPad"),
  lastResult: $("testLastResult"),
  generateOne: $("btnGenerateOne"),
  batchCount: $("testBatchCount"),
  generateBatch: $("btnGenerateBatch"),
  correctionNumber: $("testCorrectionNumber"),
  correctionValue: $("testCorrectionValue"),
  correct: $("btnCorrectTest"),
  undo: $("btnUndoTest"),
  reset: $("btnResetTest"),
  inputStatus: $("testInputStatus"),
  spinCount: $("testSpinCount"),
  forecast: $("testForecast"),
  model: $("testModel"),
  score: $("testScore"),
  decision: $("testDecision"),
  bankroll: $("testBankroll"),
  profitLoss: $("testProfitLoss"),
  modelScores: $("testModelScores"),
  companionMessage: $("testCompanionMessage"),
  forecastDetail: $("testForecastDetail"),
  expected: $("testExpected"),
  streetRows: $("testStreetRows"),
  historyCount: $("testHistoryCount"),
  history: $("testHistoryList"),
  events: $("testEventList"),
};

let session = null;
let busy = false;
let companion = null;
const streetCells = buildStreetRows();
const numberButtons = buildNumberPad();
const formatMoney = (cents) => `£${fromMinorUnits(cents).toFixed(2)}`;

function buildNumberPad(){
  const fragment = document.createDocumentFragment();
  const buttons = [];
  for (let number = 0; number <= 36; number++){
    const button = document.createElement("button");
    button.type = "button";
    button.className = `test-number-button${number === 0 ? " test-number-zero" : isRed(number) ? " test-number-red" : " test-number-black"}`;
    button.textContent = String(number);
    button.setAttribute("aria-label", `Enter roulette result ${number}`);
    button.addEventListener("click", () => submitOutcome(number));
    buttons.push(button);
    fragment.append(button);
  }
  ui.numberPad.replaceChildren(fragment);
  return buttons;
}

function buildStreetRows(){
  const rows = [];
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < 12; index++){
    const row = document.createElement("tr");
    const label = document.createElement("th");
    label.scope = "row";
    label.textContent = `Street ${index + 1} · ${index * 3 + 1}-${index * 3 + 3}`;
    const observed = document.createElement("td");
    const expected = document.createElement("td");
    const recent = document.createElement("td");
    const gap = document.createElement("td");
    row.append(label, observed, expected, recent, gap);
    rows.push({observed, expected, recent, gap});
    fragment.append(row);
  }
  ui.streetRows.replaceChildren(fragment);
  return rows;
}

function startSession(){
  session = new TestModeSession({wageringMode: ui.wageringMode.value});
  companion = new BriCompanion({mode: ui.companionMode.value});
  ui.setup.hidden = true;
  ui.session.hidden = false;
  ui.inputStatus.textContent = "Test session created in temporary page memory. Nothing is sent to the server.";
  ui.companionMessage.textContent = "BRI is ready to experiment.";
  render();
  renderExpiry();
}

function submitOutcome(outcome){
  if (!session || busy) return;
  busy = true;
  setControlsDisabled(true);
  try {
    const {result} = session.recordOutcome(outcome);
    if (result.evaluation){
      const message = companion.onEvaluation({
        hit: result.evaluation.hit,
        actual: outcome,
        forecast: {street: result.evaluation.forecast.street},
        performance: session.coordinator.engine.performance,
      });
      if (message) ui.companionMessage.textContent = message;
    }
    announcePrepared(session.prepared);
    ui.inputStatus.textContent = `Test result ${outcome} accepted · synthetic test data only`;
    render();
  } catch (error) {
    ui.inputStatus.textContent = error.message;
  } finally {
    busy = false;
    setControlsDisabled(false);
  }
}

function generate(count){
  if (!session || busy) return;
  busy = true;
  setControlsDisabled(true);
  try {
    const generated = session.generate(count);
    if (generated.length){
      const evaluation = session.coordinator.engine.evaluations.at(-1);
      if (evaluation){
        const message = companion.onEvaluation({
          hit: evaluation.hit,
          actual: evaluation.actual,
          forecast: {street: evaluation.forecast.street},
          performance: session.coordinator.engine.performance,
        });
        if (message) ui.companionMessage.textContent = message;
      }
      announcePrepared(session.prepared);
    }
    ui.inputStatus.textContent = `${generated.length} synthetic spin${generated.length === 1 ? "" : "s"} generated · not real-table observations`;
    render();
  } catch (error) {
    ui.inputStatus.textContent = error.message;
  } finally {
    busy = false;
    setControlsDisabled(false);
  }
}

function announcePrepared(prepared){
  if (!companion || !prepared) return;
  if (prepared.forecast && prepared.forecast.modelVersion !== "uniform-v1"){
    const forecastMessage = companion.onForecast({
      street: prepared.forecast.street,
      probability: prepared.forecast.probability,
      modelVersion: prepared.forecast.modelVersion,
    });
    if (forecastMessage) ui.companionMessage.textContent = forecastMessage;
  }
  if (prepared.decision){
    const decisionMessage = companion.onDecision(prepared.decision);
    if (decisionMessage) ui.companionMessage.textContent = decisionMessage;
  }
}

function correctSelected(){
  if (!session) return;
  if (ui.correctionNumber.value === ""){
    ui.inputStatus.textContent = "Choose one of the recent test results to correct.";
    return;
  }
  const spinIndex = Number(ui.correctionNumber.value);
  const outcome = Number(ui.correctionValue.value);
  try {
    session.correctAt(spinIndex, outcome);
    ui.inputStatus.textContent = `Test spin ${spinIndex + 1} corrected · forecasts and statistics replayed inside this temporary test only`;
    ui.correctionValue.value = "";
    render();
  } catch (error) {
    ui.inputStatus.textContent = error.message;
  }
}

function undoLast(){
  if (!session) return;
  if (!session.undoLast()){
    ui.inputStatus.textContent = "There is no test result to undo.";
    return;
  }
  ui.inputStatus.textContent = "Last test result removed · temporary BRI state replayed";
  render();
}

function resetSession(){
  if (!session) return;
  try {
    session.reset();
    companion = new BriCompanion({mode: ui.companionMode.value});
    ui.companionMessage.textContent = "BRI is ready to experiment.";
    ui.inputStatus.textContent = "Test results cleared · the original expiry time is unchanged";
    render();
  } catch (error) {
    ui.inputStatus.textContent = error.message;
  }
}

function discardSession({expired = false} = {}){
  if (session) session.discard();
  session = null;
  companion = null;
  ui.session.hidden = true;
  ui.setup.hidden = false;
  ui.wageringMode.disabled = false;
  ui.expiry.textContent = expired ? "Expired · results discarded" : "Test ended · results discarded";
  ui.lastResult.textContent = "No results";
  ui.sessionState.textContent = expired ? "Expired and discarded" : "Discarded";
  ui.inputStatus.textContent = "Temporary outcomes, forecasts, decisions and bankroll have been discarded.";
  ui.spinCount.textContent = "0";
  ui.forecast.textContent = "Gathering observations";
  ui.model.textContent = "Uniform baseline";
  ui.score.textContent = "0 scored";
  ui.decision.textContent = "OBSERVE";
  ui.bankroll.textContent = "£100.00";
  ui.profitLoss.textContent = "£0.00";
  ui.lastResult.textContent = "No results";
  ui.expected.textContent = "Fair expectation: 0.0 per street";
  for (const cells of streetCells){
    cells.observed.textContent = "0";
    cells.expected.textContent = "0.0";
    cells.recent.textContent = "0 / 0";
    cells.gap.textContent = "0";
  }
  ui.historyCount.textContent = "0 results";
  ui.history.replaceChildren(newListItem("No test results yet."));
  ui.events.replaceChildren(newListItem("No research events yet."));
  ui.modelScores.replaceChildren();
  ui.correctionNumber.replaceChildren(new Option("Choose a recent spin", ""));
  ui.correctionValue.value = "";
}

function render(){
  if (!session || session.expireIfDue()){
    if (session) discardSession({expired: true});
    return;
  }
  const snapshot = session.snapshot();
  const count = session.observationCount;
  const prepared = session.prepared;
  const forecast = prepared.forecast;
  const decision = prepared.decision;
  const performance = session.coordinator.engine.performance;
  const selectedModel = forecast?.candidateModels.find((model) => model.modelVersion === forecast.modelVersion);
  const bankrollCents = session.coordinator.state.bankrollCents;
  const profitLossCents = bankrollCents - session.bankrollCents;

  ui.sessionState.textContent = `${count.toLocaleString()} / ${session.maxObservations.toLocaleString()} test spins · no real-table data`;
  ui.spinCount.textContent = count.toLocaleString();
  ui.lastResult.textContent = count ? `Last result ${session.outcomes.at(-1)}` : "No results";
  ui.forecast.textContent = forecast
    ? forecast.modelVersion === "uniform-v1" ? `Uniform baseline · spin ${forecast.spinNumber}` : `Street ${forecast.street + 1} · spin ${forecast.spinNumber}`
    : "Gathering observations";
  ui.model.textContent = forecast ? forecast.modelVersion : "Uniform baseline";
  ui.score.textContent = `${performance.total.toLocaleString()} scored · ${performance.successful.toLocaleString()} hits`;
  ui.decision.textContent = decision ? `${decision.action.toUpperCase()} · ${decision.selected.financials ? formatMoney(decision.selected.financials.totalStakeCents) : "observe"}` : "OBSERVE";
  ui.bankroll.textContent = formatMoney(bankrollCents);
  ui.profitLoss.textContent = `${profitLossCents >= 0 ? "+" : ""}${formatMoney(profitLossCents)}`;
  ui.forecastDetail.textContent = forecast && selectedModel
    ? `Next spin ${forecast.spinNumber} · ${forecast.modelVersion} assigns ${(selectedModel.probabilities[forecast.street] * 100).toFixed(2)}% to its selected street. The model's forecast is staged before the next test outcome.`
    : "The first forecast is available after ten test outcomes. These results cannot enter live or shared research.";
  ui.expected.textContent = `Fair expectation: ${(count * 3 / 37).toFixed(1)} per street`;
  const scoreItems = session.coordinator.engine.modelPerformance.map((model) => {
    const item = newListItem(`${model.modelVersion} · Brier ${model.meanBrier.toFixed(3)} · ${model.total} scored`);
    return item;
  });
  ui.modelScores.replaceChildren(...scoreItems);
  if (!scoreItems.length) ui.modelScores.append(newListItem("No forecasts scored yet."));

  for (let street = 0; street < 12; street++){
    const profile = snapshot.streets[street];
    streetCells[street].observed.textContent = profile.appearances.toLocaleString();
    streetCells[street].expected.textContent = (count * 3 / 37).toFixed(1);
    streetCells[street].recent.textContent = `${profile.recentAppearances} / ${profile.recentObservationCount}`;
    streetCells[street].gap.textContent = profile.currentAbsence.toLocaleString();
  }
  renderHistory();
  renderEvents();
  renderExpiry();
}

function renderHistory(){
  const outcomes = session.outcomes;
  const start = Math.max(0, outcomes.length - 50);
  const fragment = document.createDocumentFragment();
  const correctionOptions = [];
  for (let index = outcomes.length - 1; index >= start; index--){
    const item = document.createElement("li");
    item.textContent = `Spin ${index + 1} · ${outcomes[index]}`;
    fragment.append(item);
    correctionOptions.push(new Option(`Spin ${index + 1} · result ${outcomes[index]}`, String(index)));
  }
  if (!outcomes.length){
    const item = document.createElement("li");
    item.textContent = "No test results yet.";
    fragment.append(item);
  }
  ui.history.replaceChildren(fragment);
  ui.correctionNumber.replaceChildren(new Option("Choose a recent spin", ""), ...correctionOptions);
  ui.historyCount.textContent = `${outcomes.length.toLocaleString()} total · showing ${Math.min(50, outcomes.length)}`;
  ui.undo.disabled = outcomes.length === 0;
  ui.correct.disabled = outcomes.length === 0;
}

function renderEvents(){
  const fragment = document.createDocumentFragment();
  for (const event of [...session.events.timeline].reverse()){
    fragment.append(newListItem(`${event.message} · ${event.observationCount} test spins`));
  }
  if (!session.events.timeline.length){
    fragment.append(newListItem("BRI milestones and model changes will appear here."));
  }
  ui.events.replaceChildren(fragment);
}

function newListItem(text){
  const item = document.createElement("li");
  item.textContent = text;
  return item;
}

function renderExpiry(){
  if (!session){
    if (ui.setup.hidden) ui.expiry.textContent = "No active test";
    return;
  }
  if (session.expireIfDue()){
    discardSession({expired: true});
    return;
  }
  const secondsRemaining = Math.ceil(session.timeRemainingMs / 1000);
  const hours = Math.floor(secondsRemaining / 3600);
  const minutes = Math.floor((secondsRemaining % 3600) / 60);
  const seconds = secondsRemaining % 60;
  ui.expiry.textContent = `Expires in ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}

function setControlsDisabled(disabled){
  for (const button of numberButtons) button.disabled = disabled || !session;
  for (const button of [ui.generateOne, ui.generateBatch, ui.correct, ui.undo, ui.reset]) button.disabled = disabled || !session;
  ui.batchCount.disabled = disabled || !session;
}

ui.btnStart.addEventListener("click", startSession);
ui.generateOne.addEventListener("click", () => generate(1));
ui.generateBatch.addEventListener("click", () => generate(Number(ui.batchCount.value)));
ui.correct.addEventListener("click", correctSelected);
ui.undo.addEventListener("click", undoLast);
ui.reset.addEventListener("click", resetSession);
ui.discard.addEventListener("click", () => discardSession());
window.addEventListener("pagehide", () => {
  if (session) session.discard();
});
window.addEventListener("pageshow", renderExpiry);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) renderExpiry();
});

window.setInterval(renderExpiry, 1000);
