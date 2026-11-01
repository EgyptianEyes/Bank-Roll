export function wagerOutcomeStatus(record){
  if (!record.actualWager) return "observed";
  if (record.voided) return "undone";
  const settlement = record.evaluation?.settlement;
  if (!settlement) return "unresolved";
  return settlement.hit ? "won" : "lost";
}
