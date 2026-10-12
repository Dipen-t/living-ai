export function evaluate(input: Record<string, number | string | boolean>): Record<string, number | string | boolean> {
  if (input.overdue === true) return { eligible: false, discountPercent: 0, reason: 'Overdue payment' };
  const tier = typeof input.customerTier === 'string' ? input.customerTier.trim().toLowerCase() : '';
  const amount = typeof input.orderAmount === 'number' ? input.orderAmount : 0;
  if (tier === 'gold' && amount >= 10000) return { eligible: true, discountPercent: 10, reason: 'Gold customer discount' };
  return { eligible: false, discountPercent: 0, reason: 'Standard pricing' };
}