import { ref } from 'vue'

const isRaining = ref(false)

export function useRaining() {
  return {
    isRaining,
    startRaining: (): void => {
      isRaining.value = true
    },
    stopRaining: (): void => {
      isRaining.value = false
    },
    toggleRaining: (): void => {
      isRaining.value = !isRaining.value
    },
  }
}
