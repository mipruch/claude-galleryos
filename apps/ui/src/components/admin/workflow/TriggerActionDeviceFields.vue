<script setup lang="ts">
/**
 * The device.command-specific fields of the trigger-action inspector (device,
 * command, params) — split out from `TriggerActionInspector` purely to keep
 * that component's template from accumulating every target-type's fields in
 * one block. Registers its `FormField`s against the parent's `useForm()`
 * context the normal vee-validate way (provide/inject reaches into child
 * components), so it isn't a form of its own.
 */
import type { CommandDefinition } from '@gallery/driver-core'
import type { DeviceDTO } from '@gallery/types'
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

defineProps<{
  devices: DeviceDTO[]
  deviceCommands: CommandDefinition[]
  targetId: string
  isTemplated: boolean
}>()
</script>

<template>
  <FormField v-slot="{ componentField }" name="targetId">
    <FormItem>
      <FormLabel>Device</FormLabel>
      <Select v-bind="componentField">
        <FormControl>
          <SelectTrigger><SelectValue placeholder="Not wired yet…" /></SelectTrigger>
        </FormControl>
        <SelectContent>
          <SelectGroup>
            <SelectItem v-for="d in devices" :key="d.id" :value="d.id">{{ d.name }}</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <FormMessage />
    </FormItem>
  </FormField>

  <FormField v-slot="{ componentField }" name="targetCommand">
    <FormItem>
      <FormLabel>Command</FormLabel>
      <Select v-bind="componentField" :disabled="!targetId">
        <FormControl>
          <SelectTrigger>
            <SelectValue :placeholder="targetId ? 'Not wired yet…' : 'Pick a device first'" />
          </SelectTrigger>
        </FormControl>
        <SelectContent>
          <SelectGroup>
            <SelectItem v-for="c in deviceCommands" :key="c.command" :value="c.command">
              {{ c.command }}
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      <FormMessage />
    </FormItem>
  </FormField>

  <FormField v-slot="{ componentField }" name="params">
    <FormItem>
      <FormLabel>Params</FormLabel>
      <FormControl>
        <Textarea class="font-mono text-xs" rows="4" placeholder="{}" v-bind="componentField" />
      </FormControl>
      <FormDescription v-if="isTemplated">
        JSON. Reference the signal with <code>{arg[0]}</code> (Nth argument) or <code>{:name}</code> (captured path
        param); other values are literals.
      </FormDescription>
      <FormDescription v-else>JSON. A cron fire has no signal, so these values are used as-is.</FormDescription>
      <FormMessage />
    </FormItem>
  </FormField>
</template>
