import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const researchFields = {
  researchStatus: "status",
  researchObserved: "observed",
  researchMaturity: "maturity",
  researchProvenance: "provenance",
  researchLastUpdate: "lastUpdate",
  researchExplanation: "explanation",
  researchForecastCaption: "forecastCaption",
  researchNumberCaption: "numberCaption",
  researchEvidence: "evidence",
  researchStrategyState: "strategy",
  researchTimelineCount: "timelineCount",
};

class FakeElement{
  constructor(id = ""){
    this.id = id;
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.textContent = "";
    this.innerText = "";
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    this.dataset = {};
    this.style = {setProperty(){}};
    this.classList = {
      tokens: new Set(),
      add: (...tokens) => tokens.forEach((token) => this.classList.tokens.add(token)),
      remove: (...tokens) => tokens.forEach((token) => this.classList.tokens.delete(token)),
      contains: (token) => this.classList.tokens.has(token),
      toggle: (token, force) => {
        const shouldAdd = force === undefined ? !this.classList.tokens.has(token) : Boolean(force);
        if (shouldAdd) this.classList.tokens.add(token);
        else this.classList.tokens.delete(token);
        return shouldAdd;
      },
    };
    this.width = 1200;
    this.height = 360;
    this._innerHTML = "";
  }

  set innerHTML(value){
    this._innerHTML = value;
    if (value === "") this.children = [];
  }
  get innerHTML(){ return this._innerHTML; }
  addEventListener(type, handler){
    const listeners = this.listeners.get(type) || [];
    listeners.push(handler);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, handler){
    this.listeners.set(type, (this.listeners.get(type) || []).filter((entry) => entry !== handler));
  }
  dispatch(type, event = {}){
    for (const listener of this.listeners.get(type) || []) listener({target: this, preventDefault(){}, ...event});
  }
  append(...nodes){
    for (const node of nodes){
      if (node?.isFragment) this.children.push(...node.children);
      else this.children.push(node);
    }
  }
  appendChild(node){ this.append(node); return node; }
  replaceChildren(...nodes){ this.children = []; this.append(...nodes); }
  setAttribute(name, value){ this.attributes.set(name, String(value)); }
  getAttribute(name){ return this.attributes.get(name) || null; }
  querySelectorAll(selector){
    if (this.id === "researchIntelligence" && selector === "[data-research-field]"){
      return Object.keys(researchFields).map((id) => document.getElementById(id));
    }
    return [];
  }
  querySelector(){ return new FakeElement(); }
  getContext(){
    return new Proxy({}, {
      get: (_target, key) => key === "createLinearGradient" ? () => ({addColorStop(){}}) : () => {},
      set: () => true,
    });
  }
}

