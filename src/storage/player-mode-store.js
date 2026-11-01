import {createUuid} from "../core/identifiers.js";
import {isValidOutcome} from "../core/roulette.js";
import {settleWager} from "../bankroll/accounting.js";
import {addMoneyCents} from "../core/mathematics.js";
import {approvePlayerWager, assessPlayerCadence, validatePlayerSettings} from "../simulation/player-rules.js";

function abortChange(transaction, message){
  transaction.failureReason = message;
  transaction.abort();
}

function currentRevision(transaction, session, expectedRevision){
  if (!session || (expectedRevision !== undefined && (session.revision || 0) !== expectedRevision)){
    abortChange(transaction, "This table changed in another tab. Reload before continuing; nothing was saved.");
    return false;
  }
  return true;
}

const DATABASE_NAME = "bank-roll-player-mode";
const DATABASE_VERSION = 1;
const SESSION_INDEX = "tableId";
const OBSERVATION_INDEX = "tableId";
const CORRECTION_INDEX = "tableId";
const EVENT_INDEX = "tableId";

function requestResult(request){
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Player Mode storage request failed."));
  });
}

function transactionResult(transaction){
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Player Mode could not save this change."));
    transaction.onabort = () => reject(new Error(transaction.failureReason || transaction.error?.message || "Player Mode save was cancelled; reload and check the active session."));
  });
}

export class PlayerModeStore{
  constructor({indexedDBFactory = globalThis.indexedDB, now = () => new Date().toISOString(), createId = createUuid} = {}){
    this.indexedDBFactory = indexedDBFactory;
    this.now = now;
    this.createId = createId;
    this.databasePromise = null;
  }

