<script setup lang="ts">
/**
 * Dry-run an input signal against the enabled mappings — `POST /mappings/test`,
 * which matches but never dispatches. Lets an admin confirm a pattern matches
 * and see the path params it captures before wiring real trigger actions to
 * it (the wired actions' resolved params are a dispatch-time concern, not
 * something this dry-run resolves).
 */
import { ref, watch } from 'vue'
import { PlayIcon } from '@lucide/vue'
import type { InputMappingTestResult } from '@gallery/types'
import { useMappingsStore } from '@/stores/mappings'
import { PROTOCOL_OPTIONS, parseTestArgs } from '@/lib/mappings'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const store = useMappingsStore()

const protocol = ref('osc')
const address = ref('/')
const argsText = ref('')
const result = ref<InputMappingTestResult | null>(null)
const running = ref(false)

// Reset the result whenever the dialog is (re)opened.
watch(
  () => props.open,
  (open) => {
    if (open) result.value = null
  },
)

async function run(): Promise<void> {
  running.value = true
  try {
    result.value = await store.test({
      protocol: protocol.value,
      address: address.value,
      args: parseTestArgs(argsText.value),
    })
  } finally {
    running.value = false
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-h-[85vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Test a signal</DialogTitle>
        <DialogDescription>Match a sample signal against the enabled rules. Nothing is dispatched.</DialogDescription>
      </DialogHeader>

      <div class="flex flex-col gap-4">
        <div class="grid grid-cols-[8rem_1fr] gap-3">
          <div class="flex flex-col gap-1.5">
            <Label>Protocol</Label>
            <Select v-model="protocol">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem v-for="p in PROTOCOL_OPTIONS" :key="p.value" :value="p.value">{{ p.label }}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div class="flex flex-col gap-1.5">
            <Label>Address</Label>
            <Input v-model="address" class="font-mono" placeholder="/dim/0.5" @keyup.enter="run" />
          </div>
        </div>

        <div class="flex flex-col gap-1.5">
          <Label>Arguments</Label>
          <Input v-model="argsText" class="font-mono" placeholder='0.5  or  ["HDMI1", 2]' @keyup.enter="run" />
          <p class="text-muted-foreground text-xs">A JSON array, or a single bare value. Referenced as <code>{arg[0]}</code>, …</p>
        </div>

        <Button class="self-start" :disabled="running || !address" @click="run">
          <PlayIcon class="size-4" />
          Test
        </Button>

        <!-- results -->
        <div v-if="result" class="rounded-md border">
          <div v-if="result.matched" class="divide-y">
            <div v-for="m in result.matches" :key="m.id" class="flex flex-col gap-1 p-3">
              <span class="font-medium">{{ m.name }}</span>
              <pre v-if="Object.keys(m.pathParams).length" class="text-muted-foreground bg-muted/40 rounded p-2 text-xs">{{ JSON.stringify(m.pathParams) }}</pre>
              <p v-else class="text-muted-foreground text-xs">No captured path params.</p>
            </div>
          </div>
          <p v-else class="text-muted-foreground p-6 text-center text-sm">
            No rule matched. Check the protocol and pattern.
          </p>
        </div>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" @click="emit('update:open', false)">Close</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
