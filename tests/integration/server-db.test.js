import assert from "node:assert/strict";
import test from "node:test";
import {spawn, execFileSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {StreetPredictionEngine} from "../../src/intelligence/prediction-engine.js";
import {rebuildPredictionEngine} from "../../src/intelligence/rebuild.js";
import {ResearchClient} from "../../src/storage/research-client.js";

/**
 * End-to-end verification of the PHP API against a real MySQL/MariaDB server.
 *
 * Requires environment variables (skipped otherwise):
 *   BANKROLL_TEST_DB_HOST, BANKROLL_TEST_DB_NAME,
 *   BANKROLL_TEST_DB_USER, BANKROLL_TEST_DB_PASSWORD
 * Optional: BANKROLL_TEST_PHP (PHP CLI with pdo_mysql, default "php").
 *
 * The configured database user needs DDL rights on the test database, whose
 * tables are dropped and recreated from the real migrations on every run.
 */
const DB = {
  host: process.env.BANKROLL_TEST_DB_HOST,
  name: process.env.BANKROLL_TEST_DB_NAME,
  user: process.env.BANKROLL_TEST_DB_USER,
  password: process.env.BANKROLL_TEST_DB_PASSWORD,
};
const PHP = process.env.BANKROLL_TEST_PHP || "php";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REGISTRATION_KEY = "integration-test-registration-key";
const PORT = 8471;

function phpAvailable(){
  try {
    const modules = execFileSync(PHP, ["-m"], {encoding: "utf8"});
    return modules.includes("pdo_mysql");
  } catch {
    return false;
  }
}

const configured = Boolean(DB.host && DB.name && DB.user && DB.password !== undefined) && phpAvailable();

function runPhp(code){
  return execFileSync(PHP, ["-r", code], {
    encoding: "utf8",
    env: {...process.env, DB_HOST: DB.host, DB_NAME: DB.name, DB_USER: DB.user, DB_PASSWORD: DB.password},
  });
}

function resetDatabase(){
  const migrations = ["001_bri_initial.sql", "002_integrity_corrections.sql", "003_integrity_challenge_seed.sql", "004_strategy_decisions.sql", "005_shared_table_cohorts.sql", "006_active_table_identity.sql"]
    .map((file) => readFileSync(path.join(ROOT, "server/private/migrations", file), "utf8"))
    .join("\n");
  const script = `
    $pdo = new PDO("mysql:host={$_SERVER['DB_HOST']};dbname={$_SERVER['DB_NAME']};charset=utf8mb4", $_SERVER['DB_USER'], $_SERVER['DB_PASSWORD'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('SET FOREIGN_KEY_CHECKS = 0');
    $tables = $pdo->query("SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()")->fetchAll(PDO::FETCH_COLUMN);
    foreach ($tables as $table) { $pdo->exec("DROP TABLE IF EXISTS \`{$table}\`"); }
    $pdo->exec('SET FOREIGN_KEY_CHECKS = 1');
    $sql = base64_decode($_SERVER['MIGRATIONS_B64']);
    foreach (array_filter(array_map('trim', preg_split('/;\\s*\\n/', $sql))) as $statement) { if ($statement !== '') $pdo->exec($statement); }
    echo 'ok';
  `;
  const output = execFileSync(PHP, ["-r", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      DB_HOST: DB.host,
      DB_NAME: DB.name,
      DB_USER: DB.user,
      DB_PASSWORD: DB.password,
      MIGRATIONS_B64: Buffer.from(migrations).toString("base64"),
    },
  });
  assert.equal(output.trim(), "ok", "database reset and migrations must succeed");
}

function queryScalar(sql){
  const script = `
    $pdo = new PDO("mysql:host={$_SERVER['DB_HOST']};dbname={$_SERVER['DB_NAME']};charset=utf8mb4", $_SERVER['DB_USER'], $_SERVER['DB_PASSWORD'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $value = $pdo->query(base64_decode($_SERVER['SCALAR_SQL_B64']))->fetchColumn();
    echo $value === null ? 'NULL' : (string) $value;
  `;
  return execFileSync(PHP, ["-r", script], {
    encoding: "utf8",
    env: {...process.env, DB_HOST: DB.host, DB_NAME: DB.name, DB_USER: DB.user, DB_PASSWORD: DB.password, SCALAR_SQL_B64: Buffer.from(sql).toString("base64")},
  }).trim();
}

