/**
 * Resolves which generic widgets a device supports, from its driver manifest.
 *
 * A device knows its connection (→ driver) and its endpoint type (`subtype`);
 * the driver manifest declares that endpoint's `widgets`. This composable joins
 * those two stores exactly like `useDeviceCommands` does for scene-editor
 * commands, so `DeviceWidget.vue` never has to know a device's driver id.
 */
import type { WidgetBinding } from '@gallery/driver-core'
import { useConnectionsStore } from '@/stores/connections'
import { useDriversStore } from '@/stores/drivers'
import { isCustomWidgetType, isRenderableType } from '@/lib/widgets'
import type { DeviceRecord } from '@/lib/devices'

export function useDeviceWidgets() {
  const connections = useConnectionsStore()
  const drivers = useDriversStore()

  const driverIdOf = (device: DeviceRecord): string | undefined =>
    connections.connections.find((c) => c.id === device.connectionId)?.driverId

  /** The generic widget bindings this device's endpoint type declares (empty if none/unknown). */
  const widgetsFor = (device: DeviceRecord): WidgetBinding[] =>
    drivers.endpointType(driverIdOf(device), device.subtype ?? undefined)?.widgets ?? []

  /** Whether the UI knows how to render this device at all — generic widgets or a named exception. */
  const isRenderable = (device: DeviceRecord): boolean =>
    isRenderableType(device.subtype, widgetsFor(device))

  return { widgetsFor, isRenderable, isCustomWidgetType }
}
