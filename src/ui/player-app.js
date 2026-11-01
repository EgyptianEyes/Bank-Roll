import {isRed} from "../core/roulette.js";
import {fromMinorUnits, toMinorUnits} from "../core/mathematics.js";
import {PlayerSession} from "../simulation/player-session.js";
import {PlayerModeStore} from "../storage/player-mode-store.js";
import {playerStopReason} from "../simulation/player-rules.js";
import {wagerOutcomeStatus} from "./player-history.js";

const $ = (id) => document.getElementById(id);
const ui = {
  setupPanel: $("setupPanel"),
  emptyCreate: $("emptyCreateTable"),
  workspace: $("playerWorkspace"),
  tableSelect: $("tableSelect"),
  tableMeta: $("tableMeta"),
  newTable: $("newTableButton"),
  newSession: $("newSessionButton"),
  endSession: $("endSessionButton"),
  export: $("exportButton"),
  bankroll: $("bankrollValue"),
  profit: $("profitValue"),
  wagerRecord: $("wagerRecord"),
  losses: $("lossValue"),
  evidence: $("evidenceStatus"),
  recommendation: $("recommendationContent"),
  prepare: $("prepareButton"),
  confirmRecommendation: $("confirmRecommendationButton"),
  manualWager: $("manualWagerButton"),
  noBet: $("noBetButton"),
  wagerState: $("wagerState"),
  board: $("rouletteBoard"),
  selectedNumber: $("selectedNumber"),
  recordOutcome: $("recordOutcomeButton"),
  gap: $("gapButton"),
  entryStatus: $("entryStatus"),
  historyCount: $("historyCount"),
  history: $("historyList"),
  tableDialog: $("tableDialog"),
  tableForm: $("tableForm"),
  wagerDialog: $("wagerDialog"),
  wagerForm: $("wagerForm"),
  streetPicker: $("streetPicker"),
  wagerTotal: $("manualWagerTotal"),
  correctionDialog: $("correctionDialog"),
  correctionForm: $("correctionForm"),
  correctionObservation: $("correctionObservation"),
  correctionOutcome: $("correctionOutcome"),
  toast: $("toast"),
  switchTable: $("switchTableButton"),
  handover: $("handoverButton"),
  undo: $("undoButton"),
  rules: $("strategyRules"),
  scores: $("modelScores"),
  summary: $("sessionSummary"),
  audit: $("auditList"),
  strategyTitle: $("recommendation-title"),
  activeTableName: $("activeTableName"),
};

const store = new PlayerModeStore();
const money = (cents) => `£${fromMinorUnits(cents).toFixed(2)}`;
let table = null;
let session = null;
let player = null;
let selectedNumber = null;
let busy = false;
let toastTimer = null;
let creatingSession = false;
let tableEvents = [];

function showMessage(message){
  ui.toast.textContent = message;
  ui.toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove("visible"), 4200);
}

function buildNumberPad(){
  const fragment = document.createDocumentFragment();
  for (let number = 0; number <= 36; number++){
    const button = document.createElement("button");
    button.type = "button";
    button.className = `number-button${number === 0 ? " number-zero" : isRed(number) ? " number-red" : " number-black"}`;
    button.textContent = String(number);
    button.setAttribute("aria-label", `Select winning number ${number}`);
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      selectedNumber = number;
      ui.board.querySelectorAll("button").forEach((key) => key.setAttribute("aria-pressed", String(key === button)));
      ui.selectedNumber.textContent = String(number);
      ui.recordOutcome.disabled = !session || session.status !== "active" || session.wagerStatus === "awaiting-player" || busy;
    });
    fragment.append(button);
  }
  ui.board.replaceChildren(fragment);
}

function buildStreetPicker(){
  const fragment = document.createDocumentFragment();
  for (let street = 0; street < 12; street++){
    const label = document.createElement("label");
    label.className = "street-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.name = "street";
    checkbox.value = String(street);
    checkbox.addEventListener("change", updateManualTotal);
    const text = document.createElement("span");
    text.textContent = `${street * 3 + 1}–${street * 3 + 3}`;
    label.append(checkbox, text);
    fragment.append(label);
  }
  ui.streetPicker.append(fragment);
}

