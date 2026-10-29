import {mulberry32, xfnv1a} from "../core/random.js";
import {getWheelPosition, isRed, WHEEL_ORDER} from "../core/roulette.js";
import {StreetPredictionEngine} from "../intelligence/prediction-engine.js";
import {LiveSessionEngine} from "../simulation/live-engine.js";
import {AutonomousSessionEngine} from "../simulation/autonomous-session-engine.js";
import {bindSimulationControls} from "./controls.js";
import {RouletteBoard} from "./roulette-board.js";
import {computeSessionStatistics} from "../observation/statistics.js";
import {drawHistogram, drawLineChart, drawMiniChart} from "./charts.js";
import {ResearchClient, resolveTrustedApiBase} from "../storage/research-client.js";
import {evaluateDistributionShift} from "../intelligence/integrity/integrity-monitor.js";
import {runFalseEntryChallenge} from "../intelligence/integrity/false-entry-challenge.js";
import {recoverCorrectedTable} from "../intelligence/rebuild.js";
import {decideNextAction} from "../strategies/decision-engine.js";
import {toMinorUnits} from "../core/mathematics.js";
import {BriCompanion} from "../companion/companion.js";
import {STREET_MODEL_IDS} from "../intelligence/forecast-models.js";
import {ResearchEventStream} from "../intelligence/research-events.js";
import {createResearchSnapshot} from "../intelligence/research-snapshot.js";
import {ResearchPanel} from "./research-panel.js";
import {TableProfileStore} from "../storage/table-profile-store.js";

// Formatting
function money(n){ return "£" + n.toFixed(2); }
function clamp(n, lo, hi){ return Math.max(lo, Math.min(hi, n)); }

/* ========================= UI ========================= */

const $ = (id)=>document.getElementById(id);

const ui = {
  bankroll: $("bankroll"),
  unit: $("unit"),
  sessions: $("sessions"),
  maxSpins: $("maxSpins"),
  simulationMode: $("simulationMode"),
  betType: $("betType"),
  coldThreshold: $("coldThreshold"),
  maxStreets: $("maxStreets"),
  progression: $("progression"),
  maxSteps: $("maxSteps"),
  stopLoss: $("stopLoss"),
  takeProfit: $("takeProfit"),
  seed: $("seed"),
  briApiBase: $("briApiBase"),
  briToken: $("briToken"),
  briEnabled: $("briEnabled"),
  briShare: $("briShare"),
  companionMode: $("companionMode"),
  companionVoice: $("companionVoice"),
  btnBriConnect: $("btnBriConnect"),
  briConnectionStatus: $("briConnectionStatus"),

  btnRunStop: $("btnRunStop"),
  runStopIcon: $("runStopIcon"),
  runStopText: $("runStopText"),
  btnReset: $("btnReset"),
  btnSpeed: $("btnSpeed"),
  speedLabel: $("speedLabel"),
  btnExportCsv: $("btnExportCsv"),
  btnConfig: $("btnConfig"),
  closeConfig: $("closeConfig"),
  configOverlay: $("configOverlay"),
  researchTableName: $("researchTableName"),
  researchTableContinuity: $("researchTableContinuity"),
  btnSwitchResearchTable: $("btnSwitchResearchTable"),
  tableSwitchDialog: $("tableSwitchDialog"),
  tableSwitchForm: $("tableSwitchForm"),
  tableSwitchTarget: $("tableSwitchTarget"),
  tableSwitchNewFields: $("tableSwitchNewFields"),
  tableSwitchName: $("tableSwitchName"),
  tableSwitchCohort: $("tableSwitchCohort"),
  tableSwitchStatus: $("tableSwitchStatus"),
  btnCancelTableSwitch: $("btnCancelTableSwitch"),
  btnConfirmTableSwitch: $("btnConfirmTableSwitch"),

  pillStatus: $("pillStatus"),

  livePerformance: $("livePerformance"),
  rouletteWheel: $("rouletteWheel"),
  wheelNumber: $("wheelNumber"),
  liveSession: $("liveSession"),
  liveSpin: $("liveSpin"),
  liveBankroll: $("liveBankroll"),
  streetGrid: $("streetGrid"),
  liveSessionPL: $("liveSessionPL"),
  livePL: $("livePL"),
  liveWinRate: $("liveWinRate"),
  miniChart: $("miniChart"),

  kpiTotalPL: $("kpiTotalPL"),
  kpiTotalPLSub: $("kpiTotalPLSub"),
  kpiAvgFinal: $("kpiAvgFinal"),
  kpiMedianFinal: $("kpiMedianFinal"),
  kpiWinRate: $("kpiWinRate"),
  kpiWins: $("kpiWins"),
  kpiWorstBest: $("kpiWorstBest"),
  kpiStdDev: $("kpiStdDev"),

  tbody: $("tbody"),
  statusText: $("statusText"),
  progressFill: $("progressFill"),

  chartLine: $("chartLine"),
  chartHist: $("chartHist"),

  streetControls: $("streetControls"),
};

const predictionUI = {
  maturity: $("predictionMaturity"),
  pick: $("predictionPick"),
  estimate: $("predictionEstimate"),
  model: $("predictionModel"),
  accuracy: $("predictionAccuracy"),
  baseline: $("predictionBaseline"),
  companion: $("companionMessage"),
  decision: $("briDecisionStatus"),
  integrity: $("integrityStatus"),
  btnFalseEntryChallenge: $("btnFalseEntryChallenge"),
  falseEntryChallengeStatus: $("falseEntryChallengeStatus"),
  btnLoadIntegrityHistory: $("btnLoadIntegrityHistory"),
  correctionEvent: $("briCorrectionEvent"),
  correctedOutcome: $("briCorrectedOutcome"),
  correctionReason: $("briCorrectionReason"),
  btnSubmitCorrection: $("btnSubmitCorrection"),
  correctionStatus: $("briCorrectionStatus"),
};

let running = false;
let simulationControls = null;
let stopRequested = false;
let lastResults = [];
let simulationSpeed = 1;
const speedOptions = [1, 2, 3, 5, 10];
let wheelRotation = 0;
let ballRotation = 0;
let lastSpinWin = null;
let runState = null;
let currentRngState = null;
let lastIntegrityAnnouncement = 0;
let predictionEngine = new StreetPredictionEngine();
const companion = new BriCompanion({mode: "companion", speechSynthesis: globalThis.speechSynthesis || null});
const researchEvents = new ResearchEventStream();
const researchPanel = new ResearchPanel($("researchIntelligence"), researchEvents);
let researchDatasetId = newResearchId();
let activeResearchTableId = null;
let lastDecisionAction = null;
let sequenceLossCents = 0;
const rouletteBoard = new RouletteBoard(ui.streetGrid, {isRed, streetOf, fromMinorUnits: (cents) => cents / 100});

function setCompanionMessage(message){
  if (message) predictionUI.companion.textContent = message;
}

function evidenceIsWeak(){
  const performance = predictionEngine.modelPerformance;
  const uniform = performance.find((model) => model.modelVersion === STREET_MODEL_IDS.uniform);
  const alternatives = performance.filter((model) => model.modelVersion !== STREET_MODEL_IDS.uniform && model.total >= 25);
  if (!uniform || uniform.total < 25 || alternatives.length === 0) return true;
  return Math.min(...alternatives.map((model) => model.meanBrier)) >= uniform.meanBrier;
}

