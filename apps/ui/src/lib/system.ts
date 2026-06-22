/**
 * Small presentation helpers for system / driver info shown on the admin
 * dashboard and settings pages. Pure and unit-tested.
 */
import type { DriverManifest } from '@gallery/driver-core'

/** "3d 4h" / "5h 12m" / "42s" — compact server uptime from a millisecond span. */
export function formatUptime(ms?: number | null): string {
  if (!ms || ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86_400)
  const h = Math.floor((s % 86_400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d) return `${d}d ${h}h`
  if (h) return `${h}h ${m}m`
  if (m) return `${m}m ${s % 60}s`
  return `${s}s`
}

/** Capability flags of a manifest as short labels (only the enabled ones). */
export function capabilityLabels(manifest: DriverManifest): string[] {
  const c = manifest.capabilities
  const out: string[] = []
  if (c?.discovery) out.push('discovery')
  if (c?.subscriptions) out.push('subscriptions')
  if (c?.bidirectional) out.push('bidirectional')
  return out
}
