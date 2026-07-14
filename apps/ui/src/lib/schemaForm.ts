/**
 * Drives the admin's dynamic driver forms. A driver manifest describes its
 * connection config and each endpoint's address as JSON Schema; this module
 * turns one of those (object) schemas into:
 *
 *   - `schemaToFields()` — an ordered list of render descriptors (label, kind,
 *     options, constraints) the `SchemaField` component renders.
 *   - `zodFromSchema()`  — a Zod object schema for `toTypedSchema()`, so the
 *     same constraints the server enforces with Ajv are validated client-side.
 *   - `defaultsFromSchema()` — initial form values (respecting `default`).
 *
 * Only the keywords the GalleryOS manifests actually use are handled (object of
 * scalar/enum properties); richer JSON Schema (nested objects, arrays, oneOf) is
 * out of scope and falls back to a plain text field.
 */
import type { JsonSchema } from '@gallery/driver-core'
import { z } from 'zod'
import { isHost } from './host'
import { buildConnectionOptions } from './widgets'

export type FieldKind = 'string' | 'number' | 'boolean' | 'enum'

export interface SchemaField {
  key: string
  label: string
  description?: string
  kind: FieldKind
  required: boolean
  /** For `enum` fields: the selectable values (stringified). */
  options?: string[]
  placeholder?: string
  /**
   * For a `number`/`integer` field whose schema declares `connectionEnum`,
   * resolved into a labeled dropdown once a connection config was passed to
   * `schemaToFields()` (e.g. a matrix switcher's output number — friendlier
   * than typing a bare index). Kind/validation stay `number`; this only
   * changes how `SchemaFields.vue` renders the input. Absent (or empty) when
   * unresolvable — the field then falls back to a plain number input.
   */
  dynamicOptions?: { value: string; label: string }[]
  /** For a `number` field: its schema's `minimum`, if declared. */
  minimum?: number
  /** For a `number` field: its schema's `maximum`, if declared. */
  maximum?: number
  /**
   * Slider step, present only when both `minimum`/`maximum` are set — a bounded
   * number field renders as a Slider instead of a plain input (e.g. a 0..1
   * fader level). `1` for an `integer` field, else a hundredth of the range.
   */
  step?: number
}

const titleCase = (key: string): string =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())

function kindOf(prop: JsonSchema): FieldKind {
  if (Array.isArray(prop.enum) && prop.enum.length) return 'enum'
  if (prop.type === 'boolean') return 'boolean'
  if (prop.type === 'integer' || prop.type === 'number') return 'number'
  return 'string'
}

/** A `number` field's Slider-driving bounds — `step` only once both `minimum`/`maximum` are declared (1 for an `integer`, else a hundredth of the range). */
function numberBounds(prop: JsonSchema): Pick<SchemaField, 'minimum' | 'maximum' | 'step'> {
  const minimum = typeof prop.minimum === 'number' ? prop.minimum : undefined
  const maximum = typeof prop.maximum === 'number' ? prop.maximum : undefined
  if (minimum === undefined || maximum === undefined) return { minimum, maximum }
  return { minimum, maximum, step: prop.type === 'integer' ? 1 : (maximum - minimum) / 100 || 1 }
}

/**
 * Ordered render descriptors for an object schema's properties. Pass the
 * owning device's connection config to resolve any `connectionEnum` field
 * (e.g. Extron's output number) into a labeled dropdown; omit it (or when
 * unresolvable, e.g. no connection picked yet) and that field falls back to
 * a plain number input.
 */
export function schemaToFields(
  schema: JsonSchema | undefined,
  connectionConfig?: Record<string, unknown>,
): SchemaField[] {
  const properties = (schema?.properties ?? {}) as Record<string, JsonSchema>
  const required = new Set((schema?.required as string[] | undefined) ?? [])

  return Object.entries(properties)
    // Arrays/objects aren't scalar fields; a caller that needs them (e.g. the
    // meters editor) handles them out of band, so leave them to it.
    .filter(([, prop]) => prop.type !== 'array' && prop.type !== 'object')
    .map(([key, prop]) => {
    const kind = kindOf(prop)
    const dynamic = prop.connectionEnum ? buildConnectionOptions(prop.connectionEnum, connectionConfig) : undefined
    return {
      key,
      label: (prop.title as string | undefined) ?? titleCase(key),
      description: prop.description as string | undefined,
      kind,
      required: required.has(key),
      options: kind === 'enum' ? (prop.enum as unknown[]).map((v) => String(v)) : undefined,
      placeholder: prop.default !== undefined ? String(prop.default) : undefined,
      dynamicOptions: dynamic?.map((o) => ({ value: String(o.value), label: o.label })),
      ...(kind === 'number' ? numberBounds(prop) : {}),
    }
  })
}

