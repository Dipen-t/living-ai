import React from 'react';
import { evaluate } from './logic';

export function Feature({ input }: { input: Record<string, number> }) {
  const result = evaluate(input);

  return (
    <div>
      <h3>Late Payment Calculation</h3>
      <p>Original Amount: ${input.amount.toFixed(2)}</p>
      <p>Days Late: {input.daysLate}</p>
      <p>Grace Period: {input.graceDays} days</p>
      <p>Daily Rate: {input.dailyRatePercent}%</p>
      <hr />
      <p><strong>Late Fee: ${result.fee.toFixed(2)}</strong></p>
      <p><strong>Total Amount Due: ${result.total.toFixed(2)}</strong></p>
    </div>
  );
}