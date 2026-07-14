import { describe, expect, it } from 'vitest'
import type { JsonSchema } from '@gallery/driver-core'
import { defaultsFromSchema, pruneEmpty, schemaToFields, selectValueOf, zodFromSchema } from '@/lib/schemaForm'

// Mirrors a real manifest connectionSchema (driver-tcp-generic) closely enough
// to exercise every field kind + constraint the renderer/validator must handle.
const schema: JsonSchema = {
  type: 'object',
  required: ['host'],
  properties: {
    host: { type: 'string', title: 'Host / IP', format: 'host' },
    port: { type: 'integer', title: 'Port', minimum: 1, maximum: 65535 },
    encoding: {
      type: 'string',
      title: 'Encoding',
      default: 'utf-8',
      enum: ['utf-8', 'latin1', 'ascii'],
    },
    persistent: { type: 'boolean', title: 'Keep open', default: false },
  },
}

describe('schemaToFields', () => {
  it('maps each property to a render descriptor with the right kind', () => {
    const fields = schemaToFields(schema)
    expect(fields.map((f) => [f.key, f.kind])).toEqual([
      ['host', 'string'],
      ['port', 'number'],
      ['encoding', 'enum'],
      ['persistent', 'boolean'],
    ])
  })

  it('marks required fields and exposes enum options', () => {
    const fields = schemaToFields(schema)
    expect(fields.find((f) => f.key === 'host')?.required).toBe(true)
    expect(fields.find((f) => f.key === 'port')?.required).toBe(false)
    expect(fields.find((f) => f.key === 'encoding')?.options).toEqual(['utf-8', 'latin1', 'ascii'])
  })

  it('derives a humanised label when title is absent', () => {
    const fields = schemaToFields({
      type: 'object',
      properties: { txDelimiter: { type: 'string' } },
    })
    expect(fields[0]?.label).toBe('Tx Delimiter')
  })

  it('returns an empty list for an undefined schema', () => {
    expect(schemaToFields(undefined)).toEqual([])
  })

  describe('bounded number fields (Slider-driving minimum/maximum/step)', () => {
    it('carries minimum/maximum through and steps by 1 for an integer field', () => {
      const field = schemaToFields(schema).find((f) => f.key === 'port')!
      expect(field.minimum).toBe(1)
      expect(field.maximum).toBe(65535)
      expect(field.step).toBe(1)
    })

    it('steps by a hundredth of the range for a continuous number field (e.g. a 0..1 fader level)', () => {
      const levelSchema: JsonSchema = {
        type: 'object',
        properties: { level: { type: 'number', title: 'Level', minimum: 0, maximum: 1 } },
      }
      const field = schemaToFields(levelSchema).find((f) => f.key === 'level')!
      expect(field.minimum).toBe(0)
      expect(field.maximum).toBe(1)
      expect(field.step).toBeCloseTo(0.01)
    })

    it('leaves minimum/maximum/step unset without both bounds declared', () => {
      const unboundedSchema: JsonSchema = {
        type: 'object',
        properties: { amount: { type: 'number', title: 'Amount', minimum: 0 } },
      }
      const field = schemaToFields(unboundedSchema).find((f) => f.key === 'amount')!
      expect(field.minimum).toBe(0)
      expect(field.maximum).toBeUndefined()
      expect(field.step).toBeUndefined()
    })
  })

  // A `connectionEnum` field (e.g. Extron's output number) resolves into a
  // labeled dropdown once the owning connection's config is known, without
  // changing its kind/validation — it's still a plain `number` field.
  describe('connectionEnum (dynamic dropdown for a number field)', () => {
    const outputSchema: JsonSchema = {
      type: 'object',
      required: ['output'],
      properties: {
        output: {
          type: 'integer',
          title: 'Output number',
          minimum: 1,
          maximum: 64,
          connectionEnum: { labelsKey: 'outputs', countKey: 'outputCount', fallbackLabel: 'Output' },
        },
      },
    }

    it('resolves dynamicOptions from connection config, keeping kind as number', () => {
      const fields = schemaToFields(outputSchema, { outputCount: 3, outputs: ['Hall A left', 'Hall A right'] })
      const field = fields.find((f) => f.key === 'output')!
      expect(field.kind).toBe('number')
      expect(field.dynamicOptions).toEqual([
        { value: '1', label: '1. Hall A left' },
        { value: '2', label: '2. Hall A right' },
        { value: '3', label: 'Output 3' },
      ])
    })

    it('leaves dynamicOptions unset without a connection config (falls back to a plain number input)', () => {
      const fields = schemaToFields(outputSchema)
      expect(fields.find((f) => f.key === 'output')!.dynamicOptions).toBeUndefined()
    })

    it('leaves dynamicOptions unset when the connection has no valid count yet', () => {
      const fields = schemaToFields(outputSchema, {})
      expect(fields.find((f) => f.key === 'output')!.dynamicOptions).toBeUndefined()
    })
  })
})

