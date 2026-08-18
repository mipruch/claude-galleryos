<script setup lang="ts">
/**
 * The devices list's nudge: "9 connections have no device".
 *
 * A connection with no endpoint is invisible everywhere it matters — it can't
 * be put on a panel, referenced in a scene or run from the palette — so a bulk
 * connection import silently produces a system that looks half-empty with
 * nothing anywhere saying why. This banner is that missing signal, and it leads
 * straight into the review sheet rather than making the operator work out which
 * hundred sockets are the bare ones.
 *
 * It's dismissible and count-keyed: dismissing hides it for the connections it
 * was about, and a later import (a different count) brings it back rather than
 * staying silenced forever.
 */
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import type { ProvisionCandidate } from '@/lib/deviceProvisioning'
import { summarizeCandidates } from '@/lib/deviceProvisioning'

const props = defineProps<{ candidates: ProvisionCandidate[] }>()
const emit = defineEmits<{ review: []; dismiss: [] }>()

const summary = computed(() => summarizeCandidates(props.candidates))
</script>

<template>
  <div
    v-if="candidates.length"
    class="border-brand/30 bg-brand/5 flex flex-wrap items-center gap-4 rounded-lg border px-4 py-3"
  >
    <div
      class="bg-brand/15 text-brand flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold"
    >
      {{ candidates.length }}
    </div>
    <div class="min-w-0">
      <p class="text-sm font-semibold">
        {{ candidates.length }} connection{{ candidates.length === 1 ? '' : 's' }}
        {{ candidates.length === 1 ? 'has' : 'have' }} no device
      </p>
      <p class="text-muted-foreground truncate text-sm">{{ summary }}</p>
    </div>
    <div class="ml-auto flex shrink-0 items-center gap-2">
      <Button type="button" variant="ghost" size="sm" @click="emit('dismiss')">Dismiss</Button>
      <Button
        type="button"
        size="sm"
        class="bg-brand text-brand-foreground hover:bg-brand/90"
        @click="emit('review')"
      >
        Review
      </Button>
    </div>
  </div>
</template>
