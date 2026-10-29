const REGISTRY_VERSION = 1;
const DEFAULT_KEY = "bank-roll-bri-table-profiles";
const LEGACY_KEY = "bank-roll-bri-table-profile";

export class TableProfileStore{
  constructor({storage = globalThis.localStorage, key = DEFAULT_KEY, legacyKey = LEGACY_KEY, createId = () => globalThis.crypto.randomUUID(), clock = () => new Date().toISOString()} = {}){
    if (!storage) throw new TypeError("Persistent table-profile storage is required.");
    this.storage = storage;
    this.key = key;
    this.legacyKey = legacyKey;
    this.createId = createId;
    this.clock = clock;
  }

  list(){
    return this.#read().profiles.map((profile) => ({...profile}));
  }

  getActive(){
    const registry = this.#read();
    return registry.profiles.find((profile) => profile.id === registry.activeTableId) || null;
  }

  ensureActive({name = "Bank-Roll simulated table", tableType = "simulated", sharedCohortId = null} = {}){
    const registry = this.#read();
    const existing = registry.profiles.find((profile) => profile.id === registry.activeTableId);
    if (existing) return {...existing};
    if (registry.profiles.length){
      registry.activeTableId = registry.profiles[0].id;
      this.#write(registry);
      return {...registry.profiles[0]};
    }
    const migrated = this.#readLegacyProfile();
    const profile = migrated || this.#makeProfile(name, tableType, sharedCohortId);
    registry.profiles.push(profile);
    registry.activeTableId = profile.id;
    this.#write(registry);
    return {...profile};
  }

  create({name, tableType = "simulated", sharedCohortId = null} = {}){
    const safeName = typeof name === "string" ? name.trim() : "";
    if (!safeName || safeName.length > 120) throw new RangeError("Table name must contain 1 to 120 characters.");
    if (!new Set(["physical", "electronic", "online_rng", "simulated", "imported"]).has(tableType)){
      throw new RangeError("Unsupported table type.");
    }
    const cohort = sharedCohortId === "" || sharedCohortId == null ? null : sharedCohortId;
    const profile = this.#makeProfile(safeName, tableType, cohort);
    const registry = this.#read();
    registry.profiles.push(profile);
    this.#write(registry);
    return {...profile};
  }

  activate(tableId){
    const registry = this.#read();
    if (!registry.profiles.some((profile) => profile.id === tableId)) throw new RangeError("Table profile does not exist.");
    registry.activeTableId = tableId;
    this.#write(registry);
    return {...registry.profiles.find((profile) => profile.id === tableId)};
  }

  syncRemote({tables = [], activeTableId = null} = {}){
    if (!Array.isArray(tables)) throw new TypeError("Remote table profiles must be an array.");
    const registry = this.#read();
    for (const table of tables){
      if (!table || typeof table.table_id !== "string" || typeof table.table_name !== "string") continue;
      const remoteProfile = {
        id: table.table_id,
        name: table.table_name,
        tableType: table.table_type,
        sharedCohortId: table.shared_cohort_id || null,
        createdAt: table.created_at || this.clock(),
      };
      const existing = registry.profiles.find((profile) => profile.id === remoteProfile.id);
      if (existing) Object.assign(existing, remoteProfile);
      else registry.profiles.push(remoteProfile);
    }
    if (activeTableId && registry.profiles.some((profile) => profile.id === activeTableId)) registry.activeTableId = activeTableId;
    this.#write(registry);
    return this.getActive();
  }

  #makeProfile(name, tableType, sharedCohortId){
    return {id: this.createId(), name, tableType, sharedCohortId, createdAt: this.clock()};
  }

  #readLegacyProfile(){
    const encoded = this.storage.getItem(this.legacyKey);
    if (!encoded) return null;
    let legacy;
    try {
      legacy = JSON.parse(encoded);
    } catch {
      throw new Error("The saved table profile is unreadable; it was not changed.");
    }
    if (!legacy || typeof legacy.id !== "string" || typeof legacy.name !== "string"){
      throw new Error("The saved table profile is invalid; it was not changed.");
    }
    return {
      id: legacy.id,
      name: legacy.name,
      tableType: legacy.tableType || "simulated",
      sharedCohortId: legacy.sharedCohortId || null,
      createdAt: legacy.createdAt || this.clock(),
    };
  }

  #read(){
    const encoded = this.storage.getItem(this.key);
    if (!encoded) return {version: REGISTRY_VERSION, activeTableId: null, profiles: []};
    let registry;
    try {
      registry = JSON.parse(encoded);
    } catch {
      throw new Error("Saved table profiles are unreadable; no profile was changed.");
    }
    if (!registry || registry.version !== REGISTRY_VERSION || !Array.isArray(registry.profiles)){
      throw new Error("Saved table profiles have an unsupported format; no profile was changed.");
    }
    const ids = new Set();
    for (const profile of registry.profiles){
      if (!profile || typeof profile.id !== "string" || !profile.id || typeof profile.name !== "string" || !profile.name || ids.has(profile.id)){
        throw new Error("Saved table profiles are invalid; no profile was changed.");
      }
      ids.add(profile.id);
    }
    return {version: REGISTRY_VERSION, activeTableId: registry.activeTableId || null, profiles: registry.profiles};
  }

  #write(registry){
    this.storage.setItem(this.key, JSON.stringify(registry));
  }
}