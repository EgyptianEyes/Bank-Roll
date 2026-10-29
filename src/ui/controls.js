export function bindSimulationControls({runButton, resetButton, onStart, onStop, onReset, confirmReset}){
  let running = false;
  const handleRun = () => {
    if (running) onStop();
    else onStart();
  };
  const handleReset = () => {
    if (running || !confirmReset()) return;
    onReset();
  };

  runButton.addEventListener("click", handleRun);
  resetButton.addEventListener("click", handleReset);

  return {
    setRunning(value){ running = Boolean(value); },
    dispose(){
      runButton.removeEventListener("click", handleRun);
      resetButton.removeEventListener("click", handleReset);
    },
  };
}