/** Initial form values for an object schema (honours `default`). */
export function defaultsFromSchema(schema: JsonSchema | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of schemaToFields(schema)) {
    const prop = ((schema?.properties ?? {}) as Record<string, JsonSchema>)[f.key]
    if (prop?.default !== undefined) {
      out[f.key] = prop.default
      continue
    }
    out[f.key] = f.kind === 'boolean' ? false : ''
  }
  return out
}

function zodForField(prop: JsonSchema, field: SchemaField): z.ZodTypeAny {
  switch (field.kind) {
    case 'boolean':
      return z.boolean().default(false)

    case 'enum': {
      const values = field.options ?? []
      const base = z.string().refine((v) => values.includes(v), { message: 'Select a valid option' })
      return field.required ? base : z.union([base, z.literal('')]).optional()
    }

    case 'number': {
      let num = z.number({ invalid_type_error: 'Must be a number' })
      if (prop.type === 'integer') num = num.int('Must be a whole number')
      if (typeof prop.minimum === 'number') num = num.min(prop.minimum)
      if (typeof prop.maximum === 'number') num = num.max(prop.maximum)
      // Inputs hand back strings; treat blank as "unset" so optional stays valid.
      const coerced = z.preprocess(
        (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
        field.required ? num : num.optional(),
      )
      return field.required
        ? coerced.refine((v) => v !== undefined, { message: 'Required' })
        : coerced
    }

    default: {
      let str = z.string()
      if (typeof prop.minLength === 'number') str = str.min(prop.minLength)
      if (typeof prop.maxLength === 'number') str = str.max(prop.maxLength)
      if (typeof prop.pattern === 'string') str = str.regex(new RegExp(prop.pattern), 'Invalid format')
      if (field.required) str = str.min(1, 'Required')
      // Mirror the server's Ajv `host` format (hostname or IP). Blank is left to
      // the required/optional rules above so optional hosts can stay empty.
      const withFormat: z.ZodTypeAny =
        prop.format === 'host'
          ? str.refine((v) => !v || isHost(v), { message: 'Enter a valid hostname or IP address' })
          : str
      return field.required ? withFormat : withFormat.optional()
    }
  }
}

/** A Zod object schema mirroring the manifest's constraints (for vee-validate). */
export function zodFromSchema(schema: JsonSchema | undefined): z.ZodObject<z.ZodRawShape> {
  const properties = (schema?.properties ?? {}) as Record<string, JsonSchema>
  const shape: z.ZodRawShape = {}
  for (const field of schemaToFields(schema)) {
    shape[field.key] = zodForField(properties[field.key] ?? {}, field)
  }
  return z.object(shape)
}

/**
 * Coerce a form field's current value to what a `<Select>` needs for its
 * `model-value`: a genuine string, not just a TypeScript-level cast. A
 * `number`-kind field (e.g. a `connectionEnum` dropdown) holds a real JS
 * number once seeded from a saved record — `value as string` doesn't
 * actually convert it, so the number would never strictly-equal a
 * `SelectItem`'s string `value` and the trigger would silently show the
 * placeholder instead of the current selection. `String(value)` fixes both
 * strings (already a no-op) and numbers.
 */
export function selectValueOf(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

/**
 * Strips blank/undefined entries so an optional, untouched field isn't sent as
 * `""` (which would fail the server's stricter type checks).
 */
export function pruneEmpty(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(values)) {
    if (v === '' || v === undefined || v === null) continue
    out[k] = v
  }
  return out
}

/**
 * Coerce a raw form object (string-y inputs) to the types its schema declares,
 * dropping blanks. Used where values are edited outside vee-validate — notably
 * scene-action command params — so they match the server's strict param schema.
 */
export function coerceBySchema(
  schema: JsonSchema | undefined,
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of schemaToFields(schema)) {
    const v = raw[field.key]
    if (v === '' || v === undefined || v === null) continue
    if (field.kind === 'number') {
      // Drop non-numeric input rather than persist NaN (which serializes to null).
      const n = typeof v === 'number' ? v : Number(v)
      if (Number.isFinite(n)) out[field.key] = n
      continue
    }
    if (field.kind === 'boolean') {
      // Parse by value so the string "false" doesn't become `true`.
      out[field.key] = typeof v === 'boolean' ? v : v === 'true'
      continue
    }
    out[field.key] = v
  }
  return out
}
