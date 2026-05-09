<script setup lang="ts">
import { computed, ref } from 'vue';
import { useGalleryStore } from '../store';
import WidgetRenderer from '../components/WidgetRenderer.vue';

const store = useGalleryStore();
const activePage = ref(0);
const pages = computed<any[]>(() => store.layout?.config?.pages ?? []);
</script>

<template>
  <div class="max-w-3xl mx-auto p-4">
    <div v-if="!store.layout" class="text-center text-slate-500 py-16">
      Žádný výchozí layout. Otevřete Admin UI a vytvořte ho v sekci Layouty.
    </div>
    <template v-else>
      <nav v-if="pages.length > 1" class="flex gap-2 mb-4 overflow-x-auto">
        <button
          v-for="(p, i) in pages"
          :key="p.id"
          @click="activePage = i"
          class="px-4 py-2 rounded-full border whitespace-nowrap"
          :class="
            activePage === i
              ? 'bg-blue-600 border-blue-500 text-white'
              : 'bg-slate-800 border-slate-700'
          "
        >
          {{ p.name }}
        </button>
      </nav>
      <div class="grid grid-cols-2 gap-3">
        <WidgetRenderer
          v-for="(w, idx) in pages[activePage]?.widgets ?? []"
          :key="idx"
          :widget="w"
        />
      </div>
    </template>
  </div>
</template>
