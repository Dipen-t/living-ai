import { z } from 'zod';
export type * from './lifecycle';
export * from './generated-tools';

const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-zA-Z0-9_-]+$/);
const label = z.string().trim().min(1).max(120);
export const actionPositionSchema = z.enum(['page_header', 'above_table', 'below_table']);
const actionConfigurationSchema = z
  .object({ actionId: id, label, position: actionPositionSchema })
  .strict();
const operator = z.enum([
  'eq',
  'neq',
  'contains',
  'gt',
  'gte',
  'lt',
  'lte',
  'is_null',
  'is_not_null',
  'older_than_days',
]);
const filterSchema = z
  .object({
    id,
    label,
    fieldId: id,
    operator,
    value: z.union([z.string().max(500), z.number().finite(), z.boolean()]).optional(),
  })
  .strict();
const viewSchema = z
  .object({
    columns: z
      .array(
        z
          .object({
            fieldId: id,
            visible: z.boolean(),
            label: label.optional(),
            numberFormat: z.enum(['plain', 'indian', 'international']).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    filters: z.array(filterSchema).max(32),
    sort: z.array(z.object({ fieldId: id, direction: z.enum(['asc', 'desc']) }).strict()).max(10),
  })
  .strict();
const savedViewSchema = z.object({ id, name: label, configuration: viewSchema }).strict();
export const tableConfigurationSchema = viewSchema
  .extend({
    schemaVersion: z.literal(1),
    pageId: id,
    savedViews: z.array(savedViewSchema).max(20),
    defaultViewId: id.nullable(),
    actions: z.array(actionConfigurationSchema).max(20).optional(),
    enabledFeatures: z.array(id).max(20).optional(),
  })
  .strict();
const operationSchema = z.discriminatedUnion('kind', [
  z.object({ capabilityId: id, kind: z.literal('set_column_label'), fieldId: id, label }).strict(),
  z
    .object({
      capabilityId: id,
      kind: z.literal('set_feature'),
      featureId: id,
      enabled: z.boolean(),
    })
    .strict(),
  z
    .object({
      capabilityId: id,
      kind: z.literal('set_action'),
      actionId: id,
      label: label.optional(),
      position: actionPositionSchema.optional(),
    })
    .strict(),
  z.object({ capabilityId: id, kind: z.literal('add_filter'), filter: filterSchema }).strict(),
  z
    .object({
      capabilityId: id,
      kind: z.literal('set_column_visibility'),
      fieldId: id,
      visible: z.boolean(),
    })
    .strict(),
  z
    .object({
      capabilityId: id,
      kind: z.literal('reorder_columns'),
      fieldIds: z.array(id).min(1).max(100),
    })
    .strict(),
  z
    .object({
      capabilityId: id,
      kind: z.literal('set_number_format'),
      fieldId: id,
      format: z.enum(['plain', 'indian', 'international']),
    })
    .strict(),
  z
    .object({ capabilityId: id, kind: z.literal('create_saved_view'), view: savedViewSchema })
    .strict(),
]);
export const operationsSchema = z.array(operationSchema).min(1).max(32);
const registrySchema = z
  .object({
    schemaVersion: z.literal(1),
    applicationId: id,
    version: id,
    pages: z
      .array(
        z
          .object({
            pageId: id,
            routeKey: label,
            component: z.object({ id, contractVersion: z.literal(1) }).strict(),
            dataAdapter: z
              .object({ productionId: id, previewId: id, contractVersion: z.literal(1) })
              .strict(),
            fields: z
              .array(
                z
                  .object({
                    id,
                    label,
                    type: z.enum(['string', 'number', 'boolean', 'date']),
                    nullable: z.boolean(),
                    filterOperators: z.array(operator),
                    canDisplay: z.boolean(),
                    canSort: z.boolean(),
                  })
                  .strict(),
              )
              .min(1)
              .max(100),
            actions: z
              .array(
                z
                  .object({
                    id,
                    label,
                    handlerId: id,
                    defaultPosition: actionPositionSchema,
                    allowedPositions: z.array(actionPositionSchema).min(1).max(3),
                  })
                  .strict(),
              )
              .max(20)
              .optional(),
            features: z
              .array(z.object({ id, contractVersion: z.literal(1) }).strict())
              .max(20)
              .optional(),
            operations: z
              .array(
                z
                  .object({
                    id,
                    kind: z.enum([
                      'add_filter',
                      'set_column_visibility',
                      'reorder_columns',
                      'create_saved_view',
                      'set_number_format',
                      'set_column_label',
                      'set_action',
                      'set_feature',
                    ]),
                    allowedFieldIds: z.array(id).max(100),
                    allowedActionIds: z.array(id).max(20).optional(),
                    allowedFeatureIds: z.array(id).max(20).optional(),
                  })
                  .strict(),
              )
              .max(32),
            baseline: tableConfigurationSchema,
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

export type CapabilityRegistry = z.infer<typeof registrySchema>;
export type PageCapability = CapabilityRegistry['pages'][number];
export type FieldDefinition = PageCapability['fields'][number];
export type TableConfiguration = z.infer<typeof tableConfigurationSchema>;
export type ViewConfiguration = z.infer<typeof viewSchema>;
export type FilterDefinition = z.infer<typeof filterSchema>;
export type RuntimeOperation = z.infer<typeof operationSchema>;
export type SavedView = z.infer<typeof savedViewSchema>;
export type ActionPosition = z.infer<typeof actionPositionSchema>;
export type ActionConfiguration = z.infer<typeof actionConfigurationSchema>;
export interface ValidationError {
  code: string;
  path: string;
  message: string;
}
export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: ValidationError[] };
export class ConfigurationError extends Error {
  constructor(public readonly errors: ValidationError[]) {
    super(errors.map((e) => e.message).join('; '));
    this.name = 'ConfigurationError';
  }
}
const error = (code: string, path: string, message: string): ValidationError => ({
  code,
  path,
  message,
});
function parse<T>(schema: z.ZodType<T>, input: unknown): ValidationResult<T> {
  const result = schema.safeParse(input);
  return result.success
    ? { success: true, data: result.data }
    : {
        success: false,
        errors: result.error.issues.map((i) =>
          error('INVALID_SCHEMA', i.path.join('.'), i.message),
        ),
      };
}
function duplicateErrors(values: string[], path: string): ValidationError[] {
  return new Set(values).size === values.length
    ? []
    : [error('DUPLICATE_ID', path, `Duplicate identifiers in ${path}.`)];
}
function validDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 19) === value.slice(0, 19)
  );
}
function typeMatches(value: unknown, field: FieldDefinition): boolean {
  if (value === null) return field.nullable;
  if (field.type === 'date') return validDate(value);
  if (field.type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === field.type;
}
function filterErrors(
  filter: FilterDefinition,
  page: PageCapability,
  path: string,
): ValidationError[] {
  const field = page.fields.find((f) => f.id === filter.fieldId);
  if (!field) return [error('UNKNOWN_FIELD', path, `Field ${filter.fieldId} is not registered.`)];
  const errors: ValidationError[] = [];
  const op = filter.operator;
  if (!field.filterOperators.includes(op))
    errors.push(error('UNSUPPORTED_OPERATOR', path, `${op} is not allowed for ${field.id}.`));
  if (op === 'is_null' || op === 'is_not_null') {
    if (filter.value !== undefined)
      errors.push(error('INVALID_VALUE', path, 'Null predicates do not accept a value.'));
  } else if (op === 'older_than_days') {
    if (
      field.type !== 'date' ||
      typeof filter.value !== 'number' ||
      !Number.isInteger(filter.value) ||
      filter.value < 1 ||
      filter.value > 3650
    )
      errors.push(
        error(
          'INVALID_VALUE',
          path,
          'Relative date filters require a date field and 1–3650 whole days.',
        ),
      );
  } else if (filter.value === undefined || !typeMatches(filter.value, field)) {
    errors.push(error('INVALID_VALUE', path, `Filter value must match field type ${field.type}.`));
  }
  if (op === 'contains' && field.type !== 'string')
    errors.push(error('INVALID_OPERATOR_TYPE', path, 'Contains requires a string field.'));
  if (['gt', 'gte', 'lt', 'lte'].includes(op) && !['number', 'date'].includes(field.type))
    errors.push(
      error('INVALID_OPERATOR_TYPE', path, 'Ordered comparison requires a number or date field.'),
    );
  return errors;
}
function viewErrors(
  view: ViewConfiguration,
  page: PageCapability,
  path: string,
): ValidationError[] {
  const errors = [
    ...duplicateErrors(
      view.columns.map((c) => c.fieldId),
      `${path}.columns`,
    ),
    ...duplicateErrors(
      view.filters.map((f) => f.id),
      `${path}.filters`,
    ),
    ...duplicateErrors(
      view.sort.map((s) => s.fieldId),
      `${path}.sort`,
    ),
  ];
  for (const column of view.columns) {
    if (
      column.label !== undefined &&
      !page.operations.some(
        (operation) =>
          operation.kind === 'set_column_label' &&
          operation.allowedFieldIds.includes(column.fieldId),
      )
    )
      errors.push(
        error('COLUMN_LABEL_NOT_ALLOWED', path, 'Renaming is not registered for this column.'),
      );
    const field = page.fields.find((f) => f.id === column.fieldId);
    if (!field || !field.canDisplay)
      errors.push(error('UNKNOWN_COLUMN', path, `Column ${column.fieldId} is not displayable.`));
    if (column.numberFormat && field?.type !== 'number')
      errors.push(
        error('INVALID_NUMBER_FORMAT', path, 'Number formatting requires a numeric field.'),
      );
    if (
      column.numberFormat &&
      !page.operations.some(
        (operation) =>
          operation.kind === 'set_number_format' &&
          operation.allowedFieldIds.includes(column.fieldId),
      )
    )
      errors.push(
        error(
          'NUMBER_FORMAT_NOT_ALLOWED',
          path,
          'Number formatting is not registered for this field.',
        ),
      );
  }
  if (!view.columns.some((c) => c.visible))
    errors.push(error('NO_VISIBLE_COLUMNS', path, 'At least one column must remain visible.'));
  view.filters.forEach((f, i) => errors.push(...filterErrors(f, page, `${path}.filters.${i}`)));
  for (const sort of view.sort)
    if (!page.fields.some((f) => f.id === sort.fieldId && f.canSort))
      errors.push(error('INVALID_SORT', path, `Field ${sort.fieldId} cannot be sorted.`));
  return errors;
}
export function validateConfiguration(
  input: unknown,
  page: PageCapability,
): ValidationResult<TableConfiguration> {
  const parsed = parse(tableConfigurationSchema, input);
  if (!parsed.success) return parsed;
  const config = parsed.data;
  const errors = viewErrors(config, page, 'configuration');
  errors.push(...duplicateErrors(config.enabledFeatures ?? [], 'enabledFeatures'));
  for (const featureId of config.enabledFeatures ?? [])
    if (
      !page.features?.some((feature) => feature.id === featureId) ||
      !page.operations.some(
        (cap) => cap.kind === 'set_feature' && cap.allowedFeatureIds?.includes(featureId),
      )
    )
      errors.push(
        error('FEATURE_NOT_ALLOWED', featureId, 'Workflow is not registered for this page.'),
      );
  errors.push(
    ...duplicateErrors(
      (config.actions ?? []).map((action) => action.actionId),
      'actions',
    ),
  );
  for (const action of config.actions ?? []) {
    const definition = page.actions?.find((candidate) => candidate.id === action.actionId);
    if (
      !definition ||
      !definition.allowedPositions.includes(action.position) ||
      !page.operations.some(
        (cap) => cap.kind === 'set_action' && cap.allowedActionIds?.includes(action.actionId),
      )
    )
      errors.push(
        error(
          'ACTION_NOT_ALLOWED',
          action.actionId,
          'Button or position is not registered for this page.',
        ),
      );
  }
  if (config.pageId !== page.pageId)
    errors.push(error('PAGE_MISMATCH', 'pageId', 'Configuration belongs to a different page.'));
  errors.push(
    ...duplicateErrors(
      config.savedViews.map((v) => v.id),
      'savedViews',
    ),
  );
  config.savedViews.forEach((v, i) =>
    errors.push(...viewErrors(v.configuration, page, `savedViews.${i}`)),
  );
  if (
    config.defaultViewId !== null &&
    !config.savedViews.some((v) => v.id === config.defaultViewId)
  )
    errors.push(error('UNKNOWN_VIEW', 'defaultViewId', 'Default saved view does not exist.'));
  return errors.length ? { success: false, errors } : { success: true, data: config };
}
export function validateRegistry(input: unknown): ValidationResult<CapabilityRegistry> {
  const parsed = parse(registrySchema, input);
  if (!parsed.success) return parsed;
  const registry = parsed.data;
  const errors = duplicateErrors(
    registry.pages.map((p) => p.pageId),
    'pages',
  );
  for (const page of registry.pages) {
    errors.push(
      ...duplicateErrors(
        (page.features ?? []).map((feature) => feature.id),
        `${page.pageId}.features`,
      ),
    );
    errors.push(
      ...duplicateErrors(
        (page.actions ?? []).map((action) => action.id),
        `${page.pageId}.actions`,
      ),
    );
    for (const action of page.actions ?? []) {
      if (
        !action.allowedPositions.includes(action.defaultPosition) ||
        new Set(action.allowedPositions).size !== action.allowedPositions.length
      )
        errors.push(
          error(
            'INVALID_ACTION_POSITION',
            action.id,
            'Button positions must be unique and include the default.',
          ),
        );
    }
    errors.push(
      ...duplicateErrors(
        page.fields.map((f) => f.id),
        `${page.pageId}.fields`,
      ),
      ...duplicateErrors(
        page.operations.map((o) => o.id),
        `${page.pageId}.operations`,
      ),
    );
    for (const capability of page.operations) {
      if (
        capability.kind === 'set_feature' &&
        (!capability.allowedFeatureIds?.length ||
          capability.allowedFeatureIds.some(
            (id) => !page.features?.some((feature) => feature.id === id),
          ))
      )
        errors.push(
          error(
            'UNKNOWN_FEATURE',
            capability.id,
            'Workflow capability must allow registered features.',
          ),
        );
      if (capability.kind !== 'set_feature' && capability.allowedFeatureIds?.length)
        errors.push(
          error(
            'INVALID_FEATURE_CAPABILITY',
            capability.id,
            'Only workflow capabilities may reference features.',
          ),
        );
      errors.push(
        ...duplicateErrors(
          capability.allowedFeatureIds ?? [],
          `${capability.id}.allowedFeatureIds`,
        ),
      );
      if (
        capability.kind === 'set_action' &&
        (!capability.allowedActionIds?.length ||
          capability.allowedActionIds.some(
            (id) => !page.actions?.some((action) => action.id === id),
          ))
      )
        errors.push(
          error(
            'UNKNOWN_ACTION',
            capability.id,
            'Button capabilities must allow registered buttons.',
          ),
        );
      if (capability.kind !== 'set_action' && capability.allowedActionIds?.length)
        errors.push(
          error(
            'INVALID_ACTION_CAPABILITY',
            capability.id,
            'Only button capabilities may reference buttons.',
          ),
        );
      errors.push(
        ...duplicateErrors(capability.allowedActionIds ?? [], `${capability.id}.allowedActionIds`),
      );
      if (
        capability.kind === 'set_number_format' &&
        capability.allowedFieldIds.some(
          (id) =>
            !page.fields.some(
              (field) => field.id === id && field.type === 'number' && field.canDisplay,
            ),
        )
      )
        errors.push(
          error(
            'INVALID_NUMBER_FORMAT',
            capability.id,
            'Formatting capabilities may only allow displayable numeric fields.',
          ),
        );
      errors.push(
        ...duplicateErrors(capability.allowedFieldIds, `${capability.id}.allowedFieldIds`),
      );
      if (capability.allowedFieldIds.some((id) => !page.fields.some((f) => f.id === id)))
        errors.push(
          error('UNKNOWN_FIELD', capability.id, 'Capability references an unregistered field.'),
        );
    }
    const baseline = validateConfiguration(page.baseline, page);
    if (!baseline.success) errors.push(...baseline.errors);
    for (const field of page.fields) {
      if (
        (field.filterOperators.includes('contains') && field.type !== 'string') ||
        (field.filterOperators.includes('older_than_days') && field.type !== 'date') ||
        (field.filterOperators.some((o) => ['gt', 'gte', 'lt', 'lte'].includes(o)) &&
          !['number', 'date'].includes(field.type))
      )
        errors.push(
          error('INVALID_OPERATOR_TYPE', field.id, 'Field declares incompatible filter operators.'),
        );
    }
  }
  return errors.length ? { success: false, errors } : { success: true, data: registry };
}
export function validateOperations(
  input: unknown,
  page: PageCapability,
): ValidationResult<RuntimeOperation[]> {
  const parsed = parse(operationsSchema, input);
  if (!parsed.success) return parsed;
  const errors: ValidationError[] = [];
  for (const [i, op] of parsed.data.entries()) {
    const cap = page.operations.find((c) => c.id === op.capabilityId && c.kind === op.kind);
    if (!cap) {
      errors.push(
        error(
          'UNKNOWN_CAPABILITY',
          String(i),
          `Capability ${op.capabilityId} does not support ${op.kind}.`,
        ),
      );
      continue;
    }
    if (op.kind === 'set_feature') {
      if (
        !cap.allowedFeatureIds?.includes(op.featureId) ||
        !page.features?.some((feature) => feature.id === op.featureId)
      )
        errors.push(
          error('FEATURE_NOT_ALLOWED', String(i), 'Workflow is outside the registered capability.'),
        );
      continue;
    }
    if (op.kind === 'set_action') {
      const definition = page.actions?.find((action) => action.id === op.actionId);
      if (!definition || !cap.allowedActionIds?.includes(op.actionId))
        errors.push(
          error('ACTION_NOT_ALLOWED', String(i), 'Button is outside the registered capability.'),
        );
      if (op.position && !definition?.allowedPositions.includes(op.position))
        errors.push(
          error(
            'INVALID_ACTION_POSITION',
            String(i),
            'This position is not allowed for the button.',
          ),
        );
      if (op.label === undefined && op.position === undefined)
        errors.push(error('EMPTY_ACTION_CHANGE', String(i), 'Choose a button label or position.'));
      continue;
    }
    const fields =
      op.kind === 'add_filter'
        ? [op.filter.fieldId]
        : op.kind === 'set_column_visibility' ||
            op.kind === 'set_number_format' ||
            op.kind === 'set_column_label'
          ? [op.fieldId]
          : op.kind === 'reorder_columns'
            ? op.fieldIds
            : [
                ...op.view.configuration.columns.map((c) => c.fieldId),
                ...op.view.configuration.filters.map((f) => f.fieldId),
                ...op.view.configuration.sort.map((s) => s.fieldId),
              ];
    if (fields.some((f) => !cap.allowedFieldIds.includes(f)))
      errors.push(
        error(
          'FIELD_NOT_ALLOWED',
          String(i),
          'Operation uses fields outside its capability allowlist.',
        ),
      );
    if (op.kind === 'add_filter') errors.push(...filterErrors(op.filter, page, `${i}.filter`));
    if (
      op.kind === 'set_number_format' &&
      !page.fields.some(
        (field) => field.id === op.fieldId && field.type === 'number' && field.canDisplay,
      )
    )
      errors.push(
        error(
          'INVALID_NUMBER_FORMAT',
          String(i),
          'Only displayable numeric fields can be formatted.',
        ),
      );
    if (op.kind === 'create_saved_view')
      errors.push(...viewErrors(op.view.configuration, page, `${i}.view`));
  }
  return errors.length ? { success: false, errors } : parsed;
}
function requireValid<T>(result: ValidationResult<T>): T {
  if (!result.success) throw new ConfigurationError(result.errors);
  return result.data;
}
export function applyOperations(
  base: TableConfiguration,
  input: unknown,
  page: PageCapability,
): TableConfiguration {
  const config = structuredClone(requireValid(validateConfiguration(base, page)));
  const operations = requireValid(validateOperations(input, page));
  for (const op of operations) {
    if (op.kind === 'set_column_label') {
      const column = config.columns.find((column) => column.fieldId === op.fieldId);
      if (!column)
        throw new ConfigurationError([
          error('UNKNOWN_COLUMN', op.fieldId, 'Column does not exist in the base configuration.'),
        ]);
      column.label = op.label;
    }
    if (op.kind === 'set_feature')
      config.enabledFeatures = op.enabled
        ? [...new Set([...(config.enabledFeatures ?? []), op.featureId])]
        : (config.enabledFeatures ?? []).filter((id) => id !== op.featureId);
    if (op.kind === 'set_action') {
      const current = resolveActions(config, page).find(
        (action) => action.actionId === op.actionId,
      )!;
      const updated = {
        ...current,
        ...(op.label !== undefined ? { label: op.label } : {}),
        ...(op.position !== undefined ? { position: op.position } : {}),
      };
      config.actions = [
        ...(config.actions ?? []).filter((action) => action.actionId !== op.actionId),
        updated,
      ];
    }
    if (op.kind === 'set_number_format') {
      const column = config.columns.find((column) => column.fieldId === op.fieldId);
      if (!column)
        throw new ConfigurationError([
          error('UNKNOWN_COLUMN', op.fieldId, 'Column does not exist in the base configuration.'),
        ]);
      column.numberFormat = op.format;
    }
    if (op.kind === 'add_filter') config.filters.push(op.filter);
    if (op.kind === 'set_column_visibility') {
      const column = config.columns.find((c) => c.fieldId === op.fieldId);
      if (!column)
        throw new ConfigurationError([
          error('UNKNOWN_COLUMN', op.fieldId, 'Column does not exist in the base configuration.'),
        ]);
      column.visible = op.visible;
    }
    if (op.kind === 'reorder_columns') {
      if (
        op.fieldIds.length !== config.columns.length ||
        new Set(op.fieldIds).size !== op.fieldIds.length ||
        op.fieldIds.some((id) => !config.columns.some((c) => c.fieldId === id))
      )
        throw new ConfigurationError([
          error(
            'INVALID_COLUMN_ORDER',
            'fieldIds',
            'Reordering must include every configured column exactly once.',
          ),
        ]);
      config.columns = op.fieldIds.map((id) => config.columns.find((c) => c.fieldId === id)!);
    }
    if (op.kind === 'create_saved_view') config.savedViews.push(op.view);
  }
  return requireValid(validateConfiguration(config, page));
}
export function resolveActions(
  config: TableConfiguration,
  page: PageCapability,
): ActionConfiguration[] {
  requireValid(validateConfiguration(config, page));
  return (page.actions ?? []).map(
    (action) =>
      config.actions?.find((value) => value.actionId === action.id) ?? {
        actionId: action.id,
        label: action.label,
        position: action.defaultPosition,
      },
  );
}
export function selectSavedView(
  config: TableConfiguration,
  viewId: string | null,
): TableConfiguration {
  if (viewId === null) return structuredClone(config);
  const view = config.savedViews.find((v) => v.id === viewId);
  if (!view)
    throw new ConfigurationError([error('UNKNOWN_VIEW', 'viewId', 'Saved view does not exist.')]);
  return { ...structuredClone(config), ...structuredClone(view.configuration) };
}
export interface TableModel {
  columns: FieldDefinition[];
  rows: readonly Record<string, unknown>[];
  totalRows: number;
}
function comparison(value: unknown, field: FieldDefinition): string | number | boolean {
  return field.type === 'date' ? Date.parse(value as string) : (value as string | number | boolean);
}
function matches(
  row: Record<string, unknown>,
  filter: FilterDefinition,
  field: FieldDefinition,
  now: number,
): boolean {
  const value = row[filter.fieldId];
  if (filter.operator === 'is_null') return value === null;
  if (filter.operator === 'is_not_null') return value !== null;
  if (value === null) return false;
  if (filter.operator === 'older_than_days')
    return Date.parse(value as string) < now - (filter.value as number) * 86400000;
  if (filter.operator === 'contains')
    return (value as string).toLowerCase().includes((filter.value as string).toLowerCase());
  const left = comparison(value, field),
    right = comparison(filter.value, field);
  switch (filter.operator) {
    case 'eq':
      return left === right;
    case 'neq':
      return left !== right;
    case 'gt':
      return left > right;
    case 'gte':
      return left >= right;
    case 'lt':
      return left < right;
    case 'lte':
      return left <= right;
  }
}
export function buildTableModel(
  rows: readonly Record<string, unknown>[],
  input: TableConfiguration,
  page: PageCapability,
  context: { evaluationTime: string },
): TableModel {
  const config = requireValid(validateConfiguration(input, page));
  if (!validDate(context.evaluationTime))
    throw new ConfigurationError([
      error('INVALID_DATE', 'evaluationTime', 'Evaluation time must be a valid UTC ISO timestamp.'),
    ]);
  const fields = new Map(page.fields.map((f) => [f.id, f]));
  const used = new Set([
    ...config.columns.filter((c) => c.visible).map((c) => c.fieldId),
    ...config.filters.map((f) => f.fieldId),
    ...config.sort.map((s) => s.fieldId),
  ]);
  for (const [i, row] of rows.entries())
    for (const id of used)
      if (!typeMatches(row[id], fields.get(id)!))
        throw new ConfigurationError([
          error('INVALID_DATA', `rows.${i}.${id}`, `Missing or invalid value for ${id}.`),
        ]);
  const now = Date.parse(context.evaluationTime);
  const filtered = rows.filter((row) =>
    config.filters.every((f) => matches(row, f, fields.get(f.fieldId)!, now)),
  );
  const sorted = filtered
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      for (const sort of config.sort) {
        const av = a.row[sort.fieldId],
          bv = b.row[sort.fieldId];
        if (av === null || bv === null) {
          if (av !== bv) return av === null ? 1 : -1;
          continue;
        }
        const field = fields.get(sort.fieldId)!;
        const left = comparison(av, field),
          right = comparison(bv, field);
        if (left !== right) return (left < right ? -1 : 1) * (sort.direction === 'asc' ? 1 : -1);
      }
      return a.index - b.index;
    })
    .map((v) => v.row);
  return {
    columns: config.columns
      .filter((c) => c.visible)
      .map((c) => ({
        ...fields.get(c.fieldId)!,
        ...(c.label !== undefined ? { label: c.label } : {}),
      })),
    rows: sorted,
    totalRows: rows.length,
  };
}
/** Stable JSON serialization; SHA-256 hashing belongs to the server adapter. */
/** Compatibility is deliberately limited to adding operations, with all old contracts unchanged. */
export function isAdditiveRegistryChange(
  previous: CapabilityRegistry,
  next: CapabilityRegistry,
): boolean {
  if (
    !validateRegistry(previous).success ||
    !validateRegistry(next).success ||
    previous.applicationId !== next.applicationId ||
    previous.pages.length > next.pages.length ||
    previous.schemaVersion !== next.schemaVersion
  )
    return false;
  return previous.pages.every((oldPage) => {
    const nextPage = next.pages.find((page) => page.pageId === oldPage.pageId);
    if (!nextPage) return false;
    const {
      operations: oldOperations,
      actions: oldActions,
      features: oldFeatures,
      ...oldContract
    } = oldPage;
    const {
      operations: nextOperations,
      actions: nextActions,
      features: nextFeatures,
      ...nextContract
    } = nextPage;
    return (
      canonicalize(oldContract) === canonicalize(nextContract) &&
      (oldFeatures ?? []).every((feature) =>
        (nextFeatures ?? []).some((candidate) => canonicalize(candidate) === canonicalize(feature)),
      ) &&
      (oldActions ?? []).every((action) =>
        (nextActions ?? []).some((candidate) => canonicalize(candidate) === canonicalize(action)),
      ) &&
      oldOperations.every((operation) =>
        nextOperations.some((candidate) => canonicalize(candidate) === canonicalize(operation)),
      )
    );
  });
}
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (
    typeof value === 'object' &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  )
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  throw new Error('Canonical JSON accepts only finite JSON values.');
}
