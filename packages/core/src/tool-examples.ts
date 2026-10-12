// Fixed host-authored source. This starter does not make an AI call.
export const discountExample = {
  request:
    'Build a discount eligibility tool. Inputs are customerTier (text), orderAmount (number), and overdue (yes/no). If overdue is true, return eligible false, discountPercent 0, and reason "Overdue payment". Otherwise a customer whose tier, ignoring case and surrounding spaces, is gold and whose order amount is at least 10000 gets eligible true, discountPercent 10, and reason "Gold customer discount". Everyone else gets eligible false, discountPercent 0, and reason "Standard pricing". Show the decision and explanation. This is a preview tool; do not change any orders.',
  cases: [
    {
      input: { customerTier: 'gold', orderAmount: 10000, overdue: false },
      expected: { eligible: true, discountPercent: 10, reason: 'Gold customer discount' },
    },
    {
      input: { customerTier: 'gold', orderAmount: 20000, overdue: true },
      expected: { eligible: false, discountPercent: 0, reason: 'Overdue payment' },
    },
    {
      input: { customerTier: 'silver', orderAmount: 20000, overdue: false },
      expected: { eligible: false, discountPercent: 0, reason: 'Standard pricing' },
    },
    {
      input: { customerTier: 'gold', orderAmount: 9999, overdue: false },
      expected: { eligible: false, discountPercent: 0, reason: 'Standard pricing' },
    },
    {
      input: { customerTier: ' GOLD ', orderAmount: 15000, overdue: false },
      expected: { eligible: true, discountPercent: 10, reason: 'Gold customer discount' },
    },
  ],
  draft: {
    featureId: 'discount-eligibility-example',
    summary:
      'Built-in discount example: check eligibility and explain the result. This starter uses fixed source and makes no AI call.',
    files: {
      'logic.ts': `export function evaluate(input: Record<string, number | string | boolean>): Record<string, number | string | boolean> {
  if (input.overdue === true) return { eligible: false, discountPercent: 0, reason: 'Overdue payment' };
  const tier = typeof input.customerTier === 'string' ? input.customerTier.trim().toLowerCase() : '';
  const amount = typeof input.orderAmount === 'number' ? input.orderAmount : 0;
  if (tier === 'gold' && amount >= 10000) return { eligible: true, discountPercent: 10, reason: 'Gold customer discount' };
  return { eligible: false, discountPercent: 0, reason: 'Standard pricing' };
}`,
      'Feature.tsx': `import React from 'react';
import { evaluate } from './logic';
export function Feature({input}: {input: Record<string, number | string | boolean>}) {
  const result = evaluate(input);
  return <section><h3>Discount eligibility</h3><p>Eligible: {String(result.eligible)}</p><p>Discount: {String(result.discountPercent)}%</p><p>Reason: {String(result.reason)}</p></section>;
}`,
    },
  },
};
