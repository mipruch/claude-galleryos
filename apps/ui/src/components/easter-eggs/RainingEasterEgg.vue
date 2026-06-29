<script setup lang="ts">
import { onMounted, ref, type CSSProperties } from 'vue'
import { CloudRainIcon, DropletIcon } from '@lucide/vue'

interface Raindrop {
  id: number
  left: number
  duration: number
  delay: number
}

interface Bucket {
  id: number
  left: number
}

const raindrops = ref<Raindrop[]>([])
const buckets = ref<Bucket[]>([])
let dropletId = 0
let bucketId = 0

onMounted(() => {
  // Create initial buckets
  const bucketCount = 5
  for (let i = 0; i < bucketCount; i++) {
    buckets.value.push({
      id: bucketId++,
      left: (i / bucketCount) * 100 + 10,
    })
  }

  // Continuously create raindrops
  const interval = setInterval(() => {
    const raindrop: Raindrop = {
      id: dropletId++,
      left: Math.random() * 100,
      duration: 2 + Math.random() * 1.5,
      delay: 0,
    }
    raindrops.value.push(raindrop)

    // Remove raindrop after animation completes
    setTimeout(() => {
      raindrops.value = raindrops.value.filter((d) => d.id !== raindrop.id)
    }, (raindrop.duration + 0.5) * 1000)
  }, 100)

  return () => clearInterval(interval)
})

const rainContainerStyle: CSSProperties = {
  position: 'fixed',
  inset: '0',
  pointerEvents: 'none',
  zIndex: '40',
  overflow: 'hidden',
}
</script>

<template>
  <div class="fixed inset-0 pointer-events-none z-40 overflow-hidden">
    <!-- Rain drops -->
    <div
      v-for="drop in raindrops"
      :key="drop.id"
      class="absolute w-1 h-3 bg-blue-400 rounded-full opacity-70"
      :style="{
        left: `${drop.left}%`,
        top: '-12px',
        animation: `fall ${drop.duration}s linear infinite`,
        animationDelay: `${drop.delay}ms`,
      }"
    />

    <!-- Buckets at the bottom -->
    <div class="fixed bottom-0 left-0 right-0 flex justify-around px-8 py-8 pointer-events-none">
      <div v-for="bucket in buckets" :key="bucket.id" class="flex flex-col items-center">
        <!-- Bucket visual -->
        <div
          class="relative w-12 h-10 bg-gradient-to-b from-amber-600 to-amber-800 rounded-b-lg border-2 border-amber-900"
          style="
            clipPath: 'polygon(20% 0%, 80% 0%, 100% 100%, 0% 100%)';
            boxShadow: inset 0 2px 4px rgba(0, 0, 0, 0.3);
          "
        >
          <!-- Bucket handle -->
          <div
            class="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-2 w-6 h-6 border-2 border-amber-900 rounded-full"
            style="
              transform: translateX(-50%) translateY(-8px);
            "
          />
        </div>
        <!-- Water droplets in bucket (animated) -->
        <div class="mt-1 text-blue-400 animate-pulse">
          <DropletIcon class="w-4 h-4" />
        </div>
      </div>
    </div>

    <!-- Cloud icon floating at top -->
    <div class="fixed top-8 left-1/2 transform -translate-x-1/2 text-gray-400 animate-bounce pointer-events-none">
      <CloudRainIcon class="w-12 h-12" />
    </div>
  </div>

  <style scoped>
    @keyframes fall {
      to {
        transform: translateY(100vh);
      }
    }
  </style>
</template>