function makeMemoryStorage(){
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test("app initializes the original board and controls when randomUUID and Web Crypto are unavailable", async () => {
  const globals = ["document", "window", "localStorage", "sessionStorage", "crypto", "requestAnimationFrame", "getComputedStyle", "confirm", "Option", "setTimeout"];
  const descriptors = new Map(globals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const elements = new Map();
  const defaults = {
    bankroll: "100",
    unit: "0.20",
    sessions: "1",
    maxSpins: "5",
    simulationMode: "cold-street",
    betType: "streets",
    coldThreshold: "0",
    maxStreets: "1",
    progression: "flat",
    maxSteps: "5",
    stopLoss: "0",
    takeProfit: "0",
    seed: "startup-regression",
  };
  const getElement = (id) => {
    if (!elements.has(id)){
      const element = new FakeElement(id);
      element.value = defaults[id] || "";
      if (researchFields[id]) element.dataset.researchField = researchFields[id];
      elements.set(id, element);
    }
    return elements.get(id);
  };
  const container = new FakeElement("widgets-container");
  const document = {
    getElementById: getElement,
    createElement: (tag) => new FakeElement(tag),
    createDocumentFragment: () => Object.assign(new FakeElement("fragment"), {isFragment: true}),
    querySelector: (selector) => selector === ".widgets-container" ? container : new FakeElement(selector),
    querySelectorAll: () => [],
    addEventListener(){},
    removeEventListener(){},
    body: new FakeElement("body"),
    activeElement: new FakeElement("body"),
    documentElement: new FakeElement("html"),
  };
  document.documentElement.style.setProperty = () => {};
  const listeners = new Map();
  const window = {
    innerWidth: 1280,
    addEventListener(type, callback){ listeners.set(type, callback); },
    getComputedStyle: () => ({gridColumn: "", gridRow: ""}),
  };
  const storage = makeMemoryStorage();
  const pendingSpinTimers = [];
  const originalSetTimeout = globalThis.setTimeout;

  globalThis.document = document;
  globalThis.window = window;
  globalThis.localStorage = storage;
  globalThis.sessionStorage = makeMemoryStorage();
  Object.defineProperty(globalThis, "crypto", {configurable: true, value: {}});
  globalThis.requestAnimationFrame = (callback) => { queueMicrotask(callback); return 1; };
  globalThis.getComputedStyle = () => ({getPropertyValue: () => "sans-serif", gridColumn: "", gridRow: ""});
  globalThis.confirm = () => true;
  globalThis.Option = class Option{constructor(text, value){this.text = text; this.value = value;}};
  globalThis.setTimeout = (callback, delay = 0) => {
    if (delay >= 1000) pendingSpinTimers.push(callback);
    else queueMicrotask(callback);
    return pendingSpinTimers.length;
  };

  try {
    await import(`../../src/ui/app.js?startup-without-random-uuid=${Date.now()}`);

    const board = getElement("streetGrid");
    assert.equal(board.children.length, 2, "zero and number grid should be built");
    assert.equal(board.children[0].textContent, "0");
    const numberGrid = board.children[1];
    const expectedOrder = [];
    for (let row = 0; row < 3; row++){
      for (let column = 0; column < 12; column++) expectedOrder.push(column * 3 + (3 - row));
    }
    assert.deepEqual(numberGrid.children.slice(0, 36).map((cell) => Number(cell.textContent)), expectedOrder);
    assert.equal(numberGrid.children[36].className, "street-chip-layer");
    assert.equal(numberGrid.children[36].children.length, 12, "all street chip holders should be present");
    assert.ok(getElement("btnRunStop").listeners.get("click")?.length, "Run/Stop listener should be registered");
    assert.ok(getElement("btnReset").listeners.get("click")?.length, "Reset listener should be registered");
    assert.ok(getElement("btnConfig").listeners.get("click")?.length, "Configuration listener should be registered");
    assert.match(getElement("researchTableName").textContent, /Bank-Roll simulated table/);

    getElement("btnConfig").dispatch("click");
    assert.equal(getElement("configOverlay").classList.contains("active"), true);
    getElement("closeConfig").dispatch("click");
    assert.equal(getElement("configOverlay").classList.contains("active"), false);

    const runHandler = getElement("btnRunStop").listeners.get("click")[0];
    runHandler();
    for (let attempt = 0; attempt < 20 && pendingSpinTimers.length === 0; attempt++) await new Promise((resolve) => setImmediate(resolve));
    assert.ok(pendingSpinTimers.length, "Run should reach its first spin animation");
    assert.equal(getElement("pillStatus").textContent, "Running");
    runHandler();
    assert.equal(getElement("statusText").textContent, "Pausing...");
    pendingSpinTimers.shift()();
    for (let attempt = 0; attempt < 30 && !getElement("statusText").textContent.startsWith("Paused at"); attempt++) await new Promise((resolve) => setImmediate(resolve));
    assert.match(getElement("statusText").textContent, /^Paused at session/);

    getElement("btnReset").dispatch("click");
    assert.equal(getElement("pillStatus").textContent, "Ready");
    assert.equal(getElement("liveSession").textContent, "-");
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    for (const name of globals){
      const descriptor = descriptors.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});