function buildOutcomeOptions(select){
  const fragment = document.createDocumentFragment();
  for (let outcome = 0; outcome <= 36; outcome++){
    const option = document.createElement("option");
    option.value = String(outcome);
    option.textContent = String(outcome);
    fragment.append(option);
  }
  select.replaceChildren(fragment);
}

function updateManualTotal(){
  const count = ui.wagerForm.querySelectorAll('input[name="street"]:checked').length;
  const stake = Number(ui.wagerForm.elements.stake.value || 0);
  ui.wagerTotal.textContent = `Total stake: ${money(Number.isFinite(stake) ? toMinorUnits(stake) * count : 0)}`;
}

function renderTableMeta(){
  ui.activeTableName.textContent = table.name;
  const details = [table.venue, table.observer && `Observer: ${table.observer}`, table.dealer && `Dealer: ${table.dealer}`].filter(Boolean);
  ui.tableMeta.textContent = details.join(" · ") || "Physical table · local record";
}

function renderRecommendation(){
  ui.recommendation.replaceChildren();
  const recommendation = session?.pendingRecommendation;
  const forecast = session?.pendingForecast;
  if (!recommendation){
    ui.evidence.textContent = "NO FORECAST";
    ui.confirmRecommendation.disabled = true;
    ui.noBet.disabled = !session || session.status !== "active" || Boolean(session.pendingActualWager) || busy;
    const copy = document.createElement("p");
    copy.className = "empty-copy";
    copy.textContent = session?.status !== "active"
      ? "This session is ended. Start a new session to continue."
      : player?.engine.observationCount < 10
      ? `Observation only: ${player.engine.observationCount} of 10 results recorded before a forecast can be prepared.`
      : "Prepare the next forecast before the result is known.";
    ui.recommendation.append(copy);
    return;
  }

  const decision = recommendation.decision;
  const selected = decision.selected;
  const isStop = decision.action === "stop";
  ui.evidence.textContent = isStop ? "OBSERVE ONLY" : "EXPLORATORY SIGNAL";
  ui.evidence.classList.toggle("status-ready", !recommendation.evidence.evidenceWeak);
  const title = document.createElement("strong");
  title.className = "recommendation-action";
  title.textContent = isStop
    ? "No wager recommended"
    : `${decision.action[0].toUpperCase()}${decision.action.slice(1)} · ${selected.streets.map((street) => `S${street + 1}`).join(" / ")}`;
  const explanation = document.createElement("p");
  explanation.className = "strategy-explanation";
  if (isStop){
    explanation.textContent = recommendation.evidence.evidenceWeak
      ? `No prospective model has demonstrated a reliable improvement over uniform roulette. Keep recording observations; outstanding losses remain on the ledger. ${recommendation.evidence.reason}.`
      : `${decision.reasons[0]} Outstanding losses remain on the ledger; no progression step is staked while BRI observes.`;
  } else {
    const financials = selected.financials;
    const streetText = selected.streets.map((street, index) => `street ${street + 1} at ${money(financials.streetStakeCents[index])}`).join(", ");
    const progression = `${session.settings.progressionMode} progression, step ${selected.step} (player-selected; not evidence-supported)`;
    const losses = session.accumulatedLossCents > 0 ? ` £${fromMinorUnits(session.accumulatedLossCents).toFixed(2)} remains unrecovered.` : "";
    explanation.textContent = `BRI's preferred strategy remains observation; this is an exploratory candidate, not an evidence-backed staking strategy. ${decision.reasons[0]} ${progression}: ${streetText}; total ${money(financials.totalStakeCents)}.${losses} Confirm only if this matches your actual wager.`;
  }
  ui.recommendation.append(title, explanation);
  ui.confirmRecommendation.disabled = isStop || !selected?.financials || Boolean(session.pendingActualWager) || busy;
  ui.noBet.disabled = Boolean(session.pendingActualWager) || busy;
  if (forecast){
    const model = document.createElement("small");
    model.className = "forecast-detail";
    const selectedModel = forecast.candidateModels.find((candidate) => candidate.modelVersion === forecast.modelVersion);
    model.textContent = `${forecast.observationCount} observations · ${forecast.modelVersion} · leading street probability ${(selectedModel.probabilities[forecast.street] * 100).toFixed(2)}% · forward-tested against uniform`;
    ui.recommendation.append(model);
  }
}

