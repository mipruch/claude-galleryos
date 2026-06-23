<script setup lang="ts">
import { toValue } from "vue"
import { useFormField } from "./useFormField"

const { error, formMessageId } = useFormField()
</script>

<template>
  <p
    v-if="error"
    :id="formMessageId"
    data-slot="form-message"
    class="text-destructive text-sm font-medium"
  >
    {{ toValue(error) }}
  </p>
</template>
