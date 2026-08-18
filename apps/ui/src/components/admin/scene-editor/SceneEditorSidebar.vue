<script setup lang="ts">
/**
 * Left metadata panel of the scene editor — name, room, description, look
 * (icon + colour, both picked from the app's global sets, never typed) and
 * tags. Every field is a vee-validate `FormField`; the form itself
 * (`useForm`) is owned by the parent `SceneEditorDialog` so its Save button
 * can trigger the same submit this panel's fields validate against — Vue's
 * provide/inject reaches across the component boundary the same way it would
 * within one file.
 */
import { useDevicesStore } from '@/stores/devices'
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import IconPicker from './IconPicker.vue'
import ColorPicker from './ColorPicker.vue'
import TagsField from './TagsField.vue'
import { DEFAULT_PALETTE_COLOR } from '@/lib/palette'

const devices = useDevicesStore()

const NONE = '__none__'
</script>

<template>
  <div class="flex flex-col gap-5">
    <FormField v-slot="{ componentField }" name="name">
      <FormItem>
        <FormLabel class="text-muted-foreground text-xs tracking-wide uppercase">Name</FormLabel>
        <FormControl><Input placeholder="e.g. Lecture mode" v-bind="componentField" /></FormControl>
        <FormMessage />
      </FormItem>
    </FormField>

    <FormField v-slot="{ value, handleChange }" name="roomId">
      <FormItem>
        <FormLabel class="text-muted-foreground text-xs tracking-wide uppercase">Room</FormLabel>
        <Select
          :model-value="(value as string) || NONE"
          @update:model-value="handleChange($event === NONE ? '' : $event)"
        >
          <FormControl>
            <SelectTrigger class="w-full"><SelectValue placeholder="No room" /></SelectTrigger>
          </FormControl>
          <SelectContent>
            <SelectGroup>
              <SelectItem :value="NONE">No room</SelectItem>
              <SelectItem v-for="r in devices.rooms" :key="r.id" :value="r.id">{{ r.name }}</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <FormMessage />
      </FormItem>
    </FormField>

    <FormField v-slot="{ componentField }" name="description">
      <FormItem>
        <FormLabel class="text-muted-foreground text-xs tracking-wide uppercase">Description</FormLabel>
        <FormControl><Textarea rows="3" v-bind="componentField" /></FormControl>
        <FormMessage />
      </FormItem>
    </FormField>

    <div class="space-y-2">
      <Label class="text-muted-foreground text-xs tracking-wide uppercase">Icon &amp; colour</Label>
      <FormField v-slot="{ value: color, handleChange: setColor }" name="color">
        <FormField v-slot="{ value: icon, handleChange: setIcon }" name="icon">
          <div class="flex items-center gap-3">
            <IconPicker
              :model-value="(icon as string) || ''"
              :color="(color as string) || DEFAULT_PALETTE_COLOR"
              @update:model-value="setIcon"
            />
            <ColorPicker :model-value="(color as string) || DEFAULT_PALETTE_COLOR" @update:model-value="setColor" />
          </div>
        </FormField>
      </FormField>
    </div>

    <FormField v-slot="{ value, handleChange }" name="tags">
      <FormItem>
        <FormLabel class="text-muted-foreground text-xs tracking-wide uppercase">Tags</FormLabel>
        <TagsField :model-value="(value as string[]) ?? []" @update:model-value="handleChange" />
      </FormItem>
    </FormField>

    <FormField v-slot="{ value, handleChange }" name="isFavorite">
      <FormItem>
        <div class="flex items-center justify-between gap-4">
          <div>
            <FormLabel>Favourite</FormLabel>
            <FormDescription>Show in quick actions</FormDescription>
          </div>
          <FormControl>
            <Switch
              class="data-[state=checked]:bg-brand"
              :model-value="!!value"
              @update:model-value="handleChange"
            />
          </FormControl>
        </div>
      </FormItem>
    </FormField>
  </div>
</template>
