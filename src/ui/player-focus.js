const key = "bank-roll-player-focus";
const button = document.getElementById("focusModeButton");
const summary = document.querySelector(".focus-summary");
const status = document.getElementById("focusStorageStatus");
let enabled = false;

function storageFailure(error){
  console.warn("Bank-Roll could not access the Focus Mode preference.", error);
  status.textContent = "Display preference cannot be saved. Focus Mode still works on this page.";
}

function syncSummary(){
  for (const [target, source] of [
    ["focusTable", "activeTableName"], ["focusBankroll", "bankrollValue"],
    ["focusProfit", "profitValue"], ["focusAction", "recommendation-title"],
  ]){
    const original = document.getElementById(source);
    const copy = document.getElementById(target);
    let text = original.textContent;
    if (target === "focusProfit"){
      if (original.classList.contains("negative")) text = text.replace("£-", "-£");
      else if (text !== "£0.00") text = `+${text}`;
    }
    copy.textContent = text;
    copy.classList.toggle("negative", original.classList.contains("negative"));
  }
}

function apply(){
  document.body.classList.toggle("player-focus", enabled);
  button.textContent = enabled ? "Exit Focus Mode" : "Focus Mode";
  button.setAttribute("aria-pressed", String(enabled));
  summary.hidden = !enabled;
  if (enabled){
    document.querySelectorAll("#playerWorkspace details").forEach(details => {details.open = false;});
  }
  syncSummary();
}

try {
  enabled = localStorage.getItem(key) === "true";
} catch (error) {
  storageFailure(error);
}
button.addEventListener("click", () => {
  enabled = !enabled;
  apply();
  try {
    localStorage.setItem(key, String(enabled));
    status.textContent = "";
  } catch (error) {
    storageFailure(error);
  }
});
window.addEventListener("storage", event => {
  if (event.key !== key && event.key !== null) return;
  enabled = event.newValue === "true";
  apply();
});
const observer = new MutationObserver(syncSummary);
for (const id of ["activeTableName", "bankrollValue", "profitValue", "recommendation-title"]){
  observer.observe(document.getElementById(id), {childList:true, subtree:true, attributes:true, attributeFilter:["class"]});
}
apply();
