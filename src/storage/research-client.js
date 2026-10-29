const DEFAULT_API_BASE = new URL("../../server/api/v1/", import.meta.url).href;
export function resolveTrustedApiBase(baseUrl, currentUrl = globalThis.location?.href){
  if (!currentUrl) throw new TypeError("A browser page URL is required to validate the BRI service origin.");
  const page = new URL(currentUrl);
  const target = new URL(baseUrl || "server/api/v1/", page);
  if (target.origin !== page.origin || target.username || target.password || target.search || target.hash){
    throw new Error("BRI storage must use a same-origin API URL without embedded credentials or query parameters.");
  }
  const localDevelopment = ["localhost", "127.0.0.1", "::1"].includes(page.hostname);
  if (page.protocol !== "https:" && !localDevelopment){
    throw new Error("BRI storage requires HTTPS outside localhost development.");
  }
  return target.href;
}

export class ResearchClient{
  constructor({baseUrl = DEFAULT_API_BASE, token = "", fetchImpl = globalThis.fetch, storage = globalThis.localStorage, outboxKey = "bank-roll-bri-outbox"} = {}){
    this.baseUrl = new URL(baseUrl, globalThis.location?.href || import.meta.url);
    if (!this.baseUrl.pathname.endsWith("/")) this.baseUrl.pathname += "/";
    this.token = token;
    this.fetchImpl = fetchImpl;
    this.storage = storage;
    this.outboxKey = outboxKey;
  }

