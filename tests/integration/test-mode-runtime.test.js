import assert from "node:assert/strict";
import test from "node:test";

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
  globalThis.window = {addEventListener(){}, setInterval(){return 1;}};
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
    assert.equal(getElement("testLastResult").textContent, "Last result 36");

    getElement("btnGenerateOne").dispatch("click");
    assert.equal(getElement("testSpinCount").textContent, "3");
    getElement("btnGenerateBatch").dispatch("click");
    assert.equal(getElement("testSpinCount").textContent, "13");
    assert.match(getElement("testInputStatus").textContent, /synthetic spin/);

    getElement("btnDiscardTest").dispatch("click");
    assert.equal(getElement("testSession").hidden, true);
    assert.equal(getElement("testSetup").hidden, false);
    assert.equal(getElement("testSpinCount").textContent, "0");
    assert.equal(getElement("testBankroll").textContent, "£100.00");
  } finally {
    for (const name of globalNames){
      const descriptor = descriptors.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
