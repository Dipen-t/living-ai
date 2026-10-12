export function evaluate(input: Record<string, number>): Record<string, number> {
  const amount = input.amount;
  const daysLate = input.daysLate;
  const graceDays = input.graceDays;
  const dailyRatePercent = input.dailyRatePercent;

  const chargeableDays = Math.max(0, daysLate - graceDays);
  const dailyRate = dailyRatePercent / 100;

  let fee = amount * dailyRate * chargeableDays;
  // Round fee to two decimal places
  fee = Math.round(fee * 100) / 100;

  const total = amount + fee;

  return {
    fee: fee,
    total: total
  };
}