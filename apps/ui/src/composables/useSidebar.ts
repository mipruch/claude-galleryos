/**
 * Shared open-state for the mobile off-canvas sidebar drawer, so the header's
 * hamburger button and the sidebar itself (close button, backdrop, nav links)
 * can all reach it without prop-drilling. Module-level singleton ref, same
 * pattern as useCommandPalette.ts. Irrelevant at `md:` and up, where the
 * sidebar is always visible regardless of this state.
 */
import { ref } from 'vue'

const open = ref(false)

export function useSidebar() {
  return {
    open,
    openSidebar: (): void => {
      open.value = true
    },
    close: (): void => {
      open.value = false
    },
    toggle: (): void => {
      open.value = !open.value
    },
  }
}