function renderIntelligence(){
  const settings = session.settings;
  const recommendation = session.pendingRecommendation;
  const selected = recommendation?.decision.selected;
  const stopping = playerStopReason(session);
  const betting = selected && selected.action !== "stop" && !stopping;
  ui.strategyTitle.textContent = "BRI preferred strategy: Observe";
  const progression = {
    flat: "Keep one unit per street; losses never increase the unit.",
    linear: "At step n propose n units per street.",
    fibo: "At steps 1, 2, 3, 4, 5, 6 propose 1, 1, 2, 3, 5, 8 units per street.",
    martingale: "At step n propose 2^(n-1) units per street.",
  }[settings.progressionMode];
  const rules = [
    `Observation (no wager) is BRI's preferred strategy because no staking progression is independently validated as advantageous. Selected forecast model: ${session.pendingForecast?.modelVersion || "none"}. Starting unit ${money(settings.unitCents)}; current step ${session.progressionStep}; candidate total ${money(betting ? selected.financials.totalStakeCents : 0)}.`,
    `Exploratory candidate streets: ${betting ? selected.streets.map((street) => `${street * 3 + 1}-${street * 3 + 3}`).join(", ") : "none"}. ${progression} Flat remains the default risk-control baseline, not evidence of an edge.`,
    "A loss advances only the recorded non-flat progression step. It does not authorize another bet. Every proposed increase requires renewed evidence, positive estimated return and three affordable further losses. A hit or a fresh street position resets to step 1; outstanding losses are never erased.",
    "Forecast-based switching requires at least 25 effective observations supporting the selected model and an approximate model-support screening margin; this is not a calibrated confidence interval. An unaffordable position can still be stopped or changed. Spread redistributes total stake; it does not increase total exposure.",
    `Stop wagering at ${settings.maxStakeCents ? money(settings.maxStakeCents) : "no configured maximum total stake"}, ${settings.stopLossCents ? money(settings.stopLossCents) : "no configured stop-loss"}, ${settings.takeProfitCents ? money(settings.takeProfitCents) : "no configured take-profit"}, step ${settings.maxSteps}, insufficient funds or weak/deteriorating evidence. ${stopping ? `Current stop: ${stopping}.` : ""}`,
    "Scores are prospective, not proof of profit. Streets are betting-layout groups, not physical wheel sectors. A fair wheel retains a 1/37 house edge; no progression guarantees recovery.",
  ];
  ui.rules.replaceChildren(...rules.map((text) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    return paragraph;
  }));
  ui.scores.replaceChildren(...player.engine.modelPerformance.map((model) => {
    const item = document.createElement("li");
    item.textContent = `${model.modelVersion}: ${model.total} forward scores; Brier ${model.meanBrier.toFixed(5)}${model.recentMeanBrierDelta === null ? "" : `; recent change vs uniform ${model.recentMeanBrierDelta.toFixed(5)}`}.`;
    return item;
  }));
  ui.summary.textContent = `${player.engine.observationCount} eligible table observations; ${player.engine.performance.total} scored forecasts since the last correction. Total actually staked ${money(session.totalStakedCents)}; gross returns ${money(session.totalGrossReturnsCents)}. Local, unverified and never shared.`;
}