  open(){
    if (!this.indexedDBFactory) return Promise.reject(new Error("Player Mode needs browser IndexedDB storage. Enable site storage or use a supported browser."));
    if (!this.databasePromise){
      this.databasePromise = new Promise((resolve, reject) => {
        const request = this.indexedDBFactory.open(DATABASE_NAME, DATABASE_VERSION);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains("tables")) database.createObjectStore("tables", {keyPath: "id"});
          if (!database.objectStoreNames.contains("sessions")){
            const sessions = database.createObjectStore("sessions", {keyPath: "id"});
            sessions.createIndex(SESSION_INDEX, "tableId", {unique: false});
          }
          if (!database.objectStoreNames.contains("observations")){
            const observations = database.createObjectStore("observations", {keyPath: "id"});
            observations.createIndex("tableSequence", ["tableId", "sequence"], {unique: true});
            observations.createIndex(OBSERVATION_INDEX, "tableId", {unique: false});
            observations.createIndex("sessionSequence", ["sessionId", "sequence"], {unique: true});
          }
          if (!database.objectStoreNames.contains("corrections")){
            const corrections = database.createObjectStore("corrections", {keyPath: "id"});
            corrections.createIndex(CORRECTION_INDEX, "tableId", {unique: false});
            corrections.createIndex("observationId", "observationId", {unique: false});
          }
          if (!database.objectStoreNames.contains("tableEvents")){
            const events = database.createObjectStore("tableEvents", {keyPath: "id"});
            events.createIndex(EVENT_INDEX, "tableId", {unique: false});
          }
          if (!database.objectStoreNames.contains("settings")) database.createObjectStore("settings", {keyPath: "key"});
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Player Mode could not open browser storage."));
        request.onblocked = () => reject(new Error("Close other Bank-Roll tabs to finish updating local player storage."));
      }).catch((error) => {
        this.databasePromise = null;
        throw error;
      });
    }
    return this.databasePromise;
  }

  async listTables(){
    const database = await this.open();
    const tables = await requestResult(database.transaction("tables", "readonly").objectStore("tables").getAll());
    return tables.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getTable(tableId){
    const database = await this.open();
    return requestResult(database.transaction("tables", "readonly").objectStore("tables").get(tableId));
  }

  async getActiveTable(){
    const database = await this.open();
    const active = await requestResult(database.transaction("settings", "readonly").objectStore("settings").get("activeTableId"));
    return active?.value ? this.getTable(active.value) : null;
  }

  async createTable({name, venue = "", observer = "", dealer = "", settings}){
    validatePlayerSettings(settings);
    const tableName = typeof name === "string" ? name.trim() : "";
    if (!tableName || tableName.length > 120) throw new RangeError("Table name must contain 1 to 120 characters.");
    const timestamp = this.now();
    const table = {
      id: this.createId(),
      name: tableName,
      venue: typeof venue === "string" ? venue.trim().slice(0, 120) : "",
      observer: typeof observer === "string" ? observer.trim().slice(0, 80) : "",
      dealer: typeof dealer === "string" ? dealer.trim().slice(0, 80) : "",
      tableType: "physical",
      provenance: "human-observed-unverified",
      createdAt: timestamp,
      updatedAt: timestamp,
      observationCount: 0,
      nextSequence: 1,
      activeSessionId: null,
      modelState: null,
      settings: {...settings},
    };
    const database = await this.open();
    const transaction = database.transaction(["tables", "settings"], "readwrite");
    transaction.objectStore("tables").add(table);
    transaction.objectStore("settings").put({key: "activeTableId", value: table.id});
    await transactionResult(transaction);
    return table;
  }

  async setActiveTable(tableId){
    const database = await this.open();
    const transaction = database.transaction(["tables", "settings"], "readwrite");
    const tableRequest = transaction.objectStore("tables").get(tableId);
    tableRequest.onsuccess = () => {
      if (!tableRequest.result){
        transaction.abort();
        return;
      }
      transaction.objectStore("settings").put({key: "activeTableId", value: tableId});
    };
    await transactionResult(transaction);
    return this.getTable(tableId);
  }

  async startSession(tableId, settings, {newSession = false} = {}){
    validatePlayerSettings(settings);
    const database = await this.open();
    const transaction = database.transaction(["tables", "sessions", "settings"], "readwrite");
    const tables = transaction.objectStore("tables");
    const sessions = transaction.objectStore("sessions");
    const tableRequest = tables.get(tableId);
    let result;
    tableRequest.onsuccess = () => {
      const table = tableRequest.result;
      if (!table){
        transaction.abort();
        return;
      }
      const finish = (previous) => {
        if (!newSession && previous?.status === "active"){
          result = {...previous, resumed: true};
          return;
        }
        if (!newSession && previous){
          result = {...previous, resumed: false};
          return;
        }
        if (previous?.pendingActualWager){
          transaction.abort();
          return;
        }
        if (previous?.status === "active"){
          previous.status = "paused";
          previous.revision = (previous.revision || 0) + 1;
          previous.pausedAt = this.now();
          previous.pendingForecast = null;
          previous.pendingRecommendation = null;
          previous.wagerStatus = "no-bet-recorded";
          sessions.put(previous);
        }
        const timestamp = this.now();
        result = {
          id: this.createId(),
          tableId,
          status: "active",
          revision: 0,
          createdAt: timestamp,
          startedAt: timestamp,
          startingBankrollCents: settings.startingBankrollCents,
          bankrollCents: settings.startingBankrollCents,
          totalStakedCents: 0,
          totalGrossReturnsCents: 0,
          wins: 0,
          losses: 0,
          accumulatedLossCents: 0,
          currentProgressionLossCents: 0,
          recoveryAttributionKnown: true,
          progressionStep: 1,
          currentStreets: [],
          observationCount: 0,
          sequenceStart: table.nextSequence,
          sequenceEnd: table.nextSequence - 1,
          gapBeforeNext: table.observationCount > 0,
          pendingForecast: null,
          pendingRecommendation: null,
          pendingActualWager: null,
          wagerStatus: "no-bet-recorded",
          settings: {...settings},
        };
        sessions.add(result);
        table.activeSessionId = result.id;
        table.settings = {...settings};
        table.updatedAt = timestamp;
        tables.put(table);
        transaction.objectStore("settings").put({key: "activeTableId", value: tableId});
      };
      if (table.activeSessionId){
        const sessionRequest = sessions.get(table.activeSessionId);
        sessionRequest.onsuccess = () => finish(sessionRequest.result);
        sessionRequest.onerror = () => transaction.abort();
      } else finish(null);
    };
    tableRequest.onerror = () => transaction.abort();
    await transactionResult(transaction);
    return result;
  }

  async getSession(sessionId){
    const database = await this.open();
    return requestResult(database.transaction("sessions", "readonly").objectStore("sessions").get(sessionId));
  }

  async listSessions(tableId){
    const database = await this.open();
    const rows = await requestResult(database.transaction("sessions", "readonly").objectStore("sessions").index(SESSION_INDEX).getAll(tableId));
    return rows.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async saveSession(session){
    const database = await this.open();
    const transaction = database.transaction("sessions", "readwrite");
    transaction.objectStore("sessions").put({...session, updatedAt: this.now()});
    await transactionResult(transaction);
  }

  async endSession(sessionId, expectedRevision){
    const database = await this.open();
    const transaction = database.transaction("sessions", "readwrite");
    const sessions = transaction.objectStore("sessions");
    const request = sessions.get(sessionId);
    request.onsuccess = () => {
      const session = request.result;
      if (!currentRevision(transaction, session, expectedRevision)) return;
      if (session.pendingActualWager){
        transaction.abort();
        return;
      }
      session.status = "ended";
      session.revision = (session.revision || 0) + 1;
      session.endedAt = this.now();
      session.wagerStatus = "no-bet-recorded";
      session.pendingForecast = null;
      session.pendingRecommendation = null;
      sessions.put(session);
    };
    request.onerror = () => transaction.abort();
    await transactionResult(transaction);
  }

  async saveCheckpoint(tableId, modelState){
    const database = await this.open();
    const transaction = database.transaction("tables", "readwrite");
    const tables = transaction.objectStore("tables");
    const request = tables.get(tableId);
    request.onsuccess = () => {
      if (!request.result){
        transaction.abort();
        return;
      }
      request.result.modelState = modelState;
      request.result.updatedAt = this.now();
      tables.put(request.result);
    };
    request.onerror = () => transaction.abort();
    await transactionResult(transaction);
  }

  async savePending(sessionId, {forecast, recommendation}, expectedRevision){
    const database = await this.open();
    const transaction = database.transaction(["sessions", "tableEvents"], "readwrite");
    const sessions = transaction.objectStore("sessions");
    const request = sessions.get(sessionId);
    let updated;
    request.onsuccess = () => {
      const session = request.result;
      if (!currentRevision(transaction, session, expectedRevision)) return;
      if (!session || session.status !== "active" || session.pendingActualWager){
        transaction.abort();
        return;
      }
      updated = {
        ...session,
        revision: (session.revision || 0) + 1,
        pendingForecast: forecast ? structuredClone(forecast) : null,
        pendingRecommendation: recommendation ? structuredClone(recommendation) : null,
        wagerStatus: recommendation ? "awaiting-player" : "no-bet-recorded",
        updatedAt: this.now(),
      };
      sessions.put(updated);
      if (forecast && !session.pendingForecast){
        transaction.objectStore("tableEvents").add({
          id: this.createId(), tableId: session.tableId, sessionId, eventType: "forecast-prepared",
          createdAt: this.now(), forecast: structuredClone(forecast), recommendation: structuredClone(recommendation),
        });
      }
    };
    request.onerror = () => transaction.abort();
    await transactionResult(transaction);
    return updated;
  }

  async confirmWager(sessionId, wager, expectedRevision){
    const database = await this.open();
    const transaction = database.transaction(["sessions", "tableEvents"], "readwrite");
    const sessions = transaction.objectStore("sessions");
    const request = sessions.get(sessionId);
    let updated;
    request.onsuccess = () => {
      const session = request.result;
      if (!currentRevision(transaction, session, expectedRevision)) return;
      if (!session || session.status !== "active" || session.pendingActualWager){
        transaction.abort();
        return;
      }
      updated = {
        ...session,
        revision: (session.revision || 0) + 1,
        pendingActualWager: wager ? structuredClone(wager) : null,
        wagerStatus: wager ? "player-confirmed" : "player-no-bet",
        updatedAt: this.now(),
      };
      if (wager){
        try {
          approvePlayerWager(session, wager);
          updated.bankrollCents -= wager.totalStakeCents;
          updated.totalStakedCents = addMoneyCents(updated.totalStakedCents, wager.totalStakeCents);
        } catch (error) {
          abortChange(transaction, error.message);
          return;
        }
        if (wager.action === "switch"){
          updated.progressionStep = 1;
          updated.currentProgressionLossCents = 0;
          updated.recoveryAttributionKnown = true;
        }
        updated.currentStreets = [...wager.chosen];
      }
      sessions.put(updated);
      transaction.objectStore("tableEvents").add({
        id: this.createId(), tableId: session.tableId, sessionId, eventType: wager ? "wager-confirmed" : "wager-declined",
        createdAt: this.now(), actualWager: wager ? structuredClone(wager) : null,
      });
    };
    request.onerror = () => transaction.abort();
    await transactionResult(transaction);
    return updated;
  }

  async appendOutcome({tableId, sessionId, outcome, evaluation, modelState, claimedAt = null, expectedRevision, receivedAt = this.now()}){
    if (!isValidOutcome(outcome)) throw new RangeError("Enter a European result from 0 to 36.");
    const database = await this.open();
    const transaction = database.transaction(["tables", "sessions", "observations"], "readwrite");
    const tables = transaction.objectStore("tables");
    const sessions = transaction.objectStore("sessions");
    let saved;
    const tableRequest = tables.get(tableId);
    tableRequest.onsuccess = () => {
      const table = tableRequest.result;
      const sessionRequest = sessions.get(sessionId);
      sessionRequest.onsuccess = () => {
        const session = sessionRequest.result;
        if (!currentRevision(transaction, session, expectedRevision)) return;
        if (!table || !session || session.tableId !== tableId || session.status !== "active"){
          transaction.abort();
          return;
        }
        const sequence = table.nextSequence;
        let cadence;
        try {
          cadence = assessPlayerCadence(session, receivedAt);
        } catch (error) {
          abortChange(transaction, error.message);
          return;
        }
        if (session.wagerStatus === "awaiting-player"){
          abortChange(transaction, "Confirm a wager or record no bet before entering a result.");
          return;
        }
        const settlement = session.pendingActualWager ? settleWager(session.pendingActualWager, outcome) : null;
        const record = {
          id: this.createId(),
          tableId,
          sessionId,
          sequence,
          outcome,
          sourceType: "human-observed",
          trustStatus: cadence.quarantined ? "quarantined" : "unverified",
          integrityFlags: cadence.flags,
          receivedAt,
          claimedAt,
          gapBefore: Boolean(session.gapBeforeNext),
          forecast: session.pendingForecast ? structuredClone(session.pendingForecast) : null,
          recommendation: session.pendingRecommendation ? structuredClone(session.pendingRecommendation) : null,
          actualWager: session.pendingActualWager ? structuredClone(session.pendingActualWager) : null,
          evaluation: {...structuredClone(evaluation), settlement, hit: settlement?.hit ?? false},
          correctionIds: [],
        };
        transaction.objectStore("observations").add(record);
        table.nextSequence++;
        table.observationCount++;
        table.modelState = modelState;
        table.updatedAt = record.receivedAt;
        session.observationCount++;
        session.sequenceEnd = sequence;
        session.lastRecordedAt = record.receivedAt;
        session.entryIntervals = cadence.intervals;
        session.revision = (session.revision || 0) + 1;
        session.gapBeforeNext = false;
        session.pendingForecast = null;
        session.pendingRecommendation = null;
        session.pendingActualWager = null;
        session.wagerStatus = "no-bet-recorded";
        if (settlement){
            if (settlement.hit) session.wins++;
            else session.losses++;
            session.bankrollCents = addMoneyCents(session.bankrollCents, settlement.grossReturnCents);
            session.totalGrossReturnsCents = addMoneyCents(session.totalGrossReturnsCents, settlement.grossReturnCents);
            session.accumulatedLossCents = Math.max(0, addMoneyCents(session.accumulatedLossCents, -settlement.netChangeCents));
            session.currentProgressionLossCents = Math.max(0, addMoneyCents(session.currentProgressionLossCents, -settlement.netChangeCents));
            session.progressionStep = settlement.hit || session.settings.progressionMode === "flat" ? 1 : session.progressionStep + 1;
        }
        sessions.put(session);
        tables.put(table);
        saved = record;
      };
      sessionRequest.onerror = () => transaction.abort();
    };
    tableRequest.onerror = () => transaction.abort();
    await transactionResult(transaction);
    return saved;
  }

  async markGap(sessionId, {missingSpins = null, note = ""} = {}, expectedRevision){
    const session = await this.getSession(sessionId);
    if (!session || session.status !== "active") throw new Error("Start or resume an active player session first.");
    if (missingSpins !== null && (!Number.isSafeInteger(missingSpins) || missingSpins < 0)) throw new RangeError("Missed spins must be a non-negative integer or unknown.");
    const event = {
      id: this.createId(),
      tableId: session.tableId,
      sessionId,
      eventType: "observation-gap",
      createdAt: this.now(),
      missingSpins: Number.isSafeInteger(missingSpins) && missingSpins >= 0 ? missingSpins : null,
      continuity: missingSpins === 0 ? "continuous" : "uncertain-gap",
      note: typeof note === "string" ? note.slice(0, 240) : "",
      cancelledForecast: session.pendingForecast ? structuredClone(session.pendingForecast) : null,
    };
    session.gapBeforeNext = missingSpins !== 0;
    session.pendingForecast = null;
    session.pendingRecommendation = null;
    session.wagerStatus = "no-bet-recorded";
    const database = await this.open();
    const transaction = database.transaction(["sessions", "tableEvents"], "readwrite");
    const sessions = transaction.objectStore("sessions");
    const request = sessions.get(sessionId);
    request.onsuccess = () => {
      if (!currentRevision(transaction, request.result, expectedRevision ?? (session.revision || 0))) return;
      if (request.result.pendingActualWager){
        abortChange(transaction, "Resolve the confirmed wager before recording a gap.");
        return;
      }
      session.revision = (session.revision || 0) + 1;
      sessions.put(session);
      transaction.objectStore("tableEvents").add(event);
    };
    await transactionResult(transaction);
    return event;
  }

  async recordTableEvent(tableId, sessionId, eventType, details = {}){
    const event = {id: this.createId(), tableId, sessionId, eventType, details: structuredClone(details), createdAt: this.now()};
    if (eventType === "observer-handover"){
      const recent = (await this.listEvents(tableId)).filter((prior) => prior.eventType === eventType && Date.parse(event.createdAt) - Date.parse(prior.createdAt) < 3600000);
      event.integrityFlags = recent.length >= 3 ? ["frequent-observer-changes"] : [];
    }
    const database = await this.open();
    const transaction = database.transaction("tableEvents", "readwrite");
    transaction.objectStore("tableEvents").add(event);
    await transactionResult(transaction);
    return event;
  }

  async listEvents(tableId){
    const database = await this.open();
    const events = await requestResult(database.transaction("tableEvents", "readonly").objectStore("tableEvents").index(EVENT_INDEX).getAll(tableId));
    return events.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async listObservations(tableId){
    const database = await this.open();
    const transaction = database.transaction(["observations", "corrections"], "readonly");
    const observationRequest = transaction.objectStore("observations").index(OBSERVATION_INDEX).getAll(tableId);
    const correctionRequest = transaction.objectStore("corrections").index(CORRECTION_INDEX).getAll(tableId);
    const [observations, corrections] = await Promise.all([requestResult(observationRequest), requestResult(correctionRequest)]);
    const correctionMap = new Map();
    for (const correction of corrections){
      const list = correctionMap.get(correction.observationId) || [];
      list.push(correction);
      correctionMap.set(correction.observationId, list);
    }
    return observations.sort((left, right) => left.sequence - right.sequence).map((observation) => {
      const revisions = (correctionMap.get(observation.id) || []).sort((left, right) => observation.correctionIds.indexOf(left.id) - observation.correctionIds.indexOf(right.id));
      const latestRevision = revisions.at(-1);
      return {
        ...observation,
        effectiveOutcome: latestRevision ? latestRevision.correctedOutcome : observation.outcome,
        voided: latestRevision?.correctedOutcome === null,
        originalEvaluation: observation.evaluation,
        evaluation: latestRevision?.evaluation ?? observation.evaluation,
        corrections: revisions,
      };
    });
  }

  async addCorrection(observationId, correctedOutcome, reason = "", {updatedSession = null, updatedSessions = [], expectedRevision, evaluation = null, modelState = null, evidenceResetSequence = null} = {}){
    if (correctedOutcome !== null && !isValidOutcome(correctedOutcome)) throw new RangeError("Invalid corrected result.");
    const database = await this.open();
    const transaction = database.transaction(["tables", "sessions", "observations", "corrections"], "readwrite");
    const tables = transaction.objectStore("tables");
    const observations = transaction.objectStore("observations");
    const corrections = transaction.objectStore("corrections");
    const request = observations.get(observationId);
    const priorCorrections = corrections.index("observationId").getAll(observationId);
    let correction;
    request.onsuccess = () => {
      const observation = request.result;
      if (!observation){
        transaction.abort();
        return;
      }
      priorCorrections.onsuccess = () => {
        const latest = priorCorrections.result.sort((left, right) => observation.correctionIds.indexOf(left.id) - observation.correctionIds.indexOf(right.id)).at(-1);
        correction = {
          id: this.createId(),
          tableId: observation.tableId,
          observationId,
          previousOutcome: latest ? latest.correctedOutcome : observation.outcome,
          correctedOutcome,
          reason: typeof reason === "string" ? reason.slice(0, 240) : "",
          evaluation: evaluation ? structuredClone(evaluation) : null,
          createdAt: this.now(),
        };
        observation.correctionIds.push(correction.id);
        observations.put(observation);
        corrections.add(correction);
        if (updatedSession){
          const sessions = transaction.objectStore("sessions");
          const activeRequest = sessions.get(updatedSession.id);
          activeRequest.onsuccess = () => {
            if (!currentRevision(transaction, activeRequest.result, expectedRevision)) return;
            if (activeRequest.result.pendingActualWager){
              abortChange(transaction, "Resolve the confirmed wager before correcting history.");
              return;
            }
            for (const session of updatedSessions){
              if (session.id === updatedSession.id) continue;
              const priorRequest = sessions.get(session.id);
              priorRequest.onsuccess = () => {
                if (!currentRevision(transaction, priorRequest.result, session.revision || 0)) return;
                sessions.put({...session, revision: (priorRequest.result.revision || 0) + 1});
              };
            }
            sessions.put({...updatedSession, revision: (activeRequest.result.revision || 0) + 1});
          };
        }
        if (modelState){
          const tableRequest = tables.get(observation.tableId);
          tableRequest.onsuccess = () => {
            if (!tableRequest.result){
              transaction.abort();
              return;
            }
            tableRequest.result.modelState = modelState;
            tableRequest.result.evidenceResetSequence = evidenceResetSequence;
            tableRequest.result.updatedAt = this.now();
            tables.put(tableRequest.result);
          };
          tableRequest.onerror = () => transaction.abort();
        }
      };
    };
    request.onerror = () => transaction.abort();
    await transactionResult(transaction);
    return correction;
  }

  async deleteTable(tableId){
    const database = await this.open();
    const existing = await this.getTable(tableId);
    if (!existing) return false;
    const transaction = database.transaction(["tables", "sessions", "observations", "corrections", "tableEvents", "settings"], "readwrite");
    for (const storeName of ["sessions", "observations", "corrections", "tableEvents"]){
      const store = transaction.objectStore(storeName);
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor){
          if (cursor.value.tableId === tableId) cursor.delete();
          cursor.continue();
        }
      };
    }
    transaction.objectStore("tables").delete(tableId);
    const settings = transaction.objectStore("settings");
    const settingRequest = settings.get("activeTableId");
    settingRequest.onsuccess = () => {
      if (settingRequest.result?.value === tableId) settings.delete("activeTableId");
    };
    await transactionResult(transaction);
    return true;
  }
}