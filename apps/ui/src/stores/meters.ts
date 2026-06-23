/**
 * Meters store — live BSS meter levels for the meter-widget bars.
 *
 * A widget calls `subscribe(deviceId)` when it mounts and `unsubscribe(deviceId)`
 * when it dismounts (route change / hidden by a filter). Subscriptions are
 * ref-counted per device so two copies of the same widget on screen only send one
 * server subscription, and the server is only told to stop once the last copy is
 * gone. The server in turn keeps a single BSS subscription per physical meter.
 *
 * Incoming `meter:update` messages are stored by `node:object:param`; widgets read
 * their bars via `levelFor(node, object, param)`. On reconnect every active widget
 * is re-subscribed (the previous socket's subscriptions died with it).
 */

import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { useRealtimeStore } from './realtime'

const keyOf = (node: number, object: number, param: number): string => `${node}:${object}:${param}`

export const useMetersStore = defineStore('meters', () => {
  const rt = useRealtimeStore()

  /** Latest 0..1 level per `node:object:param`. */
  const levels = ref<Record<string, number>>({})
  /** Active widget subscriptions, deviceId → mounted-instance count. */
  const refs = new Map<string, number>()

  rt.on('meter:update', (d) => {
    levels.value[keyOf(d.node, d.object, d.param)] = d.level
  })

  // The server forgets all subscriptions when a socket drops; re-arm on reconnect.
  watch(
    () => rt.connected,
    (isConnected) => {
      if (!isConnected) return
      for (const deviceId of refs.keys()) rt.send({ event: 'meter:subscribe', data: { deviceId } })
    },
  )

  function subscribe(deviceId: string): void {
    const count = (refs.get(deviceId) ?? 0) + 1
    refs.set(deviceId, count)
    if (count === 1 && rt.connected) rt.send({ event: 'meter:subscribe', data: { deviceId } })
  }

  function unsubscribe(deviceId: string): void {
    const count = (refs.get(deviceId) ?? 0) - 1
    if (count > 0) {
      refs.set(deviceId, count)
      return
    }
    refs.delete(deviceId)
    if (rt.connected) rt.send({ event: 'meter:unsubscribe', data: { deviceId } })
  }

  const levelFor = (node: number, object: number, param = 0): number =>
    levels.value[keyOf(node, object, param)] ?? 0

  return { levels, subscribe, unsubscribe, levelFor }
})
