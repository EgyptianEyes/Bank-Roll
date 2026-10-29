export function selectColdestStreets(gaps, threshold, limit){
  if (!Array.isArray(gaps) || gaps.length !== 12) throw new TypeError("Exactly twelve street gaps are required.");
  return gaps
    .map((gap, street) => ({street, gap}))
    .filter((entry) => entry.gap >= threshold)
    .sort((left, right) => right.gap - left.gap || left.street - right.street)
    .slice(0, limit)
    .map((entry) => entry.street);
}