function renderDecisionStatus(forecast, prepared, liveSession, cfg){
  if (!prepared){
    predictionUI.decision.textContent = "-";
    return;
  }
  if (cfg.simulationMode === "bri-autonomous"){
    const decision = prepared.decision;
    if (!decision){
      predictionUI.decision.textContent = "OBSERVE · gathering evidence";
      predictionUI.decision.title = "No forecast is available yet; BRI is observing.";
      return;
    }
    predictionUI.decision.textContent = `${decision.action.toUpperCase()} · ${decision.selected.financials ? money(decision.selected.financials.totalStakeCents / 100) : "observe"}`;
    predictionUI.decision.title = decision.reasons.join(" ");
    if (decision.action !== lastDecisionAction){
      setCompanionMessage(companion.onDecision(decision));
      lastDecisionAction = decision.action;
    }
    return;
  }
  if (!forecast){
    predictionUI.decision.textContent = "-";
    return;
  }
  try {
    const selectedModel = forecast.candidateModels.find((model) => model.modelVersion === forecast.modelVersion) || forecast.candidateModels[0];
    const probabilities = [...selectedModel.probabilities];
    const candidateStreets = probabilities
      .slice(0, 12)
      .map((probability, street) => ({street, probability}))
      .sort((left, right) => right.probability - left.probability || left.street - right.street)
      .slice(0, 3)
      .map((entry) => entry.street);
    // The decision is evaluated on the pre-stake bankroll, before the wager.
    const stakeAlreadyPlaced = prepared.wager ? prepared.wager.totalStakeCents : 0;
    const decision = decideNextAction({
      bankrollCents: liveSession.state.bankrollCents + stakeAlreadyPlaced,
      startingBankrollCents: liveSession.state.startingBankrollCents,
      accumulatedLossCents: sequenceLossCents,
      progressionStep: liveSession.state.progressionStep,
      progressionMode: cfg.progression,
      unitCents: toMinorUnits(cfg.unit),
      probabilities,
      currentStreets: prepared.wager?.chosen ?? [],
      candidateStreets,
      limits: {
        stopLossCents: cfg.stopLoss > 0 ? toMinorUnits(cfg.stopLoss) : 0,
        maxSteps: cfg.maxSteps,
      },
      evidenceWeak: evidenceIsWeak(),
      observationCount: predictionEngine.observationCount,
      modelVersion: forecast.modelVersion,
    });
    predictionUI.decision.textContent = `${decision.action.toUpperCase()} · ${decision.selected.financials ? money(decision.selected.financials.totalStakeCents / 100) : "observe"}`;
    predictionUI.decision.title = decision.reasons.join(" ");
    if (decision.action !== lastDecisionAction){
      setCompanionMessage(companion.onDecision(decision));
      lastDecisionAction = decision.action;
    }
  } catch {
    predictionUI.decision.textContent = "-";
  }
}

function renderPredictionMonitor(){
  const observed = predictionEngine.observationCount;
  const performance = predictionEngine.performance;
  const bestModel = [...predictionEngine.modelPerformance].sort((left, right) => left.meanBrier - right.meanBrier)[0];
  const maturity = Math.min(observed, 100);
  predictionUI.maturity.textContent = `Maturity ${maturity}% · ${observed} observed`;
  predictionUI.baseline.textContent = `${(3 / 37 * 100).toFixed(1)}%`;

  const forecast = predictionEngine.forecasts.at(-1);
  if (forecast){
    predictionUI.pick.textContent = forecast.modelVersion === "uniform-v1"
      ? `No street preference · spin ${forecast.spinNumber}`
      : `Street ${forecast.street + 1} · spin ${forecast.spinNumber}`;
    predictionUI.estimate.textContent = `${(forecast.probability * 100).toFixed(1)}% · ${forecast.streetCount}/${forecast.windowSize}`;
    const modelEvidence = predictionEngine.modelPerformance.find((model) => model.modelVersion === forecast.modelVersion);
    predictionUI.model.textContent = modelEvidence
      ? `${forecast.modelVersion} · Brier ${modelEvidence.meanBrier.toFixed(3)} (${modelEvidence.total})`
      : forecast.modelVersion;
  } else {
    predictionUI.pick.textContent = observed < 10 ? "Gathering observations" : "Awaiting next forecast";
    predictionUI.estimate.textContent = "-";
    predictionUI.model.textContent = bestModel
      ? `${bestModel.modelVersion} · Brier ${bestModel.meanBrier.toFixed(3)} (${bestModel.total})`
      : "Uniform baseline";
  }

  if (performance.total){
    predictionUI.accuracy.textContent = `${performance.successful} / ${performance.total} (${(performance.accuracy * 100).toFixed(1)}%)`;
  } else {
    predictionUI.accuracy.textContent = "0 / 0 scored";
  }
}

const BRI_PREFERENCES_KEY = "bank-roll-bri-preferences";
const BRI_TOKEN_KEY = "bank-roll-bri-player-token";
const TABLE_RESEARCH_MEMORY_KEY = "bank-roll-bri-table-research-memory";
const INTEGRITY_CHALLENGE_KEY = "bank-roll-integrity-challenges";
const BRI_CURRENT_SESSION_KEY = "bank-roll-bri-current-session";
const correctionEvents = new Map();
const tableProfiles = new TableProfileStore();
let activeTableProfile = null;
let explicitLocalTableSelection = false;
let observationsSinceLocalCheckpoint = 0;

function newResearchId(){
  return crypto.randomUUID();
}

function readTableResearchMemory(){
  try {
    const saved = JSON.parse(localStorage.getItem(TABLE_RESEARCH_MEMORY_KEY) || "{}");
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  } catch {
    return {};
  }
}

