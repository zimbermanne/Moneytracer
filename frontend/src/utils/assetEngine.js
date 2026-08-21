/**
 * Calculates straight-line annual & monthly depreciation.
 */
export function calculateDepreciation(cost, salvageValue, usefulLifeYears) {
  const depreciableBase = Math.max(0, cost - salvageValue);
  const annualDepreciation = usefulLifeYears > 0 ? depreciableBase / usefulLifeYears : 0;
  const monthlyDepreciation = annualDepreciation / 12;

  return { annualDepreciation, monthlyDepreciation };
}

/**
 * Calculates appreciation rate and unrealized gain/loss.
 */
export function calculateRevaluation(acquisitionCost, currentValue) {
  const gainLoss = currentValue - acquisitionCost;
  const percentageChange = acquisitionCost > 0 ? (gainLoss / acquisitionCost) * 100 : 0;

  return {
    gainLoss: Number(gainLoss.toFixed(2)),
    percentageChange: Number(percentageChange.toFixed(2)),
    isGain: gainLoss >= 0,
  };
}
