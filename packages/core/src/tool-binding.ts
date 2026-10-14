import { z } from 'zod';
import {
  toolValueSchema,
  toolRecordSchema,
  matchesToolContract,
  type ToolRecord,
} from './generated-tools';

const name = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,50}$/)
  .refine((key) => !['constructor', 'prototype', '__proto__'].includes(key));
export const toolManualInputSchema = z
  .record(name, toolValueSchema)
  .refine((value) => Object.keys(value).length <= 20);
export const toolBindingSchema = z
  .object({
    sourceId: name,
    sourceVersion: z.string().regex(/^[a-f0-9]{64}$/),
    mappings: z
      .array(z.object({ inputId: name, fieldId: name }).strict())
      .min(1)
      .max(20),
  })
  .strict();
export type ToolBinding = z.infer<typeof toolBindingSchema>;
export type ToolDataSource = {
  id: string;
  label: string;
  version: string;
  fields: { id: string; label: string; type: 'string' | 'number' | 'boolean' }[];
};

export function validateToolBinding(
  binding: ToolBinding,
  example: ToolRecord,
  source: ToolDataSource,
) {
  toolBindingSchema.parse(binding);
  if (binding.sourceId !== source.id || binding.sourceVersion !== source.version)
    throw new Error('The data source changed. Create a new draft with the current fields.');
  const used = new Set<string>();
  for (const mapping of binding.mappings) {
    const field = source.fields.find((field) => field.id === mapping.fieldId);
    if (
      used.has(mapping.inputId) ||
      !Object.hasOwn(example, mapping.inputId) ||
      !field ||
      field.type !== typeof example[mapping.inputId]
    )
      throw new Error('Choose one compatible data field for each mapped input.');
    used.add(mapping.inputId);
  }
  return binding;
}

// Read only the registered mapped fields. Unrelated row data never enters the tool input.
export function resolveToolInput(
  binding: ToolBinding,
  example: ToolRecord,
  source: ToolDataSource,
  manual: ToolRecord,
  row: Record<string, unknown>,
): ToolRecord {
  validateToolBinding(binding, example, source);
  toolManualInputSchema.parse(manual);
  const input: Record<string, unknown> = { ...manual };
  for (const mapping of binding.mappings) {
    if (Object.hasOwn(manual, mapping.inputId))
      throw new Error('Mapped values come from the workspace record and cannot be overridden.');
    input[mapping.inputId] = row[mapping.fieldId];
  }
  const checked = toolRecordSchema.parse(input);
  if (!matchesToolContract(checked, example))
    throw new Error('Fill in the remaining tool inputs with the reviewed value types.');
  return checked;
}

// Keep the fingerprint of older, unbound proposals unchanged.
export function toolReviewContent(
  draft: unknown,
  cases: unknown,
  request: string,
  binding?: unknown,
) {
  return binding == null ? { draft, cases, request } : { draft, cases, request, binding };
}
