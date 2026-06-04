<script setup lang="ts">
import Button from './components/ui/button/Button.vue';
import { toast } from 'vue-sonner'

import 'vue-sonner/style.css'
import { Toaster } from '@/components/ui/sonner'

</script>

<template>
  <h1 class="text-3xl">You did it!</h1>
  <p>
    Visit <a href="https://vuejs.org/" target="_blank" rel="noopener">vuejs.org</a> to read the
    documentation
  </p>
  <Button  @click="() => toast('My first toast')">Click me</Button>
  <Toaster />
</template>

<style scoped></style>
