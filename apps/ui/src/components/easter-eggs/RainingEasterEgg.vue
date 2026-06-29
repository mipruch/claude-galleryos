<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'

const DROP_COUNT = 500

function rnd(max: number): number {
  return Math.floor(Math.random() * max) + 1
}

interface DropStyle {
  opacity: number
  left: string
  borderLeftWidth: string
  animationName: string
  animationDuration: string
  animationDelay: string
}

// Generate all drop data and keyframes once at component definition time.
// Each drop gets a unique fall-N keyframe so `var(--rain-angle)` is re-read
// live — that's the trick that makes the wind direction update instantly.
const drops: DropStyle[] = []
const kfLines: string[] = []

for (let i = 1; i <= DROP_COUNT; i++) {
  drops.push({
    opacity: rnd(90) * 0.01,
    left: `${rnd(1200) * 0.1}vw`,
    borderLeftWidth: `${rnd(80) * 0.1}vmin`,
    animationName: `rain-fall-${i}`,
    animationDuration: `${rnd(15) * 0.15}s`,
    animationDelay: `${rnd(25) * -0.5}s`,
  })
  // A tiny random start-percentage keeps drops spread across the screen on mount.
  const startPct = ((rnd(50) / 500) * 100).toFixed(2)
  kfLines.push(
    `@keyframes rain-fall-${i}{` +
      `${startPct}%{transform:rotate(var(--rain-angle)) translateX(0)}` +
      `to{transform:rotate(var(--rain-angle)) translateX(calc(100vh + 5vmin))}}`,
  )
}

const injectedCSS =
  `@property --rain-angle{syntax:"<angle>";inherits:true;initial-value:91deg;}\n` +
  kfLines.join('\n')

let styleEl: HTMLStyleElement | null = null
const isLightning = ref(false)
const angle = ref(91)
let lightningTimer: ReturnType<typeof setTimeout> | null = null

function onMouseMove(e: MouseEvent) {
  // Left edge → 105 deg, right edge → 77 deg, centre → 91 deg.
  angle.value = 105 - (e.clientX / window.innerWidth) * 28
}

function onMouseDown() {
  isLightning.value = true
  if (lightningTimer) clearTimeout(lightningTimer)
  lightningTimer = setTimeout(() => {
    isLightning.value = false
  }, 600)
}

onMounted(() => {
  styleEl = document.createElement('style')
  styleEl.textContent = injectedCSS
  document.head.appendChild(styleEl)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mousedown', onMouseDown)
})

onBeforeUnmount(() => {
  styleEl?.remove()
  window.removeEventListener('mousemove', onMouseMove)
  window.removeEventListener('mousedown', onMouseDown)
  if (lightningTimer) clearTimeout(lightningTimer)
})
</script>

<template>
  <div
    class="rain-scene"
    :class="{ lightning: isLightning }"
    :style="{ '--rain-angle': `${angle}deg` }"
  >
    <div
      v-for="(drop, i) in drops"
      :key="i"
      class="drop"
      :style="{
        opacity: drop.opacity,
        left: drop.left,
        borderLeftWidth: drop.borderLeftWidth,
        animationName: drop.animationName,
        animationDuration: drop.animationDuration,
        animationDelay: drop.animationDelay,
      }"
    />

    <!-- Buckets sitting at the bottom catching the rain -->
    <div class="buckets">
      <span v-for="n in 5" :key="n" class="bucket" :style="{ animationDelay: `${(n - 1) * 0.3}s` }">🪣</span>
    </div>
  </div>
</template>

<style scoped>
.rain-scene {
  position: fixed;
  inset: 0;
  z-index: 40;
  pointer-events: none;
  overflow: hidden;
  background: linear-gradient(180deg, rgba(7, 19, 28, 0.82), rgba(48, 84, 114, 0.82));
}

.rain-scene.lightning {
  animation: lightning 0.1s linear 0s 2, lightning 0.15s ease-out 0.25s 1;
}

@keyframes lightning {
  50% {
    background:
      radial-gradient(circle at calc(50% - 10vw) -20%, #fff4, #fff0 20%),
      linear-gradient(180deg, #fff9, #fff3);
  }
}

.drop {
  border: 0.25vmin solid transparent;
  border-bottom-color: #abc2e9;
  position: absolute;
  top: -5vmin;
  animation-timing-function: ease-in;
  animation-iteration-count: infinite;
}

.buckets {
  position: absolute;
  bottom: 1.5rem;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-around;
  padding: 0 4rem;
}

.bucket {
  font-size: 2.5rem;
  display: inline-block;
  filter: drop-shadow(0 0 6px rgba(171, 194, 233, 0.5));
  animation: wobble 1.8s ease-in-out infinite;
}

@keyframes wobble {
  0%, 100% { transform: rotate(-4deg); }
  50% { transform: rotate(4deg); }
}
</style>
