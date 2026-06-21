/**
 * Realtime store — owns the single `/ws` WebSocket shared by every store.
 *
 * One connection, fanned out: any store registers handlers via `on(event, fn)`
 * and they all receive the matching `ServerMessage`. Outgoing `ClientMessage`s go
 * through `send()`. Lifecycle (`open`/`close`) is driven once by the app shell.
 *
 * Being a Pinia store makes it a per-pinia singleton — so tests get a fresh socket
 * (and fresh handlers) with `setActivePinia(createPinia())`.
 */

import { defineStore } from 'pinia'
import { computed } from 'vue'
import { useWebSocket } from '@vueuse/core'
import type { ClientMessage, ServerEvent, ServerMessage, ServerMessageData } from '@gallery/types'

/**
 * Builds a WebSocket URL for the realtime connection.
 *
 * @returns A WebSocket URL string pointing to `/ws` on the current host, using wss for HTTPS or ws for HTTP.
 */
function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws`
}

export const useRealtimeStore = defineStore('realtime', () => {
  const handlers = new Map<ServerEvent, Set<(data: unknown) => void>>()

  const { status, send: rawSend, open, close } = useWebSocket(wsUrl(), {
    immediate: false,
    autoReconnect: { retries: -1, delay: 2000 },
    onMessage: (_ws, ev) => dispatch(ev.data),
  })

  const connected = computed(() => status.value === 'OPEN')

  /**
   * Routes incoming WebSocket messages to registered event handlers.
   *
   * @param raw - Raw message payload, expected to be a JSON-serialized ServerMessage
   */
  function dispatch(raw: unknown): void {
    let msg: ServerMessage
    try {
      msg = JSON.parse(String(raw)) as ServerMessage
    } catch {
      return
    }
    const set = handlers.get(msg.event)
    if (set) for (const fn of set) fn(msg.data)
  }

  /**
   * Registers a handler for a server event.
   *
   * @param event - The server event to listen for
   * @param handler - The callback invoked when the event is received
   * @returns A function that unregisters the handler when called
   */
  function on<E extends ServerEvent>(
    event: E,
    handler: (data: ServerMessageData<E>) => void,
  ): () => void {
    let set = handlers.get(event)
    if (!set) handlers.set(event, (set = new Set()))
    const fn = handler as (data: unknown) => void
    set.add(fn)
    return () => set!.delete(fn)
  }

  const send = (msg: ClientMessage): void => {
    rawSend(JSON.stringify(msg))
  }

  return { connected, on, send, open, close }
})
