import { describe, it, expect } from 'vitest'
import { isEmbeddableUrl, sortByDisplayOrder } from '@/lib/iframes'
import { makeIframe } from './fixtures'

describe('isEmbeddableUrl', () => {
  it('accepts absolute http(s) URLs', () => {
    for (const u of ['http://10.0.0.1:1338/ui', 'https://device.local/ui?x=1', 'https://example.com'])
      expect(isEmbeddableUrl(u)).toBe(true)
  })

  it('rejects empty, relative, or non-http(s) URLs', () => {
    for (const u of ['', '/ui', 'device.local/ui', 'ftp://host/file', 'javascript:alert(1)', 'not a url'])
      expect(isEmbeddableUrl(u)).toBe(false)
  })
})

describe('sortByDisplayOrder', () => {
  it('orders by displayOrder ascending, breaking ties on name', () => {
    const a = makeIframe({ id: 'a', name: 'Zebra', displayOrder: 1 })
    const b = makeIframe({ id: 'b', name: 'Apple', displayOrder: 0 })
    const c = makeIframe({ id: 'c', name: 'Mango', displayOrder: 0 })
    expect(sortByDisplayOrder([a, b, c]).map((f) => f.id)).toEqual(['b', 'c', 'a'])
  })

  it('does not mutate the input array', () => {
    const list = [makeIframe({ id: 'a', displayOrder: 2 }), makeIframe({ id: 'b', displayOrder: 1 })]
    const before = list.map((f) => f.id)
    sortByDisplayOrder(list)
    expect(list.map((f) => f.id)).toEqual(before)
  })
})