function renderHistory(){
  const rows = player.observations;
  ui.historyCount.textContent = `${rows.length} ${rows.length === 1 ? "result" : "results"}`;
  const fragment = document.createDocumentFragment();
  for (const record of rows.slice(-60).reverse()){
    const item = document.createElement("li");
    item.className = "history-item";
    const badge = document.createElement("span");
    badge.className = `history-number${record.effectiveOutcome === 0 ? " number-zero" : isRed(record.effectiveOutcome) ? " number-red" : " number-black"}`;
    badge.textContent = record.voided ? "—" : String(record.effectiveOutcome);
    const detail = document.createElement("div");
    detail.className = "history-detail";
    const heading = document.createElement("strong");
    heading.textContent = `Entry ${record.sequence}${record.gapBefore ? " · after gap" : ""}${record.voided ? " · undone" : ""}${record.trustStatus === "quarantined" ? " · quarantined" : ""}`;
    const summary = document.createElement("small");
    const actual = record.actualWager;
    if (!actual){
      summary.textContent = "Observed · no confirmed wager";
    } else {
      const status = wagerOutcomeStatus(record);
      const wagerStatus = status === "undone" ? "undone · wager reopened" : status;
      summary.textContent = `${actual.origin === "bri-recommendation" ? "BRI confirmed" : "Manual wager"} · ${wagerStatus} · ${money(actual.totalStakeCents)}`;
    }
    detail.append(heading, summary);
    const correction = document.createElement("button");
    correction.type = "button";
    correction.className = "icon-button correction-button";
    correction.title = "Correct this result";
    correction.setAttribute("aria-label", `Correct recorded result ${record.effectiveOutcome}, spin ${record.sequence}`);
    correction.textContent = "↺";
    correction.disabled = record.voided || Boolean(session.pendingActualWager) || busy;
    correction.addEventListener("click", () => openCorrection(record));
    item.append(badge, detail, correction);
    fragment.append(item);
  }
  ui.history.replaceChildren(fragment);
  const revisions = rows.flatMap((record) => (record.corrections || []).map((revision) => ({
    text: `Entry ${record.sequence}: ${revision.previousOutcome} → ${revision.correctedOutcome ?? "undone"}; ${revision.reason || "no reason supplied"}`,
  })));
  const audit = [...tableEvents.filter((event) => event.eventType !== "forecast-prepared").slice(-30).map((event) => ({
    text: `${event.createdAt}: ${event.eventType}${event.note ? `; ${event.note}` : ""}${event.integrityFlags?.length ? `; flagged ${event.integrityFlags.join(", ")}` : ""}`,
  })), ...revisions];
  ui.audit.replaceChildren(...audit.slice(-60).reverse().map((entry) => {
    const item = document.createElement("li");
    item.textContent = entry.text;
    return item;
  }));
}

function render(){
  if (!table || !session || !player) return;
  ui.workspace.hidden = false;
  document.body.classList.add("session-active");
  ui.setupPanel.hidden = true;
  renderTableMeta();
  ui.bankroll.textContent = money(session.bankrollCents);
  ui.profit.textContent = money(session.bankrollCents + (session.pendingActualWager?.totalStakeCents || 0) - session.startingBankrollCents);
  ui.profit.classList.toggle("negative", session.bankrollCents < session.startingBankrollCents);
  ui.wagerRecord.textContent = `${session.wins} · ${session.losses}`;
  ui.losses.textContent = money(session.accumulatedLossCents);
  const active = session.status === "active";
  const pendingWager = Boolean(session.pendingActualWager);
  ui.prepare.disabled = !active || pendingWager || busy;
  ui.manualWager.disabled = !active || pendingWager || Boolean(playerStopReason(session)) || busy;
  ui.newTable.disabled = pendingWager || busy;
  ui.switchTable.disabled = pendingWager || busy;
  ui.handover.disabled = !active || pendingWager || busy;
  ui.undo.disabled = !active || pendingWager || !player.observations.some((entry) => entry.sessionId === session.id && !entry.voided) || busy;
  ui.newSession.disabled = pendingWager || busy;
  ui.endSession.disabled = !active || pendingWager || busy;
  ui.gap.disabled = !active || pendingWager || busy;
  ui.recordOutcome.disabled = selectedNumber === null || !active || session.wagerStatus === "awaiting-player" || busy;
  ui.board.querySelectorAll("button").forEach((button) => { button.disabled = !active || busy; });
  ui.wagerState.textContent = !active ? "Session ended. Start a new session to continue recording." : pendingWager
    ? `Confirmed ${money(session.pendingActualWager.totalStakeCents)} on ${session.pendingActualWager.chosen.map((street) => `street ${street + 1}`).join(", ")}. Enter the observed result to settle this wager.`
    : session.wagerStatus === "awaiting-player"
      ? "Choose Confirm BRI wager or Record no bet before entering the winning number."
      : "No confirmed wager. Only actual bets change your bankroll.";
  renderRecommendation();
  ui.confirmRecommendation.disabled ||= !active;
  ui.noBet.disabled ||= !active;
  renderIntelligence();
  renderHistory();
}

