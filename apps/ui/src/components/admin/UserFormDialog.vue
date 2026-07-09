<script setup lang="ts">
/**
 * Create / edit a user. No self-registration — an admin sets the initial
 * password here, and can change it later (leave the field blank on edit to
 * keep the current one).
 */
import { computed, watch } from 'vue'
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { z } from 'zod'
import type { UserDTO, UserUpdateInput } from '@gallery/types'
import { useUsersStore } from '@/stores/users'
import { useRolesStore } from '@/stores/roles'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'

const props = defineProps<{ open: boolean; user?: UserDTO | null }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()

const store = useUsersStore()
const roles = useRolesStore()
const isEdit = computed(() => !!props.user)

const validationSchema = toTypedSchema(
  z.object({
    username: z.string().min(1, 'Required'),
    password: z.string().optional().refine((v) => !v || v.length >= 6, 'At least 6 characters'),
    displayName: z.string().optional(),
    roleId: z.string().min(1, 'Required'),
    enabled: z.boolean(),
  }),
)

const { handleSubmit, resetForm, isSubmitting, setFieldError } = useForm({ validationSchema })

function hydrate(): void {
  const u = props.user
  resetForm({
    values: {
      username: u?.username ?? '',
      password: '',
      displayName: u?.displayName ?? '',
      roleId: u?.roleId ?? '',
      enabled: u?.enabled ?? true,
    },
  })
}

watch(
  () => props.open,
  (open) => {
    if (open) hydrate()
  },
  { immediate: true },
)

const submit = handleSubmit(async (values) => {
  if (!isEdit.value && !values.password) {
    setFieldError('password', 'Required')
    return
  }

  let ok: boolean
  if (props.user) {
    const patch: UserUpdateInput = {
      username: values.username,
      displayName: values.displayName || undefined,
      roleId: values.roleId,
      enabled: values.enabled,
    }
    if (values.password) patch.password = values.password
    ok = !!(await store.update(props.user.id, patch))
  } else {
    ok = !!(await store.create({
      username: values.username,
      password: values.password!,
      displayName: values.displayName || undefined,
      roleId: values.roleId,
      enabled: values.enabled,
    }))
  }
  if (ok) emit('update:open', false)
})
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{{ isEdit ? 'Edit user' : 'New user' }}</DialogTitle>
        <DialogDescription>No self-registration — accounts are created here only.</DialogDescription>
      </DialogHeader>

      <form class="flex flex-col gap-4" @submit="submit">
        <FormField v-slot="{ componentField }" name="username">
          <FormItem>
            <FormLabel>Username</FormLabel>
            <FormControl><Input autocomplete="off" v-bind="componentField" /></FormControl>
            <FormMessage />
          </FormItem>
        </FormField>

        <FormField v-slot="{ componentField }" name="password">
          <FormItem>
            <FormLabel>{{ isEdit ? 'New password' : 'Password' }}</FormLabel>
            <FormControl>
              <Input
                type="password"
                autocomplete="new-password"
                :placeholder="isEdit ? 'Leave blank to keep current' : ''"
                v-bind="componentField"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        </FormField>

        <FormField v-slot="{ componentField }" name="displayName">
          <FormItem>
            <FormLabel>Display name</FormLabel>
            <FormControl><Input placeholder="Optional" v-bind="componentField" /></FormControl>
            <FormMessage />
          </FormItem>
        </FormField>

        <FormField v-slot="{ componentField }" name="roleId">
          <FormItem>
            <FormLabel>Role</FormLabel>
            <Select v-bind="componentField">
              <FormControl><SelectTrigger class="w-full"><SelectValue placeholder="Select a role" /></SelectTrigger></FormControl>
              <SelectContent>
                <SelectGroup>
                  <SelectItem v-for="r in roles.records" :key="r.id" :value="r.id">{{ r.name }}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        </FormField>

        <FormField v-slot="{ value, handleChange }" name="enabled">
          <FormItem>
            <div class="flex items-center justify-between gap-4">
              <div>
                <FormLabel>Enabled</FormLabel>
                <FormDescription>Disable to block sign-in without deleting the account.</FormDescription>
              </div>
              <FormControl><Switch :model-value="!!value" @update:model-value="handleChange" /></FormControl>
            </div>
          </FormItem>
        </FormField>

        <DialogFooter>
          <Button type="button" variant="outline" @click="emit('update:open', false)">Cancel</Button>
          <Button type="submit" :disabled="isSubmitting">{{ isEdit ? 'Save changes' : 'Create' }}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