async function startServer(){
  const server = spawn(PHP, ["-S", `127.0.0.1:${PORT}`, "tests/php/router.php"], {
    cwd: ROOT,
    env: {
      ...process.env,
      BANKROLL_DB_HOST: DB.host,
      BANKROLL_DB_NAME: DB.name,
      BANKROLL_DB_USER: DB.user,
      BANKROLL_DB_PASSWORD: DB.password,
      BANKROLL_REGISTRATION_KEY: REGISTRATION_KEY,
      BANKROLL_ALLOW_OBSERVED_SUBMISSIONS: "true",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  for (let attempt = 0; attempt < 50; attempt++){
    try {
      await fetch(`http://127.0.0.1:${PORT}/index.html`);
      return server;
    } catch {
      await delay(100);
    }
  }
  server.kill();
  throw new Error("The integration PHP server did not start.");
}

function makeClient(token = ""){
  return new ResearchClient({baseUrl: `http://127.0.0.1:${PORT}/server/api/v1/`, token, storage: null});
}

function forecastPayload(engine, sessionId, forecast){
  return {
    prediction_id: randomUUID(),
    session_id: sessionId,
    spin_number: forecast.spinNumber,
    observation_count: forecast.observationCount,
    selected_street: forecast.street,
    model_version: forecast.modelVersion,
    probabilities: forecast.candidateModels.find((model) => model.modelVersion === forecast.modelVersion).probabilities,
    candidate_models: forecast.candidateModels.map((model) => ({model_version: model.modelVersion, probabilities: [...model.probabilities]})),
    parameters: {},
  };
}

function decisionPayload(sessionId, spinNumber, action = "observe", modelVersion = null){
  return {
    decision_id: randomUUID(),
    session_id: sessionId,
    spin_number: spinNumber,
    action,
    model_version: modelVersion,
    snapshot: {version: 1, action, reasons: ["integration test"]},
  };
}

test("MySQL integration: migrations, API transactions, correction chains and rebuild", {skip: !configured && "BANKROLL_TEST_DB_* environment is not configured or PHP lacks pdo_mysql"}, async (t) => {
  resetDatabase();
  const server = await startServer();
  t.after(() => server.kill());

  // --- Registration requires the secret key ---
  const anonymous = makeClient();
  await assert.rejects(anonymous.register({displayName: "Nope", registrationKey: "wrong-key"}), /registration is unavailable/i);
  const registration = await anonymous.register({displayName: "Integration Player", shareResearch: true, registrationKey: REGISTRATION_KEY});
  assert.ok(registration.token.startsWith("brp_"));
  const client = makeClient(registration.token);

  // --- Session creation is idempotent and provenance-checked ---
  const tableId = randomUUID();
  const sharedCohortId = randomUUID();
  const sessionId = randomUUID();
  const sessionPayload = {
    table_id: tableId,
    session_id: sessionId,
    table_name: "Integration Table",
    table_type: "online_rng",
    shared_cohort_id: sharedCohortId,
    source: "online_rng",
    data_origin: "observed",
    share_consent: true,
  };
  const created = await client.createSession(sessionPayload);
  assert.equal(created.created, true);
  const repeated = await client.createSession(sessionPayload);
  assert.equal(repeated.created, false);
  await assert.rejects(client.createSession({...sessionPayload, data_origin: "synthetic"}), /conflicts|data_origin/i);
  let tableProfiles = await client.listTables();
  assert.equal(tableProfiles.active_table_id, tableId);
  assert.equal(tableProfiles.tables[0].shared_cohort_id, sharedCohortId);
  const nextObservationSession = {...sessionPayload, session_id: randomUUID()};
  assert.equal((await client.createSession(nextObservationSession)).created, true);
  tableProfiles = await client.listTables();
  assert.equal(tableProfiles.active_table_id, tableId, "new observation sessions retain the selected table identity");

  // --- Observations with forecast-before-outcome and model checkpointing ---
  const engine = new StreetPredictionEngine();
  const outcomes = [5, 9, 14, 22, 31, 2, 8, 19, 27, 33, 12, 7, 25, 30, 16];
  const eventIds = [];
  let spinNumber = 1;
  // First ten spins: observation only.
  for (let index = 0; index < 10; index++){
    const decision = decisionPayload(sessionId, spinNumber);
    const storedDecision = await client.recordDecision(decision);
    assert.equal(storedDecision.created, true);
    assert.equal((await client.recordDecision(decision)).created, false);
    const eventId = randomUUID();
    eventIds.push(eventId);
    const batch = {
      ...sessionPayload,
      outcomes: [{event_id: eventId, spin_number: spinNumber, outcome: outcomes[index]}],
      model_state: null,
    };
    delete batch.model_state;
    engine.observe(outcomes[index]);
    batch.model_state = engine.snapshot();
    const stored = await client.appendObservations(batch);
    assert.equal(stored.inserted, 1);
    spinNumber++;
  }
  // Remaining spins: record the forecast first, then the outcome, then verify scoring.
  const forecastRecords = [];
  for (let index = 10; index < outcomes.length; index++){
    const forecast = engine.forecastNext();
    assert.ok(forecast, "forecast must exist after ten observations");
    const payload = forecastPayload(engine, sessionId, forecast);
    const forecastResult = await client.request("forecasts.php", {method: "POST", body: payload});
    assert.equal(forecastResult.created, true);
    const decision = decisionPayload(sessionId, spinNumber, "continue", forecast.modelVersion);
    assert.equal((await client.recordDecision(decision)).created, true);
    forecastRecords.push({payload, forecast});
    const eventId = randomUUID();
    eventIds.push(eventId);
    engine.observe(outcomes[index]);
    const batch = {...sessionPayload, outcomes: [{event_id: eventId, spin_number: spinNumber, outcome: outcomes[index]}], model_state: engine.snapshot()};
    const stored = await client.appendObservations(batch);
    assert.equal(stored.inserted, 1);
    assert.equal(stored.predictions_scored, 1);
    spinNumber++;
  }

  // --- Transactional conflict handling ---
  const duplicateEvent = {...sessionPayload, outcomes: [{event_id: eventIds[0], spin_number: spinNumber, outcome: 4}]};
  await assert.rejects(client.appendObservations(duplicateEvent), /already been used/i);
  const conflictingReplay = {...sessionPayload, outcomes: [{event_id: randomUUID(), spin_number: 3, outcome: 36}]};
  await assert.rejects(client.appendObservations(conflictingReplay), /conflicts with the stored research history/i);
  const identicalReplay = {...sessionPayload, outcomes: [{event_id: eventIds[2], spin_number: 3, outcome: outcomes[2]}]};
  const replayResult = await client.appendObservations(identicalReplay);
  assert.equal(replayResult.replayed, 1);
  assert.equal(replayResult.inserted, 0);

  // --- Stored model state round-trips ---
  const modelState = await client.getModelState(tableId, "observed");
  assert.equal(modelState.observation_count, outcomes.length);
  assert.deepEqual(modelState.state.tracker, engine.snapshot().tracker);

  // --- History exposes effective outcomes and predictions ---
  const history = await client.getHistory(sessionId);
  assert.equal(history.events.length, outcomes.length);
  assert.equal(history.events[10].prediction.hit !== null, true);
  const decisions = await client.getDecisions(sessionId);
  assert.equal(decisions.decisions.length, outcomes.length);
  assert.equal(decisions.decisions[0].action, "observe");
  assert.equal(decisions.decisions[10].action, "continue");

  // --- Correction chain: two successive corrections on one evaluated event ---
  const correctedEventIndex = 11; // spin 12, which carried a forecast
  const correctedEventId = eventIds[correctedEventIndex];
  const originalOutcome = outcomes[correctedEventIndex];
  const firstCorrection = {
    correction_id: randomUUID(),
    event_id: correctedEventId,
    session_id: sessionId,
    expected_current_outcome: originalOutcome,
    corrected_outcome: 36,
    reason: "Misread the wheel",
  };
  const firstResult = await client.recordCorrection(firstCorrection);
  assert.equal(firstResult.revision, 1);
  assert.equal(firstResult.rebuild_required, true);

  // A stale expected outcome must be rejected.
  await assert.rejects(client.recordCorrection({...firstCorrection, correction_id: randomUUID()}), /refresh the correction history/i);
  // Replaying the identical correction is idempotent.
  const replayCorrection = await client.recordCorrection(firstCorrection);
  assert.equal(replayCorrection.replayed, true);

  const secondCorrection = {
    correction_id: randomUUID(),
    event_id: correctedEventId,
    session_id: sessionId,
    expected_current_outcome: 36,
    corrected_outcome: 1,
    reason: "Second review",
  };
  const secondResult = await client.recordCorrection(secondCorrection);
  assert.equal(secondResult.revision, 2);

  // The second impact must be baselined on the first correction's effective
  // score, not the original evaluation (successive-correction defect fix).
  const chain = await client.getCorrectionHistory(correctedEventId);
  assert.equal(chain.corrections.length, 2);
  assert.equal(chain.event.original_outcome, originalOutcome);
  assert.equal(chain.event.current_outcome, 1);
  assert.equal(chain.prediction_impacts.length, 2);
  const [firstImpact, secondImpact] = chain.prediction_impacts;
  assert.equal(secondImpact.prior_hit, firstImpact.corrected_hit);
  assert.ok(Math.abs(secondImpact.prior_brier_score - firstImpact.corrected_brier_score) < 1e-9);

  // --- Derived state is paused until a rebuild ---
  const blockedBatch = {...sessionPayload, outcomes: [{event_id: randomUUID(), spin_number: spinNumber, outcome: 10}]};
  await assert.rejects(client.appendObservations(blockedBatch), /rebuild/i);
  await assert.rejects(client.getModelState(tableId, "observed"), /rebuild/i);

  // --- Rebuild: idempotent chronological reconstruction ---
  const rebuildResult = await client.runRebuild({tableId, dataOrigin: "observed"});
  assert.equal(rebuildResult.rebuilt, true);
  assert.equal(rebuildResult.events_replayed, outcomes.length);
  assert.equal(rebuildResult.corrections_applied, 1);
  assert.equal(rebuildResult.model_rebuild_required, true);

  // Interrupted rebuilds stay claimable: force a processing row and retry.
  runPhp(`
    $pdo = new PDO("mysql:host={$_SERVER['DB_HOST']};dbname={$_SERVER['DB_NAME']};charset=utf8mb4", $_SERVER['DB_USER'], $_SERVER['DB_PASSWORD'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec("UPDATE integrity_rebuild_requests SET status = 'processing'");
    $pdo->exec("UPDATE table_observation_totals SET statistics_valid = 0");
    echo 'ok';
  `);
  const retried = await client.runRebuild({tableId, dataOrigin: "observed"});
  assert.equal(retried.rebuilt, true);
  assert.equal(retried.requests_completed >= 1, true);
  const secondRun = await client.runRebuild({tableId, dataOrigin: "observed"});
  assert.equal(secondRun.already_valid, true);

  // Verify recomputed statistics match the corrected history.
  const effectiveOutcomes = [...outcomes];
  effectiveOutcomes[correctedEventIndex] = 1;
  const expectedStreetCounts = new Array(12).fill(0);
  for (const outcome of effectiveOutcomes){
    if (outcome >= 1) expectedStreetCounts[Math.floor((outcome - 1) / 3)]++;
  }
  for (let street = 0; street < 12; street++){
    const stored = queryScalar(`SELECT COALESCE((SELECT appearance_count FROM table_street_counts WHERE table_id = '${tableId}' AND data_origin = 'observed' AND street = ${street}), 0)`);
    assert.equal(Number(stored), expectedStreetCounts[street], `street ${street} count after rebuild`);
  }
  assert.equal(Number(queryScalar(`SELECT spin_count FROM table_observation_totals WHERE table_id = '${tableId}' AND data_origin = 'observed'`)), effectiveOutcomes.length);

  // --- Client model reconstruction and checkpoint upload ---
  const page = await client.getRebuildStatus({tableId, dataOrigin: "observed"});
  assert.equal(page.statistics_valid, true);
  assert.equal(page.model_state_valid, false);
  assert.equal(page.events.length, effectiveOutcomes.length);
  assert.deepEqual(page.events.map((event) => event.effective_outcome), effectiveOutcomes);
  const rebuiltEngine = rebuildPredictionEngine(page.events);
  const upload = await client.uploadModelState({tableId, dataOrigin: "observed", modelState: rebuiltEngine.snapshot()});
  assert.equal(upload.state_valid, true);
  const restored = await client.getModelState(tableId, "observed");
  assert.deepEqual(restored.state.tracker, rebuiltEngine.snapshot().tracker);

  // A checkpoint that disagrees with the ledger is refused.
  const wrongEngine = rebuildPredictionEngine(effectiveOutcomes.slice(0, 5));
  await assert.rejects(client.uploadModelState({tableId, dataOrigin: "observed", modelState: wrongEngine.snapshot()}), /does not match/i);

  // --- Observations resume after a completed rebuild ---
  const resumed = await client.appendObservations({...sessionPayload, outcomes: [{event_id: randomUUID(), spin_number: spinNumber, outcome: 10}]});
  assert.equal(resumed.inserted, 1);

  // --- Consent-gated shared aggregates ---
  const aggregates = await client.getSharedAggregates(sharedCohortId);
  assert.equal(aggregates.total_observations, effectiveOutcomes.length + 1);
  assert.equal(aggregates.contributing_players, 1);

  const otherRegistration = await anonymous.register({displayName: "Other Researcher", shareResearch: true, registrationKey: REGISTRATION_KEY});
  const otherClient = makeClient(otherRegistration.token);
  const unrelatedCohortId = randomUUID();
  const unrelatedSession = {
    ...sessionPayload,
    table_id: randomUUID(),
    session_id: randomUUID(),
    table_name: "Unrelated Table",
    shared_cohort_id: unrelatedCohortId,
  };
  await otherClient.createSession(unrelatedSession);
  await otherClient.appendObservations({...unrelatedSession, outcomes: [{event_id: randomUUID(), spin_number: 1, outcome: 0}]});
  const unrelatedAggregates = await otherClient.getSharedAggregates(unrelatedCohortId);
  assert.equal(unrelatedAggregates.total_observations, 1);
  assert.equal(unrelatedAggregates.zero_count, 1);
  assert.equal(aggregates.total_observations, effectiveOutcomes.length + 1);

  const matchingSession = {
    ...sessionPayload,
    table_id: randomUUID(),
    session_id: randomUUID(),
    table_name: "Matching Cohort Table",
  };
  await assert.rejects(otherClient.createSession({
    ...matchingSession,
    table_id: randomUUID(),
    session_id: randomUUID(),
    table_type: "simulated",
    source: "simulation",
    data_origin: "synthetic",
  }), /different roulette table types/i);
  await otherClient.createSession(matchingSession);
  await otherClient.appendObservations({...matchingSession, outcomes: [{event_id: randomUUID(), spin_number: 1, outcome: 0}]});
  const expandedAggregates = await client.getSharedAggregates(sharedCohortId);
  assert.equal(expandedAggregates.total_observations, effectiveOutcomes.length + 2);
  assert.equal(expandedAggregates.contributing_players, 2);

  const privateRegistration = await anonymous.register({displayName: "Private Player", shareResearch: false, registrationKey: REGISTRATION_KEY});
  const privateClient = makeClient(privateRegistration.token);
  await assert.rejects(privateClient.getSharedAggregates(sharedCohortId), /enable research sharing/i);
  await assert.rejects(privateClient.setActiveTable(tableId), /table profile not found/i);

  const secondTableId = randomUUID();
  const createdTable = await client.createTable({
    id: secondTableId,
    name: "Second owned profile",
    tableType: "simulated",
  });
  assert.equal(createdTable.active_table_id, secondTableId);
  assert.equal((await client.listTables()).active_table_id, secondTableId);
  await client.setActiveTable(tableId);
  assert.equal((await client.listTables()).active_table_id, tableId);

  // --- Metrics endpoint stays owner-scoped ---
  await assert.rejects(privateClient.getMetrics(tableId), /not found/i);
});