async function loadTable(selectedTable){
  table = selectedTable;
  const sessionSettings = table.settings;
  session = await store.startSession(table.id, sessionSettings);
  player = await PlayerSession.create({store, table, session});
  if (session.status === "active" && player.observations.length && !session.pendingActualWager){
    const continuous = window.confirm("Resume this same physical table: have you observed every spin since your last entry? Cancel records an unknown observation gap.");
    if (!continuous) await player.markGap({missingSpins: null, note: "Resume: continuity not confirmed"});
  }
  if (session.status === "active" && !player.session.pendingActualWager && !player.session.pendingForecast) await player.prepareRecommendation();
  session = await store.getSession(session.id);
  tableEvents = await store.listEvents(table.id);
  selectedNumber = null;
  ui.selectedNumber.textContent = "—";
  render();
}

async function refreshTables(activeId = table?.id){
  const tables = await store.listTables();
  const fragment = document.createDocumentFragment();
  for (const item of tables){
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.name;
    fragment.append(option);
  }
  ui.tableSelect.replaceChildren(fragment);
  if (!tables.length){
    table = null;
    session = null;
    player = null;
    ui.workspace.hidden = true;
    ui.setupPanel.hidden = false;
    return;
  }
  const active = tables.find((item) => item.id === activeId) || await store.getActiveTable();
  if (!active) throw new Error("No active physical table is recorded. Explicitly select a table; no replacement has been chosen.");
  ui.tableSelect.value = active.id;
  await loadTable(active);
}

function readSettings(form){
  const fields = form.elements;
  const startingBankrollCents = toMinorUnits(Number(fields.bankroll.value));
  const unitCents = toMinorUnits(Number(fields.unit.value));
  const maxStakeCents = toMinorUnits(Number(fields.maxStake.value || 0));
  const stopLossCents = toMinorUnits(Number(fields.stopLoss.value || 0));
  const takeProfitCents = toMinorUnits(Number(fields.takeProfit.value || 0));
  if (startingBankrollCents < 1 || unitCents < 1) throw new RangeError("Bankroll and unit stake must each be at least £0.01.");
  if (maxStakeCents < 0 || stopLossCents < 0) throw new RangeError("Limits cannot be negative.");
  return {
    startingBankrollCents,
    unitCents,
    maxStakeCents,
    maxExposureCents: 0,
    tableMaxStakeCents: 0,
    stopLossCents,
    takeProfitCents,
    progressionMode: fields.progression.value,
    candidateCount: 3,
    sustainabilityHorizon: 3,
    minimumModelEvaluations: 25,
    maxSteps: Number(fields.maxSteps.value),
  };
}

function openCorrection(record){
  const option = document.createElement("option");
  option.value = record.id;
  option.textContent = `Spin ${record.sequence}: ${record.effectiveOutcome}`;
  ui.correctionObservation.replaceChildren(option);
  ui.correctionOutcome.value = String(record.effectiveOutcome);
  ui.correctionDialog.showModal();
}

async function perform(action){
  if (busy) return;
  busy = true;
  render();
  try {
    await action();
    if (table) tableEvents = await store.listEvents(table.id);
  } catch (error) {
    showMessage(error.message || "Player Mode could not complete that action.");
    ui.entryStatus.textContent = error.message;
  } finally {
    busy = false;
    if (player?.session.id === session?.id) session = player.session;
    render();
  }
}

