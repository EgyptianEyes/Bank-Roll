export function computeSessionStatistics(config, results){
  const finals = results.map((result) => result.final);
  const profits = results.map((result) => result.pl);
  const totalProfitLoss = profits.reduce((sum, value) => sum + value, 0);
  const totalStartingBankroll = config.bankroll * results.length;
  const sortedFinals = [...finals].sort((left, right) => left - right);
  const middle = Math.floor(sortedFinals.length / 2);
  const median = sortedFinals.length
    ? sortedFinals.length % 2 ? sortedFinals[middle] : (sortedFinals[middle - 1] + sortedFinals[middle]) / 2
    : 0;
  const averageFinal = finals.length ? finals.reduce((sum, value) => sum + value, 0) / finals.length : 0;
  const variance = finals.length
    ? finals.reduce((sum, value) => sum + (value - averageFinal) ** 2, 0) / finals.length
    : 0;
  const wins = results.filter((result) => result.final > config.bankroll).length;

  return {
    totalProfitLoss,
    totalStartingBankroll,
    averageFinal,
    median,
    standardDeviation: Math.sqrt(variance),
    best: finals.length ? Math.max(...finals) : 0,
    worst: finals.length ? Math.min(...finals) : 0,
    wins,
    winRate: results.length ? wins / results.length : 0,
  };
}