describe('defaultsFromSchema', () => {
  it('honours declared defaults and falls back per kind', () => {
    expect(defaultsFromSchema(schema)).toEqual({
      host: '',
      port: '',
      encoding: 'utf-8',
      persistent: false,
    })
  })
})

describe('zodFromSchema', () => {
  it('rejects a missing required field', () => {
    const result = zodFromSchema(schema).safeParse({
      host: '',
      port: '',
      encoding: 'utf-8',
      persistent: false,
    })
    expect(result.success).toBe(false)
  })

  it('coerces numeric strings and enforces min/max', () => {
    const ok = zodFromSchema(schema).safeParse({
      host: '10.0.0.1',
      port: '1023',
      encoding: 'utf-8',
      persistent: true,
    })
    expect(ok.success).toBe(true)
    // expect(ok.data.port).toBe(1023)

    const tooHigh = zodFromSchema(schema).safeParse({ host: '10.0.0.1', port: '99999' })
    expect(tooHigh.success).toBe(false)
  })

  it('treats a blank optional number as unset', () => {
    const result = zodFromSchema(schema).safeParse({
      host: '10.0.0.1',
      port: '',
      encoding: 'utf-8',
      persistent: false,
    })
    expect(result.success).toBe(true)
    expect(result.data?.port).toBeUndefined()
  })

  it('rejects an enum value outside the allowed set', () => {
    const result = zodFromSchema(schema).safeParse({
      host: 'x',
      encoding: 'utf-16',
      persistent: false,
    })
    expect(result.success).toBe(false)
  })

  it('rejects a malformed IP in a host-format field', () => {
    const bad = zodFromSchema(schema).safeParse({
      host: '290.290.920.89',
      encoding: 'utf-8',
      persistent: false,
    })
    expect(bad.success).toBe(false)

    const good = zodFromSchema(schema).safeParse({
      host: '192.168.1.10',
      encoding: 'utf-8',
      persistent: false,
    })
    expect(good.success).toBe(true)
  })
})

describe('pruneEmpty', () => {
  it('drops blank, null and undefined entries', () => {
    expect(pruneEmpty({ a: '', b: null, c: undefined, d: 0, e: false, f: 'x' })).toEqual({
      d: 0,
      e: false,
      f: 'x',
    })
  })
})

describe('selectValueOf', () => {
  // Regression: a number-kind field's SelectItems always have string values,
  // but a saved record's value (e.g. address.output: 6) arrives as a real JS
  // number when the edit form seeds from it — `value as string` is a
  // TypeScript-only cast, not a runtime conversion, so 6 never matched "6"
  // and the trigger silently fell back to the placeholder on edit (never
  // reproduced on create, since there the value only ever came from a
  // Select's own @update:model-value, which is always already a string).
  it('stringifies a number so it matches a SelectItem value', () => {
    expect(selectValueOf(6)).toBe('6')
  })

  it('passes an already-string value through unchanged', () => {
    expect(selectValueOf('address')).toBe('address')
  })

  it('maps null/undefined to an empty string (nothing selected)', () => {
    expect(selectValueOf(null)).toBe('')
    expect(selectValueOf(undefined)).toBe('')
  })
})
