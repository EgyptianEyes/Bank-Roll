const form = document.getElementById("experimentForm");
const run = document.getElementById("runExperiment");
const cancel = document.getElementById("cancelExperiment");
const status = document.getElementById("experimentStatus");
const results = document.getElementById("experimentResults");
let worker = null;

function finish(){
  worker?.terminate();
  worker = null;
  run.disabled = false;
  cancel.disabled = true;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (worker) return;
  const fields = form.elements;
  const spins = Number(fields.spins.value);
  if (!Number.isInteger(spins) || spins < 100 || spins > 10000){
    status.textContent = "Choose 100 to 10,000 synthetic spins.";
    return;
  }
  results.replaceChildren();
  try {
    worker = new Worker(new URL("../workers/research-worker.js", import.meta.url), {type: "module"});
    run.disabled = true;
    cancel.disabled = false;
    worker.onerror = (error) => {
      status.textContent = `Experiment failed: ${error.message}`;
      finish();
    };
    worker.onmessage = ({data}) => {
      if (data.type === "error"){
        status.textContent = `Experiment failed: ${data.error}`;
        finish();
      } else if (data.type === "progress"){
        status.textContent = `Synthetic ${data.strategy || "comparison"}: ${data.completedSpins || 0} / ${spins}.`;
      } else if (data.type === "result"){
        for (const result of data.report.results){
          const row = document.createElement("tr");
          for (const value of [result.name, `£${(result.metrics.netProfitLossCents / 100).toFixed(2)}`, `£${(result.metrics.totalStakedCents / 100).toFixed(2)}`, String(result.metrics.observedSpins)]){
            const cell = document.createElement("td");
            cell.textContent = value;
            row.append(cell);
          }
          results.append(row);
        }
        status.textContent = `Completed ${data.report.completedStrategies} fixed strategies; sequence ${data.report.outcomeSequenceHash}. One seeded run has high uncertainty and cannot establish an advantage.`;
        finish();
      }
    };
    const type = fields.scenario.value;
    worker.postMessage({
      type: "run-autonomous", id: "local-experiment", seed: fields.seed.value, spins,
      scenario: type === "uniform" ? {type} : {type, favoredStreet: 5, favoredStreetProbability: 0.25, changeAtFraction: 0.5},
      baseConfig: {bankroll: 10000, unit: 0.2, stopLoss: 5000, takeProfit: 5000, betType: "streets", coldThreshold: 0, maxStreets: 3, progression: "flat", maxSteps: 10, maxStake: 100, maxExposure: 100},
      variants: [
        {name: "BRI evidence-gated flat", strategy: "bri-autonomous", wageringMode: "evidence-gated"},
        {name: "Cold-street flat", strategy: "cold-street"},
        {name: "Cold-street linear", strategy: "cold-street", config: {progression: "linear"}},
        {name: "Cold-street Fibonacci", strategy: "cold-street", config: {progression: "fibo"}},
        {name: "Cold-street Martingale", strategy: "cold-street", config: {progression: "martingale"}},
        {name: "Flat baseline", strategy: "flat-baseline"},
        {name: "Observation only", strategy: "observation-only"},
      ],
    });
    status.textContent = "Running isolated synthetic comparison...";
  } catch (error) {
    status.textContent = `Experiment could not start: ${error.message}`;
    finish();
  }
});
cancel.addEventListener("click", () => {
  finish();
  status.textContent = "Experiment cancelled. Partial results discarded; Player Mode was not affected.";
});
