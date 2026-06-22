/**
 * Resolves what a device can be told to do, for the scene-action editor.
 *
 * A device knows its connection (→ driver) and its endpoint type (`subtype`);
 * the driver manifest declares that endpoint's commands and each command's
 * `paramsSchema`. This composable joins those three stores so the editor can
 * offer the right command list and render the right param fields.
 */
import type { CommandDefinition, JsonSchema } from '@gallery/driver-core'
import { useConnectionsStore } from '@/stores/connections'
import { useDevicesStore } from '@/stores/devices'
import { useDriversStore } from '@/stores/drivers'

export function useDeviceCommands() {
  const devices = useDevicesStore()
  const connections = useConnectionsStore()
  const drivers = useDriversStore()

  const driverForDevice = (deviceId: string): string | undefined => {
    const device = devices.records.find((d) => d.id === deviceId)
    if (!device) return undefined
    return connections.connections.find((c) => c.id === device.connectionId)?.driverId
  }

  /** Commands available for a device (via its driver + endpoint type). */
  const commandsFor = (deviceId: string): CommandDefinition[] => {
    const device = devices.records.find((d) => d.id === deviceId)
    if (!device) return []
    return drivers.endpointType(driverForDevice(deviceId), device.subtype)?.commands ?? []
  }

  /** The param schema for one command on a device (for dynamic param fields). */
  const paramsSchemaFor = (deviceId: string, command: string): JsonSchema | undefined =>
    commandsFor(deviceId).find((c) => c.command === command)?.paramsSchema

  return { commandsFor, paramsSchemaFor }
}
