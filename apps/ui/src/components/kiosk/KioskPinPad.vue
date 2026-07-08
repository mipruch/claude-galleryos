<script setup lang="ts">
/**
 * Numeric PIN pad shown by KioskView when a kiosk has a PIN configured and
 * this browser hasn't unlocked it yet. Purely front-end (see PLAN.md
 * "Priority 6") — the PIN travels with the kiosk's own config fetch and is
 * compared locally by the parent; there's no backend call for the check.
 */
import { ref } from 'vue'
import { DeleteIcon } from '@lucide/vue'
import { Button } from '@/components/ui/button'

defineProps<{ error?: boolean }>()
const emit = defineEmits<{ submit: [pin: string] }>()

const MAX_LENGTH = 10
const digits = ref('')

function press(digit: string): void {
  if (digits.value.length >= MAX_LENGTH) return
  digits.value += digit
}
function backspace(): void {
  digits.value = digits.value.slice(0, -1)
}
function clear(): void {
  digits.value = ''
}
function submit(): void {
  if (!digits.value) return
  emit('submit', digits.value)
  digits.value = ''
}
</script>

<template>
  <div class="bg-background flex min-h-screen flex-col items-center justify-center gap-6 p-4">
    <div class="flex flex-col items-center gap-3">
      <p class="text-foreground text-lg font-medium">Enter PIN</p>
      <div class="flex min-h-3 gap-2">
        <span v-for="i in digits.length" :key="i" class="bg-foreground size-3 rounded-full" />
      </div>
      <p v-if="error" class="text-destructive text-sm">Incorrect PIN</p>
    </div>

    <div class="grid grid-cols-3 gap-3">
      <Button
        v-for="n in ['1', '2', '3', '4', '5', '6', '7', '8', '9']"
        :key="n"
        type="button"
        variant="outline"
        class="size-16 text-xl"
        @click="press(n)"
      >
        {{ n }}
      </Button>
      <Button type="button" variant="ghost" class="size-16 text-sm" @click="clear">Clear</Button>
      <Button type="button" variant="outline" class="size-16 text-xl" @click="press('0')">0</Button>
      <Button type="button" variant="ghost" class="size-16" aria-label="Backspace" @click="backspace">
        <DeleteIcon class="size-5" />
      </Button>
    </div>

    <Button type="button" class="w-full max-w-56" size="lg" :disabled="!digits.length" @click="submit">
      Unlock
    </Button>
  </div>
</template>
