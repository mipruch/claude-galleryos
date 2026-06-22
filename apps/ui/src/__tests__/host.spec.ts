import { describe, expect, it } from 'vitest'
import { isHost } from '@/lib/host'

describe('isHost', () => {
  it('accepts valid IPv4 addresses', () => {
    for (const v of ['192.168.1.10', '10.0.0.1', '0.0.0.0', '255.255.255.255'])
      expect(isHost(v)).toBe(true)
  })

  it('rejects IPv4 with out-of-range or padded octets', () => {
    for (const v of ['290.290.920.89', '256.1.1.1', '1.2.3.4.5', '1.2.3', '01.2.3.4'])
      expect(isHost(v)).toBe(false)
  })

  it('accepts hostnames', () => {
    for (const v of ['example.com', 'device-1.local', 'projector', 'a.b.c.d.example.org'])
      expect(isHost(v)).toBe(true)
  })

  it('accepts IPv6 literals and rejects garbage colons', () => {
    expect(isHost('::1')).toBe(true)
    expect(isHost('fe80::1')).toBe(true)
    expect(isHost('2001:db8:0:0:0:0:0:1')).toBe(true)
    expect(isHost(':::')).toBe(false)
    expect(isHost('1:2:3:4:5:6:7:')).toBe(false) // trailing single colon, no compression
    expect(isHost('1:2:3:4:5:6:7')).toBe(false) // too few hextets, no compression
  })

  it('rejects empty and obviously invalid hostnames', () => {
    for (const v of ['', ' ', 'bad host', 'has_underscore.com', '-leading.com'])
      expect(isHost(v)).toBe(false)
  })
})