function openTableForm(newSession = false){
  creatingSession = newSession;
  $("tableDialogTitle").textContent = newSession ? "New playing session" : "Create table";
  for (const name of ["name", "venue", "observer", "dealer"]){
    ui.tableForm.elements[name].disabled = newSession;
    ui.tableForm.elements[name].value = newSession ? table[name] || "" : "";
  }
  if (newSession){
    for (const [name, key] of Object.entries({bankroll: "startingBankrollCents", unit: "unitCents", maxStake: "maxStakeCents", stopLoss: "stopLossCents", takeProfit: "takeProfitCents"})){
      ui.tableForm.elements[name].value = (session.settings[key] || 0) / 100;
    }
    ui.tableForm.elements.progression.value = session.settings.progressionMode;
    ui.tableForm.elements.maxSteps.value = session.settings.maxSteps;
  }
  ui.tableDialog.showModal();
}
ui.emptyCreate.addEventListener("click", () => openTableForm());
ui.newTable.addEventListener("click", () => {
  if (!window.confirm("Create and switch to a different physical table? Existing history is retained.")) return;
  openTableForm();
});
ui.tableForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (event.submitter?.value === "cancel"){
    ui.tableDialog.close();
    return;
  }
  perform(async () => {
    const settings = readSettings(ui.tableForm);
    const fields = ui.tableForm.elements;
    if (session?.pendingActualWager) throw new Error("Settle the confirmed wager before changing table or session.");
    if (creatingSession){
      session = await store.startSession(table.id, settings, {newSession: true});
      player = await PlayerSession.create({store, table, session});
      await player.prepareRecommendation();
      session = player.session;
      ui.tableDialog.close();
      selectedNumber = null;
      ui.selectedNumber.textContent = "—";
      return;
    }
    const created = await store.createTable({
      name: fields.name.value,
      venue: fields.venue.value,
      observer: fields.observer.value,
      dealer: fields.dealer.value,
      settings,
    });
    ui.tableDialog.close();
    ui.tableForm.reset();
    ui.tableForm.elements.bankroll.value = "100";
    ui.tableForm.elements.unit.value = "0.20";
    ui.tableForm.elements.maxStake.value = "5";
    ui.tableForm.elements.stopLoss.value = "25";
    await refreshTables(created.id);
  });
});
ui.switchTable.addEventListener("click", () => perform(async () => {
  if (ui.tableSelect.value === table.id) throw new Error("Choose a different physical table first.");
  if (session.pendingActualWager) throw new Error("Settle the confirmed wager before switching tables.");
  if (!window.confirm("Switch physical tables? Separate histories will be retained and no results will be transferred.")){
    ui.tableSelect.value = table.id;
    return;
  }
  if (session.status === "active") await player.markGap({note: "Left table"});
  const selected = await store.setActiveTable(ui.tableSelect.value);
  await loadTable(selected);
}));
ui.newSession.addEventListener("click", () => {
  if (!window.confirm("Start a new session with a fresh bankroll? The previous session will remain in this table's history.")) return;
  openTableForm(true);
});
ui.endSession.addEventListener("click", () => perform(async () => {
  await store.endSession(session.id, session.revision || 0);
  session = await store.getSession(session.id);
  player.session = session;
}));
ui.prepare.addEventListener("click", () => perform(async () => {
  await player.prepareRecommendation();
  session = await store.getSession(session.id);
}));
ui.confirmRecommendation.addEventListener("click", () => perform(async () => {
  await player.confirmRecommendation();
  session = await store.getSession(session.id);
}));
ui.noBet.addEventListener("click", () => perform(async () => {
  await player.confirmNoBet();
  session = await store.getSession(session.id);
}));
ui.manualWager.addEventListener("click", () => {
  updateManualTotal();
  ui.wagerDialog.showModal();
});
ui.wagerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (event.submitter?.value === "cancel"){
    ui.wagerDialog.close();
    return;
  }
  perform(async () => {
    const streets = [...ui.wagerForm.querySelectorAll('input[name="street"]:checked')].map((input) => Number(input.value));
    const stakeCents = toMinorUnits(Number(ui.wagerForm.elements.stake.value));
    await player.confirmManualStreetWager(streets, stakeCents);
    ui.wagerDialog.close();
    ui.wagerForm.reset();
    updateManualTotal();
    session = await store.getSession(session.id);
  });
});
ui.recordOutcome.addEventListener("click", () => {
  if (selectedNumber === null) return;
  const outcome = selectedNumber;
  perform(async () => {
    const result = await player.recordOutcome(outcome);
    selectedNumber = null;
    ui.selectedNumber.textContent = "—";
    ui.entryStatus.textContent = result.evaluation.settlement
      ? `Recorded ${outcome}. Actual wager ${result.evaluation.settlement.hit ? "won" : "lost"}; net ${money(result.evaluation.settlement.netChangeCents)}.`
      : `Recorded ${outcome} as an observed result. No wager was settled.`;
    if (result.record.trustStatus === "quarantined") ui.entryStatus.textContent += " Cadence warning: quarantined locally and excluded from BRI learning. Browser checks are not proof of human entry.";
    await player.prepareRecommendation();
    session = await store.getSession(session.id);
  });
});
ui.gap.addEventListener("click", () => {
  if (!window.confirm("Mark that one or more table spins were not observed? The next result will start after an explicit gap.")) return;
  const missingText = window.prompt("How many results were missed? Leave blank if unknown.", "");
  if (missingText === null) return;
  const missingSpins = missingText.trim() ? Number(missingText) : null;
  if (missingSpins !== null && (!Number.isSafeInteger(missingSpins) || missingSpins < 0)){
    showMessage("Enter a whole number of missed results, or leave the field blank if unknown.");
    return;
  }
  perform(async () => {
    await player.markGap({missingSpins, note: "Unobserved table spins"});
    await player.prepareRecommendation();
    ui.entryStatus.textContent = "Observation gap recorded. The next entered result will be marked as following a gap.";
    session = await store.getSession(session.id);
  });
});
ui.correctionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (event.submitter?.value === "cancel"){
    ui.correctionDialog.close();
    return;
  }
  perform(async () => {
    await player.correctOutcome(ui.correctionObservation.value, Number(ui.correctionOutcome.value), ui.correctionForm.elements.reason.value);
    if (player.session.status === "active") await player.prepareRecommendation();
    ui.correctionDialog.close();
    session = await store.getSession(session.id);
    ui.entryStatus.textContent = "Correction appended. Forecast history and actual-wager accounting were rebuilt.";
  });
});
ui.export.addEventListener("click", () => perform(async () => {
  const history = await player.exportHistory();
  const blob = new Blob([JSON.stringify(history, null, 2)], {type: "application/json"});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `bank-roll-${table.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-history.json`;
  link.click();
  URL.revokeObjectURL(url);
}));
ui.undo.addEventListener("click", () => {
  if (!window.confirm("Undo the last result? Its original entry is retained. Any actual wager is reopened for its correct result.")) return;
  perform(async () => {
    await player.undoLastOutcome();
    if (!player.session.pendingActualWager) await player.prepareRecommendation();
    session = player.session;
  });
});
ui.handover.addEventListener("click", () => {
  const observer = window.prompt("New observer alias (avoid identifying personal information):");
  if (!observer?.trim()) return;
  perform(async () => {
    await player.markGap({note: "Observer handover: continuity uncertain"});
    const event = await store.recordTableEvent(table.id, session.id, "observer-handover", {observer: observer.trim().slice(0, 80), trust: "unverified"});
    await player.prepareRecommendation();
    session = player.session;
    ui.entryStatus.textContent = `Observer change recorded; continuity reset. This does not verify the new observer.${event.integrityFlags.length ? " Frequent observer changes flagged for review." : ""}`;
  });
});

buildNumberPad();
buildStreetPicker();
buildOutcomeOptions(ui.correctionOutcome);
refreshTables().catch((error) => {
  ui.setupPanel.hidden = false;
  ui.setupPanel.querySelector("h2").textContent = "Local storage unavailable";
  ui.setupPanel.querySelector("p:not(.eyebrow)").textContent = error.message;
  ui.emptyCreate.disabled = true;
});
