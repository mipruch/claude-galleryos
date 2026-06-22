import { describe, expect, it } from 'vitest'
import type { JsonSchema } from '@gallery/driver-core'
import { defaultsFromSchema, pruneEmpty, schemaToFields, zodFromSchema } from '@/lib/schemaForm'

// Mirrors a real manifest connectionSchema (driver-tcp-generic) closely enough
// to exercise every field kind + constraint the renderer/validator must handle.
const schema: JsonSchema = {
  type: 'object',
  required: ['host'],
  properties: {
    host: { type: 'string', title: 'Host / IP', format: 'hostname' },
    port: { type: 'integer', title: 'Port', minimum: 1, maximum: 65535 },
    encoding: { type: 'string', title: 'Encoding', default: 'utf-8', enum: ['utf-8', 'latin1', 'ascii'] },
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
    const fields = schemaToFields({ type: 'object', properties: { txDelimiter: { type: 'string' } } })
    expect(fields[0]?.label).toBe('Tx Delimiter')
  })

  it('returns an empty list for an undefined schema', () => {
    expect(schemaToFields(undefined)).toEqual([])
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
    const result = zodFromSchema(schema).safeParse({ host: '', port: '', encoding: 'utf-8', persistent: false })
    expect(result.success).toBe(false)
  })

  it('coerces numeric strings and enforces min/max', () => {
    const ok = zodFromSchema(schema).safeParse({ host: '10.0.0.1', port: '1023', encoding: 'utf-8', persistent: true })
    expect(ok.success).toBe(true)
    if (ok.success) expect(ok.data.port).toBe(1023)

    const tooHigh = zodFromSchema(schema).safeParse({ host: '10.0.0.1', port: '99999' })
    expect(tooHigh.success).toBe(false)
  })

  it('treats a blank optional number as unset', () => {
    const result = zodFromSchema(schema).safeParse({ host: '10.0.0.1', port: '', encoding: 'utf-8', persistent: false })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.port).toBeUndefined()
  })

  it('rejects an enum value outside the allowed set', () => {
    const result = zodFromSchema(schema).safeParse({ host: 'x', encoding: 'utf-16', persistent: false })
    expect(result.success).toBe(false)
  })
})

describe('pruneEmpty', () => {
  it('drops blank, null and undefined entries', () => {
    expect(pruneEmpty({ a: '', b: null, c: undefined, d: 0, e: false, f: 'x' })).toEqual({ d: 0, e: false, f: 'x' })
  })
})