function saveActiveTableResearchMemory(){
  if (!activeTableProfile) return;
  try {
    const saved = readTableResearchMemory();
    saved[activeTableProfile.id] = {
      version: 1,
      snapshot: predictionEngine.snapshot(),
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(TABLE_RESEARCH_MEMORY_KEY, JSON.stringify(saved));
  } catch {
    ui.briConnectionStatus.textContent = "Local table checkpoint unavailable · Existing browser data was not changed";
  }
}

function renderActiveTable(){
  if (!activeTableProfile){
    ui.researchTableName.textContent = "No table selected";
    ui.researchTableContinuity.textContent = "Select a table profile to continue this dataset.";
    return;
  }
  ui.researchTableName.textContent = activeTableProfile.name;
  const count = predictionEngine.observationCount;
  const lastResult = predictionEngine.tracker.history.at(-1);
  const tableType = activeTableProfile.tableType === "simulated" ? "Simulation" : activeTableProfile.tableType;
  const lastRecorded = lastResult === undefined ? "No observations yet" : `${count.toLocaleString()} outcomes in this browser dataset`;
  ui.researchTableContinuity.textContent = `${tableType} · Table ID ${activeTableProfile.id} · ${lastRecorded}. Each run creates a separate session under this table.`;
}

function activateResearchTable(profile, {saveCurrent = true} = {}){
  if (!profile || typeof profile.id !== "string") throw new TypeError("A saved table profile is required.");
  if (activeTableProfile?.id === profile.id){
    activeTableProfile = profile;
    renderActiveTable();
    return;
  }
  if (saveCurrent) saveActiveTableResearchMemory();
  activeTableProfile = {...profile};
  activeResearchTableId = profile.id;
  researchDatasetId = profile.id;
  predictionEngine = new StreetPredictionEngine();
  const memory = readTableResearchMemory()[profile.id];
  if (memory?.version === 1 && memory.snapshot){
    try {
      predictionEngine.restore(memory.snapshot);
    } catch {
      ui.briConnectionStatus.textContent = "Saved table checkpoint is incompatible · Starting with its preserved event history";
    }
  }
  researchEvents.reset();
  if (predictionEngine.observationCount){
    researchEvents.publishSnapshot(createResearchSnapshot(predictionEngine, {
      datasetId: profile.id,
      dataOrigin: "synthetic",
      outcome: predictionEngine.tracker.history.at(-1),
      updatedAt: null,
    }));
  }
  sequenceLossCents = 0;
  lastDecisionAction = null;
  renderPredictionMonitor();
  renderActiveTable();
}

async function loadRemoteTableMemory(client, profile){
  const savedState = await client.getModelState(profile.id, "synthetic");
  if (savedState.state){
    predictionEngine = new StreetPredictionEngine().restore(savedState.state);
    researchDatasetId = profile.id;
    researchEvents.reset();
    researchEvents.publishSnapshot(createResearchSnapshot(predictionEngine, {
      datasetId: profile.id,
      dataOrigin: "synthetic",
      outcome: predictionEngine.tracker.history.at(-1),
      updatedAt: null,
    }));
    saveActiveTableResearchMemory();
  } else if (savedState.observation_count > 0){
    throw new Error("Persistent observations exist without a compatible model checkpoint.");
  } else if (predictionEngine.observationCount > 0){
    throw new Error("This table has browser-only research that is not present on the server. Keep server memory disabled for this profile or choose a separate table; historical replay is not implemented yet.");
  }
  renderPredictionMonitor();
  renderActiveTable();
}

async function syncRemoteTableSelection(client){
  await client.flushOutbox();
  const remote = await client.listTables();
  tableProfiles.syncRemote({tables: remote.tables, activeTableId: null});
  const remoteActive = remote.active_table_id ? tableProfiles.list().find((profile) => profile.id === remote.active_table_id) : null;
  if (remoteActive && !explicitLocalTableSelection){
    const selected = tableProfiles.activate(remoteActive.id);
    activateResearchTable(selected);
    await loadRemoteTableMemory(client, selected);
  } else if (activeTableProfile && remote.tables.some((table) => table.table_id === activeTableProfile.id)){
    await client.setActiveTable(activeTableProfile.id);
    await loadRemoteTableMemory(client, activeTableProfile);
  }
  return remote;
}

function populateTableSwitchDialog(){
  const profiles = tableProfiles.list().filter((profile) => profile.tableType === "simulated");
  const fragment = document.createDocumentFragment();
  const createOption = document.createElement("option");
  createOption.value = "__new__";
  createOption.textContent = "Create a new simulated table";
  fragment.append(createOption);
  for (const profile of profiles){
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = `${profile.name} · ${profile.id.slice(0, 8)}${profile.id === activeTableProfile?.id ? " · active" : ""}`;
    fragment.append(option);
  }
  ui.tableSwitchTarget.replaceChildren(fragment);
  ui.tableSwitchTarget.value = "__new__";
  ui.tableSwitchName.value = `Simulated table ${profiles.length + 1}`;
  ui.tableSwitchCohort.value = "";
  ui.tableSwitchNewFields.hidden = false;
  ui.tableSwitchStatus.textContent = "";
}

function forecastId(sessionId, spinNumber){
  const parts = sessionId.split("-");
  parts[4] = spinNumber.toString(16).padStart(12, "0");
  return parts.join("-");
}

function loadBriPreferences(){
  try {
    const saved = JSON.parse(localStorage.getItem(BRI_PREFERENCES_KEY) || "{}");
    ui.briApiBase.value = saved.apiBase || "server/api/v1/";
    ui.briEnabled.checked = saved.enabled === true;
    ui.briShare.checked = saved.shareConsent === true;
    ui.briToken.value = sessionStorage.getItem(BRI_TOKEN_KEY) || "";
    const companionMode = ["quiet", "companion", "full"].includes(saved.companionMode) ? saved.companionMode : "companion";
    ui.companionMode.value = companionMode;
    companion.setMode(companionMode);
    ui.companionVoice.checked = saved.companionVoice === true;
    companion.setSpeech(ui.companionVoice.checked);
  } catch {
    ui.briApiBase.value = "server/api/v1/";
    ui.briToken.value = "";
  }
}

function saveBriPreferences(){
  try {
    localStorage.setItem(BRI_PREFERENCES_KEY, JSON.stringify({
      apiBase: ui.briApiBase.value.trim(),
      enabled: ui.briEnabled.checked,
      shareConsent: ui.briShare.checked,
      companionMode: ui.companionMode.value,
      companionVoice: ui.companionVoice.checked,
    }));
    if (ui.briToken.value.trim()) sessionStorage.setItem(BRI_TOKEN_KEY, ui.briToken.value.trim());
    else sessionStorage.removeItem(BRI_TOKEN_KEY);
  } catch {
    ui.briConnectionStatus.textContent = "Browser storage unavailable · Re-enter connection details";
  }
}

function createConfiguredResearchClient(){
  if (!ui.briEnabled.checked) return null;
  const token = ui.briToken.value.trim();
  if (!token) throw new Error("Enter a BRI player access token or disable server memory.");
  return new ResearchClient({baseUrl: resolveTrustedApiBase(ui.briApiBase.value.trim()), token});
}

function createResearchClient(token = ui.briToken.value.trim()){
  if (!token) throw new Error("Enter a BRI player access token.");
  return new ResearchClient({baseUrl: resolveTrustedApiBase(ui.briApiBase.value.trim()), token});
}

async function openRemoteSession(client, cfg, sessionId = newResearchId()){
  const tableProfile = activeTableProfile || tableProfiles.ensureActive();
  if (tableProfile.tableType !== "simulated") throw new Error("This live laboratory records synthetic results and requires a simulated table profile.");

  await client.flushOutbox();
  if (predictionEngine.observationCount === 0) await loadRemoteTableMemory(client, tableProfile);
  await client.setResearchConsent(cfg.briShare);
  await client.createSession({
    table_id: tableProfile.id,
    session_id: sessionId,
    table_name: tableProfile.name,
    table_type: tableProfile.tableType,
    shared_cohort_id: tableProfile.sharedCohortId || null,
    source: "simulation",
    data_origin: "synthetic",
    share_consent: cfg.briShare,
  });
  localStorage.setItem(BRI_CURRENT_SESSION_KEY, JSON.stringify({sessionId, tableId: tableProfile.id}));
  activeTableProfile = tableProfile;
  renderActiveTable();
  return {client, tableId: tableProfile.id, sessionId, tableName: tableProfile.name, sharedCohortId: tableProfile.sharedCohortId || null, shareConsent: cfg.briShare};
}

async function persistForecastRecord(record, remoteSession, sessionSpinNumber){
  renderPredictionMonitor();
  if (record){
    if (record.modelVersion === "uniform-v1"){
      setCompanionMessage(companion.mode === "quiet" ? null : "Nothing convincing yet. I'm watching.");
    } else {
      setCompanionMessage(companion.onForecast({street: record.street, probability: record.probability, modelVersion: record.modelVersion}));
    }
    if (remoteSession){
      const selectedModel = record.candidateModels.find((model) => model.modelVersion === record.modelVersion);
      try {
        const saveResult = await remoteSession.client.recordForecast({
          prediction_id: forecastId(remoteSession.sessionId, sessionSpinNumber),
          session_id: remoteSession.sessionId,
          spin_number: sessionSpinNumber,
          observation_count: record.observationCount,
          selected_street: record.street,
          probabilities: selectedModel.probabilities,
          candidate_models: record.candidateModels.map((model) => ({
            model_version: model.modelVersion,
            probabilities: model.probabilities,
          })),
          model_version: record.modelVersion,
          parameters: {window_size: 100, minimum_observations: 10},
        });
        if (saveResult.queued) ui.briConnectionStatus.textContent = "Forecast queued locally · Sync will retry before its outcome";
      } catch (error) {
        predictionEngine.cancelPendingForecast();
        renderPredictionMonitor();
        throw error;
      }
    }
  }
  return record;
}

async function prepareNextPrediction(remoteSession, sessionSpinNumber){
  return persistForecastRecord(predictionEngine.forecastNext(), remoteSession, sessionSpinNumber);
}

async function persistAutonomousDecision(prepared, remoteSession){
  if (!remoteSession) return;
  const decision = prepared.decision || {
    version: 1,
    action: "observe",
    observationCount: predictionEngine.observationCount,
    reasons: ["No forecast is available yet; BRI is observing."],
    decidedAt: new Date().toISOString(),
  };
  const result = await remoteSession.client.recordDecision({
    decision_id: forecastId(remoteSession.sessionId, prepared.spinNumber),
    session_id: remoteSession.sessionId,
    spin_number: prepared.spinNumber,
    action: decision.action,
    model_version: decision.modelVersion || prepared.forecast?.modelVersion || null,
    snapshot: decision,
  });
  if (result.queued) ui.briConnectionStatus.textContent = "Decision queued locally · Sync will retry before its outcome";
}

async function recordObservedOutcome(outcome, remoteSession, sessionSpinNumber, priorEvaluation = undefined, prepared = null){
  const evaluation = priorEvaluation === undefined ? predictionEngine.observe(outcome) : priorEvaluation;
  if (evaluation){
    setCompanionMessage(companion.onEvaluation({
      hit: evaluation.hit,
      actual: outcome,
      forecast: {street: evaluation.forecast.street},
      performance: predictionEngine.performance,
    }));
  }

  const observed = predictionEngine.observationCount;
  const integrityAssessment = evaluateDistributionShift(predictionEngine.tracker);
  if (!integrityAssessment){
    predictionUI.integrity.textContent = `Building baseline · ${observed}/600`;
  } else if (integrityAssessment.classification === "statistical_anomaly_candidate"){
    predictionUI.integrity.textContent = `Statistical candidate · χ² ${integrityAssessment.chiSquare.toFixed(1)}`;
    if (observed - lastIntegrityAnnouncement >= 100){
      setCompanionMessage(companion.mode === "quiet" ? null : "That's unusual for this table's history. It's a candidate, not proof of a bad entry.");
      lastIntegrityAnnouncement = observed;
    }
  } else {
    predictionUI.integrity.textContent = "No shift candidate";
  }
  if (observed === 10 || observed === 50 || observed === 100){
    setCompanionMessage(companion.onMilestone(observed));
  }
  renderPredictionMonitor();
  const researchSnapshot = createResearchSnapshot(predictionEngine, {
    datasetId: researchDatasetId,
    dataOrigin: "synthetic",
    outcome,
    evaluation,
    integrity: integrityAssessment,
    strategy: prepared,
    updatedAt: new Date().toISOString(),
  });
  researchEvents.publishObservation(researchSnapshot);
  observationsSinceLocalCheckpoint++;
  if (observationsSinceLocalCheckpoint >= 250){
    observationsSinceLocalCheckpoint = 0;
    saveActiveTableResearchMemory();
  }
  renderActiveTable();
  if (remoteSession){
    const result = await remoteSession.client.appendObservations({
      table_id: remoteSession.tableId,
      session_id: remoteSession.sessionId,
      table_name: remoteSession.tableName,
      table_type: "simulated",
      source: "simulation",
      data_origin: "synthetic",
      share_consent: remoteSession.shareConsent,
      outcomes: [{
        event_id: newResearchId(),
        spin_number: sessionSpinNumber,
        outcome,
        occurred_at: new Date().toISOString(),
        integrity_assessment: integrityAssessment?.classification === "statistical_anomaly_candidate" ? integrityAssessment : null,
      }],
      model_state: predictionEngine.snapshot(),
    });
    if (result.queued){
      ui.briConnectionStatus.textContent = "Outcome queued locally · Sync will retry in order";
    }
  }
}

function setWheelAndBall(wheelDeg, ballDeg){
  wheelRotation = wheelDeg;
  ballRotation = ballDeg;
  ui.rouletteWheel.style.setProperty("--wheel-rot", `${wheelRotation}deg`);
  ui.rouletteWheel.style.setProperty("--ball-rot", `${ballRotation}deg`);
}

function readConfig(){
  const betType = ui.betType.value;
  const simulationMode = ui.simulationMode.value;
  if (simulationMode === "bri-autonomous" && betType !== "streets"){
    throw new Error("BRI Autonomous currently requires the Streets bet strategy.");
  }
  return {
    bankroll: parseFloat(ui.bankroll.value) || 100,
    unit: parseFloat(ui.unit.value) || 0.2,
    sessions: Math.max(1, parseInt(ui.sessions.value, 10)),
    maxSpins: Math.max(1, parseInt(ui.maxSpins.value, 10)),
    simulationMode,
    betType,
    coldThreshold: Math.max(0, parseInt(ui.coldThreshold.value, 10)),
    maxStreets: clamp(parseInt(ui.maxStreets.value, 10), 1, 3),
    progression: ui.progression.value,
    maxSteps: Math.max(1, parseInt(ui.maxSteps.value, 10)),
    stopLoss: Math.max(0, parseFloat(ui.stopLoss.value)),
    takeProfit: Math.max(0, parseFloat(ui.takeProfit.value)),
    seed: ui.seed.value.trim() || String(Date.now()),
    briEnabled: ui.briEnabled.checked,
    briShare: ui.briShare.checked,
  };
}

function setRunningState(on){
  running = on;
  researchPanel.setRunning(on);
  simulationControls?.setRunning(on);
  ui.btnReset.disabled = on;
  ui.btnConfig.disabled = on;
  ui.btnExportCsv.disabled = on || lastResults.length === 0;

  if (on) {
    ui.btnRunStop.classList.remove("primary");
    ui.btnRunStop.classList.add("danger");
    ui.btnRunStop.classList.remove("stopping");
    ui.runStopIcon.textContent = "⏹";
    ui.runStopText.textContent = "Stop";
    ui.configOverlay.classList.remove("active");
  } else {
    ui.btnRunStop.classList.remove("danger");
    ui.btnRunStop.classList.remove("stopping");
    ui.btnRunStop.classList.add("primary");
    ui.runStopIcon.textContent = "▶︎";
    ui.runStopText.textContent = "Run";
  }

  ui.pillStatus.textContent = on ? "Running" : "Ready";
  ui.pillStatus.classList.toggle("active", on);
  ui.livePerformance.classList.toggle("running", on);
}

function clearOutputs(){
  ui.tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><div class="empty-state-icon">*</div><div>Run a simulation to see detailed results</div></div></td></tr>`;
  lastResults = [];
  ui.progressFill.style.width = "0%";

  ui.wheelNumber.textContent = "";
  ui.wheelNumber.className = "wheel-number";
  ui.rouletteWheel.classList.remove("win", "lose");
  ui.rouletteWheel.classList.remove("spinning", "settling");
  setWheelAndBall(0, 0);
  lastSpinWin = null;
  ui.liveSession.textContent = "-";
  ui.liveSpin.textContent = "-";
  ui.liveBankroll.textContent = "-";
  rouletteBoard.reset();
  ui.liveSessionPL.textContent = "-";
  ui.livePL.textContent = "-";
  ui.liveWinRate.textContent = "-";

  ui.kpiTotalPL.textContent = "-";
  ui.kpiTotalPLSub.textContent = "-";
  ui.kpiAvgFinal.textContent = "-";
  ui.kpiMedianFinal.textContent = "-";
  ui.kpiWinRate.textContent = "-";
  ui.kpiWins.textContent = "-";
  ui.kpiWorstBest.textContent = "-";
  ui.kpiStdDev.textContent = "-";

  const miniCtx = ui.miniChart.getContext("2d");
  miniCtx.clearRect(0, 0, ui.miniChart.width, ui.miniChart.height);

  drawLineChart(ui.chartLine, [], 0);
  drawHistogram(ui.chartHist, []);
}

function renderFinalStats(cfg, results){
  const st = computeSessionStatistics(cfg, results);

  const net = st.totalProfitLoss;
  ui.kpiTotalPL.textContent = (net>=0? "+":"") + money(net);
  ui.kpiTotalPL.className = "value " + (net>=0 ? "good" : "bad") + " updating";
  ui.kpiTotalPLSub.textContent = `From ${money(st.totalStartingBankroll)} → ${money(st.totalStartingBankroll + net)}`;
  setTimeout(()=> ui.kpiTotalPL.classList.remove("updating"), 400);

  ui.kpiAvgFinal.textContent = money(st.averageFinal);
  ui.kpiAvgFinal.classList.add("updating");
  ui.kpiMedianFinal.textContent = `Median ${money(st.median)}`;
  setTimeout(()=> ui.kpiAvgFinal.classList.remove("updating"), 400);

  ui.kpiWinRate.textContent = (st.winRate*100).toFixed(1) + "%";
  ui.kpiWinRate.classList.add("updating");
  ui.kpiWins.textContent = `${st.wins} / ${results.length} won`;
  setTimeout(()=> ui.kpiWinRate.classList.remove("updating"), 400);

  ui.kpiWorstBest.textContent = `${money(st.worst)} → ${money(st.best)}`;
  ui.kpiWorstBest.classList.add("updating");
  ui.kpiStdDev.textContent = `σ ${money(st.standardDeviation)}`;
  setTimeout(()=> ui.kpiWorstBest.classList.remove("updating"), 400);

  drawLineChart(ui.chartLine, results.map(r=>r.final), cfg.bankroll);
  drawHistogram(ui.chartHist, results.map(r=>r.final));
}

function appendRow(i, r, cfg){
  if (i === 1) ui.tbody.innerHTML = ""; // Clear empty state

  const tr = document.createElement("tr");
  tr.style.animationDelay = "0s";

  const td1 = document.createElement("td");
  td1.textContent = String(i);
  td1.className = "mono";

  const td2 = document.createElement("td");
  td2.textContent = money(r.final);
  td2.className = "mono";

  const td3 = document.createElement("td");
  td3.textContent = (r.pl>=0?"+":"") + money(r.pl);
  td3.className = "mono " + (r.pl>=0 ? "good" : "bad");

  const td4 = document.createElement("td");
  td4.textContent = String(r.spins);
  td4.className = "mono";

  const td5 = document.createElement("td");
  td5.textContent = r.reason;
  td5.style.color = "var(--muted)";

  tr.append(td1, td2, td3, td4, td5);
  ui.tbody.appendChild(tr);
}

function downloadCSV(cfg, results){
  const header = ["session","final_gbp","pl_gbp","spins","reason","bankroll","unit","progression","max_steps"];
  const rows = [header.join(",")];

  for (let i=0; i<results.length; i++){
    const r = results[i];
    rows.push([
      i+1, r.final.toFixed(2), r.pl.toFixed(2), r.spins, `"${r.reason}"`,
      cfg.bankroll, cfg.unit, cfg.progression, cfg.maxSteps
    ].join(","));
  }

  const blob = new Blob([rows.join("\n")], {type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bank-roll-${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toggleStreetControls(){
  const show = ui.betType.value === "streets";
  ui.streetControls.style.display = show ? "" : "none";
}

function buildWheelGradient(){
  const seg = 360 / 37;
  const stops = [];
  for (let i = 0; i < WHEEL_ORDER.length; i++){
    const n = WHEEL_ORDER[i];
    const color = n === 0 ? "#0b6b42" : (isRed(n) ? "#b0121b" : "#1a1a1a");
    const start = (i * seg).toFixed(4);
    const end = ((i + 1) * seg).toFixed(4);
    stops.push(`${color} ${start}deg ${end}deg`);
  }
  const gradient = `conic-gradient(from -90deg, ${stops.join(", ")})`;
  document.documentElement.style.setProperty("--wheel-gradient", gradient);
}

ui.betType.addEventListener("change", toggleStreetControls);
toggleStreetControls();
rouletteBoard.build();
buildWheelGradient();

/* ========================= PRESETS ========================= */

function presetConservative(){
  ui.bankroll.value = "100";
  ui.unit.value = "0.20";
  ui.sessions.value = "200";
  ui.maxSpins.value = "300";
  ui.betType.value = "streets";
  ui.coldThreshold.value = "28";
  ui.maxStreets.value = "1";
  ui.progression.value = "flat";
  ui.maxSteps.value = "1";
  ui.stopLoss.value = "15";
  ui.takeProfit.value = "20";
  ui.seed.value = "conservative-" + Date.now();
  toggleStreetControls();
}

function presetBalanced(){
  ui.bankroll.value = "100";
  ui.unit.value = "0.20";
  ui.sessions.value = "200";
  ui.maxSpins.value = "250";
  ui.betType.value = "streets";
  ui.coldThreshold.value = "22";
  ui.maxStreets.value = "2";
  ui.progression.value = "linear";
  ui.maxSteps.value = "6";
  ui.stopLoss.value = "25";
  ui.takeProfit.value = "25";
  ui.seed.value = "20260116";
  toggleStreetControls();
}

function presetAggressive(){
  ui.bankroll.value = "100";
  ui.unit.value = "0.20";
  ui.sessions.value = "200";
  ui.maxSpins.value = "200";
  ui.betType.value = "streets";
  ui.coldThreshold.value = "18";
  ui.maxStreets.value = "3";
  ui.progression.value = "martingale";
  ui.maxSteps.value = "5";
  ui.stopLoss.value = "35";
  ui.takeProfit.value = "35";
  ui.seed.value = "aggressive-" + Date.now();
  toggleStreetControls();
}

$("btnPresetConservative").addEventListener("click", presetConservative);
$("btnPresetBalanced").addEventListener("click", presetBalanced);
$("btnPresetAggressive").addEventListener("click", presetAggressive);

/* ========================= RUNNER ========================= */

function sleep(ms){ return new Promise(res => setTimeout(res, ms)); }

async function runSimulationLive(){
  if (running) return;

  stopRequested = false;

  let cfg = readConfig();
  let allResults = [];
  let allFinals = [];
  let totalPL = 0;
  let startSessionNum = 1;
  let totalSessions = cfg.sessions;
  let nextSessionNum = startSessionNum;

  if (runState && runState.paused){
    allResults = runState.allResults;
    allFinals = runState.allFinals;
    totalPL = runState.totalPL;
    totalSessions = runState.totalSessions;
    currentRngState = runState.rngState;
    cfg.sessions = totalSessions;

    if (runState.sessionState){
      if (runState.sessionState.simulationMode){
        cfg.simulationMode = runState.sessionState.simulationMode;
        ui.simulationMode.value = cfg.simulationMode;
        if (cfg.simulationMode === "bri-autonomous"){
          cfg.betType = "streets";
          ui.betType.value = "streets";
        }
      }
      startSessionNum = runState.sessionState.sessionNum;
      nextSessionNum = startSessionNum;
    } else {
      startSessionNum = runState.nextSessionNum;
      nextSessionNum = startSessionNum;
    }
  } else {
    clearOutputs();
    currentRngState = xfnv1a(cfg.seed);
  }

  const rng = mulberry32(currentRngState, (state) => { currentRngState = state; });
  const remoteClient = createConfiguredResearchClient();
  if (remoteClient) await syncRemoteTableSelection(remoteClient);

  setRunningState(true);

  // Base timing constants
  const baseSpinTime = 1800;
  const basePauseTime = 700;
  const baseDelayTime = 250;
  const baseSessionDelay = 400;

  // Helper to get current delay time based on current speed
  const getDelay = (baseTime) => baseTime / simulationSpeed;
  let resumeState = runState && runState.paused ? runState.sessionState : null;
  let activeRemoteSession = null;

  const pauseRun = (sessionNum, liveSession) => {
    runState = {
      paused: true,
      allResults,
      allFinals,
      totalPL,
      nextSessionNum: sessionNum,
      totalSessions,
      rngState: currentRngState,
      sessionState: {
        sessionNum,
        spinNum: liveSession.spins + 1,
        simulationMode: cfg.simulationMode,
        engineState: liveSession.snapshot(),
        remoteSessionId: activeRemoteSession?.sessionId || null,
      },
    };
    lastResults = allResults;
    setRunningState(false);
    ui.btnExportCsv.disabled = lastResults.length === 0;
    ui.statusText.textContent = `Paused at session ${sessionNum} spin ${liveSession.spins}`;
  };

  for (let sessionNum = startSessionNum; sessionNum <= totalSessions; sessionNum++){
    if (stopRequested) break;

    const resumeRemoteId = resumeState?.sessionNum === sessionNum ? resumeState.remoteSessionId : null;
    activeRemoteSession = remoteClient ? await openRemoteSession(remoteClient, cfg, resumeRemoteId || newResearchId()) : null;

    // Update session counter
    ui.liveSession.textContent = `${sessionNum} / ${cfg.sessions}`;
    ui.liveSession.classList.add("updating");
    setTimeout(()=> ui.liveSession.classList.remove("updating"), 300);

    // Run one session with spin-by-spin visualization
  let liveSession = cfg.simulationMode === "bri-autonomous"
    ? new AutonomousSessionEngine(cfg, rng, predictionEngine)
    : new LiveSessionEngine(cfg, rng);
  let sessionStart = cfg.bankroll;
  let bankroll = sessionStart;
  let reason = "max spins";
  let spinStart = 1;

  if (resumeState && resumeState.sessionNum === sessionNum){
    liveSession = cfg.simulationMode === "bri-autonomous"
      ? new AutonomousSessionEngine(cfg, rng, predictionEngine, resumeState.engineState)
      : new LiveSessionEngine(cfg, rng, resumeState.engineState);
    bankroll = liveSession.bankroll;
    reason = liveSession.stopReason || "max spins";
    spinStart = liveSession.spins + 1;
    resumeState = null;
  }
    for (let spinNum = spinStart; spinNum <= cfg.maxSpins; spinNum++){
      if (stopRequested){
          pauseRun(sessionNum, liveSession);
          return;
    }
      if (stopRequested) break;

      // Update spin counter
      ui.liveSpin.textContent = `${spinNum} / ${cfg.maxSpins}`;
      ui.liveSpin.classList.add("updating");
      setTimeout(()=> ui.liveSpin.classList.remove("updating"), 300);

      // Check exit conditions
      const preview = liveSession.previewNextSpin();
      if (preview.action === "stop"){
        const stopped = liveSession.prepareNextSpin();
        reason = stopped.reason;
        bankroll = liveSession.bankroll;
        break;
      }
      let forecast;
      let prepared;
      if (cfg.simulationMode === "bri-autonomous"){
        forecast = preview.forecast;
        if (forecast) await persistForecastRecord(forecast, activeRemoteSession, preview.spinNumber);
        prepared = liveSession.prepareNextSpin();
        await persistAutonomousDecision(prepared, activeRemoteSession);
      } else {
        forecast = await prepareNextPrediction(activeRemoteSession, preview.spinNumber);
        prepared = liveSession.prepareNextSpin();
      }
      const bet = prepared.wager;
      renderDecisionStatus(forecast, prepared, liveSession, cfg);

      if (prepared.action === "stop"){
        reason = prepared.reason;
        bankroll = liveSession.bankroll;
        break;
      }

      if (prepared.action === "observe"){
        const {outcome: n, evaluation} = liveSession.resolveSpin(prepared);
        await recordObservedOutcome(n, activeRemoteSession, prepared.spinNumber, evaluation, prepared);
        rouletteBoard.updateBets(null);
        bankroll = liveSession.bankroll;
        continue;
      }

      // Show bet
      rouletteBoard.updateBets(bet);

      // Prep wheel state
      ui.rouletteWheel.classList.remove("win", "lose");

      // Place stake
      bankroll = liveSession.bankroll;

      // Update bankroll display
      ui.liveBankroll.textContent = money(bankroll);
      ui.liveBankroll.classList.add("updating");
      setTimeout(()=> ui.liveBankroll.classList.remove("updating"), 300);

      // SPIN ANIMATION
      ui.rouletteWheel.classList.remove("settling");
      ui.rouletteWheel.classList.add("spinning");
      ui.wheelNumber.textContent = lastSpinWin === null ? "SPIN" : (lastSpinWin ? "WIN" : "LOSE");
      ui.wheelNumber.className = "wheel-number " + (lastSpinWin === null ? "" : (lastSpinWin ? "good" : "bad"));

      const spinWheel = wheelRotation - 360;
      const spinBall = ballRotation + 1080;
      setWheelAndBall(spinWheel, spinBall);

      await sleep(getDelay(baseSpinTime));

      // Spin result
      const {outcome: n, settlement, evaluation} = liveSession.resolveSpin(prepared);
      await recordObservedOutcome(n, activeRemoteSession, prepared.spinNumber, evaluation, prepared);

      ui.rouletteWheel.classList.remove("spinning");
      ui.rouletteWheel.classList.add("settling");
      ui.wheelNumber.textContent = String(n);
      ui.wheelNumber.classList.add("revealed");
      rouletteBoard.highlightWinningNumber(n);

      // Color the number
      if (n === 0){
        ui.wheelNumber.classList.add("green");
      } else if (isRed(n)){
        ui.wheelNumber.classList.add("red");
      } else {
        ui.wheelNumber.classList.add("black");
      }

      setTimeout(()=> ui.wheelNumber.classList.remove("revealed"), 400);

      const targetAngle = getWheelPosition(n);
      const pocketAngle = targetAngle - 90;
      let settleWheel = wheelRotation - (120 + Math.random() * 60);
      let settleBall = settleWheel + pocketAngle;
      while (settleBall <= ballRotation){
        settleBall += 360;
      }
      setWheelAndBall(settleWheel, settleBall);

      await sleep(getDelay(basePauseTime));

      const win = settlement.hit;
      if (bet){
        if (win) sequenceLossCents = Math.max(0, sequenceLossCents - (settlement.grossReturnCents - bet.totalStakeCents));
        else sequenceLossCents += bet.totalStakeCents;
      }
      bankroll = settlement.bankroll;
      const currentSessionPL = liveSession.profitLossCents / 100;

      // Win/lose indicator
      ui.rouletteWheel.classList.add(win ? "win" : "lose");
      lastSpinWin = win;

      // Update bankroll after win
      ui.liveBankroll.textContent = money(bankroll);
      ui.liveBankroll.classList.add("updating");
      ui.liveBankroll.className = "info-value updating " + (bankroll >= sessionStart ? "good" : "bad");
      setTimeout(()=> ui.liveBankroll.classList.remove("updating"), 300);

      // Update session P/L
      ui.liveSessionPL.textContent = (currentSessionPL >= 0 ? "+" : "") + money(currentSessionPL);
      ui.liveSessionPL.className = "value " + (currentSessionPL >= 0 ? "good" : "bad");

      if (liveSession.stopReason){
        reason = liveSession.stopReason;
        break;
      }

      await sleep(getDelay(baseDelayTime));
    }

    // Session complete
    const sessionResult = liveSession.result;
    if (reason !== "max spins" && sessionResult.reason === "max spins") sessionResult.reason = reason;

    allResults.push(sessionResult);
    allFinals.push(bankroll);
    totalPL += sessionResult.pl;

    // Add to table
    appendRow(sessionNum, sessionResult, cfg);

    // Update total P/L
    ui.livePL.textContent = (totalPL >= 0 ? "+" : "") + money(totalPL);
    ui.livePL.className = "value " + (totalPL >= 0 ? "good" : "bad");

    // Update win rate
    const wins = allResults.filter(r => r.final > cfg.bankroll).length;
    const winRate = wins / allResults.length;
    ui.liveWinRate.textContent = (winRate * 100).toFixed(1) + "%";

    // Update charts and KPIs
    drawMiniChart(ui.miniChart, allFinals, cfg.bankroll);
    renderFinalStats(cfg, allResults);

    // Update progress
    const pct = (sessionNum / cfg.sessions) * 100;
    ui.progressFill.style.width = pct.toFixed(1) + "%";
    ui.statusText.textContent = `Session ${sessionNum} / ${cfg.sessions} complete`;
    nextSessionNum = sessionNum + 1;

    await sleep(getDelay(baseSessionDelay));
  }

    lastResults = allResults;
  setRunningState(false);
  ui.btnExportCsv.disabled = false;

  if (stopRequested){
    runState = {
      paused: true,
      allResults,
      allFinals,
      totalPL,
      nextSessionNum: nextSessionNum,
      totalSessions,
      rngState: currentRngState,
    };
    ui.statusText.textContent = `Stopped at ${allResults.length} sessions`;
  } else {
    runState = null;
    currentRngState = null;
    ui.statusText.textContent = `Completed all ${allResults.length} sessions`;
  }
}

ui.btnExportCsv.addEventListener("click", ()=>{
  const cfg = readConfig();
  if (!lastResults.length) return;
  downloadCSV(cfg, lastResults);
});

function toggleRunStop(){
  if (running) {
    stopRequested = true;
    ui.btnRunStop.classList.add("stopping");
    ui.statusText.textContent = "Pausing...";
  } else {
    startSimulationSafely();
  }
}

async function startSimulationSafely(){
  try {
    await runSimulationLive();
  } catch (error) {
    setRunningState(false);
    ui.briConnectionStatus.textContent = `Storage error · ${error.message}`;
    ui.statusText.textContent = `Simulation stopped: ${error.message}`;
  }
}

loadBriPreferences();
try {
  const activeProfile = tableProfiles.ensureActive();
  activateResearchTable(activeProfile, {saveCurrent: false});
} catch (error) {
  ui.researchTableName.textContent = "Table profile unavailable";
  ui.researchTableContinuity.textContent = error.message;
}
window.addEventListener("pagehide", saveActiveTableResearchMemory);
for (const input of [ui.briApiBase, ui.briEnabled, ui.briShare]){
  input.addEventListener("change", saveBriPreferences);
}
ui.companionMode.addEventListener("change", () => {
  companion.setMode(ui.companionMode.value);
  saveBriPreferences();
});
ui.companionVoice.addEventListener("change", () => {
  companion.setSpeech(ui.companionVoice.checked);
  saveBriPreferences();
});
ui.briToken.addEventListener("change", saveBriPreferences);
ui.btnSwitchResearchTable.addEventListener("click", async () => {
  if (running) return;
  populateTableSwitchDialog();
  if (ui.briEnabled.checked && ui.briToken.value.trim()){
    try {
      const client = createConfiguredResearchClient();
      const remote = await client.listTables();
      tableProfiles.syncRemote({tables: remote.tables, activeTableId: null});
      populateTableSwitchDialog();
    } catch (error) {
      ui.tableSwitchStatus.textContent = `Showing browser-saved tables · Server unavailable: ${error.message}`;
    }
  }
  ui.tableSwitchDialog.showModal();
});
ui.tableSwitchTarget.addEventListener("change", () => {
  const creating = ui.tableSwitchTarget.value === "__new__";
  ui.tableSwitchNewFields.hidden = !creating;
  ui.tableSwitchName.required = creating;
});
ui.btnCancelTableSwitch.addEventListener("click", () => ui.tableSwitchDialog.close());
ui.tableSwitchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  let profile;
  try {
    if (ui.tableSwitchTarget.value === "__new__"){
      profile = tableProfiles.create({
        name: ui.tableSwitchName.value.trim(),
        tableType: "simulated",
        sharedCohortId: ui.tableSwitchCohort.value.trim() || null,
      });
    } else {
      profile = tableProfiles.list().find((candidate) => candidate.id === ui.tableSwitchTarget.value);
      if (!profile || profile.tableType !== "simulated") throw new Error("Choose a saved simulated table or create a new one.");
    }
    if (profile.id === activeTableProfile?.id){
      ui.tableSwitchDialog.close();
      return;
    }
    tableProfiles.activate(profile.id);
    activateResearchTable(profile);
    explicitLocalTableSelection = true;
    runState = null;
    currentRngState = null;
    ui.tableSwitchDialog.close();
    if (ui.briEnabled.checked && ui.briToken.value.trim()){
      try {
        const client = createConfiguredResearchClient();
        const remote = await client.listTables();
        tableProfiles.syncRemote({tables: remote.tables, activeTableId: null});
        if (remote.tables.some((table) => table.table_id === profile.id)){
          await client.setActiveTable(profile.id);
          await loadRemoteTableMemory(client, profile);
        } else {
          await client.createTable(profile);
        }
        ui.briConnectionStatus.textContent = "Active table saved to the account";
      } catch (error) {
        ui.briConnectionStatus.textContent = `Table selected locally · Server selection could not sync: ${error.message}`;
      }
    }
  } catch (error) {
    ui.tableSwitchStatus.textContent = error.message;
  }
});
ui.btnBriConnect.addEventListener("click", async () => {
  saveBriPreferences();
  ui.briConnectionStatus.textContent = "Checking connection...";
  try {
    const client = createResearchClient();
    await client.flushOutbox();
    await client.setResearchConsent(ui.briShare.checked);
    const remote = await syncRemoteTableSelection(client);
    ui.briConnectionStatus.textContent = `Connected · ${remote.tables.length} saved table${remote.tables.length === 1 ? "" : "s"} · Active table retained`;
  } catch (error) {
    ui.briConnectionStatus.textContent = `Connection failed · ${error.message}`;
  }
});
try {
  const savedChallenges = JSON.parse(localStorage.getItem(INTEGRITY_CHALLENGE_KEY) || "[]");
  const lastChallenge = savedChallenges.at(-1);
  if (lastChallenge){
    ui.falseEntryChallengeStatus.textContent = `Last run · TP ${lastChallenge.metrics.truePositives} · FP ${lastChallenge.metrics.falsePositives} · TN ${lastChallenge.metrics.trueNegatives} · FN ${lastChallenge.metrics.falseNegatives} · P ${(lastChallenge.metrics.precision * 100).toFixed(0)}% · R ${(lastChallenge.metrics.recall * 100).toFixed(0)}% · FPR ${(lastChallenge.metrics.falsePositiveRate * 100).toFixed(1)}%`;
  }
} catch {
  ui.falseEntryChallengeStatus.textContent = "Challenge history unavailable";
}
ui.btnFalseEntryChallenge.addEventListener("click", async () => {
  ui.btnFalseEntryChallenge.disabled = true;
  ui.falseEntryChallengeStatus.textContent = "Running isolated synthetic challenge...";
  try {
    const benchmarkSeed = newResearchId();
    const benchmark = runFalseEntryChallenge({seed: benchmarkSeed});
    const report = {
      run_id: newResearchId(),
      benchmark_version: benchmark.benchmark,
      seed: benchmark.seed,
      metrics: benchmark.metrics,
      cases: benchmark.verifiableCases.map(({name, detected}) => ({name, detected})),
      control_records_checked: benchmark.controlRecordsChecked,
      control_false_positive_count: benchmark.controlFalsePositiveCount,
      legitimate_repeated_outcomes_accepted: benchmark.legitimateRepeatedOutcomesAccepted,
      valid_substitution_flagged: benchmark.validSubstitutionClassifiedAsVerifiedError,
      undetectable_cases: benchmark.undetectableCases,
    };
    const history = JSON.parse(localStorage.getItem(INTEGRITY_CHALLENGE_KEY) || "[]");
    history.push(report);
    localStorage.setItem(INTEGRITY_CHALLENGE_KEY, JSON.stringify(history.slice(-20)));
    ui.falseEntryChallengeStatus.textContent = `TP ${report.metrics.truePositives} · FP ${report.metrics.falsePositives} · TN ${report.metrics.trueNegatives} · FN ${report.metrics.falseNegatives} · P ${(report.metrics.precision * 100).toFixed(0)}% · R ${(report.metrics.recall * 100).toFixed(0)}% · FPR ${(report.metrics.falsePositiveRate * 100).toFixed(1)}%`;

    if (ui.briEnabled.checked){
      const client = createConfiguredResearchClient();
      await client.recordIntegrityChallenge(report);
      ui.falseEntryChallengeStatus.textContent += " · saved to server (synthetic, unverified)";
    } else {
      ui.falseEntryChallengeStatus.textContent += " · saved locally";
    }
  } catch (error) {
    ui.falseEntryChallengeStatus.textContent = `Challenge failed · ${error.message}`;
  } finally {
    ui.btnFalseEntryChallenge.disabled = false;
  }
});
ui.btnLoadIntegrityHistory.addEventListener("click", async () => {
  ui.correctionStatus.textContent = "Loading recent recorded spins...";
  try {
    const savedSession = JSON.parse(localStorage.getItem(BRI_CURRENT_SESSION_KEY) || "null");
    if (!savedSession?.sessionId) throw new Error("Run a server-backed session before reviewing recorded results.");
    const token = ui.briToken.value.trim();
    if (!token) throw new Error("Enter the player token for this research account.");
    const client = createResearchClient(token);
    const firstPage = await client.getHistory(savedSession.sessionId, {afterSpin: 0, limit: 1});
    const afterSpin = Math.max(0, firstPage.session.next_spin_number - 51);
    const {events} = await client.getHistory(savedSession.sessionId, {afterSpin, limit: 50});
    correctionEvents.clear();
    const placeholder = new Option("Select a recorded spin", "");
    const options = events.map((event) => {
      correctionEvents.set(event.event_id, {...event, sessionId: savedSession.sessionId, tableId: savedSession.tableId});
      const corrected = event.correction_revision ? ` · corrected r${event.correction_revision}` : "";
      return new Option(`Spin ${event.spin_number} · recorded ${event.original_outcome}${corrected} · ${event.event_id.slice(-8)}`, event.event_id);
    });
    ui.correctionEvent.replaceChildren(placeholder, ...options);
    ui.correctionStatus.textContent = `${events.length} recent event${events.length === 1 ? "" : "s"} loaded · Originals retained`;
  } catch (error) {
    ui.correctionStatus.textContent = `Unable to load history · ${error.message}`;
  }
});
ui.correctionEvent.addEventListener("change", () => {
  const event = correctionEvents.get(ui.correctionEvent.value);
  ui.correctedOutcome.value = "";
  if (event) ui.correctedOutcome.placeholder = `Current value ${event.effective_outcome} · corrected result 0-36`;
});
ui.btnSubmitCorrection.addEventListener("click", async () => {
  const event = correctionEvents.get(ui.correctionEvent.value);
  const correctedOutcome = Number(ui.correctedOutcome.value);
  if (!event || !Number.isInteger(correctedOutcome) || correctedOutcome < 0 || correctedOutcome > 36){
    ui.correctionStatus.textContent = "Choose a recorded spin and enter a number from 0 to 36.";
    return;
  }
  if (correctedOutcome === event.effective_outcome){
    ui.correctionStatus.textContent = "The corrected value must differ from the current effective value.";
    return;
  }
  const confirmed = confirm(`Append a correction for spin ${event.spin_number}? The original result and prediction evaluation will remain in the audit history.`);
  if (!confirmed) return;
  ui.btnSubmitCorrection.disabled = true;
  try {
    const token = ui.briToken.value.trim();
    if (!token) throw new Error("Enter the player token for this research account.");
    const client = createResearchClient(token);
    const result = await client.recordCorrection({
      correction_id: newResearchId(),
      event_id: event.event_id,
      session_id: event.sessionId,
      expected_current_outcome: event.effective_outcome,
      corrected_outcome: correctedOutcome,
      reason: ui.correctionReason.value.trim(),
    });
    event.effective_outcome = correctedOutcome;
    event.correction_revision = result.revision;
    ui.correctionEvent.selectedOptions[0].textContent = `Spin ${event.spin_number} · recorded ${event.original_outcome} · corrected r${result.revision} · ${event.event_id.slice(-8)}`;
    ui.correctionStatus.textContent = `Correction ${result.revision} appended · Rebuilding derived memory...`;
    setCompanionMessage(companion.onRebuild());
    try {
      const recovery = await recoverCorrectedTable(client, {tableId: event.tableId, dataOrigin: "synthetic"});
      predictionEngine = recovery.engine;
      if (runState?.sessionState?.engineState?.predictionEngineState){
        runState.sessionState.engineState.predictionEngineState = predictionEngine.snapshot();
      }
      renderPredictionMonitor();
      ui.correctionStatus.textContent = `Correction ${result.revision} appended · Rebuilt ${recovery.observationCount} observations · Forecasting resumed`;
      ui.integrity.textContent = "History rebuilt · Integrity verified";
    } catch (rebuildError) {
      predictionEngine.reset();
      runState = null;
      renderPredictionMonitor();
      ui.correctionStatus.textContent = `Correction ${result.revision} is saved · Rebuild pending · ${rebuildError.message}`;
      ui.integrity.textContent = "Correction saved · Statistics blocked pending rebuild";
    }
  } catch (error) {
    ui.correctionStatus.textContent = `Correction not recorded · ${error.message}`;
  } finally {
    ui.btnSubmitCorrection.disabled = false;
  }
});
simulationControls = bindSimulationControls({
  runButton: ui.btnRunStop,
  resetButton: ui.btnReset,
  onStart: () => startSimulationSafely(),
  onStop: () => toggleRunStop(),
  onReset: () => {
    clearOutputs();
    runState = null;
    currentRngState = null;
    ui.pillStatus.textContent = "Ready";
    ui.pillStatus.classList.remove("active");
  },
  confirmReset: () => confirm("Reset all results and clear the simulation?"),
});
window.addEventListener("keydown", (e)=>{
  if (e.code !== "Space" && e.key !== " ") return;
  const active = document.activeElement;
  if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT" || active.isContentEditable)){
        return;
  }
  if (e.repeat) return;
  e.preventDefault();
  toggleRunStop();
});

/* ========================= INIT ========================= */

// Config overlay handlers
ui.btnConfig.addEventListener("click", ()=>{
  ui.configOverlay.classList.add("active");
});

ui.closeConfig.addEventListener("click", ()=>{
  ui.configOverlay.classList.remove("active");
});

ui.configOverlay.addEventListener("click", (e)=>{
  if (e.target === ui.configOverlay){
    ui.configOverlay.classList.remove("active");
  }
});

// Speed control - cycles through speeds on click
ui.btnSpeed.addEventListener("click", ()=>{
  const currentIndex = speedOptions.indexOf(simulationSpeed);
  const nextIndex = (currentIndex + 1) % speedOptions.length;
  simulationSpeed = speedOptions[nextIndex];
  ui.speedLabel.textContent = simulationSpeed + "x";
});

drawLineChart(ui.chartLine, [], 100);
drawHistogram(ui.chartHist, []);
renderPredictionMonitor();

/* ========================= DRAG & DROP WIDGETS ========================= */

let draggedWidget = null;
let offsetX = 0;
let offsetY = 0;
let resizeWidget = null;
let startX = 0;
let startY = 0;
let startWidth = 0;
let startHeight = 0;

// Load saved layout from localStorage
function loadLayoutFromStorage() {
  const saved = localStorage.getItem('bank-roll-layout');
  if (saved) {
    try {
      const layout = JSON.parse(saved);
      document.querySelectorAll('.widget').forEach(widget => {
        const id = widget.id;
        if (layout[id]) {
          const cfg = layout[id];
          if (cfg.gridColumn) widget.style.gridColumn = cfg.gridColumn;
          if (cfg.gridRow) widget.style.gridRow = cfg.gridRow;
          if (cfg.order !== undefined) widget.style.order = cfg.order;
        }
      });
    } catch (e) {
      console.error('Failed to load layout:', e);
    }
  }
}

// Save layout to localStorage
function saveLayoutToStorage() {
  const layout = {};
  let order = 0;
  document.querySelectorAll('.widget').forEach(widget => {
    layout[widget.id] = {
      gridColumn: window.getComputedStyle(widget).gridColumn,
      gridRow: window.getComputedStyle(widget).gridRow,
      order: order++
    };
  });
  localStorage.setItem('bank-roll-layout', JSON.stringify(layout));
}

document.querySelectorAll('.widget').forEach((widget, idx) => {
  const header = widget.querySelector('.widget-header');
  const resizeHandle = widget.querySelector('.widget-resize');

  // Drag functionality
  header.addEventListener('dragstart', (e) => {
    draggedWidget = widget;
    widget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', widget.innerText);
  });

  header.addEventListener('dragend', (e) => {
    widget.classList.remove('dragging');
    draggedWidget = null;
  });

  // Resize functionality
  if (resizeHandle) {
    resizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      resizeWidget = widget;
      startX = e.clientX;
      startY = e.clientY;
      startWidth = widget.offsetWidth;
      startHeight = widget.offsetHeight;
      widget.classList.add('resizing');

      const handleMouseMove = (e) => {
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        const newWidth = startWidth + deltaX;
        const newHeight = startHeight + deltaY;

        if (newWidth > 300) {
          const cols = Math.max(1, Math.ceil(newWidth / (window.innerWidth / 4 - 20)));
          widget.style.gridColumn = `span ${Math.min(cols, 4)}`;
        }
        if (newHeight > 200) {
          widget.style.minHeight = newHeight + 'px';
        }
      };

      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        widget.classList.remove('resizing');
        resizeWidget = null;
        saveLayoutToStorage();
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    });
  }
});

const container = document.querySelector('.widgets-container');

container.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
});

container.addEventListener('drop', (e) => {
  e.preventDefault();
  if (draggedWidget) {
    const afterElement = getDragAfterElement(container, e.clientY);
    if (afterElement == null) {
      container.appendChild(draggedWidget);
    } else {
      container.insertBefore(draggedWidget, afterElement);
    }
    saveLayoutToStorage();
  }
});

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.widget:not(.dragging)')];

  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;

    if (offset < 0 && offset > (closest?.offset ?? Number.NEGATIVE_INFINITY)) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, null)?.element;
}

// Load layout on page load
loadLayoutFromStorage();
