/**
 * Shared open-state for the command palette, so any control (the global ⌘K
 * handler inside `CommandPalette`, or a header trigger button) can open it
 * without prop-drilling. Module-level singleton ref.
 */
import { ref } from 'vue'

const open = ref(false)

export function useCommandPalette() {
  return {
    open,
    openPalette: (): void => {
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
