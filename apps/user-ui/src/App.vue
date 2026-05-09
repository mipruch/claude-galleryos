<script setup lang="ts">
import { onMounted } from 'vue';
import { useGalleryStore } from './store';

const store = useGalleryStore();
onMounted(() => store.load());
</script>

<template>
  <div class="h-full flex flex-col">
    <div
      v-if="!store.wsConnected"
      class="bg-red-700 text-white text-center text-sm py-1"
    >
      Spojení se serverem ztraceno…
    </div>
    <header class="bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
      <h1 class="font-bold text-blue-400">GalleryOS</h1>
      <nav class="space-x-2 text-sm">
        <RouterLink to="/" active-class="text-blue-400">Panel</RouterLink>
        <RouterLink to="/status" active-class="text-blue-400">Stav</RouterLink>
      </nav>
    </header>
    <main class="flex-1 overflow-y-auto">
      <RouterView />
    </main>
    <div class="fixed bottom-4 left-4 space-y-2 z-50">
      <div
        v-for="t in store.toasts"
        :key="t.id"
        class="px-4 py-2 rounded-lg shadow-lg text-sm"
        :class="{
          'bg-red-700 text-white': t.level === 'error',
          'bg-yellow-700 text-white': t.level === 'warn',
          'bg-blue-700 text-white': t.level === 'info',
        }"
      >
        {{ t.message }}
      </div>
    </div>
  </div>
</template>
