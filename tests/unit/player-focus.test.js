import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source=readFileSync(new URL("../../src/ui/player-focus.js",import.meta.url),"utf8");
function initialise(saved="false",blocked=false){
  const elements=new Map();
  const writes=[];
  const warnings=[];
  const listeners=new Map();
  let mutations;
  function element(id){
    if(!elements.has(id)){
      const classes=new Set();
      elements.set(id,{
        textContent:"",hidden:false,
        classList:{contains:value=>classes.has(value),toggle:(value,on)=>on?classes.add(value):classes.delete(value)},
        setAttribute:(name,value)=>{elements.get(id)[name]=value;},
        addEventListener:(name,callback)=>listeners.set(`${id}:${name}`,callback),
      });
    }
    return elements.get(id);
  }
  element("activeTableName").textContent="Existing table";
  element("bankrollValue").textContent="£100.00";
  element("profitValue").textContent="£0.00";
  element("recommendation-title").textContent="OBSERVE / NO BET";
  const details=[{open:true}];
  runInNewContext(source,{
    document:{
      getElementById:element,
      querySelector:()=>element("summary"),
      querySelectorAll:()=>details,
      body:element("body"),
    },
    window:{addEventListener:(name,callback)=>listeners.set(name,callback)},
    localStorage:{
      getItem(){if(blocked)throw new Error("Blocked");return saved;},
      setItem:(key,value)=>{if(blocked)throw new Error("Blocked");writes.push([key,value]);},
    },
    console:{warn:(...args)=>warnings.push(args)},
    MutationObserver:class{constructor(callback){mutations=callback;}observe(){}},
  });
  return {element,writes,warnings,listeners,details,mutations};
}
test("Focus preference changes display only and retains the same toggle",()=>{
  const state=initialise();
  assert.equal(state.element("focusModeButton").textContent,"Focus Mode");
  state.listeners.get("focusModeButton:click")();
  assert.equal(state.element("focusModeButton").textContent,"Exit Focus Mode");
  assert.equal(state.element("body").classList.contains("player-focus"),true);
  assert.equal(state.details[0].open,false);
  assert.deepEqual(state.writes,[["bank-roll-player-focus","true"]]);
  assert.equal(state.element("activeTableName").textContent,"Existing table");
  assert.equal(state.element("bankrollValue").textContent,"£100.00");
});
test("restored focus mirrors existing rendered accounting including signed profit",()=>{
  const state=initialise("true");
  assert.equal(state.element("focusBankroll").textContent,"£100.00");
  state.element("profitValue").textContent="£2.20";
  state.mutations();
  assert.equal(state.element("focusProfit").textContent,"+£2.20");
  state.element("profitValue").textContent="£-1.00";
  state.element("profitValue").classList.toggle("negative",true);
  state.mutations();
  assert.equal(state.element("focusProfit").textContent,"-£1.00");
  assert.deepEqual(state.writes,[]);
});
test("blocked preference storage reports failure but retains current-page focus",()=>{
  const state=initialise(null,true);
  state.listeners.get("focusModeButton:click")();
  assert.equal(state.element("body").classList.contains("player-focus"),true);
  assert.match(state.element("focusStorageStatus").textContent,/cannot be saved/);
  assert.equal(state.warnings.length,2);
});