  async request(endpoint, {method = "GET", body, headers = {}} = {}){
    const requestHeaders = new Headers(headers);
    if (body !== undefined) requestHeaders.set("Content-Type", "application/json");
    if (this.token) requestHeaders.set("Authorization", `Bearer ${this.token}`);
    const response = await this.fetchImpl(new URL(endpoint, this.baseUrl), {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
    });
    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error("The BRI service returned an invalid response.");
    }
    if (!response.ok) throw new Error(result.error || `BRI request failed (${response.status}).`);
    return result;
  }

  register({displayName, shareResearch = false, registrationKey}){
    return this.request("register.php", {
      method: "POST",
      body: {display_name: displayName, share_research: shareResearch},
      headers: {"X-Bankroll-Registration-Key": registrationKey},
    });
  }

  createSession(session){
    return this.request("sessions.php", {method: "POST", body: session});
  }

  setResearchConsent(shareResearch){
    return this.request("consent.php", {method: "PUT", body: {share_research: Boolean(shareResearch)}});
  }

  async recordForecast(forecast){
    if (!this.storage){
      await this.flushOutbox();
      return this.request("forecasts.php", {method: "POST", body: forecast});
    }
    this.enqueue({type: "forecast", payload: forecast});
    try {
      await this.flushOutbox();
      return {stored: true, queued: false};
    } catch (error) {
      return {stored: false, queued: true, error: error.message};
    }
  }

  async recordDecision(decision){
    if (!this.storage){
      await this.flushOutbox();
      return this.request("decisions.php", {method: "POST", body: decision});
    }
    this.enqueue({type: "decision", payload: decision});
    try {
      await this.flushOutbox();
      return {stored: true, queued: false};
    } catch (error) {
      return {stored: false, queued: true, error: error.message};
    }
  }

  async appendObservations(batch){
    if (!this.storage) return this.request("observations.php", {method: "POST", body: batch});
    this.enqueue({type: "observations", payload: batch});
    try {
      await this.flushOutbox();
      return {stored: true, queued: false};
    } catch (error) {
      return {stored: false, queued: true, error: error.message};
    }
  }

  enqueue(batch){
    if (!this.storage) return;
    const queue = this.readOutbox();
    queue.push(batch);
    const encoded = JSON.stringify(queue);
    if (encoded.length > 4_000_000) throw new Error("BRI offline storage is full; reconnect before recording more spins.");
    this.storage.setItem(this.outboxKey, encoded);
  }

  readOutbox(){
    if (!this.storage) return [];
    const value = this.storage.getItem(this.outboxKey);
    if (!value) return [];
    const queue = JSON.parse(value);
    if (!Array.isArray(queue)) throw new Error("BRI offline queue is invalid.");
    return queue;
  }

  async flushOutbox(){
    if (!this.storage) return 0;
    let queue = this.readOutbox();
    let flushed = 0;
    while (queue.length){
      const item = queue[0];
      if (item.type === "forecast") await this.request("forecasts.php", {method: "POST", body: item.payload});
      else if (item.type === "decision") await this.request("decisions.php", {method: "POST", body: item.payload});
      else if (item.type === "observations") await this.request("observations.php", {method: "POST", body: item.payload});
      else await this.request("observations.php", {method: "POST", body: item});
      queue = queue.slice(1);
      this.storage.setItem(this.outboxKey, JSON.stringify(queue));
      flushed++;
    }
    return flushed;
  }

  listTables(){
    return this.request("tables.php");
  }

  createTable(profile){
    if (!profile || typeof profile.id !== "string" || !profile.id || typeof profile.name !== "string" || !profile.name){
      throw new TypeError("A table profile with an ID and name is required.");
    }
    return this.request("tables.php", {
      method: "POST",
      body: {
        table_id: profile.id,
        table_name: profile.name,
        table_type: profile.tableType,
        shared_cohort_id: profile.sharedCohortId || null,
      },
    });
  }

  setActiveTable(tableId){
    if (typeof tableId !== "string" || !tableId) throw new TypeError("An owned table ID is required.");
    return this.request("tables.php", {method: "PUT", body: {table_id: tableId}});
  }

  getMetrics(tableId){
    const query = new URLSearchParams({table_id: tableId});
    return this.request(`metrics.php?${query}`);
  }

  getModelState(tableId, dataOrigin = "observed"){
    const query = new URLSearchParams({table_id: tableId, data_origin: dataOrigin});
    return this.request(`model-state.php?${query}`);
  }

  recordIntegrityChallenge(run){
    return this.request("integrity-challenges.php", {method: "POST", body: run});
  }

  listIntegrityChallenges({limit = 20} = {}){
    const query = new URLSearchParams({limit: String(limit)});
    return this.request(`integrity-challenges.php?${query}`);
  }

  recordCorrection(correction){
    return this.request("corrections.php", {method: "POST", body: correction});
  }

  getCorrectionHistory(eventId){
    const query = new URLSearchParams({event_id: eventId});
    return this.request(`corrections.php?${query}`);
  }

  runRebuild({tableId, dataOrigin = "observed"}){
    return this.request("rebuild.php", {method: "POST", body: {table_id: tableId, data_origin: dataOrigin}});
  }

  getRebuildStatus({tableId, dataOrigin = "observed", offset = 0, limit = 500} = {}){
    const query = new URLSearchParams({table_id: tableId, data_origin: dataOrigin, offset: String(offset), limit: String(limit)});
    return this.request(`rebuild.php?${query}`);
  }

  uploadModelState({tableId, dataOrigin = "observed", modelState}){
    return this.request("model-state.php", {method: "POST", body: {table_id: tableId, data_origin: dataOrigin, model_state: modelState}});
  }

  getSharedAggregates(cohortId){
    if (typeof cohortId !== "string" || !cohortId) throw new TypeError("An explicit shared cohort ID is required.");
    const query = new URLSearchParams({cohort_id: cohortId});
    return this.request(`shared-aggregates.php?${query}`);
  }

  getHistory(sessionId, {afterSpin = 0, limit = 250} = {}){
    const query = new URLSearchParams({session_id: sessionId, after_spin: String(afterSpin), limit: String(limit)});
    return this.request(`history.php?${query}`);
  }

  getDecisions(sessionId, {afterSpin = 0, limit = 250} = {}){
    const query = new URLSearchParams({session_id: sessionId, after_spin: String(afterSpin), limit: String(limit)});
    return this.request(`decisions.php?${query}`);
  }
}