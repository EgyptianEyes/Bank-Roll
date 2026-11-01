import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source = readFileSync(new URL("../../assets/js/theme.js", import.meta.url), "utf8");

function initialise({saved = null, dark = false, blocked = false} = {}){
  const callbacks = new Map();
  const warnings = [];
  const writes = [];
  const root = {dataset: {}, style: {}};
  const control = {value: "", addEventListener: (name, callback) => callbacks.set(`control:${name}`, callback)};
  const status = {textContent: ""};
  const system = {matches: dark, addEventListener: (name, callback) => callbacks.set(`system:${name}`, callback)};
  const window = {
    matchMedia: () => system,
    addEventListener: (name, callback) => callbacks.set(`window:${name}`, callback),
    dispatchEvent(){},
  };
  const document = {
    documentElement: root,
    addEventListener: (name, callback) => callbacks.set(`document:${name}`, callback),
    querySelector: (selector) => selector === "[data-theme-select]" ? control : selector === "[data-theme-status]" ? status : null,
  };
  runInNewContext(source, {
    window, document, Event: class Event {},
    console: {warn: (...args) => warnings.push(args)},
    localStorage: {
      getItem(){
        if (blocked) throw new Error("Storage blocked");
        return saved;
      },
      setItem(key, value){
        if (blocked) throw new Error("Storage blocked");
        writes.push({key, value});
      },
    },
  });
  return {callbacks, root, control, status, system, warnings, writes};
}

test("theme initialises from the system before document readiness without saving a preference", () => {
  const state = initialise({dark: true});
  assert.equal(state.root.dataset.theme, "dark");
  assert.equal(state.root.style.colorScheme, "dark");
  assert.deepEqual(state.writes, []);
  state.system.matches = false;
  state.callbacks.get("system:change")();
  assert.equal(state.root.dataset.theme, "light");
});

test("manual preference overrides OS changes and can return to system", () => {
  const state = initialise({saved: "dark"});
  assert.equal(state.root.dataset.theme, "dark");
  state.callbacks.get("document:DOMContentLoaded")();
  state.system.matches = false;
  state.callbacks.get("system:change")();
  assert.equal(state.root.dataset.theme, "dark");
  state.control.value = "system";
  state.callbacks.get("control:change")();
  assert.equal(state.root.dataset.theme, "light");
  assert.deepEqual(state.writes, [{key: "bank-roll-theme", value: "system"}]);
});

test("cross-page storage changes and cleared preferences synchronise the active theme", () => {
  const state = initialise({saved: "dark", dark: true});
  state.callbacks.get("window:storage")({key: "bank-roll-theme", newValue: "light"});
  assert.equal(state.root.dataset.theme, "light");
  state.callbacks.get("window:storage")({key: null, newValue: null});
  assert.equal(state.root.dataset.theme, "dark");
  assert.deepEqual(state.writes, []);
});

test("blocked theme storage logs and displays the persistence limitation without breaking switching", () => {
  const state = initialise({blocked: true});
  state.callbacks.get("document:DOMContentLoaded")();
  assert.match(state.status.textContent, /storage is unavailable/);
  state.control.value = "dark";
  state.callbacks.get("control:change")();
  assert.equal(state.root.dataset.theme, "dark");
  assert.match(state.status.textContent, /could not be saved/);
  assert.equal(state.warnings.length, 2);
});
