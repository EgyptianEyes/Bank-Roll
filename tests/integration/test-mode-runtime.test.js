import assert from "node:assert/strict";
import test from "node:test";
import {TestModeSession} from "../../src/simulation/sandbox-session.js";

class Element{
  constructor(id = ""){
    this.id = id;
    this.value = id === "testWageringMode" ? "evidence-gated" : id === "testCompanionMode" ? "companion" : id === "testBatchCount" ? "10" : "";
    this.textContent = "";
    this.disabled = false;
    this.hidden = false;
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
    const classes = new Set();
    this.classList = {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    };
    this.style = {setProperty: (name, value) => this.attributes.set(name, value)};
  }
  addEventListener(type, handler){
    const listeners = this.listeners.get(type) || [];
    listeners.push(handler);
    this.listeners.set(type, listeners);
  }
  dispatch(type){ for (const handler of this.listeners.get(type) || []) handler({target: this, preventDefault(){}}); }
  append(...children){
    for (const child of children){
      if (child?.isFragment) this.children.push(...child.children);
      else this.children.push(child);
    }
  }
  appendChild(child){ this.append(child); return child; }
  replaceChildren(...children){ this.children = []; this.append(...children); }
  setAttribute(name, value){ this.attributes.set(name, String(value)); }
}

test("Test Mode page starts, accepts manual outcomes, generates spins and discards without Web Crypto", async () => {
  const globalNames = ["document", "window", "crypto", "Option"];
  const descriptors = new Map(globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, new Element(id));
    return elements.get(id);
  };
  globalThis.document = {
    getElementById: getElement,
    createElement: (tag) => new Element(tag),
    createDocumentFragment: () => Object.assign(new Element("fragment"), {isFragment: true}),
    addEventListener(){},
  };
  const timers = new Map();
  let nextTimer = 0;
  globalThis.window = {
    addEventListener(){}, setInterval(){return 1;},
    setTimeout(callback, delay){timers.set(++nextTimer, {callback, delay}); return nextTimer;},
    clearTimeout(id){timers.delete(id);},
  };
  Object.defineProperty(globalThis, "crypto", {configurable: true, value: {}});
  globalThis.Option = class Option{text; value; constructor(text, value){this.text = text; this.value = value;}};

  try {
    await import(`../../src/ui/sandbox-app.js?runtime=${Date.now()}`);
    getElement("btnStartTest").dispatch("click");
    assert.equal(getElement("testSetup").hidden, true);
    assert.equal(getElement("testSession").hidden, false);
    assert.match(getElement("testExpiry").textContent, /^Expires in/);
    assert.equal(getElement("testNumberPad").children.length, 37);

    getElement("testNumberPad").children[0].dispatch("click");
    getElement("testNumberPad").children[36].dispatch("click");
    assert.equal(getElement("testSpinCount").textContent, "2");
    assert.equal(getElement("testLastResult").textContent, "Recorded: 36");
    assert.equal(getElement("testEntryCount").textContent, "2 observations");
    const repeated = getElement("testNumberPad").children[17];
    for (let index = 0; index < 5; index++) repeated.dispatch("click");
    assert.equal(getElement("testSpinCount").textContent, "7");
    assert.equal(getElement("testLastResult").textContent, "Recorded: 17");
    assert.equal(getElement("testLastResult").className, "test-result-black");
    assert.deepEqual(getElement("testRecentResults").children.slice(0, 5).map(item => item.textContent), ["17", "17", "17", "17", "17"]);
    assert.equal(repeated.classList.contains("test-number-recorded"), true);
    assert.equal(timers.size, 3);
    for (const [id, {callback, delay}] of [...timers]){
      assert.equal(delay, 650);
      timers.delete(id);
      callback();
    }
    assert.equal(repeated.classList.contains("test-number-recorded"), false);

    const recordOutcome = TestModeSession.prototype.recordOutcome;
    try {
      TestModeSession.prototype.recordOutcome = () => {throw new Error("Recording unavailable");};
      getElement("testNumberPad").children[13].dispatch("click");
      assert.equal(getElement("testInputStatus").textContent, "Recording unavailable");
      assert.equal(getElement("testSpinCount").textContent, "7");
      assert.equal(getElement("testLastResult").textContent, "Latest: 17");
      assert.equal(getElement("testNumberPad").children[13].classList.contains("test-number-recorded"), false);
    } finally {
      TestModeSession.prototype.recordOutcome = recordOutcome;
    }

    getElement("btnGenerateOne").dispatch("click");
    assert.equal(getElement("testSpinCount").textContent, "8");
    getElement("btnGenerateBatch").dispatch("click");
    assert.equal(getElement("testSpinCount").textContent, "18");
    assert.match(getElement("testInputStatus").textContent, /synthetic spin/);

    getElement("btnDiscardTest").dispatch("click");
    assert.equal(getElement("testSession").hidden, true);
    assert.equal(getElement("testSetup").hidden, false);
    assert.equal(getElement("testSpinCount").textContent, "0");
    assert.equal(getElement("testBankroll").textContent, "£100.00");
    assert.equal(getElement("testRecentResults").children.length, 0);
    assert.equal(timers.size, 0);
  } finally {
    for (const name of globalNames){
      const descriptor = descriptors.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
