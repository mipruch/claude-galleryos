<script setup lang="ts">
/**
 * Simple username + password lock screen for the whole app (see
 * PLAN.md "Priority 6"). This is a front-end gate, not a hardened session —
 * a successful login just tells `useAuthStore` who's using this browser, so
 * the router guard and the devices store know what to show.
 */
import { useForm } from 'vee-validate'
import { toTypedSchema } from '@vee-validate/zod'
import { z } from 'zod'
import { useRoute, useRouter } from 'vue-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()

const validationSchema = toTypedSchema(
  z.object({
    username: z.string().min(1, 'Required'),
    password: z.string().min(1, 'Required'),
  }),
)

const { handleSubmit, isSubmitting } = useForm({ validationSchema })

const submit = handleSubmit(async (values) => {
  const ok = await auth.login(values.username, values.password)
  if (!ok) return
  const redirect = route.query.redirect
  router.push(typeof redirect === 'string' && redirect ? redirect : '/')
})
</script>

<template>
  <div class="bg-background flex min-h-screen items-center justify-center p-4">
    <Card class="w-full max-w-sm">
      <CardHeader>
        <CardTitle>GalleryOS</CardTitle>
        <CardDescription>Sign in to continue</CardDescription>
      </CardHeader>
      <CardContent>
        <form class="flex flex-col gap-4" @submit="submit">
          <FormField v-slot="{ componentField }" name="username">
            <FormItem>
              <FormLabel>Username</FormLabel>
              <FormControl>
                <Input autocomplete="username" autofocus v-bind="componentField" />
              </FormControl>
              <FormMessage />
            </FormItem>
          </FormField>

          <FormField v-slot="{ componentField }" name="password">
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl>
                <Input type="password" autocomplete="current-password" v-bind="componentField" />
              </FormControl>
              <FormMessage />
            </FormItem>
          </FormField>

          <p v-if="auth.error" class="text-destructive text-sm">{{ auth.error }}</p>

          <Button type="submit" class="w-full" :disabled="isSubmitting">
            {{ isSubmitting ? 'Signing in…' : 'Sign in' }}
          </Button>
        </form>
      </CardContent>
    </Card>
  </div>
</template>
