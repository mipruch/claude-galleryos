/**
 * Client-side inactivity auto-logout (see PLAN.md "Priority 6"). There's no
 * server session to expire — this just watches for user inactivity (mouse,
 * keyboard, touch) and calls `onTimeout` once the configured number of
 * minutes elapses with none. The general app shell logs out and redirects to
 * `/login`; the kiosk viewer re-shows its PIN pad in place instead of
 * navigating away — see their respective call sites.
 */
import { useIdle } from '@vueuse/core'
import { watch } from 'vue'

/**
 * Starts watching for inactivity.
 *
 * @returns A function that stops watching (call it before starting another
 * one, e.g. on re-login, so repeated calls don't stack up multiple timers).
 */
export function useInactivityLogout(timeoutMinutes: number, onTimeout: () => void): () => void {
  const { idle, stop } = useIdle(Math.max(1, timeoutMinutes) * 60_000)
  const unwatch = watch(idle, (isIdle) => {
    if (isIdle) onTimeout()
  })
  return () => {
    stop()
    unwatch()
  }
}
