import assert from "node:assert/strict";
import test from "node:test";
import {TableProfileStore} from "../../src/storage/table-profile-store.js";

function makeStorage(initial = {}){
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    values,
  };
}

function makeStore(storage, ids = ["table-a", "table-b", "table-c"]){
  return new TableProfileStore({
    storage,
    createId: () => ids.shift(),
    clock: () => "2026-10-29T12:00:00.000Z",
  });
}

test("table profile registry migrates the former single active profile", () => {
  const storage = makeStorage({
    "bank-roll-bri-table-profile": JSON.stringify({id: "legacy-table", name: "Old table", sharedCohortId: "cohort-a"}),
  });
  const store = makeStore(storage);

  assert.deepEqual(store.ensureActive(), {
    id: "legacy-table",
    name: "Old table",
    tableType: "simulated",
    sharedCohortId: "cohort-a",
    createdAt: "2026-10-29T12:00:00.000Z",
  });
  assert.equal(JSON.parse(storage.getItem("bank-roll-bri-table-profiles")).activeTableId, "legacy-table");
});

test("profiles persist independently and only explicit activation changes the active table", () => {
  const storage = makeStorage();
  const firstStore = makeStore(storage);
  const first = firstStore.ensureActive();
  const second = firstStore.create({name: "Second table", tableType: "physical"});
  assert.equal(firstStore.getActive().id, first.id);

  const reloadedStore = makeStore(storage);
  assert.equal(reloadedStore.getActive().id, first.id);
  assert.equal(reloadedStore.activate(second.id).id, second.id);

  const switchedBack = makeStore(storage).activate(first.id);
  assert.equal(switchedBack.id, first.id);
  assert.deepEqual(makeStore(storage).list().map((profile) => profile.id), [first.id, second.id]);
});

test("remote active table synchronization adopts the account-level active profile", () => {
  const storage = makeStorage();
  const store = makeStore(storage);
  const local = store.ensureActive();
  const active = {table_id: "server-table", table_name: "Server table", table_type: "physical", shared_cohort_id: null};

  const selected = store.syncRemote({tables: [active], activeTableId: active.table_id});

  assert.equal(selected.id, "server-table");
  assert.notEqual(selected.id, local.id);
  assert.equal(selected.tableType, "physical");
  assert.deepEqual(store.list().map((profile) => profile.id), [local.id, "server-table"]);
});

test("malformed profile storage fails without overwriting the original value", () => {
  const encoded = "not-json";
  const storage = makeStorage({"bank-roll-bri-table-profiles": encoded});
  const store = makeStore(storage);

  assert.throws(() => store.ensureActive(), /unreadable; no profile was changed/);
  assert.equal(storage.getItem("bank-roll-bri-table-profiles"), encoded);
});