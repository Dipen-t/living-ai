import React from 'react';
import { evaluate } from './logic';
export function Feature({input}: {input: Record<string, number | string | boolean>}) {
  const result = evaluate(input);
  return <section><h3>Discount eligibility</h3><p>Eligible: {String(result.eligible)}</p><p>Discount: {String(result.discountPercent)}%</p><p>Reason: {String(result.reason)}</p></section>;
}