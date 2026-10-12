import { z } from 'zod';

export const toolValueSchema = z.union([
  z.number().finite().min(-1e12).max(1e12),
  z.string().max(500),
  z.boolean(),
]);
const field = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,50}$/)
  .refine((key) => !['constructor', 'prototype', '__proto__'].includes(key));
export const toolRecordSchema = z
  .record(field, toolValueSchema)
  .refine(
    (value) => Object.keys(value).length > 0 && Object.keys(value).length <= 20,
    'Use 1–20 named values.',
  );
export type ToolValue = z.infer<typeof toolValueSchema>;
export type ToolRecord = z.infer<typeof toolRecordSchema>;
export function matchesToolContract(value: ToolRecord, example: ToolRecord): boolean {
  const keys = Object.keys(example);
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key) && typeof value[key] === typeof example[key])
  );
}
export const toolCasesSchema = z
  .array(
    z
      .object({
        input: toolRecordSchema,
        expected: toolRecordSchema,
      })
      .strict(),
  )
  .min(3)
  .max(30)
  .superRefine((cases, context) => {
    for (const [index, item] of cases.entries()) {
      for (const side of ['input', 'expected'] as const) {
        if (!matchesToolContract(item[side], cases[0][side]))
          context.addIssue({
            code: 'custom',
            path: [index, side],
            message: 'Use the same fields and value types in every example.',
          });
      }
    }
  });
